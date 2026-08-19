use crate::config::Config;
use crate::domain::{
    RepositoryBlobPreview, RepositoryChangedFile as DomainRepositoryChangedFile,
    RepositoryChangedFileStatus as DomainRepositoryChangedFileStatus,
    RepositoryCommitIdentity as DomainRepositoryCommitIdentity,
    RepositoryDiffHunk as DomainRepositoryDiffHunk, RepositoryDiffLine as DomainRepositoryDiffLine,
    RepositoryDiffLineKind as DomainRepositoryDiffLineKind, RepositoryError,
    RepositoryMergeRequest, RepositoryMergeStrategy as DomainRepositoryMergeStrategy,
    RepositoryMergeStrategyAvailability as DomainRepositoryMergeStrategyAvailability,
    RepositoryMergeStrategyUnavailableReason as DomainRepositoryMergeStrategyUnavailableReason,
    RepositoryRefKind, RepositorySignature as DomainRepositorySignature,
    RepositorySignatureState as DomainRepositorySignatureState, RepositoryTreeEntryKind,
    TrustedGpgKey as DomainTrustedGpgKey,
};
use crate::proto::git_storage_service_server::GitStorageService;
use crate::proto::{
    CheckRepositoryMergeabilityRequest, CheckRepositoryMergeabilityResponse,
    CompareRepositoryRefsRequest, CompareRepositoryRefsResponse, CreateRepositoryRequest,
    CreateRepositoryResponse, FindRepositoryMergeReceiptRequest,
    FindRepositoryMergeReceiptResponse, GetRepositoryBlobRequest, GetRepositoryBlobResponse,
    GetRepositoryBrowserSummaryRequest, GetRepositoryBrowserSummaryResponse,
    GetRepositoryFileDiffRequest, GetRepositoryFileDiffResponse, GetRepositoryRawBlobRequest,
    GetRepositoryRawBlobResponse, GetRepositoryTreeRequest, GetRepositoryTreeResponse,
    HealthRequest, HealthResponse, ImportRepositoryRequest, ImportRepositoryResponse,
    ListRepositoryCommitsRequest, ListRepositoryCommitsResponse, ListRepositoryRefsRequest,
    ListRepositoryRefsResponse, MergeRepositoryRefsRequest, MergeRepositoryRefsResponse,
    PushRepositoryMirrorRequest, PushRepositoryMirrorResponse,
    RepositoryBlobPreviewState as ProtoRepositoryBlobPreviewState, RepositoryChangedFile,
    RepositoryChangedFileStatus, RepositoryCommit, RepositoryCommitIdentity,
    RepositoryComparisonCommit, RepositoryDiffHunk, RepositoryDiffLine, RepositoryDiffLineKind,
    RepositoryMergeStrategy as ProtoRepositoryMergeStrategy, RepositoryMergeStrategyAvailability,
    RepositoryMergeStrategyUnavailableReason as ProtoRepositoryMergeStrategyUnavailableReason,
    RepositoryReadme, RepositoryRef, RepositoryRefKind as ProtoRepositoryRefKind,
    RepositorySignature, RepositorySignatureState as ProtoRepositorySignatureState,
    RepositoryTreeEntry, RepositoryTreeEntryKind as ProtoRepositoryTreeEntryKind, TrustedGpgKey,
};
use crate::storage::application::GitStorageApplication;
use crate::storage::infrastructure::RepositoryStorage;
use tonic::{Request, Response, Status};

#[derive(Clone, Debug)]
pub struct GitStorageGrpcService {
    application: GitStorageApplication,
}

impl GitStorageGrpcService {
    pub fn new(config: Config) -> Self {
        let storage = RepositoryStorage::new(config.storage_root, config.git_binary);

        Self {
            application: GitStorageApplication::new(storage),
        }
    }
}

