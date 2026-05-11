import { createClient } from '@repo/auth/client'
import { getApiUrl } from '@/utils/get-api-url'

export const authClient = createClient(getApiUrl())
