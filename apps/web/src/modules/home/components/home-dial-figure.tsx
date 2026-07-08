export function HomeDialFigure() {
	return (
		<figure className="flex justify-center">
			<svg
				aria-hidden="true"
				className="h-auto w-full max-w-36 sm:max-w-52 md:max-w-80"
				fill="none"
				viewBox="0 0 320 320"
			>
				<circle
					className="stroke-border"
					cx="160"
					cy="160"
					r="140"
					strokeWidth="1"
				/>
				<circle
					className="stroke-border/60"
					cx="160"
					cy="160"
					r="118"
					strokeWidth="1"
				/>
				<g className="stroke-muted-foreground" strokeWidth="1.5">
					<path d="M160 22v16M298 160h-16M160 298v-16M22 160h16" />
					<path d="M257.6 62.4l-11.3 11.3M257.6 257.6l-11.3-11.3M62.4 257.6l11.3-11.3M62.4 62.4l11.3 11.3" />
				</g>
				<g className="stroke-border" strokeWidth="1">
					<path d="M212.7 34.9l-6.1 14.6M285.1 107.3l-14.6 6.1M285.1 212.7l-14.6-6.1M212.7 285.1l-6.1-14.6M107.3 285.1l6.1-14.6M34.9 212.7l14.6-6.1M34.9 107.3l14.6 6.1M107.3 34.9l6.1 14.6" />
				</g>
				<path className="stroke-primary" d="M160 42v42" strokeWidth="3" />
				<circle className="fill-card stroke-border" cx="160" cy="160" r="64" />
				<circle className="fill-primary" cx="160" cy="160" r="8" />
				<path
					className="stroke-primary"
					d="M160 160v-56"
					strokeLinecap="round"
					strokeWidth="3"
				/>
				<text
					className="fill-muted-foreground font-mono text-[11px] uppercase tracking-[0.18em]"
					textAnchor="middle"
					x="160"
					y="232"
				>
					main · protected
				</text>
			</svg>
		</figure>
	)
}
