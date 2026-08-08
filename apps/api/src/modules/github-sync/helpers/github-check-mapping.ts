/**
 * The columns of a check mapping that record where a result came from rather
 * than how it is doing: the app or account that reported it, when the provider
 * first created it, and the delivery that announced it.
 *
 * A requeued run is reported under the same identity with those fields cleared,
 * and a reconciliation sweep that discovers a result no delivery announced
 * carries no delivery at all. Writing either back wholesale would erase the
 * provenance of the first sighting, so a snapshot column only ever fills in: the
 * value the mapping already holds wins, and an absent one is taken from the
 * report at hand.
 */
export function preserveCheckMappingProvenance<
	TProvenance extends Record<string, unknown>,
>(existing: TProvenance | undefined, reported: TProvenance): TProvenance {
	if (!existing) return reported

	return Object.fromEntries(
		Object.entries(reported).map(([column, value]) => [
			column,
			existing[column] ?? value,
		])
	) as TProvenance
}