#[tonic::async_trait]
impl GitStorageService for GitStorageGrpcService {
    async fn health(
        &self,
        _request: Request<HealthRequest>,
    ) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse {
            status: self.application.health().to_string(),
        }))
    }

    async fn create_repository(
        &self,
        request: Request<CreateRepositoryRequest>,
    ) -> Result<Response<CreateRepositoryResponse>, Status> {
        let repository = self
            .application
            .create_repository(&request.into_inner().repository_id)
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(CreateRepositoryResponse {
            storage_path: repository.storage_path,
        }))
    }

    async fn import_repository(
        &self,
        request: Request<ImportRepositoryRequest>,
    ) -> Result<Response<ImportRepositoryResponse>, Status> {
        let request = request.into_inner();
        let import = self
            .application
            .import_repository(
                &request.repository_id,
                &request.storage_path,
                &request.source_url,
                request.access_token.as_deref(),
                &request.default_branch_hint,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(ImportRepositoryResponse {
            default_branch: import.default_branch,
            storage_path: import.storage_path,
        }))
    }

    async fn push_repository_mirror(
        &self,
        request: Request<PushRepositoryMirrorRequest>,
    ) -> Result<Response<PushRepositoryMirrorResponse>, Status> {
        let request = request.into_inner();
        self.application
            .push_repository_mirror(
                &request.repository_id,
                &request.storage_path,
                &request.target_url,
                request.access_token.as_deref(),
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(PushRepositoryMirrorResponse {
            success: true,
        }))
    }

    async fn get_repository_browser_summary(
        &self,
        request: Request<GetRepositoryBrowserSummaryRequest>,
    ) -> Result<Response<GetRepositoryBrowserSummaryResponse>, Status> {
        let request = request.into_inner();
        let summary = self
            .application
            .get_repository_browser_summary(
                &request.repository_id,
                &request.storage_path,
                &request.default_branch,
                &request.r#ref,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(GetRepositoryBrowserSummaryResponse {
            is_empty: summary.is_empty,
            default_branch: summary.default_branch,
            root_entries: summary
                .root_entries
                .into_iter()
                .map(|entry| RepositoryTreeEntry {
                    name: entry.name,
                    object_id: entry.object_id,
                    kind: proto_tree_entry_kind(entry.kind).into(),
                    size_bytes: entry.size_bytes,
                    path: entry.path,
                    mode: entry.mode,
                })
                .collect(),
            readme: summary.readme.map(|readme| RepositoryReadme {
                filename: readme.filename,
                object_id: readme.object_id,
                content: readme.content,
                is_truncated: readme.is_truncated,
            }),
            commit_count: summary.commit_count,
        }))
    }

    async fn list_repository_refs(
        &self,
        request: Request<ListRepositoryRefsRequest>,
    ) -> Result<Response<ListRepositoryRefsResponse>, Status> {
        let request = request.into_inner();
        let trusted_gpg_keys = domain_trusted_gpg_keys(request.trusted_gpg_keys);
        let ref_list = self
            .application
            .list_repository_refs(
                &request.repository_id,
                &request.storage_path,
                &trusted_gpg_keys,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(ListRepositoryRefsResponse {
            refs: ref_list
                .refs
                .into_iter()
                .map(|repository_ref| RepositoryRef {
                    kind: proto_ref_kind(repository_ref.kind).into(),
                    display_name: repository_ref.display_name,
                    qualified_name: repository_ref.qualified_name,
                    commit_id: repository_ref.commit_id,
                    is_default_branch: repository_ref.is_default_branch,
                    signature: Some(proto_signature(repository_ref.signature)),
                })
                .collect(),
        }))
    }

    async fn get_repository_tree(
        &self,
        request: Request<GetRepositoryTreeRequest>,
    ) -> Result<Response<GetRepositoryTreeResponse>, Status> {
        let request = request.into_inner();
        let tree = self
            .application
            .get_repository_tree(
                &request.repository_id,
                &request.storage_path,
                &request.r#ref,
                &request.path,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(GetRepositoryTreeResponse {
            commit_id: tree.commit_id,
            path: tree.path,
            entries: tree
                .entries
                .into_iter()
                .map(|entry| RepositoryTreeEntry {
                    name: entry.name,
                    object_id: entry.object_id,
                    kind: proto_tree_entry_kind(entry.kind).into(),
                    size_bytes: entry.size_bytes,
                    path: entry.path,
                    mode: entry.mode,
                })
                .collect(),
        }))
    }

    async fn get_repository_blob(
        &self,
        request: Request<GetRepositoryBlobRequest>,
    ) -> Result<Response<GetRepositoryBlobResponse>, Status> {
        let request = request.into_inner();
        let blob = self
            .application
            .get_repository_blob(
                &request.repository_id,
                &request.storage_path,
                &request.object_id,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(proto_blob_preview(blob)))
    }

    async fn get_repository_raw_blob(
        &self,
        request: Request<GetRepositoryRawBlobRequest>,
    ) -> Result<Response<GetRepositoryRawBlobResponse>, Status> {
        let request = request.into_inner();
        let blob = self
            .application
            .get_repository_raw_blob(
                &request.repository_id,
                &request.storage_path,
                &request.object_id,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(GetRepositoryRawBlobResponse {
            object_id: blob.object_id,
            content: blob.content,
            size_bytes: blob.size_bytes,
        }))
    }

    async fn list_repository_commits(
        &self,
        request: Request<ListRepositoryCommitsRequest>,
    ) -> Result<Response<ListRepositoryCommitsResponse>, Status> {
        let request = request.into_inner();
        let trusted_gpg_keys = domain_trusted_gpg_keys(request.trusted_gpg_keys);
        let commit_list = self
            .application
            .list_repository_commits(
                &request.repository_id,
                &request.storage_path,
                &request.r#ref,
                request.limit,
                &trusted_gpg_keys,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(ListRepositoryCommitsResponse {
            commits: commit_list
                .commits
                .into_iter()
                .map(|commit| RepositoryCommit {
                    sha: commit.sha,
                    short_sha: commit.short_sha,
                    summary: commit.summary,
                    author: Some(proto_commit_identity(commit.author)),
                    committer: Some(proto_commit_identity(commit.committer)),
                    signature: Some(proto_signature(commit.signature)),
                })
                .collect(),
        }))
    }

    async fn compare_repository_refs(
        &self,
        request: Request<CompareRepositoryRefsRequest>,
    ) -> Result<Response<CompareRepositoryRefsResponse>, Status> {
        let request = request.into_inner();
        let comparison = self
            .application
            .compare_repository_refs(
                &request.repository_id,
                &request.storage_path,
                &request.base_ref,
                &request.head_ref,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(CompareRepositoryRefsResponse {
            base_sha: comparison.base_sha,
            head_sha: comparison.head_sha,
            merge_base_sha: comparison.merge_base_sha,
            commits: comparison
                .commits
                .into_iter()
                .map(|commit| RepositoryComparisonCommit {
                    sha: commit.sha,
                    short_sha: commit.short_sha,
                    summary: commit.summary,
                    author: Some(proto_commit_identity(commit.author)),
                })
                .collect(),
            files: comparison
                .files
                .into_iter()
                .map(proto_changed_file)
                .collect(),
            is_truncated: comparison.is_truncated,
            file_limit: comparison.file_limit,
            commits_truncated: comparison.commits_truncated,
            commit_limit: comparison.commit_limit,
        }))
    }

    async fn get_repository_file_diff(
        &self,
        request: Request<GetRepositoryFileDiffRequest>,
    ) -> Result<Response<GetRepositoryFileDiffResponse>, Status> {
        let request = request.into_inner();
        let diff = self
            .application
            .get_repository_file_diff(
                &request.repository_id,
                &request.storage_path,
                &request.base_ref,
                &request.head_ref,
                &request.path,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(GetRepositoryFileDiffResponse {
            base_sha: diff.base_sha,
            head_sha: diff.head_sha,
            merge_base_sha: diff.merge_base_sha,
            file: Some(proto_changed_file(diff.file)),
            hunks: diff.hunks.into_iter().map(proto_diff_hunk).collect(),
            is_truncated: diff.is_truncated,
            patch_limit_bytes: diff.patch_limit_bytes,
        }))
    }

    async fn merge_repository_refs(
        &self,
        request: Request<MergeRepositoryRefsRequest>,
    ) -> Result<Response<MergeRepositoryRefsResponse>, Status> {
        let request = request.into_inner();
        let strategy = domain_merge_strategy(request.strategy)?;
        let merge = self
            .application
            .merge_repository_refs(RepositoryMergeRequest {
                repository_id: &request.repository_id,
                storage_path: &request.storage_path,
                base_ref: &request.base_ref,
                head_ref: &request.head_ref,
                expected_base_sha: &request.expected_base_sha,
                expected_head_sha: &request.expected_head_sha,
                author_name: &request.author_name,
                author_email: &request.author_email,
                message: &request.message,
                squash_title: &request.squash_title,
                squash_body: &request.squash_body,
                strategy,
                operation_id: &request.operation_id,
            })
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(MergeRepositoryRefsResponse {
            merge_commit_sha: merge.resulting_sha.clone(),
            resulting_sha: merge.resulting_sha,
        }))
    }

    async fn find_repository_merge_receipt(
        &self,
        request: Request<FindRepositoryMergeReceiptRequest>,
    ) -> Result<Response<FindRepositoryMergeReceiptResponse>, Status> {
        let request = request.into_inner();
        let strategy = domain_merge_strategy(request.strategy)?;
        let resulting_sha = self
            .application
            .find_repository_merge_receipt(
                &request.repository_id,
                &request.storage_path,
                &request.operation_id,
                strategy,
                &request.expected_base_sha,
                &request.expected_head_sha,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(FindRepositoryMergeReceiptResponse {
            found: resulting_sha.is_some(),
            resulting_sha: resulting_sha.unwrap_or_default(),
        }))
    }

    async fn check_repository_mergeability(
        &self,
        request: Request<CheckRepositoryMergeabilityRequest>,
    ) -> Result<Response<CheckRepositoryMergeabilityResponse>, Status> {
        let request = request.into_inner();
        let mergeability = self
            .application
            .check_repository_mergeability(
                &request.repository_id,
                &request.storage_path,
                &request.base_ref,
                &request.head_ref,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(CheckRepositoryMergeabilityResponse {
            mergeable: mergeability.mergeable,
            base_sha: mergeability.base_sha,
            head_sha: mergeability.head_sha,
            merge_base_sha: mergeability.merge_base_sha,
            conflict_paths: mergeability.conflict_paths,
            conflict_paths_truncated: mergeability.conflict_paths_truncated,
            conflict_path_limit: mergeability.conflict_path_limit,
            strategy_availability: mergeability
                .strategy_availability
                .into_iter()
                .map(proto_strategy_availability)
                .collect(),
        }))
    }
}

