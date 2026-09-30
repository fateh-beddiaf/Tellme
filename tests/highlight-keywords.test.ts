import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
	findHighlightMatch,
	findTriggerKeywordMatch,
	TRIGGER_WORDS,
} from '../src/routing/matcher.ts';
import { RoutingEngine } from '../src/routing/routing-engine.ts';
import type { HighlightKeywordConfig, VaultItem } from '../src/routing/types.ts';
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

void describe('Highlight Keywords - Trigger Word Lookahead & Matching', () => {
	const configs: HighlightKeywordConfig[] = [
		{ keyword: 'meeting', targetPath: 'Work/Meetings' },
		{ keyword: 'meeting notes', targetPath: 'Work/Meetings/Notes' },
		{ keyword: 'ideas', targetPath: 'Personal/Ideas' },
		{ keyword: 'idea', targetPath: 'Personal/Ideas' },
		{ keyword: 'project alpha', targetPath: 'Work/Projects/Alpha' },
		{ keyword: 'quarterly team review', targetPath: 'Work/Reviews' },
		{ keyword: 'أفكار', targetPath: 'Personal/Ideas/Arabic' },
		{ keyword: 'مشاريع', targetPath: 'Work/Projects/Arabic' },
	];

	// 1. Trigger Words Constant
	void test('TRIGGER_WORDS contains English and Arabic triggers', () => {
		assert.ok(TRIGGER_WORDS.includes('path'));
		assert.ok(TRIGGER_WORDS.includes('highlight'));
		assert.ok(TRIGGER_WORDS.includes('folder'));
		assert.ok(TRIGGER_WORDS.includes('مسار'));
		assert.ok(TRIGGER_WORDS.includes('مجلد'));
		assert.ok(TRIGGER_WORDS.includes('هايلايت'));
	});

	// 2. Lookahead 1-word match
	void test('Lookahead: 1-word keyword with "path" trigger', () => {
		const match = findTriggerKeywordMatch('path ideas: buy a new microphone', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'ideas');
		assert.strictEqual(match?.targetPath, 'Personal/Ideas');
	});

	void test('Lookahead: 1-word keyword with "highlight" trigger', () => {
		const match = findTriggerKeywordMatch('highlight meeting with engineering', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'meeting');
		assert.strictEqual(match?.targetPath, 'Work/Meetings');
	});

	void test('Lookahead: 1-word keyword with "folder" trigger and punctuation', () => {
		const match = findTriggerKeywordMatch('folder: ideas - remember this concept', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'ideas');
		assert.strictEqual(match?.targetPath, 'Personal/Ideas');
	});

	// 3. Lookahead 2-word match
	void test('Lookahead: 2-word keyword "project alpha"', () => {
		const match = findTriggerKeywordMatch('path project alpha sprint planning notes', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'project alpha');
		assert.strictEqual(match?.targetPath, 'Work/Projects/Alpha');
	});

	// 4. Lookahead 3-word match
	void test('Lookahead: 3-word keyword "quarterly team review"', () => {
		const match = findTriggerKeywordMatch('highlight quarterly team review for Q3', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'quarterly team review');
		assert.strictEqual(match?.targetPath, 'Work/Reviews');
	});

	// 5. Lookahead specificity (prefers longer match over shorter)
	void test('Lookahead: prefers longer 2-word match "meeting notes" over "meeting"', () => {
		const match = findTriggerKeywordMatch('path meeting notes from today', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'meeting notes');
		assert.strictEqual(match?.targetPath, 'Work/Meetings/Notes');
	});

	// 6. Arabic Trigger Words
	void test('Lookahead: Arabic trigger "مسار" with Arabic keyword "أفكار"', () => {
		const match = findTriggerKeywordMatch('مسار أفكار لتطبيق جديد', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'أفكار');
		assert.strictEqual(match?.targetPath, 'Personal/Ideas/Arabic');
	});

	void test('Lookahead: Arabic trigger "مجلد" with Arabic keyword "مشاريع"', () => {
		const match = findTriggerKeywordMatch('مجلد مشاريع الربع الثالث', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'مشاريع');
		assert.strictEqual(match?.targetPath, 'Work/Projects/Arabic');
	});

	// 7. Direct Keyword Matching (without trigger word)
	void test('Direct Match: finds keyword "meeting" in natural speech without trigger word', () => {
		const match = findHighlightMatch('We had a productive meeting with the client today.', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'meeting');
		assert.strictEqual(match?.targetPath, 'Work/Meetings');
	});

	void test('Direct Match: finds multi-word keyword "project alpha" in natural speech', () => {
		const match = findHighlightMatch('Let us update the project alpha architecture diagrams.', configs);
		assert.ok(match);
		assert.strictEqual(match?.keyword, 'project alpha');
		assert.strictEqual(match?.targetPath, 'Work/Projects/Alpha');
	});

	// 8. Word Boundary Safety
	void test('Word Boundary: substring "fleeting" does NOT match "meeting"', () => {
		const match = findHighlightMatch('A fleeting thought on productivity and habits.', configs);
		assert.strictEqual(match, null);
	});

	void test('Word Boundary: word "idealistic" does NOT match "idea"', () => {
		const match = findHighlightMatch('This is an idealistic view of software architecture.', configs);
		assert.strictEqual(match, null);
	});

	void test('Word Boundary: word "telepathic" does NOT trigger "path"', () => {
		const match = findTriggerKeywordMatch('Telepathic ideas are not yet technically feasible.', configs);
		assert.strictEqual(match, null);
	});
});

