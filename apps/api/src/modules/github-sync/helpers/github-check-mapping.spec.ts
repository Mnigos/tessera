import { preserveCheckMappingProvenance } from './github-check-mapping'

describe('GitHub check mappings', () => {
	test('takes the whole report when nothing is on file yet', () => {
		expect(
			preserveCheckMappingProvenance(undefined, {
				appName: 'GitHub Actions',
				deliveryId: 'delivery-1',
			})
		).toEqual({ appName: 'GitHub Actions', deliveryId: 'delivery-1' })
	})

	test('keeps what the first sighting recorded when a requeue reports nothing', () => {
		expect(
			preserveCheckMappingProvenance(
				{
					appName: 'GitHub Actions',
					providerCreatedAt: new Date('2026-08-08T10:00:00Z'),
					deliveryId: 'delivery-1',
				},
				{ appName: null, providerCreatedAt: null, deliveryId: null }
			)
		).toEqual({
			appName: 'GitHub Actions',
			providerCreatedAt: new Date('2026-08-08T10:00:00Z'),
			deliveryId: 'delivery-1',
		})
	})

	test('never lets a later report rename the identity that reported first', () => {
		expect(
			preserveCheckMappingProvenance(
				{ appName: 'GitHub Actions', deliveryId: 'delivery-1' },
				{ appName: 'Renamed', deliveryId: 'delivery-2' }
			)
		).toEqual({ appName: 'GitHub Actions', deliveryId: 'delivery-1' })
	})

	test('fills a column the first sighting left empty', () => {
		expect(
			preserveCheckMappingProvenance(
				{ appName: null, deliveryId: 'delivery-1' },
				{ appName: 'GitHub Actions', deliveryId: null }
			)
		).toEqual({ appName: 'GitHub Actions', deliveryId: 'delivery-1' })
	})
})
