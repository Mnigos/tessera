import { Injectable } from '@nestjs/common'
import { Octokit } from '@octokit/rest'

@Injectable()
export class GitHubOctokitClient {
	createForUser(accessToken: string) {
		return new Octokit({ auth: accessToken })
	}
}
