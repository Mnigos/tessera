const REPOSITORY_COLLABORATOR_DATE_FORMATTER = new Intl.DateTimeFormat('en', {
	dateStyle: 'medium',
	timeZone: 'UTC',
})

export function formatRepositoryCollaboratorAddedDate(value: Date | string) {
	const date = value instanceof Date ? value : new Date(value)

	if (Number.isNaN(date.getTime())) return 'unknown'

	return REPOSITORY_COLLABORATOR_DATE_FORMATTER.format(date)
}
