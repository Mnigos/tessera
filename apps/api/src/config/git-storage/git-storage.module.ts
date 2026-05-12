import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { EnvModule, EnvService } from '@config/env'
import { Global, Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { TESSERA_GIT_V1_PACKAGE_NAME } from './generated/tessera/git/v1/git_storage'
import { GIT_STORAGE_GRPC_CLIENT, GitStorageClient } from './git-storage.client'

const GIT_STORAGE_PROTO_RELATIVE_PATH =
	'services/git/proto/tessera/git/v1/git_storage.proto'

@Global()
@Module({
	imports: [
		EnvModule,
		ClientsModule.registerAsync([
			{
				name: GIT_STORAGE_GRPC_CLIENT,
				imports: [EnvModule],
				inject: [EnvService],
				useFactory: (envService: EnvService) => ({
					transport: Transport.GRPC,
					options: {
						package: TESSERA_GIT_V1_PACKAGE_NAME,
						protoPath: resolveGitStorageProtoPath(),
						url: envService.get('GIT_SERVICE_URL'),
					},
				}),
			},
		]),
	],
	providers: [GitStorageClient],
	exports: [GitStorageClient],
})
export class GitStorageModule {}

function resolveGitStorageProtoPath() {
	const candidates = [
		resolve(process.cwd(), GIT_STORAGE_PROTO_RELATIVE_PATH),
		resolve(process.cwd(), '../../', GIT_STORAGE_PROTO_RELATIVE_PATH),
	]

	return (
		candidates.find(candidate => existsSync(candidate)) ??
		candidates[0] ??
		resolve(GIT_STORAGE_PROTO_RELATIVE_PATH)
	)
}
