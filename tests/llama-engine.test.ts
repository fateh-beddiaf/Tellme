import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
	LLAMA_ENGINE,
	installFolderName,
	resolveEngineAsset,
} from '../src/engines/engine-registry.ts';
import { buildLlamaServerArgs, CLEANUP_RESPONSE_SCHEMA } from '../src/engines/llama-args.ts';

void describe('Engine registry - pinned llama.cpp downloads', () => {
	void test('Windows/Linux x64 have a separate GPU (Vulkan) build; macOS does not need one', () => {
		assert.ok(resolveEngineAsset(LLAMA_ENGINE, 'win32', 'x64', true)?.url.includes('win-vulkan-x64'));
		assert.ok(resolveEngineAsset(LLAMA_ENGINE, 'win32', 'x64', false)?.url.includes('win-cpu-x64'));
		assert.ok(resolveEngineAsset(LLAMA_ENGINE, 'linux', 'x64', true)?.url.includes('ubuntu-vulkan-x64'));
		assert.strictEqual(resolveEngineAsset(LLAMA_ENGINE, 'darwin', 'arm64', true), null);
		assert.ok(resolveEngineAsset(LLAMA_ENGINE, 'darwin', 'arm64', false));
	});

	void test('every asset is pinned to one official build with a SHA-256', () => {
		for (const [key, asset] of Object.entries(LLAMA_ENGINE.assets)) {
			assert.match(
				asset.url,
				/^https:\/\/github\.com\/ggml-org\/llama\.cpp\/releases\/download\/b11218\/llama-b11218-bin-/,
				key,
			);
			assert.match(asset.sha256, /^[0-9a-f]{64}$/, `${key} sha256`);
			assert.strictEqual(asset.binaryPath.endsWith('.exe'), key.startsWith('win32'), key);
		}
	});

	void test('CPU and GPU builds install into separate folders', () => {
		assert.strictEqual(installFolderName(LLAMA_ENGINE, false), 'llama-cpp-b11218');
		assert.strictEqual(installFolderName(LLAMA_ENGINE, true), 'llama-cpp-b11218-gpu');
	});
});

void describe('buildLlamaServerArgs - how the cleanup engine is started', () => {
	const base = { modelPath: 'C:/m.gguf', port: 51234, apiKey: 'secret', contextSize: 8192 };
	const argValue = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];

	void test('listens only on this computer and requires the per-launch key', () => {
		const args = buildLlamaServerArgs({ ...base, useGpu: true });
		assert.strictEqual(argValue(args, '--host'), '127.0.0.1');
		assert.strictEqual(argValue(args, '--port'), '51234');
		assert.strictEqual(argValue(args, '--api-key'), 'secret');
		assert.ok(args.includes('--no-webui'));
	});

	void test('GPU on = auto offload; GPU off = processor only', () => {
		assert.strictEqual(argValue(buildLlamaServerArgs({ ...base, useGpu: true }), '--gpu-layers'), 'auto');
		assert.strictEqual(argValue(buildLlamaServerArgs({ ...base, useGpu: false }), '--gpu-layers'), '0');
	});

	void test('thinking is disabled and only one request slot is used', () => {
		const args = buildLlamaServerArgs({ ...base, useGpu: false });
		assert.strictEqual(argValue(args, '--reasoning-budget'), '0');
		assert.strictEqual(argValue(args, '--parallel'), '1');
	});

	void test('the answer schema requires exactly cleaned_text and routing_intent', () => {
		assert.deepStrictEqual([...CLEANUP_RESPONSE_SCHEMA.required], ['cleaned_text', 'routing_intent']);
		assert.strictEqual(CLEANUP_RESPONSE_SCHEMA.additionalProperties, false);
	});
});