/// An unrecognised strategy is refused rather than defaulted. Silently merging by
/// a strategy nobody asked for is the one failure mode a caller cannot audit its
/// way out of afterwards.
///
/// An unset strategy is the exception, and only because of what it can mean: a
/// caller old enough not to send the field predates every strategy but the
/// two-parent merge, so that is not a guess about what it wanted — it is the
/// only thing it could have meant. This keeps a git service deployed ahead of
/// the API serving the API it is deployed beside.
fn domain_merge_strategy(value: i32) -> Result<DomainRepositoryMergeStrategy, Status> {
    match ProtoRepositoryMergeStrategy::try_from(value) {
        Ok(
            ProtoRepositoryMergeStrategy::MergeCommit | ProtoRepositoryMergeStrategy::Unspecified,
        ) => Ok(DomainRepositoryMergeStrategy::MergeCommit),
        Ok(ProtoRepositoryMergeStrategy::Squash) => Ok(DomainRepositoryMergeStrategy::Squash),
        Ok(ProtoRepositoryMergeStrategy::Rebase) => Ok(DomainRepositoryMergeStrategy::Rebase),
        Ok(ProtoRepositoryMergeStrategy::FastForward) => {
            Ok(DomainRepositoryMergeStrategy::FastForward)
        }
        _ => Err(Status::invalid_argument("merge strategy is invalid")),
    }
}

