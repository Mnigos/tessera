export function parseIdList(ids?: string) {
	return ids?.split(',') ?? []
}

export function serializeIdList(ids: string[]) {
	return ids.length > 0 ? ids.join(',') : undefined
}
