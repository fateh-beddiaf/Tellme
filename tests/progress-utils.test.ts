import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as nodeTimers from 'node:timers';
import { ProgressThrottle, withDeadline, withTimeout } from '../src/models/progress-utils.ts';

void describe('ProgressThrottle - download progress painting', () => {
	void test('first event is always painted', () => {
		const t = new ProgressThrottle(250);
		assert.strictEqual(t.shouldEmit(0, 1000), true);
	});

	void test('a flood of per-chunk events is reduced to at most one paint per percent', () => {
		// Simulate a 1.5 GB download in 64 KB chunks arriving every 1 ms.
		const t = new ProgressThrottle(0);
		const total = 1.5 * 1024 * 1024 * 1024;
		const chunk = 64 * 1024;
		let paints = 0;
		let now = 0;
		for (let done = chunk; done <= total; done += chunk) {
			now += 1;
			if (t.shouldEmit(Math.min(99, Math.round((done / total) * 100)), now)) {
				paints++;
			}
		}
		// ~24,000 events in, at most ~100 paints out.
		assert.ok(paints <= 101, `expected <= 101 paints, got ${paints}`);
		assert.ok(paints >= 90, `expected the bar to still move every percent, got ${paints}`);
	});

	void test('same percentage is never painted twice', () => {
		const t = new ProgressThrottle(0);
		assert.strictEqual(t.shouldEmit(5, 0), true);
		assert.strictEqual(t.shouldEmit(5, 1000), false);
	});

	void test('a new percentage within the interval is held back', () => {
		const t = new ProgressThrottle(250);
		assert.strictEqual(t.shouldEmit(1, 0), true);
		assert.strictEqual(t.shouldEmit(2, 100), false);
		assert.strictEqual(t.shouldEmit(3, 300), true);
	});

	void test('100% is always painted, even inside the interval', () => {
		const t = new ProgressThrottle(250);
		assert.strictEqual(t.shouldEmit(99, 0), true);
		assert.strictEqual(t.shouldEmit(100, 10), true);
	});
});

void describe('withDeadline - a provider that never answers must not stall the note', () => {
	void test('passes the answer through when it arrives in time', async () => {
		assert.strictEqual(await withDeadline(Promise.resolve('ok'), 1000, 'late', nodeTimers), 'ok');
	});

	void test('rejects with the given message when the provider hangs', async () => {
		const never = new Promise<string>(() => {});
		await assert.rejects(withDeadline(never, 20, 'no answer after 20 ms', nodeTimers), /no answer after 20 ms/);
	});

	void test('passes the provider error through unchanged', async () => {
		await assert.rejects(
			withDeadline(Promise.reject(new Error('HTTP 401')), 1000, 'late', nodeTimers),
			/HTTP 401/,
		);
	});
});

void describe('withTimeout - never let a slow server block the UI', () => {
	void test('returns the value when the promise is fast', async () => {
		assert.deepStrictEqual(await withTimeout(Promise.resolve(['a']), 1000, [], nodeTimers), ['a']);
	});

	void test('returns the fallback when the promise is too slow', async () => {
		const slow = new Promise<string[]>((resolve) => nodeTimers.setTimeout(() => resolve(['late']), 500));
		assert.deepStrictEqual(await withTimeout(slow, 20, [], nodeTimers), []);
	});

	void test('returns the fallback when the promise rejects', async () => {
		assert.deepStrictEqual(
			await withTimeout(Promise.reject(new Error('refused')), 1000, ['fallback'], nodeTimers),
			['fallback'],
		);
	});
});
