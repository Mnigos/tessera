import { listen } from 'bun'

export function getAvailablePort() {
	const server = listen({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			data() {
				return
			},
		},
	})
	const { port } = server
	server.stop(true)

	return port
}

export function getGitE2EPorts(): [number, number, number, number] {
	return [
		getAvailablePort(),
		getAvailablePort(),
		getAvailablePort(),
		getAvailablePort(),
	]
}
