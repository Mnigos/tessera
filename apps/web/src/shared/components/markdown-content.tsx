'use client'

import { cn } from '@repo/ui/utils'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownContentProps {
	children: string
	className?: string
}

export function MarkdownContent({
	children,
	className,
}: Readonly<MarkdownContentProps>) {
	return (
		<div className={cn('min-w-0', className)}>
			<ReactMarkdown
				components={markdownComponents}
				remarkPlugins={[remarkGfm]}
				skipHtml
			>
				{children}
			</ReactMarkdown>
		</div>
	)
}

const markdownComponents: Components = {
	a: ({ children, node: _node, ...props }) => (
		<a
			{...props}
			className="font-medium text-primary underline-offset-4 hover:underline"
			rel="noreferrer"
			target="_blank"
		>
			{children}
		</a>
	),
	blockquote: ({ children, node: _node, ...props }) => (
		<blockquote
			{...props}
			className="my-4 rounded-md border border-border bg-muted/30 px-4 py-3 text-muted-foreground"
		>
			{children}
		</blockquote>
	),
	code: ({ children, node: _node, ...props }) => (
		<code
			{...props}
			className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm"
		>
			{children}
		</code>
	),
	h1: ({ children, node: _node, ...props }) => (
		<h1 {...props} className="mb-4 font-semibold text-2xl tracking-normal">
			{children}
		</h1>
	),
	h2: ({ children, node: _node, ...props }) => (
		<h2
			{...props}
			className="mt-6 mb-3 border-border border-b pb-2 font-semibold text-xl tracking-normal first:mt-0"
		>
			{children}
		</h2>
	),
	h3: ({ children, node: _node, ...props }) => (
		<h3 {...props} className="mt-5 mb-2 font-semibold text-lg tracking-normal">
			{children}
		</h3>
	),
	li: ({ children, node: _node, ...props }) => (
		<li {...props} className="pl-1">
			{children}
		</li>
	),
	ol: ({ children, node: _node, ...props }) => (
		<ol {...props} className="my-3 list-decimal pl-6 text-sm leading-6">
			{children}
		</ol>
	),
	p: ({ children, node: _node, ...props }) => (
		<p {...props} className="my-3 text-sm leading-6 first:mt-0 last:mb-0">
			{children}
		</p>
	),
	pre: ({ children, node: _node, ...props }) => (
		<pre
			{...props}
			className="my-4 overflow-x-auto rounded-md bg-muted p-3 text-sm"
		>
			{children}
		</pre>
	),
	table: ({ children, node: _node, ...props }) => (
		<div className="my-4 overflow-x-auto">
			<table {...props} className="w-full border-collapse text-sm">
				{children}
			</table>
		</div>
	),
	td: ({ children, node: _node, ...props }) => (
		<td {...props} className="border border-border px-3 py-2">
			{children}
		</td>
	),
	th: ({ children, node: _node, ...props }) => (
		<th {...props} className="border border-border px-3 py-2 text-left">
			{children}
		</th>
	),
	ul: ({ children, node: _node, ...props }) => (
		<ul {...props} className="my-3 list-disc pl-6 text-sm leading-6">
			{children}
		</ul>
	),
}
