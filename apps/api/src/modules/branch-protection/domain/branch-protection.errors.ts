import { ConflictError, InternalError, NotFoundError } from '~/shared/errors'

export class BranchProtectionRuleNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('branch protection rule', context)
	}
}

export class BranchProtectionRuleAlreadyExistsError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'branch protection rule',
			context,
			'This branch already has a protection rule.'
		)
	}
}

export class BranchProtectionRuleVersionConflictError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'branch protection rule',
			context,
			'This rule changed since it was loaded. Refresh the settings and try again.'
		)
	}
}

export class BranchProtectionRuleCreateFailedError extends InternalError {
	constructor(context?: Record<string, unknown>) {
		super('branch protection rule create', context)
	}
}
