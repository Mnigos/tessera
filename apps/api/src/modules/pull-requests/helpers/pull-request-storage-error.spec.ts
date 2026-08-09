import { status } from '@grpc/grpc-js'
import { ExternalServiceError } from '~/shared/errors'
import {
	PullRequestMergeConflictError,
	PullRequestMergeStrategyUnavailableError,
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

	// The reason travels in the status message because gRPC gives a failed
	// precondition nowhere else to put it, so both halves of that string are
	// checked here against the names git storage actually sends.
	test.each([
		'conflict',
		'not_fast_forward',
		'already_up_to_date',
		'nothing_to_rebase',
		'unsupported_history',
	] as const)('maps an unavailable %s strategy back to its reason', reason => {
		const error = toPullRequestStorageError(
			new ExternalServiceError('git storage', {
				grpcCode: status.FAILED_PRECONDITION,
				grpcDetails: `repository merge strategy is unavailable: ${reason}`,
			}),
			context,
			'fast_forward'
		)

		expect(error).toBeInstanceOf(PullRequestMergeStrategyUnavailableError)
		expect(error).toMatchObject({
			strategy: 'fast_forward',
			unavailableReason: reason,
		})
	})

	// Without a strategy there is nothing to attribute the refusal to, and the
	// only honest thing left is the operational error git storage sent.
	test('leaves an unavailable strategy unmapped when none was named', () => {
		const error = new ExternalServiceError('git storage', {
			grpcCode: status.FAILED_PRECONDITION,
			grpcDetails: 'repository merge strategy is unavailable: conflict',
		})

		expect(toPullRequestStorageError(error, context)).toBe(error)
	})

	test('refuses a reason this build does not know', () => {
		const error = new ExternalServiceError('git storage', {
			grpcCode: status.FAILED_PRECONDITION,
			grpcDetails: 'repository merge strategy is unavailable: teleported',
		})

		expect(toPullRequestStorageError(error, context, 'rebase')).toBe(error)
	})

	test('preserves unrelated failed preconditions as operational errors', () => {
		const error = new ExternalServiceError('git storage', {
			grpcCode: status.FAILED_PRECONDITION,
			grpcDetails: 'repository storage path does not match storage root',
		})

		expect(toPullRequestStorageError(error, context)).toBe(error)
	})
})
