import type { ComponentProps } from 'react'
import { Toaster } from 'sonner'

export function Sonner(props: Readonly<ComponentProps<typeof Toaster>>) {
	return (
		<Toaster
			className="toaster group"
			theme="dark"
			toastOptions={{
				classNames: {
					toast:
						'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
					description: 'group-[.toast]:text-muted-foreground',
					actionButton:
						'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
					cancelButton:
						'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
				},
			}}
			{...props}
		/>
	)
}

// biome-ignore lint/performance/noBarrelFile: Re-export for convenience
export { toast } from 'sonner'
