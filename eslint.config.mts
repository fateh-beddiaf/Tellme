import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		// Test-runner plumbing (plain Node scripts, not plugin code)
		'tests/support',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
			'obsidianmd/ui/sentence-case': [
				'warn',
				{
					acronyms: [
						'API',
						'URL',
						'HTML',
						'BYOK',
						'GGML',
						'STT',
						'LLM',
						'AI',
						'PCM',
						'WAV',
						'HTTPS',
						'HTTP',
					],
					brands: [
						'Obsidian',
						'GitHub',
						'Groq',
						'OpenAI',
						'OpenRouter',
						'Ollama',
						'Gemini',
						'whisper.cpp',
						'Tellme',
					],
				},
			],
		},
	},
);
