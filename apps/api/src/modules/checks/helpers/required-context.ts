import type { RequiredContext } from '@repo/contracts'
import type { EffectiveCheckRow } from '../infrastructure/checks.repository'

/**
 * Whether one result answers to a requirement's name.
 *
 * `kind` and `providerAppId` narrow it; a requirement that omits them matches on
 * the context alone and therefore matches every provider reporting it. Deciding
 * what a requirement means belongs in one place: evaluation asks this to reach a
 * verdict and the read side asks it to find out what nobody reported, and the
 * two must never disagree about which is which.
 */
export function matchesRequiredContext(
	{ context, kind, providerAppId }: RequiredContext,
	row: EffectiveCheckRow
): boolean {
	if (row.context !== context) return false

	if (kind && row.kind !== kind) return false

	if (!providerAppId) return true

	return (
		row.appExternalNodeId === providerAppId ||
		row.appExternalNumericId?.toString() === providerAppId
	)
}
