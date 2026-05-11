import 'reflect-metadata'

import { HonoAdapter } from '@mnigos/platform-hono'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { EnvService } from './config/env'
import { AppModule } from './modules/app'

async function bootstrap() {
	const adapter = new HonoAdapter({
		skipBodyParserFor: ['/api/auth'],
	})
	const app = await NestFactory.create(AppModule, adapter)
	const envService = app.get(EnvService)

	const port = envService.get('PORT')
	const appUrl = envService.get('APP_URL')

	app.enableCors({
		origin: appUrl,
		credentials: true,
	})

	await app.listen(port)

	Logger.log(`API running on http://localhost:${port}`)
}

bootstrap()
