const READOUT_SERVICES = [
	['postgres', 'ready'],
	['git-service', 'ready · rust, grpc'],
	['api', 'ready'],
	['web', 'ready · http://localhost:3000'],
] as const

export function HomeOpenSource() {
	return (
		<section className="border-border/60 border-y bg-card/40">
			<div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-2 md:gap-16 md:py-16">
				<div>
					<span className="font-mono text-muted-foreground text-xs uppercase tracking-[0.12em]">
						Open source, by necessity
					</span>
					<h2 className="mt-4 max-w-md font-semibold text-2xl tracking-tight md:text-3xl">
						You should never have to trust a black box with your source code.
					</h2>
					<p className="mt-3.5 max-w-prose text-muted-foreground text-sm">
						Every line of detent is public: the web app, the API, and the Rust
						service that speaks Git on disk. Repositories are stored as bare Git
						repositories, no proprietary format in between. If you leave, you
						leave with everything.
					</p>
				</div>
				<div className="overflow-x-auto rounded-md border border-border bg-background p-5 font-mono text-muted-foreground text-sm leading-7">
					<p>
						$ git clone{' '}
						<span className="text-foreground">
							https://detent.dev/detent/core
						</span>
					</p>
					<p>$ docker compose up -d</p>
					{READOUT_SERVICES.map(([service, status]) => (
						<p key={service}>
							<span aria-hidden="true" className="text-primary">
								✓
							</span>{' '}
							<span className="text-foreground">{service}</span> {status}
						</p>
					))}
					<p className="mt-4">your instance. your disk. your keys.</p>
				</div>
			</div>
		</section>
	)
}
