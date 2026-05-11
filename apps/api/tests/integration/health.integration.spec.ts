import { RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { HealthModule } from '@modules/health'
import { type INestApplication, Module } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'

@Module({
	imports: [RPCModule, HealthModule],
})
class HealthIntegrationTestModule {}

interface HealthResponseBody {
	status: string
	timestamp: string
}

describe('Health integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter

	beforeAll(async () => {
		moduleRef = await Test.createTestingModule({
			imports: [HealthIntegrationTestModule],
		}).compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)

		await app.init()
	})

	afterAll(async () => {
		await app.close()
		await moduleRef.close()
	})

	test('responds to the health ping route through the HTTP adapter', async () => {
		const response = await adapter.hono.request('http://localhost/health/ping')
		const body = (await response.json()) as HealthResponseBody

		expect(response.status).toBe(200)
		expect(body).toEqual({
			status: 'ok',
			timestamp: expect.any(String),
		})
		expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
	})
})
