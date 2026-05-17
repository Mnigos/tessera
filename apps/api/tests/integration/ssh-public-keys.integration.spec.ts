import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { SshPublicKeysModule } from '@modules/ssh-public-keys'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { db } from '@repo/db/client'
import { session, sshPublicKeys, user } from '@repo/db/schema'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const validPublicKey =
	'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA marta@laptop'

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		RPCModule,
		AuthModule,
		SshPublicKeysModule,
	],
	providers: [
		{
			provide: APP_FILTER,
			useClass: GlobalExceptionFilter,
		},
	],
})
class SshPublicKeysIntegrationTestModule {}

interface SshPublicKeyResponseBody {
	sshPublicKey: {
		id: string
		title: string
		keyType: string
		publicKey: string
		fingerprintSha256: string
		comment?: string
		createdAt: string
		updatedAt: string
	}
}

interface SshPublicKeysListResponseBody {
	sshPublicKeys: SshPublicKeyResponseBody['sshPublicKey'][]
}

interface ErrorResponseBody {
	defined: true
	code: string
	message: string
}

interface CreateIntegrationUserOptions {
	username: string
	email: string
	name?: string
}

describe('SSH public keys integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		moduleRef = await Test.createTestingModule({
			imports: [SshPublicKeysIntegrationTestModule],
		}).compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)

		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('rejects unauthenticated create requests', async () => {
		const response = await createSshPublicKey({
			title: 'Laptop',
			publicKey: validPublicKey,
		})
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		})
	})

	test('creates and lists SSH public keys for the authenticated user', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const createResponse = await createSshPublicKey(
			{ title: ' Laptop ', publicKey: `  ${validPublicKey}  ` },
			headers
		)
		const createBody = (await createResponse.json()) as SshPublicKeyResponseBody

		expect(createResponse.status).toBe(200)
		expect(createBody.sshPublicKey).toMatchObject({
			title: 'Laptop',
			keyType: 'ssh-ed25519',
			publicKey: validPublicKey,
			fingerprintSha256: 'SHA256:kmYcvdi2GkPeWxB6XLjrZB8JHsy2Hm8luHMFp9GMvqk',
			comment: 'marta@laptop',
		})
		expect(createBody.sshPublicKey.id).toEqual(expect.any(String))
		expect(Date.parse(createBody.sshPublicKey.createdAt)).not.toBeNaN()

		const listResponse = await listSshPublicKeys(headers)
		const listBody =
			(await listResponse.json()) as SshPublicKeysListResponseBody

		expect(listResponse.status).toBe(200)
		expect(listBody.sshPublicKeys).toHaveLength(1)
		expect(listBody.sshPublicKeys[0]).toMatchObject(createBody.sshPublicKey)
	})

	test('rejects invalid SSH public keys clearly', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createSshPublicKey(
			{ title: 'Laptop', publicKey: 'not-a-key' },
			headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body).toMatchObject({
			code: 'BAD_REQUEST',
			message: 'ssh public key is invalid',
		})
	})

	test('rejects duplicate keys for the same owner', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})

		expect(
			(
				await createSshPublicKey(
					{ title: 'Laptop', publicKey: validPublicKey },
					headers
				)
			).status
		).toBe(200)

		const response = await createSshPublicKey(
			{ title: 'Desktop', publicKey: validPublicKey },
			headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body).toMatchObject({
			code: 'CONFLICT',
			message: 'ssh public key already exists',
		})
	})

	test('isolates list and delete operations by owner', async () => {
		const martaHeaders = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const renHeaders = await createIntegrationSessionHeaders({
			username: 'ren',
			email: 'ren@example.com',
		})
		const createResponse = await createSshPublicKey(
			{ title: 'Laptop', publicKey: validPublicKey },
			martaHeaders
		)
		const createBody = (await createResponse.json()) as SshPublicKeyResponseBody

		const renListResponse = await listSshPublicKeys(renHeaders)
		const renListBody =
			(await renListResponse.json()) as SshPublicKeysListResponseBody

		expect(renListResponse.status).toBe(200)
		expect(renListBody.sshPublicKeys).toEqual([])

		const renDeleteResponse = await deleteSshPublicKey(
			createBody.sshPublicKey.id,
			renHeaders
		)
		const renDeleteBody = (await renDeleteResponse.json()) as ErrorResponseBody

		expect(renDeleteResponse.status).toBe(404)
		expect(renDeleteBody).toMatchObject({
			code: 'NOT_FOUND',
			message: 'ssh public key not found',
		})

		expect(
			(await deleteSshPublicKey(createBody.sshPublicKey.id, martaHeaders))
				.status
		).toBe(200)

		const martaListResponse = await listSshPublicKeys(martaHeaders)
		const martaListBody =
			(await martaListResponse.json()) as SshPublicKeysListResponseBody

		expect(martaListBody.sshPublicKeys).toEqual([])
	})

	async function createIntegrationSessionHeaders({
		email,
		name,
		username,
	}: CreateIntegrationUserOptions) {
		const token = crypto.randomUUID()
		const createdUsers = await db
			.insert(user)
			.values({
				name: name ?? username,
				email,
				emailVerified: true,
				username,
			})
			.returning({ id: user.id })
		const createdUser = createdUsers[0]

		if (!createdUser) throw new Error('Failed to create integration user')

		await db.insert(session).values({
			token,
			userId: createdUser.id,
			expiresAt: new Date(Date.now() + 86_400_000),
		})

		const headers = new Headers()
		headers.set(
			'cookie',
			`better-auth.session_token=${token}.${await makeSignature(
				token,
				'test-auth-secret'
			)}`
		)

		return headers
	}

	async function resetIntegrationDatabase() {
		await db.delete(sshPublicKeys)
		await db.delete(session)
		await db.delete(user)
	}

	function createSshPublicKey(input: object, headers?: Headers) {
		const requestHeaders = new Headers(headers)
		requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request('http://localhost/ssh-public-keys', {
			method: 'POST',
			headers: requestHeaders,
			body: JSON.stringify(input),
		})
	}

	function listSshPublicKeys(headers?: Headers) {
		return adapter.hono.request('http://localhost/ssh-public-keys', {
			headers,
		})
	}

	function deleteSshPublicKey(id: string, headers?: Headers) {
		return adapter.hono.request(`http://localhost/ssh-public-keys/${id}`, {
			method: 'DELETE',
			headers,
		})
	}
})
