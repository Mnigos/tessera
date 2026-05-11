import type { EnvService } from '@config/env'
import { DocsService } from './docs.service'

describe(DocsService.name, () => {
	test('generates an OpenAPI document for the configured API URL', async () => {
		const envService = {
			get: vi.fn().mockReturnValue('http://localhost:4000'),
		}
		const document = await new DocsService(
			envService as unknown as EnvService
		).generateOpenAPIDocument()

		expect(document.info).toEqual({
			title: 'Tessera API',
			version: '1.0.0',
		})
		expect(document.servers).toEqual([{ url: 'http://localhost:4000' }])
		expect(envService.get).toHaveBeenCalledWith('API_URL')
	})
})
