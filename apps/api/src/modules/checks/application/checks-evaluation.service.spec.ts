import { Test, type TestingModule } from '@nestjs/testing'
import type { CheckKind, CheckState } from '@repo/contracts'
import type {
	GitHubCheckRunMappingId,
	GitHubCommitStatusMappingId,
} from '@repo/db'
import type { CheckId, RepositoryId } from '@repo/domain'
import {
	ChecksRepository,
	type EffectiveCheckRow,
} from '../infrastructure/checks.repository'
import { ChecksEvaluationService } from './checks-evaluation.service'

const repositoryId = '00000000-0000-4000-8000-000000000001' as RepositoryId

describe(ChecksEvaluationService.name, () => {
	let moduleRef: TestingModule
	let service: ChecksEvaluationService
	let repository: ChecksRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				ChecksEvaluationService,
				{
					provide: ChecksRepository,
					useValue: { listEffectiveChecks: vi.fn() },
				},
			],
		}).compile()
		service = moduleRef.get(ChecksEvaluationService)
		repository = moduleRef.get(ChecksRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('treats no requirements as vacuously successful without querying', async () => {
		expect(await service.evaluate(repositoryId, 'head', [])).toEqual({
			headSha: 'head',
			perContext: [],
			overall: 'success',
		})
		expect(repository.listEffectiveChecks).not.toHaveBeenCalled()
	})

	test('fails when a required context is missing', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([])

		expect(
			await service.evaluate(repositoryId, 'head', [{ context: 'build' }])
		).toMatchObject({
			overall: 'failure',
			perContext: [{ state: 'missing', satisfied: false }],
		})
	})

	test.each([
		'success',
		'neutral',
		'skipped',
	] as const)('treats %s as satisfying', async state => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([
			checkRow({ state }),
		])

		expect(
			await service.evaluate(repositoryId, 'head', [{ context: 'build' }])
		).toMatchObject({
			overall: 'success',
			perContext: [{ state, satisfied: true }],
		})
	})

	test('applies failure over pending over success precedence', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([
			checkRow({ context: 'lint', state: 'success' }),
			checkRow({ context: 'build', state: 'pending' }),
			checkRow({ context: 'test', state: 'failure' }),
		])

		expect(
			await service.evaluate(repositoryId, 'head', [
				{ context: 'lint' },
				{ context: 'build' },
			])
		).toMatchObject({ overall: 'pending' })
		expect(
			await service.evaluate(repositoryId, 'head', [
				{ context: 'lint' },
				{ context: 'build' },
				{ context: 'test' },
			])
		).toMatchObject({ overall: 'failure' })
	})

	test('distinguishes kind and provider app while an unqualified match uses the worst result', async () => {
		vi.spyOn(repository, 'listEffectiveChecks').mockResolvedValue([
			checkRow({ kind: 'status', state: 'failure' }),
			checkRow({
				kind: 'check_run',
				state: 'success',
				appExternalNodeId: 'app-node',
				appExternalNumericId: 42n,
			}),
		])

		expect(
			await service.evaluate(repositoryId, 'head', [
				{ context: 'build' },
				{ context: 'build', kind: 'check_run', providerAppId: '42' },
				{ context: 'build', kind: 'check_run', providerAppId: 'app-node' },
			])
		).toMatchObject({
			overall: 'failure',
			perContext: [
				{ state: 'failure', satisfied: false },
				{ state: 'success', satisfied: true },
				{ state: 'success', satisfied: true },
			],
		})
	})
})

function checkRow({
	context = 'build',
	kind = 'check_run',
	state,
	appExternalNodeId = null,
	appExternalNumericId = null,
}: {
	context?: string
	kind?: CheckKind
	state: CheckState
	appExternalNodeId?: string | null
	appExternalNumericId?: bigint | null
}): EffectiveCheckRow {
	return {
		id: crypto.randomUUID() as CheckId,
		sha: 'head',
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
		observedAt: new Date('2026-08-08T10:00:00Z'),
		runMappingId: kind === 'check_run' ? runMappingId() : null,
		statusMappingId: kind === 'status' ? statusMappingId() : null,
		runName: kind === 'check_run' ? context : null,
		runDetailsUrl: null,
		runHtmlUrl: null,
		appExternalNumericId,
		appExternalNodeId,
		appName: null,
		appSlug: null,
		appHtmlUrl: null,
		statusActorLogin: null,
		statusActorHtmlUrl: null,
	}
}

function runMappingId() {
	return crypto.randomUUID() as GitHubCheckRunMappingId
}

function statusMappingId() {
	return crypto.randomUUID() as GitHubCommitStatusMappingId
}
