---
name: rust-service-patterns
description: Rust service structure, tonic/prost gRPC, safe Git storage, Cargo workspace scripts, and Rust tests. Use when creating or modifying services/git, Rust protobuf generation, Git filesystem/process behavior, or Rust service Turbo wiring.
---

Use this skill for Rust service work under `services/git`: tonic gRPC adapters, protobuf build scripts, Cargo workspace wiring, Git process execution, filesystem storage, and Rust tests.

## First Read

Before editing, read:
- This skill.
- `services/git/README.md`, `services/git/Cargo.toml`, `services/git/build.rs`, and the relevant `services/git/src/**` modules.
- At least 3 similar files from the current Rust service when they exist. If the service is too small, inspect the closest Tessera API/domain layering files and relevant reference repositories named in `AGENTS.md`.
- Current tonic/prost docs with Context7 when changing gRPC generation or service wiring.

## Structure

- Keep `services/git/src/lib.rs` as module declarations and public exports only.
- Use layers:
  - `domain/` for value objects, domain result types, and domain errors.
  - `application/` for orchestration and use-case methods.
  - `infrastructure/` for filesystem, process execution, storage roots, and external adapters.
  - `grpc/` for tonic request/response adapters and gRPC status mapping.
  - `config.rs` for env parsing and socket/storage configuration.
- Do not place orchestration, filesystem behavior, gRPC adapter code, and config parsing together in one large file.
- Keep generated protobuf includes behind `pub mod proto { tonic::include_proto!(...) }`.

## Git Storage Rules

- Treat repository ids as opaque UUIDs; parse them into a Rust value object before constructing storage paths.
- Never use usernames, repository slugs, sessions, visibility, or authorization data in Git filesystem paths.
- Build paths as `{GIT_STORAGE_ROOT}/repositories/{repository_id}.git`.
- Reject traversal and symlink escapes. Check both the repositories root and repository leaf with `symlink_metadata`, canonicalize roots where needed, and reject symlinks inside existing bare repository markers such as `HEAD`, `config`, `objects`, and `refs`.
- Run Git commands with controlled `Command` arguments; do not concatenate shell command strings.
- Existing bare repositories should be idempotent. Existing non-bare paths should return a deterministic error.

## gRPC And API Contracts

- Keep the proto at `services/git/proto/tessera/git/v1/git_storage.proto` unless the issue explicitly changes the contract location.
- Preserve the package `tessera.git.v1` and service name `GitStorageService` for this boundary.
- If the proto changes, regenerate both Rust and API TypeScript generated code and run both Rust and API checks.
- The Nest API should consume generated TypeScript gRPC types and Nest `ClientGrpc`, not handwritten service/request/response interfaces.

## Tests And Verification

- Add or update Rust tests for path construction, invalid IDs, existing bare idempotency, existing non-bare failure, Git process failure, and symlink escape cases.
- Run `cargo fmt --check` before finishing; run `cargo fmt` only when formatting changes are expected.
- Run `cargo test -p tessera-git` for Rust service changes.
- If Turbo/package wiring changes, run a Turbo dry run for the affected task and `bun run check`.
- Remove or ignore `target/`; never leave Rust build artifacts as untracked worktree noise.
