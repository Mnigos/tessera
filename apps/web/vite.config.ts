import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { env } from './src/env'
import { routes } from './src/routes'

const apiUrl = env.API_URL

const config = defineConfig({
	plugins: [
		tailwindcss(),
		tanstackStart({
			router: {
				routesDirectory: '.',
				virtualRouteConfig: routes,
			},
		}),
		nitro({
			preset: 'bun',
			compatibilityDate: '2025-12-13',
			compressPublicAssets: true,
			routeRules: {
				'/auth/session': {
					proxy: `${apiUrl}/auth/session`,
				},
				'/auth/**': {
					proxy: `${apiUrl}/auth/**`,
				},
				'/health/ping': {
					proxy: `${apiUrl}/health/ping`,
				},
				'/health/**': {
					proxy: `${apiUrl}/health/**`,
				},
				'/organizations': {
					proxy: `${apiUrl}/organizations`,
				},
				'/organizations/**': {
					proxy: `${apiUrl}/organizations/**`,
				},
				'/repositories': {
					proxy: `${apiUrl}/repositories`,
				},
				'/repositories/**': {
					proxy: `${apiUrl}/repositories/**`,
				},
				'/user': {
					proxy: `${apiUrl}/user`,
				},
				'/user/**': {
					proxy: `${apiUrl}/user/**`,
				},
			},
		}),
		react(),
		babel({
			presets: [reactCompilerPreset()],
		}),
	],
	resolve: {
		tsconfigPaths: true,
	},
	server: {
		host: '0.0.0.0',
		port: 3000,
		cors: true,
	},
})

export default config
