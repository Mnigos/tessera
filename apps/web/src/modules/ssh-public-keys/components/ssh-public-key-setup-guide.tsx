import { Card } from '@repo/ui/components/card'
import { SshPublicKeyCopyButton } from './ssh-public-key-copy-button'

const generateSshKeyCommand = 'ssh-keygen -t ed25519 -C "you@example.com"'
const printPublicKeyCommand = 'cat ~/.ssh/id_ed25519.pub'

export function SshPublicKeySetupGuide() {
	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">Set up SSH</h2>
				<p className="text-muted-foreground text-sm">
					Generate a key on your machine, then paste the public key below.
				</p>
			</div>
			<div className="flex flex-col gap-3">
				<SetupCommand
					command={generateSshKeyCommand}
					copiedLabel="Generate SSH key command copied"
					label="Copy generate SSH key command"
					title="Generate a key"
				/>
				<SetupCommand
					command={printPublicKeyCommand}
					copiedLabel="Print public key command copied"
					label="Copy print public key command"
					title="Show the public key"
				/>
			</div>
			<p className="text-muted-foreground text-sm">
				Copy the full public key output, including the key type at the
				beginning.
			</p>
		</Card>
	)
}

interface SetupCommandProps {
	command: string
	copiedLabel: string
	label: string
	title: string
}

function SetupCommand({
	command,
	copiedLabel,
	label,
	title,
}: Readonly<SetupCommandProps>) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<h3 className="font-medium text-sm">{title}</h3>
				<SshPublicKeyCopyButton
					copiedLabel={copiedLabel}
					errorMessage="Could not copy SSH setup command"
					label={label}
					text={command}
				/>
			</div>
			<code className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
				{command}
			</code>
		</div>
	)
}
