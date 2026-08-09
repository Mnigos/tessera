import { Test, type TestingModule } from '@nestjs/testing'
import type { CheckState } from '@repo/contracts'
import type {
	GitHubCheckRunMappingId,
	GitHubCommitStatusMappingId,
} from '@repo/db'
import type { CheckId, RepositoryId } from '@repo/domain'
import {
	ChecksRepository,
	type EffectiveCheckRow,
} from '../infrastructure/checks.repository'
import { ChecksReadService } from './checks-read.service'

const repositoryId = '00000000-0000-4000-8000-000000000001' as RepositoryId

describe(ChecksReadService.name, () => {
	let moduleRef: TestingModule
	let service: ChecksReadService
	let repository: ChecksRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				ChecksReadService,
				{
					provide: ChecksRepository,
					useValue: { listEffectiveChecks: vi.fn() },
				},
			],
		}).compile()
		service = moduleRef.get(ChecksReadService)
		repository = moduleRef.get(ChecksRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('answers for a commit nothing reported on with an empty rollup', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([])

		const summary = await service.findSummary({
			repositoryId,
			head: { sha: 'head', isCurrent: true },
		})

		expect(summary).toMatchObject({
			headSha: 'head',
			overall: 'none',
			headIsCurrent: true,
		})
		expect(summary.lastResultAt).toBeUndefined()
		expect(
			Object.values(summary.counts).every(count => count === 0)
		).toBeTruthy()
	})

	test('answers every requested SHA, including ones with no results', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([
			row('head-a', 'success', '2026-08-08T10:00:00Z'),
		])

		const summaries = await service.listSummaries({
			repositoryId,
			heads: [
				{ key: 'reported', sha: 'head-a', isCurrent: true },
				{ key: 'silent', sha: 'head-b', isCurrent: true },
			],
		})

		expect(summaries.get('reported')).toMatchObject({ overall: 'success' })
		expect(summaries.get('silent')).toMatchObject({
			headSha: 'head-b',
			overall: 'none',
		})
	})

	test('keeps currency per requesting reference rather than per shared commit', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([
			row('head-a', 'success', '2026-08-08T10:00:00Z'),
			row('head-a', 'pending', '2026-08-08T11:00:00Z'),
			row('head-b', 'failure', '2026-08-08T12:00:00Z'),
		])

		const summaries = await service.listSummaries({
			repositoryId,
			heads: [
				{ key: 'still-the-head', sha: 'head-a', isCurrent: true },
				{ key: 'moved-past', sha: 'head-a', isCurrent: false },
				{ key: 'other', sha: 'head-b', isCurrent: false },
			],
		})

		expect(repository.listEffectiveChecks).toHaveBeenCalledWith({
			repositoryId,
			shas: ['head-a', 'head-b'],
		})
		expect(summaries.get('still-the-head')).toMatchObject({
			overall: 'pending',
			headIsCurrent: true,
			lastResultAt: new Date('2026-08-08T11:00:00Z'),
		})
		// The same commit, asked about by a reference that has moved on: one answer
		// must never overwrite the other.
		expect(summaries.get('moved-past')).toMatchObject({
			overall: 'pending',
			headIsCurrent: false,
		})
		expect(summaries.get('other')).toMatchObject({
			overall: 'failure',
			headIsCurrent: false,
		})
	})

	test('lists failures first and preserves status and check-run contexts separately', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([
			row('head', 'success', '2026-08-08T10:00:00Z', 'build', 'status'),
			row('head', 'failure', '2026-08-08T11:00:00Z', 'build', 'check_run'),
		])

		expect(
			await service.listChecks({
				repositoryId,
				head: { sha: 'head', isCurrent: false },
			})
		).toMatchObject({
			headSha: 'head',
			headIsCurrent: false,
			lastResultAt: new Date('2026-08-08T11:00:00Z'),
			checks: [
				{ state: 'failure', context: 'build', kind: 'check_run' },
				{ state: 'success', context: 'build', kind: 'status' },
			],
		})
	})

	test('names the requirements nothing on the commit answers to', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([
			row('head', 'success', '2026-08-08T10:00:00Z', 'ci/build', 'status'),
		])

		const { missingRequiredContexts } = await service.listChecks({
			repositoryId,
			head: { sha: 'head', isCurrent: true },
			requiredContexts: [
				{ context: 'ci/build' },
				{ context: 'ci/lint' },
				// Same name, wrong kind: the requirement is for a check run and only a
				// commit status reported, so nothing has answered it.
				{ context: 'ci/build', kind: 'check_run' },
			],
		})

		expect(missingRequiredContexts).toEqual([
			{ context: 'ci/lint' },
			{ context: 'ci/build', kind: 'check_run' },
		])
	})

	test('reports no absences to a caller that requires nothing', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([])

		const { missingRequiredContexts } = await service.listChecks({
			repositoryId,
			head: { sha: 'head', isCurrent: true },
		})

		expect(missingRequiredContexts).toEqual([])
	})

	test('names GitHub as the provider of a mapped status with no surviving actor', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([
			row('head', 'success', '2026-08-08T10:00:00Z', 'ci', 'status'),
		])

		const { checks } = await service.listChecks({
			repositoryId,
			head: { sha: 'head', isCurrent: true },
		})

		expect(checks[0]?.provider).toMatchObject({
			kind: 'github',
			name: 'GitHub',
		})
	})

	test('reads an unmapped result as natively written', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([
			{
				...row('head', 'success', '2026-08-08T10:00:00Z', 'ci', 'status'),
				statusMappingId: null,
			},
		])

		const { checks } = await service.listChecks({
			repositoryId,
			head: { sha: 'head', isCurrent: true },
		})

		expect(checks[0]?.provider).toMatchObject({
			kind: 'tessera',
			name: 'Tessera',
		})
	})
})

function row(
	sha: string,
	state: CheckState,
	observedAt: string,
	context: string = state,
	kind: EffectiveCheckRow['kind'] = 'check_run'
): EffectiveCheckRow {
	return {
		id: crypto.randomUUID() as CheckId,
		sha,
		kind,
		context,
		state,
		rawStatus: null,
		rawConclusion: null,
		targetUrl: null,
		description: null,
		outputTitle: null,
		outputSummary: null,
		startedAt: null,
		completedAt: null,
		observedAt: new Date(observedAt),
		providerId: null,
		providerKey: null,
		providerDisplayName: null,
		runMappingId:
			kind === 'check_run'
				? (crypto.randomUUID() as GitHubCheckRunMappingId)
				: null,
		statusMappingId:
			kind === 'status'
				? (crypto.randomUUID() as GitHubCommitStatusMappingId)
				: null,
		runName: kind === 'check_run' ? context : null,
		runDetailsUrl: null,
		runHtmlUrl: null,
		appExternalNumericId: null,
		appExternalNodeId: null,
		appName: null,
		appSlug: null,
		appHtmlUrl: null,
		statusActorLogin: null,
		statusActorHtmlUrl: null,
	}
}
