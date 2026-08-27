import { Button } from '@repo/ui/components/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PullRequestsPaginationProps {
	/** The page being shown, absent on the first one. */
	cursor?: string
	nextCursor?: string
	/**
	 * True while the rows on screen still belong to the previous request, whose
	 * `nextCursor` would page from the wrong position.
	 */
	busy?: boolean
	onPageChange: (cursor: string | undefined) => void
}

/**
 * Only the two directions the browser cannot supply are drawn. Back already
 * walks to the previous page, so no cursor stack is kept to duplicate it, and
 * both buttons stay mounted — disabled at the ends — so paging never reflows
 * the footer.
 */
export function PullRequestsPagination({
	cursor,
	nextCursor,
	busy,
	onPageChange,
}: Readonly<PullRequestsPaginationProps>) {
	if (!(cursor || nextCursor)) return null

	return (
		<nav
			aria-label="Pull request pages"
			className="flex items-center justify-between gap-3"
		>
			<Button
				disabled={!cursor}
				onClick={() => onPageChange(undefined)}
				size="sm"
				type="button"
				variant="outline"
			>
				<ChevronLeft aria-hidden />
				First page
			</Button>
			<Button
				disabled={!nextCursor || busy}
				onClick={() => onPageChange(nextCursor)}
				size="sm"
				type="button"
				variant="outline"
			>
				Next page
				<ChevronRight aria-hidden />
			</Button>
		</nav>
	)
}
