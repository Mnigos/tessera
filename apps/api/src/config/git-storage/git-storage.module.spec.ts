import {
	GIT_GRPC_LOADER_OPTIONS,
	GIT_STORAGE_MAX_RECEIVE_MESSAGE_BYTES,
	GIT_STORAGE_RAW_BLOB_MAX_BYTES,
} from './git-storage.module'

describe('Git storage gRPC configuration', () => {
	test('keeps receive message capacity above the raw blob content limit', () => {
		expect(GIT_STORAGE_MAX_RECEIVE_MESSAGE_BYTES).toBeGreaterThan(
			GIT_STORAGE_RAW_BLOB_MAX_BYTES
		)
	})

	test('loads uint64 values as numbers to match generated gRPC types', () => {
		expect(GIT_GRPC_LOADER_OPTIONS.longs).toBe(Number)
	})
})
