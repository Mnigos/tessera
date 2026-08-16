import { Module } from '@nestjs/common'
import { OrganizationHandlePolicyService } from './application/organization-handle-policy.service'
import { OrganizationsService } from './application/organizations.service'
import { GitHubLoginClient } from './infrastructure/github-login.client'
import { GitHubLoginCacheRepository } from './infrastructure/github-login-cache.repository'
import { OrganizationsRepository } from './infrastructure/organizations.repository'
import { OrganizationsController } from './presentation/organizations.controller'

@Module({
	controllers: [OrganizationsController],
	providers: [
		OrganizationsService,
		OrganizationHandlePolicyService,
		OrganizationsRepository,
		GitHubLoginCacheRepository,
		GitHubLoginClient,
	],
	exports: [OrganizationsService],
})
export class OrganizationsModule {}
