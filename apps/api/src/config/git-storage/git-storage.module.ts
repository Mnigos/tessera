import { EnvModule, EnvService } from '@config/env'
import { Global, Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { TESSERA_GIT_V1_PACKAGE_NAME } from './generated/tessera/git/v1/git_storage'
import { GIT_STORAGE_GRPC_CLIENT, GitStorageClient } from './git-storage.client'
import { resolveGitStorageProtoPath } from './git-storage-proto-paths'

export const GIT_GRPC_LOADER_OPTIONS = {
	keepCase: false,
	longs: Number,
}
export const GIT_STORAGE_RAW_BLOB_MAX_BYTES = 10 * 1024 * 1024
export const GIT_STORAGE_MAX_RECEIVE_MESSAGE_BYTES =
	GIT_STORAGE_RAW_BLOB_MAX_BYTES + 1024

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
						channelOptions: {
							'grpc.max_receive_message_length':
								GIT_STORAGE_MAX_RECEIVE_MESSAGE_BYTES,
						},
						loader: GIT_GRPC_LOADER_OPTIONS,
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
