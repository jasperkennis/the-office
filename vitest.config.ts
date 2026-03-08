import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['standalone/**/*.test.ts', 'src/**/*.test.ts'],
	},
});
