/// <reference types="vitest" />

import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [react()],
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		globals: true,
		environment: 'happy-dom',
		setupFiles: './vitest.setup.ts',
		exclude: [...configDefaults.exclude, '.output/**'],
	},
})
