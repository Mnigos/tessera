'use client'

import type { RepositoryReadme } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
					<ReactMarkdown
						components={markdownComponents}
						remarkPlugins={[remarkGfm]}
						skipHtml
					>
						{readme.content}
					</ReactMarkdown>
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

const markdownComponents = {
	a: ({ children, ...props }: ComponentProps<'a'>) => (
		<a
			{...props}
			className="font-medium text-primary underline-offset-4 hover:underline"
			rel="noreferrer"
			target="_blank"
		>
			{children}
		</a>
	),
	blockquote: ({ children, ...props }: ComponentProps<'blockquote'>) => (
		<blockquote
			{...props}
			className="border-border border-l-2 pl-4 text-muted-foreground"
		>
			{children}
		</blockquote>
	),
	code: ({ children, ...props }: ComponentProps<'code'>) => (
		<code
			{...props}
			className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm"
		>
			{children}
		</code>
	),
	h1: ({ children, ...props }: ComponentProps<'h1'>) => (
		<h1 {...props} className="mb-4 font-semibold text-2xl tracking-normal">
			{children}
		</h1>
	),
	h2: ({ children, ...props }: ComponentProps<'h2'>) => (
		<h2
			{...props}
			className="mt-6 mb-3 border-border border-b pb-2 font-semibold text-xl tracking-normal first:mt-0"
		>
			{children}
		</h2>
	),
	h3: ({ children, ...props }: ComponentProps<'h3'>) => (
		<h3 {...props} className="mt-5 mb-2 font-semibold text-lg tracking-normal">
			{children}
		</h3>
	),
	li: ({ children, ...props }: ComponentProps<'li'>) => (
		<li {...props} className="pl-1">
			{children}
		</li>
	),
	ol: ({ children, ...props }: ComponentProps<'ol'>) => (
		<ol {...props} className="my-3 list-decimal pl-6 text-sm leading-6">
			{children}
		</ol>
	),
	p: ({ children, ...props }: ComponentProps<'p'>) => (
		<p {...props} className="my-3 text-sm leading-6 first:mt-0 last:mb-0">
			{children}
		</p>
	),
	pre: ({ children, ...props }: ComponentProps<'pre'>) => (
		<pre
			{...props}
			className="my-4 overflow-x-auto rounded-md bg-muted p-3 text-sm"
		>
			{children}
		</pre>
	),
	table: ({ children, ...props }: ComponentProps<'table'>) => (
		<div className="my-4 overflow-x-auto">
			<table {...props} className="w-full border-collapse text-sm">
				{children}
			</table>
		</div>
	),
	td: ({ children, ...props }: ComponentProps<'td'>) => (
		<td {...props} className="border border-border px-3 py-2">
			{children}
		</td>
	),
	th: ({ children, ...props }: ComponentProps<'th'>) => (
		<th {...props} className="border border-border px-3 py-2 text-left">
			{children}
		</th>
	),
	ul: ({ children, ...props }: ComponentProps<'ul'>) => (
		<ul {...props} className="my-3 list-disc pl-6 text-sm leading-6">
			{children}
		</ul>
	),
}
