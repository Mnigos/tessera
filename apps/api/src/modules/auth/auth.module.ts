import { EnvModule, EnvService } from '@config/env'
import { Module } from '@nestjs/common'
import { initAuth } from '@repo/auth'
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth'
import { AuthService } from './application/auth.service'
import { AuthController } from './presentation/auth.controller'

@Module({
	imports: [
		BetterAuthModule.forRootAsync({
			imports: [EnvModule],
			inject: [EnvService],
			useFactory: (envService: EnvService) => ({
				auth: initAuth({
					apiUrl: envService.get('API_URL'),
					secret: envService.get('AUTH_SECRET'),
					githubClientId: envService.get('GITHUB_CLIENT_ID'),
					githubClientSecret: envService.get('GITHUB_CLIENT_SECRET'),
					trustedOrigins: [envService.get('APP_URL')],
				}),
				disableBodyParser: true,
				disableGlobalRequiredAuth: true,
			}),
		}),
	],
	controllers: [AuthController],
	providers: [AuthService],
	exports: [BetterAuthModule],
})
export class AuthModule {}
