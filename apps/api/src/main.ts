import 'reflect-metadata'

import { HonoAdapter } from '@mnigos/platform-hono'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { type MicroserviceOptions, Transport } from '@nestjs/microservices'
import { EnvService } from './config/env'
import {
	GIT_GRPC_LOADER_OPTIONS,
	resolveGitAuthorizationProtoPath,
	TESSERA_GIT_V1_PACKAGE_NAME,
} from './config/git-storage'
import { AppModule } from './modules/app'

async function bootstrap() {
	const adapter = new HonoAdapter({
		skipBodyParserFor: ['/api/auth'],
	})
	const app = await NestFactory.create(AppModule, adapter)
	const envService = app.get(EnvService)

	const port = envService.get('PORT')
	const appUrl = envService.get('APP_URL')
	const grpcUrl = envService.get('API_GRPC_URL')

	app.enableCors({
		origin: appUrl,
		credentials: true,
	})
	app.enableShutdownHooks()

	app.connectMicroservice<MicroserviceOptions>({
		transport: Transport.GRPC,
		options: {
			loader: GIT_GRPC_LOADER_OPTIONS,
			package: TESSERA_GIT_V1_PACKAGE_NAME,
			protoPath: resolveGitAuthorizationProtoPath(),
			url: grpcUrl,
		},
	})

	await app.startAllMicroservices()
	await app.listen(port)

	Logger.log(`API running on http://localhost:${port}`)
	Logger.log(`API gRPC running on ${grpcUrl}`)
}

bootstrap()
