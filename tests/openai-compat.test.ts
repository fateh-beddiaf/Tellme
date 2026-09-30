import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
	candidateBases,
	describeHttpFailure,
	endpointFor,
	filterModels,
	parseModelIds,
	toBaseUrl,
} from '../src/providers/openai-compat.ts';

void describe('Provider URLs - whatever the user pastes', () => {
	void test('a full chat endpoint and its base give the same request URL', () => {
		const full = 'https://api.cline.bot/api/v1/chat/completions';
		assert.strictEqual(endpointFor(full, 'chat'), full);
		assert.strictEqual(endpointFor('https://api.cline.bot/api/v1', 'chat'), full);
		assert.strictEqual(endpointFor('https://api.cline.bot/api/v1/', 'chat'), full);
	});

	void test('a pasted /models or chat URL becomes the base', () => {
		assert.strictEqual(toBaseUrl('https://api.groq.com/openai/v1/models'), 'https://api.groq.com/openai/v1');
		assert.strictEqual(toBaseUrl('https://x.ai/v1/chat/completions/'), 'https://x.ai/v1');
	});

	void test('transcription endpoints are built from the same base', () => {
		assert.strictEqual(
			endpointFor('https://api.groq.com/openai/v1', 'transcription'),
			'https://api.groq.com/openai/v1/audio/transcriptions',
		);
		assert.strictEqual(
			endpointFor('https://api.groq.com/openai/v1/chat/completions', 'transcription'),
			'https://api.groq.com/openai/v1/audio/transcriptions',
		);
	});

	void test('a full endpoint with a query string is kept verbatim (e.g. Azure api-version)', () => {
		const azure = 'https://r.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21';
		assert.strictEqual(endpointFor(azure, 'chat'), azure);
	});

	void test('an address typed without https:// still works', () => {
		assert.strictEqual(
			endpointFor('api.cline.bot/api/v1', 'chat'),
			'https://api.cline.bot/api/v1/chat/completions',
		);
		assert.strictEqual(toBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1');
	});

	void test('a bare site address is tried with the common version paths', () => {
		assert.deepStrictEqual(candidateBases('https://api.cline.bot'), [
			'https://api.cline.bot',
			'https://api.cline.bot/v1',
			'https://api.cline.bot/api/v1',
			'https://api.cline.bot/openai/v1',
		]);
		assert.deepStrictEqual(candidateBases('https://api.openai.com/v1/'), ['https://api.openai.com/v1']);
		assert.deepStrictEqual(candidateBases('  '), []);
	});
});

void describe('Model lists', () => {
	void test('OpenAI-style lists are parsed, de-duplicated and sorted', () => {
		const body = { object: 'list', data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'b-model' }, {}] };
		assert.deepStrictEqual(parseModelIds(body), ['a-model', 'b-model']);
	});

	void test('Gemini-style lists (models[].name with a models/ prefix) are parsed', () => {
		assert.deepStrictEqual(parseModelIds({ models: [{ name: 'models/gemini-2.5-flash' }] }), [
			'gemini-2.5-flash',
		]);
	});

	void test('garbage answers give an empty list, never a crash', () => {
		assert.deepStrictEqual(parseModelIds(null), []);
		assert.deepStrictEqual(parseModelIds('oops'), []);
		assert.deepStrictEqual(parseModelIds({ data: 'nope' }), []);
	});

	void test('transcription shows speech models; cleanup hides them', () => {
		const ids = ['whisper-large-v3', 'llama-3.3-70b-versatile', 'text-embedding-3-small', 'gpt-4o-mini-tts'];
		assert.deepStrictEqual(filterModels(ids, 'transcription'), ['whisper-large-v3']);
		assert.deepStrictEqual(filterModels(ids, 'chat'), ['llama-3.3-70b-versatile']);
	});

	void test('if the filter would hide everything, the full list is shown', () => {
		assert.deepStrictEqual(filterModels(['my-custom-model'], 'transcription'), ['my-custom-model']);
	});

	void test('failures are explained in plain language', () => {
		assert.match(describeHttpFailure(401), /refused the API key/);
		assert.match(describeHttpFailure(404), /Check the URL/);
		assert.match(describeHttpFailure(503), /server error/);
	});
});
