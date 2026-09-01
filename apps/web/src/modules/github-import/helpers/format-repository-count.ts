export function formatRepositoryCount(count: number) {
	return `${count} ${count === 1 ? 'repository' : 'repositories'}`
}
