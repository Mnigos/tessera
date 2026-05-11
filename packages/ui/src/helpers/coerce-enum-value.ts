/**
 * Returns a fallback when the provided value is not one of the allowed enum values.
 */
export function coerceEnumValue<const TValue extends string>(
	value: string | null | undefined,
	allowedValues: readonly TValue[],
	fallbackValue: TValue
) {
	return allowedValues.includes(value as TValue)
		? (value as TValue)
		: fallbackValue
}
