import {
	createOrganizationInputSchema,
	type ParsedCreateOrganizationInput,
} from '@repo/contracts'

export type OrganizationFormResult =
	| { success: true; data: ParsedCreateOrganizationInput }
	| { success: false; message: string }

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
