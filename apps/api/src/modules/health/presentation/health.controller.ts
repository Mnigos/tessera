import { contract } from '@config/rpc'
import { Controller } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import { HealthService } from '../application/health.service'

@Controller()
export class HealthController {
	constructor(private readonly healthService: HealthService) {}

	@Implement(contract.health.ping)
	ping() {
		return implement(contract.health.ping).handler(() =>
			this.healthService.getStatus()
		)
	}
}
