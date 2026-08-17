import { NotFoundError } from '~/shared/errors'

export class HandleNotFoundError extends NotFoundError {
	constructor(handle: string) {
		super('handle', { handle }, 'Handle not found')
	}
}
