import { Module } from '@nestjs/common'
import { LocalHandleAvailabilityService } from './application/local-handle-availability.service'
import { OrganizationDeletionService } from './application/organization-deletion.service'
import { OrganizationHandlePolicyService } from './application/organization-handle-policy.service'
import { OrganizationsService } from './application/organizations.service'
import { GitHubLoginClient } from './infrastructure/github-login.client'
import { GitHubLoginCacheRepository } from './infrastructure/github-login-cache.repository'
import { OrganizationHandlePolicyRepository } from './infrastructure/organization-handle-policy.repository'
import { OrganizationsRepository } from './infrastructure/organizations.repository'
import { OrganizationsController } from './presentation/organizations.controller'

@Module({
	controllers: [OrganizationsController],
	providers: [
		OrganizationsService,
		OrganizationDeletionService,
		OrganizationHandlePolicyService,
		LocalHandleAvailabilityService,
		OrganizationsRepository,
		OrganizationHandlePolicyRepository,
		GitHubLoginCacheRepository,
		GitHubLoginClient,
	],
	exports: [OrganizationsService],
})
export class OrganizationsModule {}
