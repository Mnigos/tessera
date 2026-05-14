import { inspect } from 'node:util'
import { Logger, Module } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import { ORPCModule, onError } from '@orpc/nest'
import { ORPCError, ValidationError } from '@orpc/server'
import { experimental_RethrowHandlerPlugin as RethrowHandlerPlugin } from '@orpc/server/plugins'

const logger = new Logger('RPC')

@Module({
	imports: [
		ORPCModule.forRootAsync({
			useFactory: (request: Request) => ({
				plugins: [
					new RethrowHandlerPlugin({
						filter: error => !(error instanceof ORPCError),
					}),
				],
				interceptors: [
					onError((error: unknown) => {
						if (!(error instanceof ORPCError)) return

						if (error.cause instanceof ValidationError) {
							logger.error(
								error.cause.message,
								error.cause.issues
									.map(({ path, message }) => `[${path}]: ${message}`)
									.join('\n')
							)
							return
						}

						logger.error('Something went wrong', formatErrorCause(error.cause))
					}),
				],
				context: { request },
			}),
			inject: [REQUEST],
		}),
	],
})
export class RPCModule {}

function formatErrorCause(cause: unknown) {
	if (cause instanceof Error) return cause.stack ?? cause.message
	if (typeof cause === 'string') return cause

	return inspect(cause, { depth: 6 })
}
