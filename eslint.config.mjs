import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
	},

	js.configs.recommended,
	...tseslint.configs.recommended,

	{
		files: ['source/**/*.{ts,tsx}', 'globals.d.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/no-misused-promises': [
				'warn',
				{
					checksVoidReturn: false,
				},
			],
		},
	},
);
