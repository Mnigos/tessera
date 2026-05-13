import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { BadRequestError } from '~/shared/errors'
import { RepositoriesService } from '../application/repositories.service'
import { InternalBearerTokenGuard } from './internal-bearer-token.guard'
import { authorizeGitRepositoryReadInputSchema } from './internal-git-repositories.schema'

@Controller('/internal/git/repositories')
@UseGuards(InternalBearerTokenGuard)
export class InternalGitRepositoriesController {
	constructor(private readonly repositoriesService: RepositoriesService) {}

	@Post('/authorize-read')
	@HttpCode(200)
	authorizeRead(@Body() body: unknown) {
		const result = authorizeGitRepositoryReadInputSchema.safeParse(body)

		if (!result.success)
			throw new BadRequestError('git repository read authorization input')

		return this.repositoriesService.authorizeGitRepositoryRead(result.data)
	}
}
