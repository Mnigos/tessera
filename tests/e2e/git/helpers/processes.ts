import type { Subprocess } from 'bun'
import { $, connect as bunConnect, sleep, spawn } from 'bun'

export interface GitE2EPorts {
	apiGrpc: number
	apiHttp: number
	gitGrpc: number
	gitHttp: number
}

export interface GitE2EProcesses {
	api: Subprocess<'ignore', 'pipe', 'pipe'>
	git: Subprocess<'ignore', 'pipe', 'pipe'>
}

interface StartGitE2EProcessesOptions {
	ports: GitE2EPorts
	storageRoot: string
}

const rootDirectory = new URL('../../../../', import.meta.url).pathname.replace(
	/\/$/,
	''
)
const apiDirectory = `${rootDirectory}/apps/api`
const bunBinary = process.env.BUN_INSTALL
	? `${process.env.BUN_INSTALL}/bin/bun`
	: 'bun'
const bunPath = process.env.BUN_INSTALL
	? `${process.env.BUN_INSTALL}/bin:${process.env.PATH ?? ''}`
	: (process.env.PATH ?? '')

export async function startGitE2EProcesses({
	ports,
	storageRoot,
}: StartGitE2EProcessesOptions): Promise<GitE2EProcesses> {
	const databaseUrl =
		process.env.DATABASE_URL ??
		'postgresql://test:test@localhost:5432/tessera_test'
	const sharedEnv = {
		...process.env,
		AUTH_SECRET: 'test-auth-secret',
		DATABASE_URL: databaseUrl,
		DB_POOL_MAX: '5',
		GITHUB_CLIENT_ID: 'test-github-client-id',
		GITHUB_CLIENT_SECRET: 'test-github-client-secret',
		INTERNAL_API_TOKEN: 'test-internal-token',
		PATH: bunPath,
		REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
		TESSERA_SKIP_ENV_FILE: 'true',
	}
	const api = spawn([bunBinary, 'src/main.ts'], {
		cwd: apiDirectory,
		env: {
			...sharedEnv,
			API_GRPC_URL: `localhost:${ports.apiGrpc}`,
			API_URL: `http://localhost:${ports.apiHttp}`,
			APP_URL: `http://localhost:${ports.apiHttp}`,
			GIT_SERVICE_URL: `localhost:${ports.gitGrpc}`,
			PORT: String(ports.apiHttp),
		},
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe',
	})
	const git = spawn(['cargo', 'run', '-p', 'tessera-git'], {
		cwd: rootDirectory,
		env: {
			...sharedEnv,
			GIT_API_GRPC_AUTHORIZATION_TOKEN: 'test-internal-token',
			GIT_API_GRPC_URL: `http://localhost:${ports.apiGrpc}`,
			GIT_HTTP_HOST: '127.0.0.1',
			GIT_HTTP_PORT: String(ports.gitHttp),
			GIT_SERVICE_HOST: '127.0.0.1',
			GIT_SERVICE_PORT: String(ports.gitGrpc),
			GIT_STORAGE_ROOT: storageRoot,
		},
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe',
	})
	const processes = { api, git }
	const apiOutput = captureProcessOutput(api, 'api')
	const gitOutput = captureProcessOutput(git, 'git')

	try {
		await Promise.race([
			Promise.all([
				waitForHttpOk(`http://localhost:${ports.apiHttp}/health/ping`),
				waitForTcpPort(ports.gitGrpc),
				waitForTcpPort(ports.gitHttp),
			]),
			rejectOnEarlyExit(api, 'api', apiOutput),
			rejectOnEarlyExit(git, 'git', gitOutput),
		])
	} catch (error) {
		await stopGitE2EProcesses(processes, undefined)
		throw error
	}

	return processes
}

export async function stopGitE2EProcesses(
	processes: GitE2EProcesses | undefined,
	storageRoot: string | undefined
) {
	if (processes) {
		processes.api.kill()
		processes.git.kill()
		await Promise.allSettled([processes.api.exited, processes.git.exited])
	}

	if (storageRoot) await $`rm -rf ${storageRoot}`.quiet()
}

function captureProcessOutput(
	process: Subprocess<'ignore', 'pipe', 'pipe'>,
	name: string
) {
	let output = ''
	void captureReadableStream(process.stdout, chunk => {
		output += `[${name}:stdout] ${chunk}`
	})
	void captureReadableStream(process.stderr, chunk => {
		output += `[${name}:stderr] ${chunk}`
	})

	return () => output.slice(-8000)
}

async function rejectOnEarlyExit(
	process: Subprocess<'ignore', 'pipe', 'pipe'>,
	name: string,
	getOutput: () => string
) {
	const exitCode = await process.exited

	throw new Error(
		`${name} exited before readiness checks completed: code=${exitCode}\n${getOutput()}`
	)
}

async function captureReadableStream(
	stream: ReadableStream<Uint8Array>,
	onChunk: (chunk: string) => void
) {
	const reader = stream.getReader()
	const decoder = new TextDecoder()

	while (true) {
		const result = await reader.read()
		if (result.done) break
		onChunk(decoder.decode(result.value, { stream: true }))
	}
}

async function waitForHttpOk(url: string) {
	const deadline = Date.now() + 60_000
	let lastError: unknown

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url)
			if (response.ok) return
		} catch (error) {
			lastError = error
		}
		await sleep(250)
	}

	throw new Error(`timed out waiting for ${url}: ${String(lastError)}`)
}

async function waitForTcpPort(port: number) {
	const deadline = Date.now() + 60_000
	let lastError: unknown

	while (Date.now() < deadline) {
		try {
			await connect(port)
			return
		} catch (error) {
			lastError = error
		}
		await sleep(250)
	}

	throw new Error(
		`timed out waiting for localhost:${port}: ${String(lastError)}`
	)
}

async function connect(port: number) {
	const socket = await bunConnect({
		hostname: '127.0.0.1',
		port,
		socket: {
			data() {
				return
			},
		},
	})
	socket.end()
}
