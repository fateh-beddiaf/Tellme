import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { App } from 'obsidian';
import { ModelManager } from '../src/models/model-manager.ts';
import {
	ALL_MODELS,
	WHISPER_MODELS,
	OLLAMA_MODELS,
	LOCAL_LLM_MODELS,
} from '../src/models/registry.ts';
import type { ModelInfo } from '../src/models/types.ts';

function mustBe(info: ModelInfo | undefined): ModelInfo {
	assert.ok(info, 'model must exist in registry');
	return info;
}

function createMockApp(tmpDir: string): App {
	return {
		vault: {
			adapter: {
				getBasePath: () => tmpDir,
			},
			configDir: 'obsidian-config',
		},
	} as unknown as App;
}

void describe('Model Registry & Metadata', () => {
	void test('Registry contains all Whisper, built-in and Ollama models', () => {
		assert.ok(ALL_MODELS.length >= 8);
		assert.strictEqual(
			ALL_MODELS.length,
			WHISPER_MODELS.length + LOCAL_LLM_MODELS.length + OLLAMA_MODELS.length,
		);
		assert.strictEqual(new Set(ALL_MODELS.map((m) => m.id)).size, ALL_MODELS.length, 'ids unique');
	});

	void test('Built-in cleanup models are pinned, ungated GGUF downloads', () => {
		assert.ok(LOCAL_LLM_MODELS.length >= 1);
		for (const model of LOCAL_LLM_MODELS) {
			assert.strictEqual(model.type, 'llm');
			assert.ok(model.fileName?.endsWith('.gguf'), model.id);
			assert.strictEqual(
				model.downloadUrl,
				`https://huggingface.co/${model.downloadUrl?.split('/').slice(3, 5).join('/')}/resolve/main/${model.fileName}`,
				`${model.id} must point at a fixed file on Hugging Face`,
			);
			assert.match(model.sha256 ?? '', /^[0-9a-f]{64}$/, `${model.id} sha256`);
			assert.ok(model.license && model.license.length > 0, `${model.id} license`);
			assert.strictEqual(model.ollamaModelName, undefined);
			assert.doesNotMatch(model.ramRequired, /^RAM_/, `${model.id} RAM placeholder must be replaced`);
		}
	});

	void test('Whisper models have valid download URLs and file names', () => {
		for (const model of WHISPER_MODELS) {
			assert.strictEqual(model.type, 'stt');
			assert.ok(model.fileName?.endsWith('.bin'));
			assert.ok(model.downloadUrl?.startsWith('https://huggingface.co/'));
			assert.ok(model.sizeBytes > 0);
			assert.ok(model.sizeFormatted.length > 0);
			assert.ok(model.ramRequired.length > 0);
			assert.ok(['fast', 'balanced', 'accurate'].includes(model.profile));
		}
	});

	void test('Ollama models have valid model names and requirements', () => {
		for (const model of OLLAMA_MODELS) {
			assert.strictEqual(model.type, 'llm');
			assert.ok(model.ollamaModelName && model.ollamaModelName.length > 0);
			assert.ok(model.sizeBytes > 0);
			assert.ok(model.sizeFormatted.length > 0);
			assert.ok(model.ramRequired.length > 0);
			assert.ok(['fast', 'balanced', 'accurate'].includes(model.profile));
		}
	});
});

void describe('ModelManager - Whisper Model Status & Operations', () => {
	let tmpDir: string;
	let modelsDir: string;
	let mockApp: App;
	let manager: ModelManager;

	before(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tellme-models-test-'));
		modelsDir = path.join(tmpDir, 'models');
		await fs.promises.mkdir(modelsDir, { recursive: true });
		mockApp = createMockApp(tmpDir);
		manager = new ModelManager(mockApp, modelsDir);
	});

	after(async () => {
		if (fs.existsSync(tmpDir)) {
			await fs.promises.rm(tmpDir, { recursive: true, force: true });
		}
	});

	void test('Model is "available" when model file is not on disk', async () => {
		const model = mustBe(WHISPER_MODELS[0]);
		const status = await manager.getFileModelStatus(model, '');
		assert.strictEqual(status, 'available');
	});

	void test('Model is "installed" when file exists on disk but not active', async () => {
		const model = mustBe(WHISPER_MODELS[0]);
		const modelPath = manager.getModelFilePath(model);
		await fs.promises.writeFile(modelPath, 'fake-model-binary-data');

		const status = await manager.getFileModelStatus(model, '');
		assert.strictEqual(status, 'installed');
	});

	void test('Model is "active" when file exists and path matches activeWhisperPath', async () => {
		const model = mustBe(WHISPER_MODELS[0]);
		const modelPath = manager.getModelFilePath(model);

		const status = await manager.getFileModelStatus(model, modelPath);
		assert.strictEqual(status, 'active');
	});

	void test('Deleting Whisper model removes file from disk and returns status to "available"', async () => {
		const model = mustBe(WHISPER_MODELS[0]);
		const modelPath = manager.getModelFilePath(model);
		assert.ok(fs.existsSync(modelPath));

		await manager.deleteModelFile(model);
		assert.strictEqual(fs.existsSync(modelPath), false);

		const status = await manager.getFileModelStatus(model, '');
		assert.strictEqual(status, 'available');
	});

	void test('Disk space checking returns valid object with freeBytes', async () => {
		const space = await manager.checkDiskSpace(100 * 1024 * 1024, modelsDir);
		assert.strictEqual(typeof space.ok, 'boolean');
		assert.strictEqual(typeof space.freeBytes, 'number');
		assert.ok(space.freeBytes > 0);
	});
});

void describe('ModelManager - Ollama Model Status & Lifecycle', () => {
	let tmpDir: string;
	let mockApp: App;
	let manager: ModelManager;

	before(async () => {
		tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tellme-ollama-test-'));
		mockApp = createMockApp(tmpDir);
		manager = new ModelManager(mockApp, tmpDir);
	});

	after(async () => {
		if (fs.existsSync(tmpDir)) {
			await fs.promises.rm(tmpDir, { recursive: true, force: true });
		}
	});

	void test('Ollama model is "available" when not in installed list', async () => {
		const model = mustBe(OLLAMA_MODELS[0]); // llama3.2:1b
		const status = await manager.getOllamaModelStatus(model, ['mistral:7b', 'phi3:latest'], '');
		assert.strictEqual(status, 'available');
	});

	void test('Ollama model is "installed" when present in installed list but not active', async () => {
		const model = mustBe(OLLAMA_MODELS[0]);
		const tag = model.ollamaModelName as string;
		const status = await manager.getOllamaModelStatus(
			model,
			[tag, 'mistral:7b'],
			'mistral:7b',
		);
		assert.strictEqual(status, 'installed');
	});

	void test('Ollama model is "active" when installed and matches activeOllamaModel', async () => {
		const model = mustBe(OLLAMA_MODELS[0]);
		const tag = model.ollamaModelName as string;
		const status = await manager.getOllamaModelStatus(
			model,
			[tag, 'mistral:7b'],
			tag,
		);
		assert.strictEqual(status, 'active');
	});

	void test('Download cancellation tracking functions correctly', () => {
		const model = mustBe(WHISPER_MODELS[0]);
		assert.strictEqual(manager.isDownloading(model.id), false);

		manager.cancelDownload(model.id); // Safe no-op when not downloading
		assert.strictEqual(manager.isDownloading(model.id), false);
	});
});
