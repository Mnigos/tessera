import type { Check, CheckProvider } from '@repo/contracts'
import type { EffectiveCheckRow } from '../infrastructure/checks.repository'

const GITHUB_PROVIDER_FALLBACK_NAME = 'GitHub'
const NATIVE_PROVIDER_NAME = 'Tessera'

export function toCheckOutput(row: EffectiveCheckRow): Check {
	return {
		id: row.id,
		kind: row.kind,
		context: row.context,
		state: row.state,
		rawStatus: toOptionalText(row.rawStatus),
		rawConclusion: toOptionalText(row.rawConclusion),
		provider: toCheckProvider(row),
		// A run reports its page through the observation; the mapping's links are
		// the fallback for a result recorded before the provider published one.
		targetUrl:
			toOptionalUrl(row.targetUrl) ??
			toOptionalUrl(row.runDetailsUrl) ??
			toOptionalUrl(row.runHtmlUrl),
		description: toOptionalText(row.description),
		outputTitle: toOptionalText(row.outputTitle),
		outputSummary: toOptionalText(row.outputSummary),
		startedAt: row.startedAt ?? undefined,
		completedAt: row.completedAt ?? undefined,
		durationMs: toDurationMs(row.startedAt, row.completedAt),
		observedAt: row.observedAt,
	}
}

/**
 * A check run is reported by a GitHub App, which is never a person; a commit
 * status is posted by an account, which is. What makes a result GitHub's is that
 * a mapping records GitHub reporting it — not that an actor survived the import.
 * A status whose poster was deleted, or was never an account Tessera resolved,
 * is still GitHub's result and says so under GitHub's name; only a result with
 * no mapping at all was written natively.
 */
function toCheckProvider(row: EffectiveCheckRow): CheckProvider {
	if (row.runMappingId !== null)
		return {
			kind: 'github',
			name: toOptionalText(row.appName) ?? GITHUB_PROVIDER_FALLBACK_NAME,
			appSlug: toOptionalText(row.appSlug),
			url: toOptionalUrl(row.appHtmlUrl),
		}

	if (row.statusMappingId !== null)
		return {
			kind: 'github',
			name:
				toOptionalText(row.statusActorLogin) ?? GITHUB_PROVIDER_FALLBACK_NAME,
			url: toOptionalUrl(row.statusActorHtmlUrl),
		}

	return { kind: 'tessera', name: NATIVE_PROVIDER_NAME }
}

function toDurationMs(
	startedAt: Date | null,
	completedAt: Date | null
): number | undefined {
	if (!(startedAt && completedAt)) return undefined

	const durationMs = completedAt.getTime() - startedAt.getTime()

	return durationMs >= 0 ? durationMs : undefined
}

function toOptionalText(value: string | null): string | undefined {
	return value ? value : undefined
}

/**
 * Provider links reach the read model unvalidated. One malformed URL must cost
 * its own link, not the whole response.
 */
function toOptionalUrl(value: string | null): string | undefined {
	if (!value) return undefined

	return URL.canParse(value) ? value : undefined
}