fn proto_merge_strategy(strategy: DomainRepositoryMergeStrategy) -> ProtoRepositoryMergeStrategy {
    match strategy {
        DomainRepositoryMergeStrategy::MergeCommit => ProtoRepositoryMergeStrategy::MergeCommit,
        DomainRepositoryMergeStrategy::Squash => ProtoRepositoryMergeStrategy::Squash,
        DomainRepositoryMergeStrategy::Rebase => ProtoRepositoryMergeStrategy::Rebase,
        DomainRepositoryMergeStrategy::FastForward => ProtoRepositoryMergeStrategy::FastForward,
    }
}

fn proto_strategy_unavailable_reason(
    reason: DomainRepositoryMergeStrategyUnavailableReason,
) -> ProtoRepositoryMergeStrategyUnavailableReason {
    match reason {
        DomainRepositoryMergeStrategyUnavailableReason::Conflict => {
            ProtoRepositoryMergeStrategyUnavailableReason::Conflict
        }
        DomainRepositoryMergeStrategyUnavailableReason::NotFastForward => {
            ProtoRepositoryMergeStrategyUnavailableReason::NotFastForward
        }
        DomainRepositoryMergeStrategyUnavailableReason::AlreadyUpToDate => {
            ProtoRepositoryMergeStrategyUnavailableReason::AlreadyUpToDate
        }
        DomainRepositoryMergeStrategyUnavailableReason::NothingToRebase => {
            ProtoRepositoryMergeStrategyUnavailableReason::NothingToRebase
        }
        DomainRepositoryMergeStrategyUnavailableReason::UnsupportedHistory => {
            ProtoRepositoryMergeStrategyUnavailableReason::UnsupportedHistory
        }
    }
}

