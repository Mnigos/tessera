import { cn } from '@repo/ui/utils'
import {
	type ComponentProps,
	type ComponentType,
	createContext,
	type ReactNode,
	use,
	useId,
	useMemo,
} from 'react'
import * as RechartsPrimitive from 'recharts'
import type { LegendPayload } from 'recharts/types/component/DefaultLegendContent'
import type {
	Formatter,
	NameType,
	Payload,
	ValueType,
} from 'recharts/types/component/DefaultTooltipContent'

// Documentation: https://ui.shadcn.com/docs/components/chart
// Examples: https://ui.shadcn.com/charts

const THEMES = { dark: '' } as const

export type ChartConfig = Readonly<{
	[k in string]: {
		label?: ReactNode
		icon?: ComponentType
	} & (
		| { color?: string; theme?: never }
		| { color?: never; theme: Record<keyof typeof THEMES, string> }
	)
}>

interface ChartContextProps {
	config: ChartConfig
}

const ChartContext = createContext<ChartContextProps | null>(null)

function useChart() {
	const context = use(ChartContext)

	if (!context) {
		throw new Error('useChart must be used within a <ChartContainer />')
	}

	return context
}

interface ChartContainerProps extends ComponentProps<'div'> {
	config: ChartConfig
	children: ComponentProps<
		typeof RechartsPrimitive.ResponsiveContainer
	>['children']
	height?: ComponentProps<
		typeof RechartsPrimitive.ResponsiveContainer
	>['height']
	width?: ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['width']
	minHeight?: ComponentProps<
		typeof RechartsPrimitive.ResponsiveContainer
	>['minHeight']
	minWidth?: ComponentProps<
		typeof RechartsPrimitive.ResponsiveContainer
	>['minWidth']
}

export function ChartContainer({
	id,
	className,
	children,
	config,
	height = '100%',
	width = '100%',
	minHeight,
	minWidth = 0,
	...props
}: Readonly<ChartContainerProps>) {
	const uniqueId = useId()
	const chartId = `chart-${id ?? uniqueId.replaceAll(':', '')}`
	const initialDimensionHeight =
		typeof minHeight === 'number' && Number.isFinite(minHeight) ? minHeight : 0

	return (
		<ChartContext.Provider value={{ config }}>
			<div
				className={cn(
					"flex aspect-video w-full min-w-0 justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-foreground/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-foreground [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-foreground [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted/50 [&_.recharts-reference-line_[stroke='#ccc']]:stroke-foreground [&_.recharts-sector[stroke='#fff']]:stroke-foreground [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
					className
				)}
				data-chart={chartId}
				data-slot="chart"
				{...props}
			>
				<ChartStyle config={config} id={chartId} />
				<RechartsPrimitive.ResponsiveContainer
					height={height}
					initialDimension={{ height: initialDimensionHeight, width: 0 }}
					minHeight={minHeight}
					minWidth={minWidth}
					width={width}
				>
					{children}
				</RechartsPrimitive.ResponsiveContainer>
			</div>
		</ChartContext.Provider>
	)
}

interface ChartStyleProps {
	id: string
	config: ChartConfig
}

type ColorConfigEntry = [string, ChartConfig[string]]

function buildColorVariables(
	colorConfig: ColorConfigEntry[],
	theme: string
): string {
	return colorConfig
		.map(([key, itemConfig]) => {
			const color =
				itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ??
				itemConfig.color

			return color ? `  --color-${key}: ${color};` : null
		})
		.filter(Boolean)
		.join('\n')
}

function buildChartStyles(id: string, colorConfig: ColorConfigEntry[]): string {
	return Object.entries(THEMES)
		.map(
			([theme]) =>
				`[data-chart=${id}] {\n${buildColorVariables(colorConfig, theme)}\n}`
		)
		.join('\n')
}

export function ChartStyle({ id, config }: Readonly<ChartStyleProps>) {
	const colorConfig = Object.entries(config).filter(
		([, config]) => config.theme ?? config.color
	)

	if (colorConfig.length === 0) {
		return null
	}

	return (
		<style
			dangerouslySetInnerHTML={{ __html: buildChartStyles(id, colorConfig) }}
		/>
	)
}

export const ChartTooltip = RechartsPrimitive.Tooltip

interface ChartTooltipContentProps
	extends Pick<ComponentProps<'div'>, 'className'> {
	active?: boolean
	payload?: readonly Payload<ValueType, NameType>[]
	label?: ReactNode
	labelFormatter?: (
		label: ReactNode,
		payload: readonly Payload<ValueType, NameType>[]
	) => ReactNode
	labelClassName?: string
	formatter?: Formatter<ValueType, NameType>
	hideLabel?: boolean
	hideIndicator?: boolean
	indicator?: 'line' | 'dot' | 'dashed'
	nameKey?: string
	labelKey?: string
	color?: string
}

