import type { NestHonoRequest } from '@mnigos/platform-hono'
import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common'
import { z } from 'zod'
import { BadRequestError } from '~/shared/errors'
import { GitHubWebhookService } from '../application/github-webhook.service'

const gitHubDeliveryIdSchema = z.uuid().brand<'github_webhook_delivery_id'>()

@Controller('/webhooks/github')
export class GitHubWebhookController {
	constructor(private readonly githubWebhookService: GitHubWebhookService) {}

	@Post()
	@HttpCode(202)
	async receive(
		@Req() request: NestHonoRequest,
		@Headers('x-github-delivery') deliveryId: string | undefined,
		@Headers('x-github-event') eventName: string | undefined,
		@Headers('x-hub-signature-256') signature: string | undefined
	) {
		if (!(request.rawBody && deliveryId && eventName && signature))
			throw new BadRequestError(
				'github webhook',
				{ reason: 'missing_required_data' },
				'Missing required GitHub webhook data'
			)

		return await this.githubWebhookService.receive({
			deliveryId: gitHubDeliveryIdSchema.parse(deliveryId),
			eventName,
			signature,
			rawBody: request.rawBody,
		})
	}
}
