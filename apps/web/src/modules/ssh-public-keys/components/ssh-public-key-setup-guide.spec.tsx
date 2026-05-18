import type { SshPublicKey } from '@repo/contracts'
import type { SshPublicKeyId } from '@repo/domain'
import { toast } from '@repo/ui/components/sonner'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SshPublicKeyListItem } from './ssh-public-key-list-item'
import { SshPublicKeySetupGuide } from './ssh-public-key-setup-guide'

vi.mock('@repo/ui/components/sonner', async importOriginal => {
	const actual =
		await importOriginal<typeof import('@repo/ui/components/sonner')>()

	return {
		...actual,
		toast: {
			error: vi.fn(),
		},
	}
})

const generateCommand = 'ssh-keygen -t ed25519 -C "you@example.com"'
const printPublicKeyCommand = 'cat ~/.ssh/id_ed25519.pub'

interface SshPublicKeyWithLastUsedAt extends SshPublicKey {
	lastUsedAt?: Date
}

function getSshPublicKey(
	overrides: Partial<SshPublicKeyWithLastUsedAt> = {}
): SshPublicKeyWithLastUsedAt {
	return {
		id: '8d6ced61-1733-4aca-abba-ccbb9991cd08' as SshPublicKeyId,
		title: 'MacBook Pro',
		keyType: 'ssh-ed25519',
		publicKey: 'ssh-ed25519 AAAA...',
		fingerprint: 'SHA256:abc123',
		comment: 'you@example.com',
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-02T00:00:00.000Z'),
		...overrides,
	}
}

describe('SshPublicKeySetupGuide', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('explains SSH key setup with copyable commands', async () => {
		const user = userEvent.setup()

		render(<SshPublicKeySetupGuide />)

		expect(screen.getByRole('heading', { name: 'Set up SSH' })).toBeTruthy()
		expect(screen.getByText(generateCommand)).toBeTruthy()
		expect(screen.getByText(printPublicKeyCommand)).toBeTruthy()

		await user.click(
			screen.getByRole('button', {
				name: 'Copy generate SSH key command',
			})
		)

		expect(
			screen.getByRole('button', {
				name: 'Generate SSH key command copied',
			})
		).toBeTruthy()

		await user.click(
			screen.getByRole('button', { name: 'Copy print public key command' })
		)

		expect(
			screen.getByRole('button', { name: 'Print public key command copied' })
		).toBeTruthy()
	})

	test('shows copy failure feedback', async () => {
		const error = new Error('clipboard unavailable')
		const consoleErrorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined)
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(error)
		const user = userEvent.setup()

		render(<SshPublicKeySetupGuide />)

		await user.click(
			screen.getByRole('button', {
				name: 'Copy generate SSH key command',
			})
		)

		expect(consoleErrorSpy).toHaveBeenCalledWith(error)
		expect(toast.error).toHaveBeenCalledWith('Could not copy SSH setup command')
	})
})

describe('SshPublicKeyListItem', () => {
	test('shows the last used date when present', () => {
		render(
			<SshPublicKeyListItem
				onDelete={vi.fn()}
				sshPublicKey={getSshPublicKey({
					lastUsedAt: new Date('2026-02-03T00:00:00.000Z'),
				})}
			/>
		)

		expect(screen.getByText('Last used 2026-02-03')).toBeTruthy()
	})

	test('shows never used when the key has not been used', () => {
		render(
			<SshPublicKeyListItem
				onDelete={vi.fn()}
				sshPublicKey={getSshPublicKey()}
			/>
		)

		expect(screen.getByText('Never used')).toBeTruthy()
	})
})
