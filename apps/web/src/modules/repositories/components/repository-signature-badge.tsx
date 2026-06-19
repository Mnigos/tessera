import type { RepositorySignature } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { BadgeAlert, BadgeCheck, BadgeQuestionMark, BadgeX } from 'lucide-react'

interface RepositorySignatureBadgeProps {
	signature?: RepositorySignature
}

export function RepositorySignatureBadge({
	signature,
}: Readonly<RepositorySignatureBadgeProps>) {
	const display = getRepositorySignatureDisplay(signature)
	const Icon = display.icon

	return (
		<span
			className={cn(
				'inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 font-medium text-[11px] leading-none',
				display.className
			)}
			data-signature-state={signature?.state ?? 'unsigned'}
			title={display.title}
		>
			<Icon aria-hidden="true" className="size-3" />
			<span>{display.label}</span>
		</span>
	)
}

interface RepositorySignatureDisplay {
	label: string
	title: string
	icon: typeof BadgeCheck
	className: string
}

function getRepositorySignatureDisplay(
	signature?: RepositorySignature
): RepositorySignatureDisplay {
	if (!signature || signature.state === 'unsigned')
		return {
			label: 'Unsigned',
			title: 'Unsigned commit or tag',
			icon: BadgeQuestionMark,
			className: 'border-border bg-muted/60 text-muted-foreground',
		}

	if (signature.state === 'valid' || signature.state === 'trusted')
		return {
			label: 'Verified',
			title: getSignatureTitle('Verified signature', signature),
			icon: BadgeCheck,
			className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
		}

	if (signature.state === 'bad')
		return {
			label: 'Bad',
			title: getSignatureTitle('Bad signature', signature),
			icon: BadgeX,
			className: 'border-destructive/30 bg-destructive/10 text-destructive',
		}

	if (signature.state === 'unknown')
		return {
			label: 'Unknown',
			title: getSignatureTitle('Unknown signer', signature),
			icon: BadgeQuestionMark,
			className: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
		}

	if (signature.state === 'expired')
		return {
			label: 'Expired',
			title: getSignatureTitle('Expired signature or signing key', signature),
			icon: BadgeAlert,
			className: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
		}

	if (signature.state === 'revoked')
		return {
			label: 'Revoked',
			title: getSignatureTitle('Revoked signing key', signature),
			icon: BadgeX,
			className: 'border-destructive/30 bg-destructive/10 text-destructive',
		}

	return {
		label: 'Unverified',
		title: getSignatureTitle('Signed but unverified signature', signature),
		icon: BadgeAlert,
		className: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
	}
}

function getSignatureTitle(prefix: string, signature: RepositorySignature) {
	const signer = signature.signer ?? signature.keyId ?? signature.fingerprint

	if (!signer) return prefix

	return `${prefix}: ${signer}`
}
