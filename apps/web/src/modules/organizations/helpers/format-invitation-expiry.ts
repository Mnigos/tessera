const MINUTE_IN_MS = 60 * 1000
const HOUR_IN_MS = 60 * MINUTE_IN_MS
const DAY_IN_MS = 24 * HOUR_IN_MS

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('en', {
	numeric: 'auto',
})

export function formatInvitationExpiry(expiresAt: Date, now = new Date()) {
	const remaining = expiresAt.getTime() - now.getTime()

	if (Number.isNaN(remaining)) return 'unknown'

	if (remaining <= 0) return 'expired'

	if (remaining >= DAY_IN_MS)
		return RELATIVE_TIME_FORMATTER.format(
			Math.round(remaining / DAY_IN_MS),
			'day'
		)

	if (remaining >= HOUR_IN_MS)
		return RELATIVE_TIME_FORMATTER.format(
			Math.round(remaining / HOUR_IN_MS),
			'hour'
		)

	return RELATIVE_TIME_FORMATTER.format(
		Math.max(1, Math.round(remaining / MINUTE_IN_MS)),
		'minute'
	)
}
