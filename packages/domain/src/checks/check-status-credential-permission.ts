/**
 * What a status-publishing credential is allowed to do. Publishing is the only
 * thing an external provider ever needs, and reading is what the repository's
 * own audience already has — so the list is one entry rather than a matrix.
 */
export const checkStatusCredentialPermissions = ['checks:write'] as const

export type CheckStatusCredentialPermission =
	(typeof checkStatusCredentialPermissions)[number]
