/**
 * What to call the non-SSH remote.
 *
 * Clone URLs follow the source, and a self-hosted GitHub Enterprise instance
 * reached over plain HTTP would otherwise be labelled — and announced to screen
 * readers — as HTTPS, which is a security claim rather than a cosmetic one.
 */
export function getCloneProtocolLabel(httpCloneUrl: string) {
	try {
		const { protocol } = new URL(httpCloneUrl)

		if (protocol === 'https:') return 'HTTPS'
		if (protocol === 'http:') return 'HTTP'
	} catch {
		return 'HTTP/HTTPS'
	}

	return 'HTTP/HTTPS'
}
