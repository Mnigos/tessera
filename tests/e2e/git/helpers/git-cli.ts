import { $, env, spawn, write } from 'bun'

interface CommandResult {
	exitCode: number
	stderr: string
	stdout: string
}

export async function createCommittedRepository(
	directory: string,
	filename: string,
	content: string
) {
	await $`mkdir -p ${directory}`.quiet()
	await runGit(['init', '--initial-branch=main'], directory)
	await runGit(['config', 'user.email', 'e2e@example.com'], directory)
	await runGit(['config', 'user.name', 'Tessera E2E'], directory)
	await write(`${directory}/${filename}`, content)
	await runGit(['add', filename], directory)
	await runGit(['commit', '-m', `Add ${filename}`], directory)
}

export async function pushRepository(directory: string, remoteUrl: string) {
	await runGit(['remote', 'add', 'origin', remoteUrl], directory)
	return await runGit(['push', '-u', 'origin', 'main'], directory, {
		expectSuccess: false,
	})
}

export async function cloneRepository(remoteUrl: string, directory: string) {
	return await runGit(['clone', remoteUrl, directory], repoRootDirectory, {
		expectSuccess: false,
	})
}

export async function fetchRepository(directory: string) {
	return await runGit(['fetch', 'origin'], directory, {
		expectSuccess: false,
	})
}

export async function lsRemote(remoteUrl: string) {
	return await runGit(['ls-remote', remoteUrl], repoRootDirectory, {
		expectSuccess: false,
	})
}

export function smartHttpUrl(
	gitHttpPort: number,
	username: string,
	slug: string,
	token?: string
) {
	const credentials = token
		? `${encodeURIComponent(username)}:${encodeURIComponent(token)}@`
		: ''

	return `http://${credentials}localhost:${gitHttpPort}/${username}/${slug}.git`
}

const repoRootDirectory = new URL(
	'../../../../',
	import.meta.url
).pathname.replace(/\/$/, '')

async function runGit(
	args: string[],
	cwd: string,
	options: { expectSuccess?: boolean } = {}
): Promise<CommandResult> {
	const process = spawn(['git', ...args], {
		cwd,
		env: {
			...env,
			GIT_TERMINAL_PROMPT: '0',
		},
		stderr: 'pipe',
		stdout: 'pipe',
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	])
	const result = { exitCode, stderr, stdout }

	if (options.expectSuccess !== false && exitCode !== 0)
		throw new Error(
			`git ${args.join(' ')} failed with ${exitCode}\n${stderr}\n${stdout}`
		)

	return result
}
