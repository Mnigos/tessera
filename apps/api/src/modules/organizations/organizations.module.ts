import { Module } from '@nestjs/common'
import { OrganizationHandlePolicyService } from './application/organization-handle-policy.service'
import { OrganizationInvitationsService } from './application/organization-invitations.service'
import { OrganizationMembersService } from './application/organization-members.service'
import { OrganizationsService } from './application/organizations.service'
import { GitHubLoginClient } from './infrastructure/github-login.client'
import { GitHubLoginCacheRepository } from './infrastructure/github-login-cache.repository'
import { OrganizationInvitationsRepository } from './infrastructure/organization-invitations.repository'
import { OrganizationMembersRepository } from './infrastructure/organization-members.repository'
import { OrganizationsRepository } from './infrastructure/organizations.repository'
import { OrganizationInvitationsController } from './presentation/organization-invitations.controller'
import { OrganizationMembersController } from './presentation/organization-members.controller'
import { OrganizationsController } from './presentation/organizations.controller'

@Module({
	controllers: [
		OrganizationsController,
		OrganizationMembersController,
		OrganizationInvitationsController,
	],
	providers: [
		OrganizationsService,
		OrganizationMembersService,
		OrganizationInvitationsService,
		OrganizationHandlePolicyService,
		OrganizationsRepository,
		OrganizationMembersRepository,
		OrganizationInvitationsRepository,
		GitHubLoginCacheRepository,
		GitHubLoginClient,
	],
	exports: [OrganizationsService],
})
export class OrganizationsModule {}
