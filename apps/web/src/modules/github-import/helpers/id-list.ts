export function parseIdList(ids?: string) {
	return [...new Set(ids?.split(',') ?? [])]
}

export function serializeIdList(ids: string[]) {
	return ids.length > 0 ? ids.join(',') : undefined
}
