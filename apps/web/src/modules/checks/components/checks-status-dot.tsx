import type { ChecksSummary } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import {
	getCheckRollupDescription,
	getCheckRollupPresentation,
} from '../helpers/check-presentation'

interface ChecksStatusDotProps {
	summary?: ChecksSummary
}

/**
 * A commit row's check outcome. The shape carries the meaning and the label
 * carries it again for anyone who cannot see the shape; colour is only ever the
 * third telling.
 */
export function ChecksStatusDot({ summary }: Readonly<ChecksStatusDotProps>) {
	if (!summary || summary.overall === 'none') return null

	const presentation = getCheckRollupPresentation(summary.overall)
	const description = getCheckRollupDescription(summary)

	return (
		<span className="inline-flex shrink-0 items-center" title={description}>
			<presentation.icon
				aria-hidden
				className={cn('size-4', presentation.iconClassName)}
			/>
			<span className="sr-only">{description}</span>
		</span>
	)
}
