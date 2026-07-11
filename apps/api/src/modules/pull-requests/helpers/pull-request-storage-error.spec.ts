import { status } from '@grpc/grpc-js'
import { ExternalServiceError } from '~/shared/errors'
import {
	PullRequestMergeConflictError,
	PullRequestStaleComparisonError,
} from '../domain/pull-request.errors'
import { toPullRequestStorageError } from './pull-request-storage-error'

const context = { repositoryId: 'repository-id', number: 1 }

describe(toPullRequestStorageError.name, () => {
	test('maps aborted comparisons to stale state conflicts', () => {
		expect(
			toPullRequestStorageError(
				new ExternalServiceError('git storage', {
					grpcCode: status.ABORTED,
				}),
				context
			)
		).toBeInstanceOf(PullRequestStaleComparisonError)
	})

	test('maps failed preconditions to merge conflicts', () => {
		expect(
			toPullRequestStorageError(
				new ExternalServiceError('git storage', {
					grpcCode: status.FAILED_PRECONDITION,
					grpcDetails: 'repository refs cannot be merged cleanly',
				}),
				context
			)
		).toBeInstanceOf(PullRequestMergeConflictError)
	})

	test('preserves unrelated failed preconditions as operational errors', () => {
		const error = new ExternalServiceError('git storage', {
			grpcCode: status.FAILED_PRECONDITION,
			grpcDetails: 'repository storage path does not match storage root',
		})

		expect(toPullRequestStorageError(error, context)).toBe(error)
	})
})
