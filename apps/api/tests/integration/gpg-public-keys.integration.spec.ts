import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { GpgPublicKeysModule } from '@modules/gpg-public-keys'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { gpgPublicKeySchema } from '@repo/contracts'
import { db } from '@repo/db/client'
import { gpgPublicKeys, session, user } from '@repo/db/schema'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const validPublicKey = `-----BEGIN PGP PUBLIC KEY BLOCK-----

xjMEZZN9JRYJKwYBBAHaRw8BAQdAJHJGXb7Vwj5XXgHDpZ9Ww4pHrGgPZvpy
Wtiv0TahrobNGU1hcnRhIDxtYXJ0YUBleGFtcGxlLmNvbT7CwBkEExYKAIsF
gmWTfSUFiQABUYADCwkHCRA8FjAzS5pBIEUUAAAAAAAcACBzYWx0QG5vdGF0
aW9ucy5vcGVucGdwanMub3Jnh3D6OSc2gJHgR+nnUvzFI7BAve9b4xXwtlii
lby4HbgFFQoIDgwEFgACAQIZAQKbAwIeARYhBPRXSIC11/tkq3CySjwWMDNL
mkEgAAAcoQD/SHzvzBC3TaJ9ClbyXsTuGcppZw9vzDhHV+JA2BPajr0BAJ9s
E0L/LJylembht1HU8n8CDBWS7Apucuwa5iOof1AEzjgEZZN9JRIKKwYBBAGX
VQEFAQEHQN6GoGeIS4MgPnHK5Ii9K3lsKPRmBUNPfOeBMIyttsUSAwEIB8LA
BAQYFgoAdgWCZZN9JQWJAAFRgAkQPBYwM0uaQSBFFAAAAAAAHAAgc2FsdEBu
b3RhdGlvbnMub3BlbnBncGpzLm9yZ3VTF8yhWqyZZULIxB6W4kGvR7oa3qhw
GLv+3bchD7WDApsMFiEE9FdIgLXX+2SrcLJKPBYwM0uaQSAAACCYAQCwGDGv
VFJXrA3WiLArUw4uNrIHcobxf+7WzP15VAKsgwD9H82orGKcwVLrAS6fz7gX
HY2leIkGDbvNcJ5VayBkyQ4=
=fhBZ
-----END PGP PUBLIC KEY BLOCK-----`

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		RPCModule,
		AuthModule,
		GpgPublicKeysModule,
	],
	providers: [
		{
			provide: APP_FILTER,
			useClass: GlobalExceptionFilter,
		},
	],
})
class GpgPublicKeysIntegrationTestModule {}

interface GpgPublicKeyResponseBody {
	gpgPublicKey: {
		id: string
		title: string
		publicKey: string
		fingerprint: string
		keyId: string
		identities: {
			name?: string
			email?: string
			comment?: string
			userId: string
		}[]
		emails: string[]
		keyCreatedAt: string
		keyExpiresAt?: string
		isRevoked: boolean
		lastUsedAt?: string
		createdAt: string
		updatedAt: string
	}
}

interface GpgPublicKeysListResponseBody {
	gpgPublicKeys: GpgPublicKeyResponseBody['gpgPublicKey'][]
}

interface ErrorResponseBody {
	defined: false
	code: string
	status: number
	message: string
}

interface CreateIntegrationUserOptions {
	username: string
	email: string
	name?: string
}

