import type { Env } from './env.schema'
import { parseEnv } from './env.schema'

let runtimeEnvCache: Env | undefined

export function getRuntimeEnv() {
	if (!runtimeEnvCache) runtimeEnvCache = parseEnv(process.env)
	return runtimeEnvCache
}
