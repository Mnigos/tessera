'use client'

import { Button } from '@repo/ui/components/button'
import { toast } from '@repo/ui/components/sonner'
import { Check, Copy } from 'lucide-react'
import { useRef, useState } from 'react'
import { useMountEffect } from '@/shared/hooks/use-mount-effect'

const COPY_FEEDBACK_DURATION_MS = 2000

interface CopyButtonProps {
	copiedLabel: string
	errorMessage: string
	label: string
	text: string
}

export function CopyButton({
	copiedLabel,
	errorMessage,
	label,
	text,
}: Readonly<CopyButtonProps>) {
	const [isCopied, setIsCopied] = useState(false)
	const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined
	)

	useMountEffect(() => () => {
		if (copyFeedbackTimeout.current) clearTimeout(copyFeedbackTimeout.current)
	})

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(text)
			if (copyFeedbackTimeout.current) clearTimeout(copyFeedbackTimeout.current)

			setIsCopied(true)
			copyFeedbackTimeout.current = setTimeout(
				() => setIsCopied(false),
				COPY_FEEDBACK_DURATION_MS
			)
		} catch (error) {
			setIsCopied(false)
			console.error(error)
			toast.error(errorMessage)
		}
	}

	return (
		<>
			<Button
				aria-label={isCopied ? copiedLabel : label}
				className="sm:w-fit"
				onClick={handleCopy}
				type="button"
				variant="outline"
			>
				{isCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
				{isCopied ? 'Copied' : 'Copy'}
			</Button>
			<output aria-live="polite" className="sr-only">
				{isCopied ? copiedLabel : ''}
			</output>
		</>
	)
}
