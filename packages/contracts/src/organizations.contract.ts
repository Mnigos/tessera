import { oc } from '@orpc/contract'
import { z } from 'zod'

export const organizationSchema = z.object({
	id: z.uuid().brand<'organization_id'>(),
	slug: z.string(),
	name: z.string(),
})
export type Organization = z.infer<typeof organizationSchema>

export const organizationsContract = {
	list: oc
		.route({ method: 'GET', path: '/organizations' })
		.output(z.object({ organizations: z.array(organizationSchema) })),
}
