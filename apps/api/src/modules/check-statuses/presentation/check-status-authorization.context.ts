import type { CheckStatusCredentialAuthorization } from '@modules/checks'
import { InternalError } from '~/shared/errors'
import type { AppRequest } from '~/shared/types/app-request'

const AUTHORIZATIONS = new WeakMap<
	AppRequest,
	CheckStatusCredentialAuthorization
>()

/**
 * What the guard proved about the caller, carried to the handler out of band.
 *
 * It never travels on the request body: provider identity is the one thing a
 * publisher must not be able to claim for itself, so the handler reads it from
 * here or refuses to run at all.
 */
export function setCheckStatusAuthorization(
	request: AppRequest,
	authorization: CheckStatusCredentialAuthorization
): void {
	AUTHORIZATIONS.set(request, authorization)
}

export function getCheckStatusAuthorization(
	request: AppRequest
): CheckStatusCredentialAuthorization {
	const authorization = AUTHORIZATIONS.get(request)

	if (!authorization) throw new InternalError('check status authorization')

	return authorization
}
