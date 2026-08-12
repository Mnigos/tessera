import { randomBytes } from 'node:crypto'
import { parseEnv } from './env.schema'

const DEV_AUTH_SECRET_FALLBACK = 'development-auth-secret'
const STRONG_SECRET = randomBytes(32).toString('hex')
const AUTH_SECRET_ERROR = /AUTH_SECRET/

const createBaseEnv = (
	overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
	INTERNAL_API_TOKEN: 'internal-token',
	...overrides,
})

describe('parseEnv', () => {
	describe('AUTH_SECRET fail-closed guard', () => {
		test('throws in production when AUTH_SECRET is missing', () => {
			expect(() => parseEnv(createBaseEnv({ NODE_ENV: 'production' }))).toThrow(
				AUTH_SECRET_ERROR
			)
		})

		test('throws in production when AUTH_SECRET uses the known dev fallback', () => {
			expect(() =>
				parseEnv(
					createBaseEnv({
						NODE_ENV: 'production',
						AUTH_SECRET: DEV_AUTH_SECRET_FALLBACK,
					})
				)
			).toThrow(AUTH_SECRET_ERROR)
		})

		test('throws in production when AUTH_SECRET is shorter than 32 chars', () => {
			expect(() =>
				parseEnv(
					createBaseEnv({
						NODE_ENV: 'production',
						AUTH_SECRET: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p', // 31 chars
					})
				)
			).toThrow(AUTH_SECRET_ERROR)
		})

		test('throws in production when AUTH_SECRET has low entropy', () => {
			expect(() =>
				parseEnv(
					createBaseEnv({
						NODE_ENV: 'production',
						AUTH_SECRET: 'a'.repeat(40),
					})
				)
			).toThrow(AUTH_SECRET_ERROR)
		})

		test('passes in production with a strong secret and preserves it unchanged', () => {
			expect(
				parseEnv(
					createBaseEnv({ NODE_ENV: 'production', AUTH_SECRET: STRONG_SECRET })
				).AUTH_SECRET
			).toBe(STRONG_SECRET)
		})

		test('accepts a boundary-length 32-char strong secret in production', () => {
			const boundarySecret = randomBytes(16).toString('hex') // exactly 32 chars

			expect(
				parseEnv(
					createBaseEnv({
						NODE_ENV: 'production',
						AUTH_SECRET: boundarySecret,
					})
				).AUTH_SECRET
			).toBe(boundarySecret)
		})

		test('passes in development when AUTH_SECRET is missing and applies the fallback', () => {
			expect(
				parseEnv(createBaseEnv({ NODE_ENV: 'development' })).AUTH_SECRET
			).toBe(DEV_AUTH_SECRET_FALLBACK)
		})

		test('passes in test when AUTH_SECRET is missing and applies the fallback', () => {
			expect(parseEnv(createBaseEnv({ NODE_ENV: 'test' })).AUTH_SECRET).toBe(
				DEV_AUTH_SECRET_FALLBACK
			)
		})

		test('does not enforce the strong-secret guard outside production', () => {
			expect(
				parseEnv(
					createBaseEnv({
						NODE_ENV: 'development',
						AUTH_SECRET: DEV_AUTH_SECRET_FALLBACK,
					})
				).AUTH_SECRET
			).toBe(DEV_AUTH_SECRET_FALLBACK)
		})

		test('treats an unset NODE_ENV as production and fails closed', () => {
			const environment = createBaseEnv()
			environment.NODE_ENV = undefined

			expect(() => parseEnv(environment)).toThrow(AUTH_SECRET_ERROR)
		})

		test('rejects an unknown NODE_ENV value instead of falling back to dev', () => {
			expect(() =>
				parseEnv(
					createBaseEnv({ NODE_ENV: 'staging', AUTH_SECRET: STRONG_SECRET })
				)
			).toThrow()
		})
	})
})
