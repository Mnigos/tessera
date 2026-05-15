import { listen } from 'bun'

interface PortReservation {
	port: number
	stop(closeActiveConnections?: boolean): void
}

export interface GitE2EPortReservations {
	ports: [number, number, number, number]
	release(): void
}

export function getGitE2EPortReservations(): GitE2EPortReservations {
	const reservations = [
		reserveAvailablePort(),
		reserveAvailablePort(),
		reserveAvailablePort(),
		reserveAvailablePort(),
	]

	return {
		ports: reservations.map(({ port }) => port) as [
			number,
			number,
			number,
			number,
		],
		release() {
			for (const reservation of reservations) reservation.stop(true)
		},
	}
}

function reserveAvailablePort(): PortReservation {
	return listen({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			data() {
				return
			},
		},
	}) as PortReservation
}