void describe('Highlight Keywords - RoutingEngine Integration (Zero-AI & Priorities)', () => {
	const engine = new RoutingEngine();

	const mockVault: VaultItem[] = [
		createVaultItem('Work/Projects/Alpha', 'folder'),
		createVaultItem('Work/Meetings', 'folder'),
		createVaultItem('Personal/Ideas', 'folder'),
		createVaultItem('Personal/Daily Notes', 'folder'),
	];

	const options = {
		defaultFolder: 'tellme',
		highlightKeywords: [
			{ keyword: 'meeting', targetPath: 'Work/Meetings' },
			{ keyword: 'ideas', targetPath: 'Personal/Ideas' },
			{ keyword: 'project alpha', targetPath: 'Work/Projects/Alpha' },
		],
	};

	// Zero-AI Definition of Done
	void test('Zero-AI Mode: raw transcript with trigger word routes to mapped folder with zero AI models', () => {
		// When AI is disabled, routingIntent is null and cleanedText === rawTranscript
		const rawTranscript = 'path ideas remember to order new microphone cables';
		const result = engine.resolve(
			rawTranscript,
			null, // No routingIntent from LLM
			mockVault,
			options,
			rawTranscript,
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'highlight_keyword');
		assert.strictEqual(result.targetPath, 'Personal/Ideas');
	});

	void test('Zero-AI Mode: raw transcript with direct keyword routes to mapped folder', () => {
		const rawTranscript = 'Quick meeting update regarding sprint goals';
		const result = engine.resolve(
			rawTranscript,
			null,
			mockVault,
			options,
			rawTranscript,
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'highlight_keyword');
		assert.strictEqual(result.targetPath, 'Work/Meetings');
	});

	// Priority Hierarchy
	void test('Priority Order: Explicit intent (Priority 1) overrides Highlight Keyword (Priority 2)', () => {
		// Speech contains "meeting" (keyword mapped to Work/Meetings)
		// but explicit intent says "Personal/Daily Notes"
		const result = engine.resolve(
			'Discussed meeting notes with team.',
			'Personal/Daily Notes',
			mockVault,
			options,
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'explicit_intent');
		assert.strictEqual(result.targetPath, 'Personal/Daily Notes');
	});

	void test('Priority Order: Highlight Keyword (Priority 2) overrides Vault Tree Fuzzy Match (Priority 3)', () => {
		// Speech mentions vault folder "Daily Notes" AND keyword "ideas"
		// Since routingIntent is null, Highlight Keyword (Priority 2) wins over Vault Tree (Priority 3)
		const result = engine.resolve(
			'Reviewing ideas for our Daily Notes workflow.',
			null,
			mockVault,
			options,
		);

		assert.strictEqual(result.status, 'resolved');
		assert.strictEqual(result.matchSource, 'highlight_keyword');
		assert.strictEqual(result.targetPath, 'Personal/Ideas');
	});

	void test('Fallback: speech without keywords or vault matches safely falls back to tellme/', () => {
		const result = engine.resolve(
			'Random thoughts while walking in the park.',
			null,
			mockVault,
			options,
		);

		assert.strictEqual(result.status, 'unresolved');
		assert.strictEqual(result.matchSource, 'fallback');
		assert.strictEqual(result.targetPath, 'tellme');
	});
});
