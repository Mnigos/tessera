import {
	createOrganizationInputSchema,
	type ParsedCreateOrganizationInput,
} from '@repo/contracts'

export type OrganizationFormResult =
	| { success: true; data: ParsedCreateOrganizationInput }
	| { success: false; message: string }

/**
 * Validates against the same schema the API enforces, so a malformed handle is
 * answered in place instead of after a round trip that also spends a GitHub
 * lookup.
 */
export function parseOrganizationForm(input: {
	name: string
	slug: string
}): OrganizationFormResult {
	const parsed = createOrganizationInputSchema.safeParse(input)

	if (parsed.success) return { success: true, data: parsed.data }

	return {
		success: false,
		message:
			parsed.error.issues[0]?.message ?? 'Check the name and handle and retry.',
	}
}