describe('GPG public keys integration', () => {
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
			imports: [GpgPublicKeysIntegrationTestModule],
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
		const response = await createGpgPublicKey({
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

	test('creates and lists GPG public keys for the authenticated user', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const createResponse = await createGpgPublicKey(
			{ title: ' Laptop ', publicKey: `  ${validPublicKey}  ` },
			headers
		)
		const createBody = (await createResponse.json()) as GpgPublicKeyResponseBody

		expect(createResponse.status).toBe(200)
		expect(createBody.gpgPublicKey).toMatchObject({
			title: 'Laptop',
			publicKey: `${validPublicKey}\n`,
			fingerprint: 'F4574880B5D7FB64AB70B24A3C1630334B9A4120',
			keyId: '3C1630334B9A4120',
			identities: [
				{
					name: 'Marta',
					email: 'marta@example.com',
					userId: 'Marta <marta@example.com>',
				},
			],
			emails: ['marta@example.com'],
			keyCreatedAt: '2024-01-02T03:04:05.000Z',
			keyExpiresAt: '2024-01-03T03:04:05.000Z',
			isRevoked: false,
		})
		expect(createBody.gpgPublicKey.id).toEqual(expect.any(String))
		expect(Date.parse(createBody.gpgPublicKey.createdAt)).not.toBeNaN()
		expect(createBody.gpgPublicKey).not.toHaveProperty('lastUsedAt')

		const listResponse = await listGpgPublicKeys(headers)
		const listBody =
			(await listResponse.json()) as GpgPublicKeysListResponseBody

		expect(listResponse.status).toBe(200)
		expect(listBody.gpgPublicKeys).toHaveLength(1)
		expect(listBody.gpgPublicKeys[0]).toMatchObject(createBody.gpgPublicKey)
		expect(listBody.gpgPublicKeys[0]).not.toHaveProperty('lastUsedAt')
		expect(
			gpgPublicKeySchema.safeParse({
				...createBody.gpgPublicKey,
				lastUsedAt: null,
			}).success
		).toBeFalsy()
	})

	test('rejects invalid GPG public keys clearly', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createGpgPublicKey(
			{ title: 'Laptop', publicKey: 'not-a-key' },
			headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body).toMatchObject({
			code: 'BAD_REQUEST',
			message: 'gpg public key is invalid',
		})
	})

	test('rejects private GPG keys clearly', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createGpgPublicKey(
			{
				title: 'Laptop',
				publicKey: `-----BEGIN PGP PRIVATE KEY BLOCK-----

abc
-----END PGP PRIVATE KEY BLOCK-----`,
			},
			headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body).toMatchObject({
			code: 'BAD_REQUEST',
			message: 'gpg public key is invalid',
		})
	})

	test('rejects duplicate keys for the same owner', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})

		expect(
			(
				await createGpgPublicKey(
					{ title: 'Laptop', publicKey: validPublicKey },
					headers
				)
			).status
		).toBe(200)

		const response = await createGpgPublicKey(
			{ title: 'Desktop', publicKey: validPublicKey },
			headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body).toMatchObject({
			code: 'CONFLICT',
			message: 'gpg public key already exists',
		})
	})

	test('allows duplicate key fingerprints for different owners', async () => {
		const martaHeaders = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const renHeaders = await createIntegrationSessionHeaders({
			username: 'ren',
			email: 'ren@example.com',
		})

		expect(
			(
				await createGpgPublicKey(
					{ title: 'Laptop', publicKey: validPublicKey },
					martaHeaders
				)
			).status
		).toBe(200)
		expect(
			(
				await createGpgPublicKey(
					{ title: 'Laptop', publicKey: validPublicKey },
					renHeaders
				)
			).status
		).toBe(200)
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
		const createResponse = await createGpgPublicKey(
			{ title: 'Laptop', publicKey: validPublicKey },
			martaHeaders
		)
		const createBody = (await createResponse.json()) as GpgPublicKeyResponseBody

		const renListResponse = await listGpgPublicKeys(renHeaders)
		const renListBody =
			(await renListResponse.json()) as GpgPublicKeysListResponseBody

		expect(renListResponse.status).toBe(200)
		expect(renListBody.gpgPublicKeys).toEqual([])

		const renDeleteResponse = await deleteGpgPublicKey(
			createBody.gpgPublicKey.id,
			renHeaders
		)
		const renDeleteBody = (await renDeleteResponse.json()) as ErrorResponseBody

		expect(renDeleteResponse.status).toBe(404)
		expect(renDeleteBody).toMatchObject({
			code: 'NOT_FOUND',
			message: 'gpg public key not found',
		})

		expect(
			(await deleteGpgPublicKey(createBody.gpgPublicKey.id, martaHeaders))
				.status
		).toBe(200)

		const martaListResponse = await listGpgPublicKeys(martaHeaders)
		const martaListBody =
			(await martaListResponse.json()) as GpgPublicKeysListResponseBody

		expect(martaListBody.gpgPublicKeys).toEqual([])
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
		await db.delete(gpgPublicKeys)
		await db.delete(session)
		await db.delete(user)
	}

	function createGpgPublicKey(input: object, headers?: Headers) {
		const requestHeaders = new Headers(headers)
		requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request('http://localhost/gpg-public-keys', {
			method: 'POST',
			headers: requestHeaders,
			body: JSON.stringify(input),
		})
	}

	function listGpgPublicKeys(headers?: Headers) {
		return adapter.hono.request('http://localhost/gpg-public-keys', {
			headers,
		})
	}

	function deleteGpgPublicKey(id: string, headers?: Headers) {
		return adapter.hono.request(`http://localhost/gpg-public-keys/${id}`, {
			method: 'DELETE',
			headers,
		})
	}
})
