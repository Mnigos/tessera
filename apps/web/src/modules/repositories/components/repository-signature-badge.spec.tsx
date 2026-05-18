import { render, screen } from '@testing-library/react'
import { RepositorySignatureBadge } from './repository-signature-badge'

describe('RepositorySignatureBadge', () => {
	test('renders repository signature states with terse labels and titles', () => {
		const signatures = [
			{
				label: 'Verified',
				title: 'Verified signature: Ada Lovelace',
				signature: { state: 'trusted', signer: 'Ada Lovelace' },
			},
			{
				label: 'Verified',
				title: 'Verified signature',
				signature: { state: 'valid' },
			},
			{
				label: 'Unverified',
				title: 'Signed but unverified signature: key-1',
				signature: { state: 'untrusted', keyId: 'key-1' },
			},
			{
				label: 'Expired',
				title: 'Expired signature or signing key: key-4',
				signature: { state: 'expired', keyId: 'key-4' },
			},
			{
				label: 'Revoked',
				title: 'Revoked signing key: key-5',
				signature: { state: 'revoked', keyId: 'key-5' },
			},
			{
				label: 'Bad',
				title: 'Bad signature: key-2',
				signature: { state: 'bad', keyId: 'key-2' },
			},
			{
				label: 'Unknown',
				title: 'Unknown signer: key-3',
				signature: { state: 'unknown', keyId: 'key-3' },
			},
			{
				label: 'Unsigned',
				title: 'Unsigned commit or tag',
				signature: { state: 'unsigned' },
			},
			{
				label: 'Unsigned',
				title: 'Unsigned commit or tag',
				signature: undefined,
			},
		] as const

		for (const { label, signature, title } of signatures) {
			const { unmount } = render(
				<RepositorySignatureBadge signature={signature} />
			)

			expect(screen.getByText(label).closest(`[title="${title}"]`)).toBeTruthy()

			unmount()
		}
	})
})
