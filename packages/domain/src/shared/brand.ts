import type { z } from 'zod'

export type Brand<TValue, TBrand extends string> = TValue & z.$brand<TBrand>

export function brand<TValue, TBrand extends string>(value: TValue) {
	return value as Brand<TValue, TBrand>
}