export function ChartTooltipContent({
	active,
	payload,
	className,
	indicator = 'dot',
	hideLabel = false,
	hideIndicator = false,
	label,
	labelFormatter,
	labelClassName,
	formatter,
	color,
	nameKey,
	labelKey,
}: Readonly<ChartTooltipContentProps>) {
	const { config } = useChart()

	const tooltipLabel = useMemo(() => {
		if (hideLabel || !payload?.length) {
			return null
		}

		const [item] = payload
		const key = `${labelKey ?? item?.dataKey ?? item?.name ?? 'value'}`
		const itemConfig = getPayloadConfigFromPayload(config, item, key)
		const value =
			!labelKey && typeof label === 'string'
				? (config[label]?.label ?? label)
				: itemConfig?.label

		if (labelFormatter) {
			return (
				<div className={cn('font-medium', labelClassName)}>
					{labelFormatter(value, payload)}
				</div>
			)
		}

		if (!value) {
			return null
		}

		return <div className={cn('font-medium', labelClassName)}>{value}</div>
	}, [
		label,
		labelFormatter,
		payload,
		hideLabel,
		labelClassName,
		config,
		labelKey,
	])

	if (!(active && payload?.length)) {
		return null
	}

	const nestLabel = payload.length === 1 && indicator !== 'dot'

	return (
		<div
			className={cn(
				'grid min-w-32 items-start gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-xl',
				className
			)}
		>
			{nestLabel ? null : tooltipLabel}
			<div className="grid gap-1.5">
				{payload.map((item: Payload<ValueType, NameType>, index: number) => {
					const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`
					const itemConfig = getPayloadConfigFromPayload(config, item, key)
					const indicatorColors = resolveIndicatorColor(
						color ?? item.payload?.fill ?? item.color,
						itemConfig?.color
					)
					const isDashed = indicator === 'dashed'

					return (
						<div
							className={cn(
								'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground',
								indicator === 'dot' && 'items-center'
							)}
							key={item.dataKey?.toString()}
						>
							{itemConfig?.icon ? (
								<itemConfig.icon />
							) : (
								!hideIndicator && (
									<div
										className={cn('shrink-0 rounded-xs', {
											'h-2.5 w-2.5': indicator === 'dot',
											'w-1': indicator === 'line',
											'w-0 border-2 border-dashed bg-transparent':
												indicator === 'dashed',
											'my-0.5': nestLabel && indicator === 'dashed',
										})}
										style={{
											background: isDashed
												? 'transparent'
												: indicatorColors.background,
											borderColor: indicatorColors.borderColor,
										}}
									/>
								)
							)}
							<div
								className={cn(
									'flex flex-1 justify-between gap-2 leading-none',
									nestLabel ? 'items-end' : 'items-center'
								)}
							>
								<div className="grid gap-1.5">
									{nestLabel ? tooltipLabel : null}
									<span className="text-muted-foreground">
										{itemConfig?.label ?? item.name}
									</span>
								</div>

								{item.value && (
									<span className="font-medium font-mono tabular-nums">
										{item.name && formatter
											? formatter(item.value, item.name, item, index, payload)
											: item.value.toLocaleString()}
									</span>
								)}
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}

export const ChartLegend = RechartsPrimitive.Legend

interface ChartLegendContentProps
	extends ComponentProps<'div'>,
		Pick<RechartsPrimitive.LegendProps, 'verticalAlign'> {
	payload?: LegendPayload[]
	hideIcon?: boolean
	nameKey?: string
}

export function ChartLegendContent({
	className,
	hideIcon = false,
	payload,
	verticalAlign = 'bottom',
	nameKey,
}: Readonly<ChartLegendContentProps>) {
	const { config } = useChart()

	if (!payload?.length) {
		return null
	}

	return (
		<div
			className={cn(
				'absolute flex flex-wrap items-center justify-center gap-3 sm:relative md:gap-6',
				verticalAlign === 'top' ? 'pb-3' : 'mt-3',
				className
			)}
		>
			{payload.map((item: LegendPayload) => {
				const key = nameKey ?? item.dataKey?.toString() ?? 'value'
				const itemConfig = getPayloadConfigFromPayload(config, item, key)

				return (
					<div
						className={cn(
							'flex flex-wrap items-center justify-center gap-2 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground'
						)}
						key={item.value}
					>
						{itemConfig?.icon && !hideIcon ? (
							<itemConfig.icon />
						) : (
							<div
								className="h-3 w-3 shrink-0 rounded-xs"
								style={{
									background: item.color?.startsWith('url(')
										? itemConfig?.color
										: item.color,
								}}
							/>
						)}
						<span className="whitespace-nowrap text-sm">
							{itemConfig?.label}
						</span>
					</div>
				)
			})}
		</div>
	)
}

function resolveIndicatorColor(
	rawColor: string | undefined,
	configColor: string | undefined
) {
	const resolved = rawColor?.startsWith('url(')
		? (configColor ?? rawColor)
		: rawColor

	return {
		borderColor: resolved,
		background: resolved?.startsWith('url(')
			? (configColor ?? resolved)
			: resolved,
	}
}

function getPayloadConfigFromPayload(
	config: ChartConfig,
	payload: unknown,
	key: string
) {
	if (typeof payload !== 'object' || payload === null) {
		return undefined
	}

	const payloadPayload =
		'payload' in payload &&
		typeof payload.payload === 'object' &&
		payload.payload !== null
			? payload.payload
			: undefined

	let configLabelKey: string = key

	if (
		key in payload &&
		typeof payload[key as keyof typeof payload] === 'string'
	) {
		configLabelKey = payload[key as keyof typeof payload] as string
	} else if (
		payloadPayload &&
		key in payloadPayload &&
		typeof payloadPayload[key as keyof typeof payloadPayload] === 'string'
	) {
		configLabelKey = payloadPayload[
			key as keyof typeof payloadPayload
		] as string
	}

	return configLabelKey in config ? config[configLabelKey] : config[key]
}
