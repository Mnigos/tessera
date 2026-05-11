export function formatAmount(
	amount: number,
	measurement: 'plays' | 'playtime',
	withUnit = true
) {
	if (amount === 0) return ''

	return measurement === 'plays'
		? formatPlays(amount, withUnit)
		: formatDuration(amount)
}

export function formatDuration(milliseconds: number) {
	if (milliseconds === 0) return ''

	const hours = Math.floor(milliseconds / (1000 * 60 * 60))
	const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60))
	const formattedHours = hours
		? `${new Intl.NumberFormat().format(hours)}h`
		: ''
	const formattedMinutes = minutes
		? `${new Intl.NumberFormat().format(minutes)}m`
		: ''

	if (formattedHours && formattedMinutes)
		return `${formattedHours} ${formattedMinutes}`

	return formattedHours || formattedMinutes
}

export function formatPlays(plays: number, withUnit = true) {
	if (plays === 0) return ''

	const units = withUnit ? ` ${plays > 1 ? 'plays' : 'play'}` : ''

	return `${new Intl.NumberFormat().format(plays)}${units}`
}
