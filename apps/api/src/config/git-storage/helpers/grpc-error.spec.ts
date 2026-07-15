import { getGrpcCode, getGrpcDetails } from './grpc-error'

describe('gRPC error helpers', () => {
	test('reads supported gRPC error properties', () => {
		expect(getGrpcCode({ code: 10 })).toBe(10)
		expect(getGrpcDetails({ details: 'repository refs changed' })).toBe(
			'repository refs changed'
		)
	})

	test('ignores missing and unsupported gRPC error properties', () => {
		expect(getGrpcCode(undefined)).toBeUndefined()
		expect(getGrpcCode({ code: '10' })).toBeUndefined()
		expect(getGrpcDetails(null)).toBeUndefined()
		expect(getGrpcDetails({ details: 10 })).toBeUndefined()
	})
})