fn proto_strategy_availability(
    availability: DomainRepositoryMergeStrategyAvailability,
) -> RepositoryMergeStrategyAvailability {
    RepositoryMergeStrategyAvailability {
        strategy: proto_merge_strategy(availability.strategy).into(),
        available: availability.available,
        reason: availability
            .reason
            .map(proto_strategy_unavailable_reason)
            .unwrap_or(ProtoRepositoryMergeStrategyUnavailableReason::Unspecified)
            .into(),
    }
}

fn repository_error_to_status(error: RepositoryError) -> Status {
    match error {
        RepositoryError::InvalidRepositoryId => {
            Status::invalid_argument("repository_id must be an opaque UUID")
        }
        RepositoryError::InvalidRepositoryPath => {
            Status::invalid_argument("repository path is invalid")
        }
        RepositoryError::InvalidRepositoryRef => {
            Status::invalid_argument("repository default branch is invalid")
        }
        RepositoryError::InvalidObjectId => Status::invalid_argument("object_id is invalid"),
        RepositoryError::InvalidMergeInput => {
            Status::invalid_argument("repository merge input is invalid")
        }
        RepositoryError::InvalidGitOutput => Status::internal("git returned invalid output"),
        RepositoryError::BlobTooLarge => Status::resource_exhausted("repository blob is too large"),
        RepositoryError::RepositoryObjectNotFound => {
            Status::not_found("repository object was not found")
        }
        RepositoryError::ComparisonFileNotFound => {
            Status::not_found("comparison file was not found")
        }
        RepositoryError::MergeConflict => {
            Status::failed_precondition("repository refs cannot be merged cleanly")
        }
        // The reason travels in the message because it is what the API turns
        // into a blocking reason. Both sides of that string are named: the
        // prefix here and `RepositoryMergeStrategyUnavailableReason::as_name`.
        RepositoryError::MergeStrategyUnavailable(reason) => Status::failed_precondition(format!(
            "repository merge strategy is unavailable: {}",
            reason.as_name()
        )),
        RepositoryError::StaleRepositoryRef => Status::aborted("repository ref moved"),
        RepositoryError::WrongObjectKind => {
            Status::failed_precondition("repository object has the wrong kind")
        }
        RepositoryError::PathEscapesStorageRoot => {
            Status::internal("repository storage path failed safety validation")
        }
        RepositoryError::ExistingPathNotBare => {
            Status::failed_precondition("repository path exists but is not a bare git repository")
        }
        RepositoryError::StoragePathMismatch => {
            Status::failed_precondition("repository storage path does not match storage root")
        }
        RepositoryError::StorageIo(_)
        | RepositoryError::GitProcessIo(_)
        | RepositoryError::GitProcessFailed => Status::internal("repository git operation failed"),
    }
}

fn proto_changed_file(file: DomainRepositoryChangedFile) -> RepositoryChangedFile {
    RepositoryChangedFile {
        status: match file.status {
            DomainRepositoryChangedFileStatus::Added => RepositoryChangedFileStatus::Added,
            DomainRepositoryChangedFileStatus::Modified => RepositoryChangedFileStatus::Modified,
            DomainRepositoryChangedFileStatus::Deleted => RepositoryChangedFileStatus::Deleted,
            DomainRepositoryChangedFileStatus::Renamed => RepositoryChangedFileStatus::Renamed,
        }
        .into(),
        old_path: file.old_path,
        new_path: file.new_path,
        base_blob_id: file.base_blob_id,
        head_blob_id: file.head_blob_id,
        additions: file.additions,
        deletions: file.deletions,
        is_binary: file.is_binary,
    }
}

fn proto_diff_hunk(hunk: DomainRepositoryDiffHunk) -> RepositoryDiffHunk {
    RepositoryDiffHunk {
        header: hunk.header,
        lines: hunk.lines.into_iter().map(proto_diff_line).collect(),
    }
}

