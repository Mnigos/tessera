import { UserService } from '@modules/user'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	repositoryBlobSchema,
	repositoryBrowserSummarySchema,
	repositoryCommitHistorySchema,
	repositoryTreeSchema,
} from '@repo/contracts'
import type { RepositoryId, RepositoryName, RepositorySlug } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { RepositoriesService } from '../application/repositories.service'
import { RepositoriesController } from './repositories.controller'
import { RepositoryBrowserController } from './repository-browser.controller'
import { RepositoryOwnerGuard } from './repository-owner.guard'

const repository = {
	repository: {
		id: '00000000-0000-4000-8000-000000000002' as RepositoryId,
		slug: 'notes' as RepositorySlug,
		name: 'Notes' as RepositoryName,
		visibility: 'private' as const,
		description: undefined,
		defaultBranch: 'main',
		createdAt: new Date('2026-05-12T00:00:00Z'),
		updatedAt: new Date('2026-05-12T00:00:00Z'),
	},
	owner: {
		username: 'marta',
	},
}

const session = createMockSession()

describe(RepositoriesController.name, () => {
	let moduleRef: TestingModule
	let repositoriesController: RepositoriesController
	let repositoryBrowserController: RepositoryBrowserController
	let repositoriesService: RepositoriesService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [RepositoriesController, RepositoryBrowserController],
			providers: [
				{
					provide: RepositoriesService,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						get: vi.fn(),
						getBrowserSummary: vi.fn(),
						getTree: vi.fn(),
						getBlob: vi.fn(),
						getRawBlob: vi.fn(),
						getCommitHistory: vi.fn(),
					},
				},
				{
					provide: RepositoryOwnerGuard,
					useValue: {
						canActivate: vi.fn(),
					},
				},
				{
					provide: UserService,
					useValue: {
						findUserId: vi.fn(),
					},
				},
			],
		}).compile()

		repositoriesController = moduleRef.get(RepositoriesController)
		repositoryBrowserController = moduleRef.get(RepositoryBrowserController)
		repositoriesService = moduleRef.get(RepositoriesService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates create requests to the repositories service', async () => {
		const createSpy = vi
			.spyOn(repositoriesService, 'create')
			.mockResolvedValue(repository)

		expect(
			await repositoriesController.create(session)['~orpc'].handler({
				input: { name: 'Notes' },
				context: {},
				path: ['repositories', 'create'],
				procedure: repositoriesController.create(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(repository)
		expect(createSpy).toHaveBeenCalledWith(mockUserId, 'marta', {
			name: 'Notes',
		})
	})

	test('delegates create requests with undefined when the session has no username', async () => {
		const createSpy = vi
			.spyOn(repositoriesService, 'create')
			.mockResolvedValue(repository)
		const sessionWithoutUsername = createMockSession({ username: null })

		await repositoriesController
			.create(sessionWithoutUsername)
			['~orpc'].handler({
				input: { name: 'Notes' },
				context: {},
				path: ['repositories', 'create'],
				procedure: repositoriesController.create(sessionWithoutUsername),
				lastEventId: undefined,
				errors: {},
			})

		expect(createSpy).toHaveBeenCalledWith(mockUserId, undefined, {
			name: 'Notes',
		})
	})

	test('delegates list requests to the repositories service', async () => {
		const listSpy = vi
			.spyOn(repositoriesService, 'list')
			.mockResolvedValue([repository])

		expect(
			await repositoriesController.list(mockUserId)['~orpc'].handler({
				input: { username: 'marta' },
				context: {},
				path: ['repositories', 'list'],
				procedure: repositoriesController.list(mockUserId),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ repositories: [repository] })
		expect(listSpy).toHaveBeenCalledWith(mockUserId)
	})

	test('delegates get requests to the repositories service', async () => {
		const getSpy = vi
			.spyOn(repositoriesService, 'get')
			.mockResolvedValue(repository)

		expect(
			await repositoriesController.get(mockUserId)['~orpc'].handler({
				input: { username: 'marta', slug: repository.repository.slug },
				context: {},
				path: ['repositories', 'get'],
				procedure: repositoriesController.get(mockUserId),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(repository)
		expect(getSpy).toHaveBeenCalledWith(mockUserId, {
			username: 'marta',
			slug: repository.repository.slug,
		})
	})

	test('delegates browser summary requests with an optional viewer', async () => {
		const browserSummary = {
			...repository,
			isEmpty: false,
			defaultBranch: 'main',
			rootEntries: [
				{
					name: 'README.md',
					objectId: 'abc123',
					kind: 'file' as const,
					sizeBytes: 42,
					path: 'README.md',
					mode: '100644',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'abc123',
				content: '# Tessera',
				isTruncated: false,
			},
		}
		const getBrowserSummarySpy = vi
			.spyOn(repositoriesService, 'getBrowserSummary')
			.mockResolvedValue(browserSummary)

		expect(
			await repositoryBrowserController
				.getBrowserSummary(session)
				['~orpc'].handler({
					input: { username: 'marta', slug: repository.repository.slug },
					context: {},
					path: ['repositories', 'getBrowserSummary'],
					procedure: repositoryBrowserController.getBrowserSummary(session),
					lastEventId: undefined,
					errors: {},
				})
		).toEqual(browserSummary)
		expect(getBrowserSummarySpy).toHaveBeenCalledWith(mockUserId, {
			username: 'marta',
			slug: repository.repository.slug,
		})
	})

	test('delegates anonymous browser summary requests without a viewer', async () => {
		const browserSummary = {
			...repository,
			isEmpty: true,
			defaultBranch: 'main',
			rootEntries: [],
			readme: undefined,
		}
		const getBrowserSummarySpy = vi
			.spyOn(repositoriesService, 'getBrowserSummary')
			.mockResolvedValue(browserSummary)

		expect(
			await repositoryBrowserController.getBrowserSummary()['~orpc'].handler({
				input: { username: 'marta', slug: repository.repository.slug },
				context: {},
				path: ['repositories', 'getBrowserSummary'],
				procedure: repositoryBrowserController.getBrowserSummary(),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(browserSummary)
		expect(getBrowserSummarySpy).toHaveBeenCalledWith(undefined, {
			username: 'marta',
			slug: repository.repository.slug,
		})
	})

	test('delegates tree requests with an optional viewer', async () => {
		const tree = {
			...repository,
			ref: 'main',
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file' as const,
					sizeBytes: 17,
					path: 'src/index.ts',
					mode: '100644',
				},
			],
		}
		const getTreeSpy = vi
			.spyOn(repositoriesService, 'getTree')
			.mockResolvedValue(tree)

		expect(
			await repositoryBrowserController.getTree(session)['~orpc'].handler({
				input: {
					username: 'marta',
					slug: repository.repository.slug,
					ref: 'main',
					path: 'src',
				},
				context: {},
				path: ['repositories', 'getTree'],
				procedure: repositoryBrowserController.getTree(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(tree)
		expect(getTreeSpy).toHaveBeenCalledWith(mockUserId, {
			username: 'marta',
			slug: repository.repository.slug,
			ref: 'main',
			path: 'src',
		})
	})

	test('delegates blob requests with an optional viewer', async () => {
		const blob = {
			...repository,
			ref: 'main',
			path: 'src/index.ts',
			name: 'index.ts',
			objectId: 'blob123',
			sizeBytes: 17,
			preview: {
				type: 'text' as const,
				content: 'console.log("hi")',
			},
		}
		const getBlobSpy = vi
			.spyOn(repositoriesService, 'getBlob')
			.mockResolvedValue(blob)

		expect(
			await repositoryBrowserController.getBlob(session)['~orpc'].handler({
				input: {
					username: 'marta',
					slug: repository.repository.slug,
					ref: 'main',
					path: 'src/index.ts',
				},
				context: {},
				path: ['repositories', 'getBlob'],
				procedure: repositoryBrowserController.getBlob(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(blob)
		expect(getBlobSpy).toHaveBeenCalledWith(mockUserId, {
			username: 'marta',
			slug: repository.repository.slug,
			ref: 'main',
			path: 'src/index.ts',
		})
	})

	test('delegates raw blob requests with an optional viewer', async () => {
		const rawBlob = new TextEncoder().encode('console.log("hi")')
		const getRawBlobSpy = vi
			.spyOn(repositoriesService, 'getRawBlob')
			.mockResolvedValue(rawBlob)

		const file = await repositoryBrowserController
			.getRawBlob(session)
			['~orpc'].handler({
				input: {
					username: 'marta',
					slug: repository.repository.slug,
					ref: 'main',
					path: 'src/index.ts',
				},
				context: {},
				path: ['repositories', 'getRawBlob'],
				procedure: repositoryBrowserController.getRawBlob(session),
				lastEventId: undefined,
				errors: {},
			})

		expect(getRawBlobSpy).toHaveBeenCalledWith(mockUserId, {
			username: 'marta',
			slug: repository.repository.slug,
			ref: 'main',
			path: 'src/index.ts',
		})
		expect(file).toBeInstanceOf(File)
		expect(file.name).toBe('index.ts')
		expect(file.type).toBe('application/octet-stream')
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(rawBlob)
	})

	test('delegates commit history requests with an optional viewer', async () => {
		const commitHistory = {
			...repository,
			ref: 'main',
			commits: [
				{
					sha: 'abcdef1234567890',
					shortSha: 'abcdef1',
					summary: 'Add repository browser',
					author: {
						name: 'Marta',
						email: 'marta@example.com',
						date: '2026-05-15T12:00:00Z',
					},
					committer: {
						name: 'Codex',
						email: 'codex@example.com',
						date: '2026-05-15T12:05:00Z',
					},
				},
			],
		}
		const getCommitHistorySpy = vi
			.spyOn(repositoriesService, 'getCommitHistory')
			.mockResolvedValue(commitHistory)

		expect(
			await repositoryBrowserController
				.getCommitHistory(session)
				['~orpc'].handler({
					input: {
						username: 'marta',
						slug: repository.repository.slug,
						ref: 'main',
						limit: 10,
					},
					context: {},
					path: ['repositories', 'getCommitHistory'],
					procedure: repositoryBrowserController.getCommitHistory(session),
					lastEventId: undefined,
					errors: {},
				})
		).toEqual(commitHistory)
		expect(getCommitHistorySpy).toHaveBeenCalledWith(mockUserId, {
			username: 'marta',
			slug: repository.repository.slug,
			ref: 'main',
			limit: 10,
		})
	})

	test('falls back to a blob filename for raw blob paths without a basename', async () => {
		const rawBlob = new TextEncoder().encode('console.log("hi")')
		vi.spyOn(repositoriesService, 'getRawBlob').mockResolvedValue(rawBlob)

		const file = await repositoryBrowserController
			.getRawBlob(session)
			['~orpc'].handler({
				input: {
					username: 'marta',
					slug: repository.repository.slug,
					ref: 'main',
					path: 'src/',
				},
				context: {},
				path: ['repositories', 'getRawBlob'],
				procedure: repositoryBrowserController.getRawBlob(session),
				lastEventId: undefined,
				errors: {},
			})

		expect(file.name).toBe('blob')
	})

	test('validates browser summary contract output without storage path', () => {
		expect(
			repositoryBrowserSummarySchema.parse({
				...repository,
				storagePath: '/internal/repositories/notes.git',
				isEmpty: false,
				defaultBranch: 'main',
				rootEntries: [
					{
						name: 'README.md',
						objectId: 'abc123',
						kind: 'file',
						sizeBytes: 42,
						path: 'README.md',
						mode: '100644',
					},
				],
				readme: {
					filename: 'README.md',
					objectId: 'abc123',
					content: '# Tessera',
					isTruncated: false,
				},
			})
		).toEqual(
			expect.not.objectContaining({
				storagePath: expect.any(String),
			})
		)
	})

	test('validates tree contract output without storage path', () => {
		expect(
			repositoryTreeSchema.parse({
				...repository,
				storagePath: '/internal/repositories/notes.git',
				ref: 'main',
				commitId: 'commit123',
				path: 'src',
				entries: [
					{
						name: 'index.ts',
						objectId: 'blob123',
						kind: 'file',
						sizeBytes: 17,
						path: 'src/index.ts',
						mode: '100644',
					},
				],
			})
		).toEqual(
			expect.not.objectContaining({
				storagePath: expect.any(String),
			})
		)
	})

	test('validates commit history contract output without storage path', () => {
		expect(
			repositoryCommitHistorySchema.parse({
				...repository,
				storagePath: '/internal/repositories/notes.git',
				ref: 'main',
				commits: [
					{
						sha: 'abcdef1234567890',
						shortSha: 'abcdef1',
						summary: 'Add repository browser',
						author: {
							name: 'Marta',
							email: 'marta@example.com',
							date: '2026-05-15T12:00:00Z',
						},
						committer: {
							name: 'Codex',
							email: 'codex@example.com',
							date: '2026-05-15T12:05:00Z',
						},
					},
				],
			})
		).toEqual(
			expect.not.objectContaining({
				storagePath: expect.any(String),
			})
		)
	})

	test('validates discriminated blob preview contract output', () => {
		expect(
			repositoryBlobSchema.parse({
				...repository,
				storagePath: '/internal/repositories/notes.git',
				ref: 'main',
				path: 'src/index.ts',
				name: 'index.ts',
				objectId: 'blob123',
				sizeBytes: 17,
				preview: {
					type: 'text',
					content: 'console.log("hi")',
					language: 'typescript',
					highlighted: {
						startLine: 1,
						lines: [
							{
								number: 1,
								html: '<span style="color:#0550ae">console</span>.log("hi")',
							},
						],
					},
				},
			}).preview
		).toEqual({
			type: 'text',
			content: 'console.log("hi")',
			language: 'typescript',
			highlighted: {
				startLine: 1,
				lines: [
					{
						number: 1,
						html: '<span style="color:#0550ae">console</span>.log("hi")',
					},
				],
			},
		})
		expect(
			repositoryBlobSchema.parse({
				...repository,
				ref: 'main',
				path: 'dist/app.bin',
				name: 'app.bin',
				objectId: 'blob456',
				sizeBytes: 2_097_152,
				preview: {
					type: 'tooLarge',
					previewLimitBytes: 1_048_576,
				},
			}).preview
		).toEqual({
			type: 'tooLarge',
			previewLimitBytes: 1_048_576,
		})
	})
})
