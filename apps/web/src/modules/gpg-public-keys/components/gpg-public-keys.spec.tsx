import type { GpgPublicKey } from '@repo/contracts'
import type { GpgPublicKeyId } from '@repo/domain'
import { fireEvent, render, screen } from '@testing-library/react'
import { getCreateGpgPublicKeyInput } from '../helpers/gpg-public-key-input'
import { useGpgPublicKeysListQuery } from '../hooks/use-gpg-public-keys-list.query'
import { CreateGpgPublicKeyForm } from './create-gpg-public-key-form'
import { GpgPublicKeyListItem } from './gpg-public-key-list-item'
import { GpgPublicKeysList } from './gpg-public-keys-list'

vi.mock('../hooks/use-gpg-public-keys-list.query', () => ({
	useGpgPublicKeysListQuery: vi.fn(),
}))

const useGpgPublicKeysListQueryMock = vi.mocked(useGpgPublicKeysListQuery)

interface GpgPublicKeyWithOptionalDates extends GpgPublicKey {
	keyExpiresAt?: Date
	lastUsedAt?: Date
}

function getGpgPublicKey(
	overrides: Partial<GpgPublicKeyWithOptionalDates> = {}
): GpgPublicKeyWithOptionalDates {
	return {
		id: '8d6ced61-1733-4aca-abba-ccbb9991cd08' as GpgPublicKeyId,
		title: 'Signing key',
		publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
		fingerprint: 'A1B2 C3D4 E5F6',
		keyId: 'ABC123DEF456',
		identities: [],
		emails: ['you@example.com'],
		keyCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
		isRevoked: false,
		createdAt: new Date('2026-01-02T00:00:00.000Z'),
		updatedAt: new Date('2026-01-03T00:00:00.000Z'),
		...overrides,
	}
}

describe('getCreateGpgPublicKeyInput', () => {
	test('trims title and armored public key form data', () => {
		const formData = new FormData()
		formData.set('title', '  Work signing key  ')
		formData.set(
			'publicKey',
			'  -----BEGIN PGP PUBLIC KEY BLOCK-----\nabc\n-----END PGP PUBLIC KEY BLOCK-----  '
		)

		expect(getCreateGpgPublicKeyInput(formData)).toEqual({
			title: 'Work signing key',
			publicKey:
				'-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc\n-----END PGP PUBLIC KEY BLOCK-----',
		})
	})
})

describe('CreateGpgPublicKeyForm', () => {
	test('submits title and armored public key text', () => {
		const onSubmit = vi.fn()
		render(
			<CreateGpgPublicKeyForm
				isError={false}
				isPending={false}
				onSubmit={onSubmit}
			/>
		)

		fireEvent.change(screen.getByLabelText('Title'), {
			target: { value: 'Work key' },
		})
		fireEvent.change(screen.getByLabelText('Armored public key'), {
			target: { value: '-----BEGIN PGP PUBLIC KEY BLOCK-----' },
		})
		const submitButton = screen.getByRole('button', { name: 'Add GPG key' })
		const form = submitButton.closest('form')

		expect(form).toBeTruthy()
		if (!form) return

		fireEvent.submit(form)

		expect(onSubmit).toHaveBeenCalledWith(
			{
				title: 'Work key',
				publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
			},
			expect.any(HTMLFormElement)
		)
	})

	test('shows pending and error states', () => {
		render(<CreateGpgPublicKeyForm isError isPending onSubmit={vi.fn()} />)

		expect(screen.getByText('GPG public key could not be added.')).toBeTruthy()
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Adding' }).disabled
		).toBe(true)
	})
})

describe('GpgPublicKeysList', () => {
	afterEach(() => {
		vi.resetAllMocks()
	})

	test('shows loading state', () => {
		useGpgPublicKeysListQueryMock.mockReturnValue({
			data: undefined,
			isError: false,
			isLoading: true,
		} as never)

		render(<GpgPublicKeysList enabled onDelete={vi.fn()} />)

		expect(screen.getByRole('heading', { name: 'GPG keys' })).toBeTruthy()
		expect(screen.queryByText('No GPG public keys yet.')).toBeNull()
	})

	test('shows error state', () => {
		useGpgPublicKeysListQueryMock.mockReturnValue({
			data: undefined,
			isError: true,
			isLoading: false,
		} as never)

		render(<GpgPublicKeysList enabled onDelete={vi.fn()} />)

		expect(
			screen.getByText('GPG public keys could not be loaded.')
		).toBeTruthy()
	})

	test('shows empty state', () => {
		useGpgPublicKeysListQueryMock.mockReturnValue({
			data: { gpgPublicKeys: [] },
			isError: false,
			isLoading: false,
		} as never)

		render(<GpgPublicKeysList enabled onDelete={vi.fn()} />)

		expect(screen.getByText('No GPG public keys yet.')).toBeTruthy()
	})

	test('shows public keys', () => {
		useGpgPublicKeysListQueryMock.mockReturnValue({
			data: { gpgPublicKeys: [getGpgPublicKey()] },
			isError: false,
			isLoading: false,
		} as never)

		render(<GpgPublicKeysList enabled onDelete={vi.fn()} />)

		expect(screen.getByText('Signing key')).toBeTruthy()
		expect(screen.getByText('ABC123DEF456 · A1B2 C3D4 E5F6')).toBeTruthy()
	})
})

describe('GpgPublicKeyListItem', () => {
	test('shows signing key dates and email metadata', () => {
		render(
			<GpgPublicKeyListItem
				gpgPublicKey={getGpgPublicKey({
					keyExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
					lastUsedAt: new Date('2026-02-03T00:00:00.000Z'),
				})}
				onDelete={vi.fn()}
			/>
		)

		expect(screen.getByText('Last used 2026-02-03')).toBeTruthy()
		expect(screen.getByText('Expires 2027-01-01')).toBeTruthy()
		expect(screen.getByText('you@example.com')).toBeTruthy()
	})

	test('disables the delete button while deleting this key', () => {
		render(
			<GpgPublicKeyListItem
				deletingId={'8d6ced61-1733-4aca-abba-ccbb9991cd08' as GpgPublicKeyId}
				gpgPublicKey={getGpgPublicKey()}
				onDelete={vi.fn()}
			/>
		)

		expect(
			screen.getByRole<HTMLButtonElement>('button', {
				name: 'Delete GPG public key',
			}).disabled
		).toBe(true)
	})
})
