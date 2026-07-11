import type { RepositoryBranchRef } from '@repo/contracts'

export interface CreatePullRequestFields {
	sourceBranch: string
	targetBranch: string
	title: string
	body?: string
}

interface GetCreatePullRequestFieldsInput {
	formData: FormData
	sourceBranch: string
	targetBranch: string
}

export function getCreatePullRequestFields({
	formData,
	sourceBranch,
	targetBranch,
}: GetCreatePullRequestFieldsInput): CreatePullRequestFields | undefined {
	const title = String(formData.get('title') ?? '').trim()
	const body = String(formData.get('body') ?? '').trim()

	if (!(title && sourceBranch && targetBranch)) return undefined
	if (sourceBranch === targetBranch) return undefined

	return {
		sourceBranch,
		targetBranch,
		title,
		body: body || undefined,
	}
}

export function getInitialPullRequestBranches(
	branches: RepositoryBranchRef[],
	defaultBranch: string
) {
	const targetBranch =
		branches.find(branch => branch.name === defaultBranch)?.name ??
		branches[0]?.name ??
		''
	const sourceBranch =
		branches.find(branch => branch.name !== targetBranch)?.name ?? targetBranch

	return { sourceBranch, targetBranch }
}
