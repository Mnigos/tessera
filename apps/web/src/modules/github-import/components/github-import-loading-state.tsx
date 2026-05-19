export function GitHubImportLoadingState() {
	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<div className="flex flex-col gap-2">
				<div className="h-20 animate-pulse rounded-md bg-secondary/70" />
				<div className="h-20 animate-pulse rounded-md bg-secondary/50" />
				<div className="h-20 animate-pulse rounded-md bg-secondary/40" />
			</div>
			<div className="h-44 animate-pulse rounded-md bg-secondary/50" />
		</div>
	)
}
