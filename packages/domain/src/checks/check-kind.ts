export const checkKinds = ['status', 'check_run'] as const

export type CheckKind = (typeof checkKinds)[number]
