import { $, build } from 'bun'

await $`rm -rf dist`

const result = await build({
	entrypoints: ['./src/main.ts'],
	outdir: './dist',
	target: 'bun',
	packages: 'external',
	sourcemap: 'external',
	minify: { syntax: true, whitespace: true },
	splitting: true,
})

if (!result.success) {
	console.log(result.logs[0])
	process.exit(1)
}

console.log('Built successfully!')
