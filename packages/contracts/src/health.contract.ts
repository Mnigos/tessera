import { oc } from '@orpc/contract'
import { z } from 'zod'

export const healthContract = {
	ping: oc
		.route({ method: 'GET', path: '/health/ping' })
		.output(z.object({ status: z.literal('ok'), timestamp: z.coerce.date() })),
}
