import { GITHUB_SYNC_DELAYED_MESSAGE } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { cn } from '@repo/ui/utils'
import { Github } from 'lucide-react'
import { useState } from 'react'
import { reconnectGitHub } from '@/modules/auth/helpers/reconnect-github'
import {
	getPullRequestErrorMessage,
	isGitHubReconnectRequiredError,
} from '../helpers/get-pull-request-error-message'

interface PullRequestErrorMessageProps {
	error: unknown
	fallback: string
	/** Set where a field describes itself by this message. */
	id?: string
}

export function PullRequestErrorMessage({
	error,
	fallback,
	id,
}: Readonly<PullRequestErrorMessageProps>) {
	const [hasReconnectFailed, setHasReconnectFailed] = useState(false)
	const message = getPullRequestErrorMessage(error, fallback)
	// GitHub already took this write; only the local copy is late.
	const isDelivered = message === GITHUB_SYNC_DELAYED_MESSAGE

	async function handleReconnect() {
		setHasReconnectFailed(false)
		setHasReconnectFailed(Boolean(await reconnectGitHub()))
	}

	return (
		<div className="flex flex-col items-start gap-2">
			<p
				className={cn(
					'text-sm',
					isDelivered ? 'text-muted-foreground' : 'text-destructive'
				)}
				id={id}
				role={isDelivered ? 'status' : 'alert'}
			>
				{message}
			</p>
			{isGitHubReconnectRequiredError(error) && (
				<Button onClick={handleReconnect} size="sm" variant="outline">
					<Github className="size-4" />
					Reconnect GitHub
				</Button>
			)}
			{hasReconnectFailed && (
				<p className="text-destructive text-sm" role="alert">
					GitHub could not be reconnected. Try again.
				</p>
			)}
		</div>
	)
}
