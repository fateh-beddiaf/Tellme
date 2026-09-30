import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RoutingEngine } from '../src/routing/routing-engine.ts';
import type { VaultItem } from '../src/routing/types.ts';
import { tokenize } from '../src/routing/matcher.ts';

function createVaultItem(path: string, type: 'folder' | 'file'): VaultItem {
	const lastSlash = path.lastIndexOf('/');
	const name = lastSlash === -1 ? path : path.substring(lastSlash + 1);
	return {
		path,
		name,
		type,
		tokens: tokenize(name + ' ' + path),
	};
}

void describe('RoutingEngine 4-Step Priority Hierarchy', () => {
	const engine = new RoutingEngine();

	const mockVault: VaultItem[] = [
		createVaultItem('Work/Projects/Alpha', 'folder'),
		createVaultItem('Work/Projects/Beta', 'folder'),
		createVaultItem('Personal/Daily Notes', 'folder'),
		createVaultItem('Personal/Finance', 'folder'),
		createVaultItem('Archive/2025', 'folder'),
		createVaultItem('Meeting Notes.md', 'file'),
	];

	const defaultOptions = {
		defaultFolder: 'tellme',
		highlightKeywords: [
			{ keyword: 'meeting', targetPath: 'Work/Meetings' },
			{ keyword: 'idea', targetPath: 'Personal/Ideas' },
		],
	};

	// 1. Priority 1: Explicit Spoken Intent
	void test('Priority 1: routes to explicit spoken folder intent matching vault', () => {
		const result = engine.resolve(
			'Discussed project alpha architecture with the team.',
			'Projects/Alpha',
			mockVault,
			defaultOptions,
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'explicit_intent');
		assert.strictEqual(result.targetPath, 'Work/Projects/Alpha');
	});

	void test('Priority 1: routes to explicit spoken new folder path if not yet in vault', () => {
		const result = engine.resolve(
			'Save this note in projects gamma.',
			'Projects/Gamma',
			mockVault,
			defaultOptions,
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'explicit_intent');
		assert.strictEqual(result.targetPath, 'Projects/Gamma');
	});

	void test('Priority 1: explicit intent overrides highlight keyword in same recording', () => {
		const result = engine.resolve(
			'This is an idea for a meeting with Alice.',
			'Work/Projects/Beta',
			mockVault,
			defaultOptions,
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'explicit_intent');
		assert.strictEqual(result.targetPath, 'Work/Projects/Beta');
	});

	// 2. Priority 2: Highlight Keywords
	void test('Priority 2: routes matching highlight keyword to configured path', () => {
		const result = engine.resolve(
			'We had a quick meeting regarding Q3 roadmap.',
			null,
			mockVault,
			defaultOptions,
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'highlight_keyword');
		assert.strictEqual(result.targetPath, 'Work/Meetings');
	});

	void test('Priority 2: strictly respects word boundaries for highlight keywords', () => {
		// "fleeting" contains "eeting", not "meeting"
		const result = engine.resolve(
			'A fleeting thought on productivity.',
			null,
			mockVault,
			defaultOptions,
		);

		assert.notStrictEqual(result.matchSource, 'highlight_keyword');
	});

	void test('Priority 2: highlight keyword overrides fuzzy vault match', () => {
		// Text mentions "Projects Alpha" (vault folder) AND "idea" (highlight keyword)
		// Since routingIntent is null, Highlight Keyword (Priority 2) wins over Vault Match (Priority 3)
		const result = engine.resolve(
			'I have a great idea for Projects Alpha.',
			null,
			mockVault,
			defaultOptions,
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'highlight_keyword');
		assert.strictEqual(result.targetPath, 'Personal/Ideas');
	});

	// 3. Priority 3: Vault Tree Fuzzy Match
	void test('Priority 3: fuzzy matches vault folder name from speech', () => {
		const result = engine.resolve(
			'Update for project beta on frontend redesign.',
			null,
			mockVault,
			{ defaultFolder: 'tellme', highlightKeywords: [] },
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'vault_tree');
		assert.strictEqual(result.targetPath, 'Work/Projects/Beta');
	});

	void test('Priority 3: fuzzy matches vault file name from speech', () => {
		const result = engine.resolve(
			'Meeting Notes on product backlog grooming.',
			null,
			mockVault,
			{ defaultFolder: 'tellme', highlightKeywords: [] },
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'vault_tree');
		assert.strictEqual(result.targetPath, 'Meeting Notes.md');
	});

	// 4. Priority 4: Safe Fallback
	void test('Priority 4: routes unrecognized rambling speech to tellme fallback as unresolved', () => {
		const result = engine.resolve(
			'Remember to buy milk and oranges on the way home.',
			null,
			mockVault,
			defaultOptions,
		);

		assert.strictEqual(result.status, 'unresolved');
		assert.strictEqual(result.matchSource, 'fallback');
		assert.strictEqual(result.targetPath, 'tellme');
	});

	void test('Priority 4: safely handles empty input by falling back', () => {
		const result = engine.resolve(
			'',
			null,
			mockVault,
			defaultOptions,
		);

		assert.strictEqual(result.status, 'unresolved');
		assert.strictEqual(result.matchSource, 'fallback');
		assert.strictEqual(result.targetPath, 'tellme');
	});

	void test('Priority 4: resolves ambiguous ties by safely falling back', () => {
		const ambiguousVault: VaultItem[] = [
			createVaultItem('Work/Tasks', 'folder'),
			createVaultItem('Personal/Tasks', 'folder'),
		];

		const result = engine.resolve(
			'Tasks for today.',
			null,
			ambiguousVault,
			{ defaultFolder: 'tellme', highlightKeywords: [] },
		);

		// Equal match between Work/Tasks and Personal/Tasks triggers ambiguity protection
		assert.strictEqual(result.status, 'unresolved');
		assert.strictEqual(result.matchSource, 'fallback');
		assert.strictEqual(result.targetPath, 'tellme');
	});
});
