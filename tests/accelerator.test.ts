import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
	hotkeyToAccelerator,
	isSameCombo,
	RollingRepeatGuard,
} from '../src/hotkeys/accelerator.ts';

void describe('hotkeyToAccelerator - settings vocabulary to Electron Accelerator', () => {
	void test('Ctrl + Space maps to Control+Space', () => {
		assert.strictEqual(
			hotkeyToAccelerator('Ctrl', 'Space'),
			'Control+Space',
		);
	});

	void test('Shift + Space maps to Shift+Space', () => {
		assert.strictEqual(
			hotkeyToAccelerator('Shift', 'Space'),
			'Shift+Space',
		);
	});

	void test('Alt + r maps to Alt+R (single letter upper-cased)', () => {
		assert.strictEqual(hotkeyToAccelerator('Alt', 'r'), 'Alt+R');
	});

	void test('Meta + Space maps to Super+Space', () => {
		assert.strictEqual(hotkeyToAccelerator('Meta', 'Space'), 'Super+Space');
	});

	void test('None + a maps to bare A (no modifier)', () => {
		assert.strictEqual(hotkeyToAccelerator('None', 'a'), 'A');
	});

	void test('digits are accepted', () => {
		assert.strictEqual(hotkeyToAccelerator('Ctrl', '3'), 'Control+3');
	});

	void test('key casing and surrounding whitespace are normalized', () => {
		assert.strictEqual(hotkeyToAccelerator('Ctrl', ' space '), 'Control+Space');
	});

	void test('multi-letter keys are rejected (null)', () => {
		assert.strictEqual(hotkeyToAccelerator('Ctrl', 'ctrl'), null);
		assert.strictEqual(hotkeyToAccelerator('Ctrl', 'enter'), null);
	});

	void test('punctuation and empty keys are rejected (null)', () => {
		assert.strictEqual(hotkeyToAccelerator('Ctrl', '!'), null);
		assert.strictEqual(hotkeyToAccelerator('Ctrl', ''), null);
	});
});

void describe('isSameCombo - double-fire guard comparison', () => {
	void test('same combo matches case-insensitively', () => {
		assert.strictEqual(
			isSameCombo({ modifier: 'Ctrl', key: 'Space' }, { modifier: 'Ctrl', key: 'space' }),
			true,
		);
	});

	void test('different modifier does not match', () => {
		assert.strictEqual(
			isSameCombo({ modifier: 'Shift', key: 'Space' }, { modifier: 'Ctrl', key: 'Space' }),
			false,
		);
		assert.strictEqual(
			isSameCombo({ modifier: 'None', key: 'a' }, { modifier: 'Shift', key: 'a' }),
			false,
		);
	});

	void test('different key does not match', () => {
		assert.strictEqual(
			isSameCombo({ modifier: 'Ctrl', key: 'Space' }, { modifier: 'Ctrl', key: 'r' }),
			false,
		);
	});

	void test('whitespace is trimmed before comparing keys', () => {
		assert.strictEqual(
			isSameCombo({ modifier: 'Ctrl', key: ' r ' }, { modifier: 'Ctrl', key: 'r' }),
			true,
		);
	});
});

void describe('RollingRepeatGuard - global hotkey auto-repeat suppression', () => {
	void test('first event is always accepted', () => {
		const guard = new RollingRepeatGuard(600);
		assert.strictEqual(guard.shouldAccept(1000), true);
	});

	void test('default Windows hold: entire repeat train is swallowed', () => {
		// Windows default: initial fire, repeat delay 500 ms, then repeats
		// every ~33 ms until release. Rolling suppression must kill them all.
		const guard = new RollingRepeatGuard(600);
		assert.strictEqual(guard.shouldAccept(0), true); // initial press
		assert.strictEqual(guard.shouldAccept(500), false); // first repeat
		for (let t = 533; t <= 3000; t += 33) {
			assert.strictEqual(guard.shouldAccept(t), false, `repeat at t=${t}`);
		}
	});

	void test('slowest Windows delay (1000 ms): at most one repeat leaks, rest swallowed', () => {
		const guard = new RollingRepeatGuard(600);
		assert.strictEqual(guard.shouldAccept(0), true); // initial press
		assert.strictEqual(guard.shouldAccept(1000), true); // known 1-fire leak
		for (let t = 1033; t <= 3000; t += 33) {
			assert.strictEqual(guard.shouldAccept(t), false, `repeat at t=${t}`);
		}
	});

	void test('a genuine second press after release is accepted', () => {
		const guard = new RollingRepeatGuard(600);
		assert.strictEqual(guard.shouldAccept(0), true);
		// Repeat train ends (key released); user presses again 700 ms later.
		assert.strictEqual(guard.shouldAccept(700), true);
	});

	void test('gap of exactly minIntervalMs is accepted (>= comparison)', () => {
		const guard = new RollingRepeatGuard(600);
		assert.strictEqual(guard.shouldAccept(0), true);
		assert.strictEqual(guard.shouldAccept(600), true);
	});

	void test('reset() allows an immediate press after re-enabling', () => {
		const guard = new RollingRepeatGuard(600);
		assert.strictEqual(guard.shouldAccept(5000), true);
		guard.reset();
		assert.strictEqual(guard.shouldAccept(5100), true);
	});
});
