import { Test, type TestingModule } from '@nestjs/testing'
import type { SshPublicKey } from '@repo/contracts'
import type { SshPublicKeyId } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { SshPublicKeysService } from '../application/ssh-public-keys.service'
import { SshPublicKeysController } from './ssh-public-keys.controller'

const session = createMockSession()
const sshPublicKeyId = '00000000-0000-4000-8000-000000000021' as SshPublicKeyId
const sshPublicKey: SshPublicKey = {
	id: sshPublicKeyId,
	title: 'Laptop',
	keyType: 'ssh-ed25519',
	publicKey:
		'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA marta@laptop',
	fingerprintSha256: 'SHA256:kmYcvdi2GkPeWxB6XLjrZB8JHsy2Hm8luHMFp9GMvqk',
	comment: 'marta@laptop',
	createdAt: new Date('2026-05-12T00:00:00Z'),
	updatedAt: new Date('2026-05-12T00:00:00Z'),
}

describe(SshPublicKeysController.name, () => {
	let moduleRef: TestingModule
	let sshPublicKeysController: SshPublicKeysController
	let sshPublicKeysService: SshPublicKeysService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [SshPublicKeysController],
			providers: [
				{
					provide: SshPublicKeysService,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						revoke: vi.fn(),
						delete: vi.fn(),
					},
				},
			],
		}).compile()

		sshPublicKeysController = moduleRef.get(SshPublicKeysController)
		sshPublicKeysService = moduleRef.get(SshPublicKeysService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates create requests to the service', async () => {
		const createSpy = vi
			.spyOn(sshPublicKeysService, 'create')
			.mockResolvedValue(sshPublicKey)

		expect(
			await sshPublicKeysController.create(session)['~orpc'].handler({
				input: { title: 'Laptop', publicKey: sshPublicKey.publicKey },
				context: {},
				path: ['sshPublicKeys', 'create'],
				procedure: sshPublicKeysController.create(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ sshPublicKey })
		expect(createSpy).toHaveBeenCalledWith(mockUserId, {
			title: 'Laptop',
			publicKey: sshPublicKey.publicKey,
		})
	})

	test('delegates list requests to the service', async () => {
		const listSpy = vi
			.spyOn(sshPublicKeysService, 'list')
			.mockResolvedValue([sshPublicKey])

		expect(
			await sshPublicKeysController.list(session)['~orpc'].handler({
				input: undefined,
				context: {},
				path: ['sshPublicKeys', 'list'],
				procedure: sshPublicKeysController.list(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ sshPublicKeys: [sshPublicKey] })
		expect(listSpy).toHaveBeenCalledWith(mockUserId)
	})

	test('delegates revoke requests to the service', async () => {
		const revokeSpy = vi.spyOn(sshPublicKeysService, 'revoke')

		expect(
			await sshPublicKeysController.revoke(session)['~orpc'].handler({
				input: { id: sshPublicKey.id },
				context: {},
				path: ['sshPublicKeys', 'revoke'],
				procedure: sshPublicKeysController.revoke(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ success: true })
		expect(revokeSpy).toHaveBeenCalledWith(mockUserId, sshPublicKey.id)
	})

	test('delegates delete requests to the service', async () => {
		const deleteSpy = vi.spyOn(sshPublicKeysService, 'delete')

		expect(
			await sshPublicKeysController.delete(session)['~orpc'].handler({
				input: { id: sshPublicKey.id },
				context: {},
				path: ['sshPublicKeys', 'delete'],
				procedure: sshPublicKeysController.delete(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ success: true })
		expect(deleteSpy).toHaveBeenCalledWith(mockUserId, sshPublicKey.id)
	})
})
