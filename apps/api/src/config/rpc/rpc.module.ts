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
						if (error instanceof ORPCError)
							if (error.cause instanceof ValidationError)
								logger.error(
									error.cause.message,
									error.cause.issues
										.map(({ path, message }) => `[${path}]: ${message}`)
										.reduce((acc, curr) => `${acc}\n ${curr}`, '')
								)
							else
								logger.error(
									'Something went wrong',
									JSON.stringify(error.cause)
								)
					}),
				],
				context: { request },
			}),
			inject: [REQUEST],
		}),
	],
})
export class RPCModule {}
