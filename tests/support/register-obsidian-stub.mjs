// Test-only: resolve `import ... from 'obsidian'` to a small in-repo stub.
// The real `obsidian` npm package ships type definitions only (no runtime
// code), so without this hook tests that import plugin modules cannot load.
// Keeping the stub in the repo (instead of patching node_modules) means
// `npm install` can no longer break the test suite.
import { registerHooks } from 'node:module';

const stubUrl = new URL('./obsidian-stub.js', import.meta.url).href;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'obsidian') {
			return { url: stubUrl, format: 'module', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	},
});
