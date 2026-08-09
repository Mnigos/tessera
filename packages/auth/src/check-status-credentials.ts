import {
	type CheckStatusCredentialPermission,
	checkStatusCredentialPermissions,
} from '@repo/domain'

export const CHECK_STATUS_CREDENTIAL_CONFIG_ID = 'status-provider-credentials'
export const CHECK_STATUS_CREDENTIAL_PREFIX = 'tes_status_'

const [checksWritePermission] = checkStatusCredentialPermissions
export const CHECK_STATUS_CREDENTIAL_DEFAULT_PERMISSION = checksWritePermission

export const CHECK_STATUS_CREDENTIAL_PERMISSIONS = {
	[checksWritePermission]: { checks: ['write'] },
} as const satisfies Record<
	CheckStatusCredentialPermission,
	Record<string, readonly string[]>
>

export type { CheckStatusCredentialPermission }

export function getCheckStatusCredentialPermission(
	permission: CheckStatusCredentialPermission
): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(CHECK_STATUS_CREDENTIAL_PERMISSIONS[permission]).map(
			([resource, actions]) => [resource, [...actions]]
		)
	)
}
