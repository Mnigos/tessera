import type { Repository } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@repo/ui/components/popover'
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '@repo/ui/components/tabs'
import { ChevronDown } from 'lucide-react'
import { CopyButton } from '@/shared/components/copy-button'
import { getCloneProtocolLabel } from '../helpers/get-clone-protocol-label'

interface RepositoryClonePopoverProps {
	repository: Repository
}

export function RepositoryClonePopover({
	repository: { cloneUrls },
}: Readonly<RepositoryClonePopoverProps>) {
	const httpProtocolLabel = getCloneProtocolLabel(cloneUrls.https)

	return (
		<Popover>
			<PopoverTrigger render={<Button size="sm" variant="outline" />}>
				Code
				<ChevronDown />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-3">
				<Tabs className="gap-2" defaultValue="ssh">
					<TabsList aria-label="Clone protocol">
						<TabsTrigger value="ssh">SSH</TabsTrigger>
						<TabsTrigger value="http">{httpProtocolLabel}</TabsTrigger>
					</TabsList>
					<TabsContent value="ssh">
						<CloneUrlField label="SSH" url={cloneUrls.ssh} />
					</TabsContent>
					<TabsContent value="http">
						<CloneUrlField label={httpProtocolLabel} url={cloneUrls.https} />
					</TabsContent>
				</Tabs>
				{cloneUrls.authority === 'github' && (
					<p className="pt-2 text-muted-foreground text-xs">
						GitHub is the source of truth for this repository, so clones and
						pushes go to GitHub.
					</p>
				)}
			</PopoverContent>
		</Popover>
	)
}

interface CloneUrlFieldProps {
	label: string
	url: string
}

function CloneUrlField({ label, url }: Readonly<CloneUrlFieldProps>) {
	return (
		<div className="flex items-center gap-2">
			<code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-input bg-muted px-3 py-2 text-sm">
				{url}
			</code>
			<CopyButton
				copiedLabel={`${label} clone URL copied`}
				errorMessage="Could not copy clone URL"
				label={`Copy ${label} clone URL`}
				text={url}
			/>
		</div>
	)
}
