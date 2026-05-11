import { EnvService } from '@config/env'
import { contract } from '@config/rpc'
import { Injectable } from '@nestjs/common'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'

@Injectable()
export class DocsService {
	private readonly openAPIGenerator = new OpenAPIGenerator({
		schemaConverters: [new ZodToJsonSchemaConverter()],
	})

	constructor(private readonly envService: EnvService) {}

	generateOpenAPIDocument() {
		return this.openAPIGenerator.generate(contract, {
			info: {
				title: 'Tessera API',
				version: '1.0.0',
			},
			servers: [
				{
					url: this.envService.get('API_URL'),
				},
			],
		})
	}
}
