'use client'

import type { RepositoryReadme } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { MarkdownContent } from '@/shared/components/markdown-content'

interface RepositoryReadmePreviewProps {
	readme: RepositoryReadme
}

export function RepositoryReadmePreview({
	readme,
}: Readonly<RepositoryReadmePreviewProps>) {
	const [isOpen, setIsOpen] = useState(true)
	const ToggleIcon = isOpen ? ChevronUp : ChevronDown

	return (
		<Card className="gap-0 overflow-hidden p-0">
			<div className="flex items-center justify-between gap-3 border-border border-b px-4 py-3">
				<h2 className="font-medium text-sm">{readme.filename}</h2>
				<Button
					aria-label={isOpen ? 'Collapse README' : 'Expand README'}
					onClick={() => setIsOpen(currentIsOpen => !currentIsOpen)}
					size="icon"
					type="button"
					variant="ghost"
				>
					<ToggleIcon className="size-4" />
				</Button>
			</div>
			{isOpen && (
				<div className="overflow-hidden px-4 py-5">
					<MarkdownContent>{readme.content}</MarkdownContent>
					{readme.isTruncated && (
						<p className="mt-5 border-border border-t pt-4 text-muted-foreground text-sm">
							README preview is truncated.
						</p>
					)}
				</div>
			)}
		</Card>
	)
}