fn proto_diff_line(line: DomainRepositoryDiffLine) -> RepositoryDiffLine {
    RepositoryDiffLine {
        kind: match line.kind {
            DomainRepositoryDiffLineKind::Context => RepositoryDiffLineKind::Context,
            DomainRepositoryDiffLineKind::Addition => RepositoryDiffLineKind::Addition,
            DomainRepositoryDiffLineKind::Deletion => RepositoryDiffLineKind::Deletion,
        }
        .into(),
        content: line.content,
        old_line: line.old_line,
        new_line: line.new_line,
    }
}

fn proto_blob_preview(blob: RepositoryBlobPreview) -> GetRepositoryBlobResponse {
    match blob {
        RepositoryBlobPreview::Text {
            object_id,
            text,
            size_bytes,
            preview_limit_bytes,
        } => GetRepositoryBlobResponse {
            object_id,
            state: ProtoRepositoryBlobPreviewState::Text.into(),
            text,
            size_bytes,
            preview_limit_bytes,
        },
        RepositoryBlobPreview::Binary {
            object_id,
            size_bytes,
            preview_limit_bytes,
        } => GetRepositoryBlobResponse {
            object_id,
            state: ProtoRepositoryBlobPreviewState::Binary.into(),
            text: String::new(),
            size_bytes,
            preview_limit_bytes,
        },
        RepositoryBlobPreview::TooLarge {
            object_id,
            size_bytes,
            preview_limit_bytes,
        } => GetRepositoryBlobResponse {
            object_id,
            state: ProtoRepositoryBlobPreviewState::TooLarge.into(),
            text: String::new(),
            size_bytes,
            preview_limit_bytes,
        },
    }
}

fn proto_tree_entry_kind(kind: RepositoryTreeEntryKind) -> ProtoRepositoryTreeEntryKind {
    match kind {
        RepositoryTreeEntryKind::File => ProtoRepositoryTreeEntryKind::File,
        RepositoryTreeEntryKind::Directory => ProtoRepositoryTreeEntryKind::Directory,
        RepositoryTreeEntryKind::Symlink => ProtoRepositoryTreeEntryKind::Symlink,
        RepositoryTreeEntryKind::Submodule => ProtoRepositoryTreeEntryKind::Submodule,
    }
}

fn proto_ref_kind(kind: RepositoryRefKind) -> ProtoRepositoryRefKind {
    match kind {
        RepositoryRefKind::Branch => ProtoRepositoryRefKind::Branch,
        RepositoryRefKind::Tag => ProtoRepositoryRefKind::Tag,
    }
}

fn proto_commit_identity(identity: DomainRepositoryCommitIdentity) -> RepositoryCommitIdentity {
    RepositoryCommitIdentity {
        name: identity.name,
        email: identity.email,
        date: identity.date,
    }
}

fn domain_trusted_gpg_keys(keys: Vec<TrustedGpgKey>) -> Vec<DomainTrustedGpgKey> {
    keys.into_iter()
        .map(|key| DomainTrustedGpgKey {
            key_id: key.key_id,
            fingerprint: key.fingerprint,
            public_key: key.public_key,
        })
        .collect()
}

fn proto_signature(signature: DomainRepositorySignature) -> RepositorySignature {
    RepositorySignature {
        state: proto_signature_state(signature.state).into(),
        key_id: signature.key_id,
        fingerprint: signature.fingerprint,
        primary_key_fingerprint: signature.primary_key_fingerprint,
        signer: signature.signer,
    }
}

fn proto_signature_state(state: DomainRepositorySignatureState) -> ProtoRepositorySignatureState {
    match state {
        DomainRepositorySignatureState::Unsigned => ProtoRepositorySignatureState::Unsigned,
        DomainRepositorySignatureState::Valid => ProtoRepositorySignatureState::Valid,
        DomainRepositorySignatureState::Trusted => ProtoRepositorySignatureState::Trusted,
        DomainRepositorySignatureState::Untrusted => ProtoRepositorySignatureState::Untrusted,
        DomainRepositorySignatureState::Bad => ProtoRepositorySignatureState::Bad,
        DomainRepositorySignatureState::Unknown => ProtoRepositorySignatureState::Unknown,
        DomainRepositorySignatureState::Expired => ProtoRepositorySignatureState::Expired,
        DomainRepositorySignatureState::Revoked => ProtoRepositorySignatureState::Revoked,
    }
}
