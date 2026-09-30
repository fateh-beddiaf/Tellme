import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	WHISPER_ENGINE,
	formatMegabytes,
	resolveEngineAsset,
} from '../src/engines/engine-registry.ts';
import { WhisperEngine } from '../src/engines/whisper-engine.ts';
import type { ModelManager } from '../src/models/model-manager.ts';

void describe('Engine registry - pinned whisper.cpp downloads', () => {
	void test('Windows x64 and Linux x64 have a download; macOS has none', () => {
		assert.ok(resolveEngineAsset(WHISPER_ENGINE, 'win32', 'x64'));
		assert.ok(resolveEngineAsset(WHISPER_ENGINE, 'linux', 'x64'));
		assert.strictEqual(resolveEngineAsset(WHISPER_ENGINE, 'darwin', 'arm64'), null);
	});

	void test('every asset is pinned to an official ggml-org release with a SHA-256', () => {
		for (const [key, asset] of Object.entries(WHISPER_ENGINE.assets)) {
			assert.match(
				asset.url,
				/^https:\/\/github\.com\/ggml-org\/whisper\.cpp\/releases\/download\/b\d+\//,
				key,
			);
			assert.doesNotMatch(asset.url, /latest/, `${key} must be pinned, not "latest"`);
			assert.match(asset.sha256, /^[0-9a-f]{64}$/, `${key} sha256`);
			assert.ok(asset.sizeBytes > 1024 * 1024, `${key} size`);
		}
	});

	void test('Windows binaries end in .exe, others do not', () => {
		for (const [key, asset] of Object.entries(WHISPER_ENGINE.assets)) {
			assert.strictEqual(asset.binaryPath.endsWith('.exe'), key.startsWith('win32'), key);
		}
	});

	void test('formatMegabytes rounds and never shows 0 MB', () => {
		assert.strictEqual(formatMegabytes(8573270), '8 MB');
		assert.strictEqual(formatMegabytes(10), '1 MB');
	});
});

void describe('WhisperEngine.resolveCliPath - which program runs', () => {
	let root: string;
	let engine: WhisperEngine;

	before(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tellme-engine-'));
		const fakeManager = {
			getModelsDirectory: () => path.join(root, 'models'),
		} as unknown as ModelManager;
		engine = new WhisperEngine(fakeManager);
	});

	after(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	void test('a custom path always wins', () => {
		assert.deepStrictEqual(engine.resolveCliPath('  C:/my/whisper-cli.exe '), {
			path: 'C:/my/whisper-cli.exe',
			source: 'custom',
		});
	});

	void test('nothing installed → null (the UI then offers the download)', () => {
		if (process.platform === 'darwin') {
			return; // may find a real Homebrew install on a Mac dev machine
		}
		assert.strictEqual(engine.resolveCliPath(''), null);
	});

	void test('an installed engine is found under engines/<release id>/', () => {
		const asset = engine.getAsset();
		if (!asset) {
			return; // no download for this platform (macOS)
		}
		const cli = path.join(root, 'engines', WHISPER_ENGINE.id, ...asset.binaryPath.split('/'));
		fs.mkdirSync(path.dirname(cli), { recursive: true });
		fs.writeFileSync(cli, '');
		assert.deepStrictEqual(engine.resolveCliPath(''), { path: cli, source: 'bundled' });
	});
});
