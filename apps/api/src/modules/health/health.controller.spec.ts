import { HealthService } from './application/health.service'

describe(HealthService.name, () => {
	test('returns ok status', () => {
		const service = new HealthService()
		const result = service.getHealthStatus()

		expect(result.status).toBe('ok')
		expect(result.timestamp).toBeInstanceOf(Date)
	})
})
