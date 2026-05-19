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
		'/$username/$slug',
		'modules/repositories/routes/repository.$username.$slug.route.tsx'
	),
	route(
		'/$username/$slug/tree/$ref/$',
		'modules/repositories/routes/repository.$username.$slug.tree.$ref.$.route.tsx'
	),
	route(
		'/$username/$slug/blob/$ref/$',
		'modules/repositories/routes/repository.$username.$slug.blob.$ref.$.route.tsx'
	),
	route(
		'/$username/$slug/commits/$ref',
		'modules/repositories/routes/repository.$username.$slug.commits.$ref.route.tsx'
	),
])
