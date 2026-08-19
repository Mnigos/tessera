import { index, rootRoute, route } from '@tanstack/virtual-file-routes'

export const routes = rootRoute('routes/__root.tsx', [
	index('modules/home/routes/index.route.tsx'),
	route('/api/auth/$', 'modules/auth/routes/api.auth.$.route.ts'),
	route('/import', 'modules/github-import/routes/import.route.tsx', [
		route('/github', 'modules/github-import/routes/import.github.route.tsx'),
	]),
	route('/profile', 'modules/profile/routes/profile.route.tsx', [
		route('/$username', 'modules/profile/routes/profile.$username.route.tsx'),
	]),
	route(
		'/organizations/new',
		'modules/organizations/routes/organizations.new.route.tsx'
	),
	route(
		'/organizations/$slug/settings',
		'modules/organizations/routes/organizations.$slug.settings.route.tsx'
	),
	// Every repository page hangs off one shell, so the title row and the tabs are
	// loaded once and never remount between them.
	route(
		'/$username/$slug',
		'modules/repositories/routes/repository.$username.$slug.route.tsx',
		[
			index(
				'modules/repositories/routes/repository.$username.$slug.index.route.tsx'
			),
			route(
				'/tree/$ref/$',
				'modules/repositories/routes/repository.$username.$slug.tree.$ref.$.route.tsx'
			),
			route(
				'/blob/$ref/$',
				'modules/repositories/routes/repository.$username.$slug.blob.$ref.$.route.tsx'
			),
			route(
				'/commits/$ref',
				'modules/repositories/routes/repository.$username.$slug.commits.$ref.route.tsx'
			),
			route(
				'/pulls',
				'modules/pull-requests/routes/repository.$username.$slug.pulls.route.tsx'
			),
			route(
				'/pulls/new',
				'modules/pull-requests/routes/repository.$username.$slug.pulls.new.route.tsx'
			),
			route(
				'/pulls/$number',
				'modules/pull-requests/routes/repository.$username.$slug.pulls.$number.route.tsx',
				[
					index(
						'modules/pull-requests/routes/repository.$username.$slug.pulls.$number.index.route.tsx'
					),
					route(
						'/commits',
						'modules/pull-requests/routes/repository.$username.$slug.pulls.$number.commits.route.tsx'
					),
					route(
						'/files',
						'modules/pull-requests/routes/repository.$username.$slug.pulls.$number.files.route.tsx'
					),
				]
			),
			route(
				'/settings/collaborators',
				'modules/repository-collaborators/routes/repository.$username.$slug.settings.collaborators.route.tsx'
			),
			route(
				'/settings/branch-protection',
				'modules/branch-protection/routes/repository.$username.$slug.settings.branch-protection.route.tsx'
			),
			route(
				'/settings/status-providers',
				'modules/check-statuses/routes/repository.$username.$slug.settings.status-providers.route.tsx'
			),
			route(
				'/settings/github',
				'modules/repositories/routes/repository.$username.$slug.settings.github.route.tsx'
			),
		]
	),
])
