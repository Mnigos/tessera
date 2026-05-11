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
						if (
							error instanceof ORPCError &&
							error.cause instanceof ValidationError
						) {
							logger.error('Validation failed', error.data)
						}
					}),
				],
				context: { request },
			}),
			inject: [REQUEST],
		}),
	],
})
export class RPCModule {}
