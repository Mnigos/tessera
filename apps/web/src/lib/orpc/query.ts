import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { orpc } from './client'

export const orpcQuery = createTanstackQueryUtils(orpc)
