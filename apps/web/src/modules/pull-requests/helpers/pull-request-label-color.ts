const HEX_COLOR_PATTERN = /^#?([0-9a-f]{6})$/i
const READABLE_LIGHTNESS = 0.62

/**
 * Turns GitHub's flat label colour into a pill that reads on a dark surface.
 *
 * GitHub picks black or white text over the colour itself; Tessera tints the
 * colour instead, so the fill stays a wash and the text keeps enough contrast
 * to be read. A colour too dark to read as text is lifted to a fixed lightness
 * rather than replaced, which keeps a navy label recognisably navy.
 */
export function getPullRequestLabelStyle(color: string) {
	const hex = HEX_COLOR_PATTERN.exec(color.trim())?.[1]

	if (!hex) return undefined

	const [red, green, blue] = [0, 2, 4].map(offset =>
		Number.parseInt(hex.slice(offset, offset + 2), 16)
	) as [number, number, number]

	return {
		backgroundColor: `rgb(${red} ${green} ${blue} / 0.18)`,
		borderColor: `rgb(${red} ${green} ${blue} / 0.4)`,
		color: toReadableTint(red, green, blue),
	}
}

/** Lifts a colour toward the light end without moving its hue. */
function toReadableTint(red: number, green: number, blue: number) {
	const lightness = Math.max(red, green, blue) / 255

	if (lightness >= READABLE_LIGHTNESS) return `rgb(${red} ${green} ${blue})`

	// Black has no hue to lift, so it borrows the muted text colour instead.
	if (lightness === 0) return 'rgb(161 161 170)'

	const scale = READABLE_LIGHTNESS / lightness

	return `rgb(${[red, green, blue]
		.map(channel => Math.min(255, Math.round(channel * scale)))
		.join(' ')})`
}
