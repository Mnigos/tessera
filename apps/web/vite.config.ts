import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { routes } from './src/routes'

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
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/auth/session`,
				},
				'/auth/**': {
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/auth/**`,
				},
				'/health/ping': {
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/health/ping`,
				},
				'/health/**': {
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/health/**`,
				},
				'/organizations': {
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/organizations`,
				},
				'/organizations/**': {
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/organizations/**`,
				},
				'/repositories': {
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/repositories`,
				},
				'/repositories/**': {
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/repositories/**`,
				},
				'/users': {
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/users`,
				},
				'/users/**': {
					proxy: `${process.env.API_URL ?? 'http://localhost:4000'}/users/**`,
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
