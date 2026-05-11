import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { parseEnv } from './env.schema'
import { EnvService } from './env.service'

@Global()
@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validate: parseEnv,
		}),
	],
	providers: [EnvService],
	exports: [EnvService],
})
export class EnvModule {}
