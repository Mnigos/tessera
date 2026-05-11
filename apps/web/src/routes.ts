import { index, rootRoute, route } from '@tanstack/virtual-file-routes'

export const routes = rootRoute('routes/__root.tsx', [
	index('modules/home/routes/index.route.tsx'),
	route('/api/auth/$', 'modules/auth/routes/api.auth.$.route.ts'),
	route('/profile', 'modules/profile/routes/profile.route.tsx'),
])
