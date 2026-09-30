import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseCleanupResponse } from '../src/cleanup/parser.ts';

void describe('parseCleanupResponse', () => {
	void test('parses clean json string', () => {
		const raw = '{"cleaned_text": "Buy milk and bread.", "routing_intent": "Daily Notes"}';
		const result = parseCleanupResponse(raw, 'original');
		assert.strictEqual(result.cleanedText, 'Buy milk and bread.');
		assert.strictEqual(result.routingIntent, 'Daily Notes');
	});

	void test('parses json in markdown codeblock', () => {
		const raw = '```json\n{"cleaned_text": "Meeting notes with Alice.", "routing_intent": "Projects/Alpha"}\n```';
		const result = parseCleanupResponse(raw, 'original');
		assert.strictEqual(result.cleanedText, 'Meeting notes with Alice.');
		assert.strictEqual(result.routingIntent, 'Projects/Alpha');
	});

	void test('handles null routing intent', () => {
		const raw = '{"cleaned_text": "Random thought without destination.", "routing_intent": null}';
		const result = parseCleanupResponse(raw, 'original');
		assert.strictEqual(result.cleanedText, 'Random thought without destination.');
		assert.strictEqual(result.routingIntent, null);
	});

	void test('handles "null" or "none" string routing intent', () => {
		const raw = '{"cleaned_text": "Some text", "routing_intent": "none"}';
		const result = parseCleanupResponse(raw, 'original');
		assert.strictEqual(result.cleanedText, 'Some text');
		assert.strictEqual(result.routingIntent, null);
	});

	void test('handles json embedded in conversational text', () => {
		const raw = 'Here is the cleaned result:\n{"cleaned_text": "Cleaned content.", "routing_intent": "Work/Todos"}\nHope this helps!';
		const result = parseCleanupResponse(raw, 'original');
		assert.strictEqual(result.cleanedText, 'Cleaned content.');
		assert.strictEqual(result.routingIntent, 'Work/Todos');
	});

	void test('gracefully falls back when json is completely malformed', () => {
		const raw = 'This is just raw conversational reply without json.';
		const result = parseCleanupResponse(raw, 'original raw speech');
		assert.strictEqual(result.cleanedText, 'This is just raw conversational reply without json.');
		assert.strictEqual(result.routingIntent, null);
	});

	void test('gracefully falls back to fallbackTranscript when empty', () => {
		const raw = '';
		const result = parseCleanupResponse(raw, 'original speech');
		assert.strictEqual(result.cleanedText, 'original speech');
		assert.strictEqual(result.routingIntent, null);
	});
});
