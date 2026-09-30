import { test, describe } from 'node:test';
import assert from 'node:assert';
import { NoteWriter } from '../src/routing/note-writer.ts';
import type { RoutingResult } from '../src/routing/types.ts';
import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

class MockVault {
	files = new Map<string, string>();
	folders = new Set<string>();

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		if (this.files.has(path)) {
			const file = new TFile();
			file.path = path;
			return file;
		}
		if (this.folders.has(path)) {
			const folder = new TFolder();
			folder.path = path;
			return folder;
		}
		return null;
	}

	async createFolder(path: string): Promise<void> {
		this.folders.add(path);
	}

	async create(path: string, data: string): Promise<TFile> {
		this.files.set(path, data);
		const file = new TFile();
		file.path = path;
		return file;
	}

	async append(file: TFile, data: string): Promise<void> {
		const existing = this.files.get(file.path) || '';
		this.files.set(file.path, existing + data);
	}
}

function createMockApp(): { app: App; vault: MockVault } {
	const vault = new MockVault();
	return {
		app: { vault } as unknown as App,
		vault,
	};
}

void describe('NoteWriter - Write Behavior & Frontmatter Timestamps', () => {
	void test('Append Mode: creates tellme.md with YAML frontmatter if file does not exist', async () => {
		const { app, vault } = createMockApp();
		const writer = new NoteWriter(app);

		const routing: RoutingResult = {
			targetPath: 'Projects/Alpha',
			targetType: 'folder',
			status: 'resolved',
			matchSource: 'explicit_intent',
			confidence: 1.0,
		};

		const result = await writer.write('Test note content.', routing, {
			writeMode: 'append',
			defaultFolder: 'tellme',
		});

		assert.strictEqual(result.filePath, 'Projects/Alpha/tellme.md');
		assert.strictEqual(result.created, true);
		assert.strictEqual(result.status, 'resolved');

		const content = vault.files.get('Projects/Alpha/tellme.md');
		assert.ok(content);
		assert.ok(content?.includes('---'));
		assert.ok(content?.includes('timestamp: '));
		assert.ok(content?.includes('routing_status: resolved'));
		assert.ok(content?.includes('## 202'));
		assert.ok(content?.includes('Test note content.'));
	});

	void test('Append Mode: appends under timestamp heading if tellme.md already exists', async () => {
		const { app, vault } = createMockApp();
		const writer = new NoteWriter(app);

		const routing: RoutingResult = {
			targetPath: 'Work/Meetings',
			targetType: 'folder',
			status: 'resolved',
			matchSource: 'highlight_keyword',
			confidence: 1.0,
		};

		// First write creates file
		await writer.write('First note.', routing, {
			writeMode: 'append',
			defaultFolder: 'tellme',
		});

		// Second write appends
		const result = await writer.write('Second note.', routing, {
			writeMode: 'append',
			defaultFolder: 'tellme',
		});

		assert.strictEqual(result.filePath, 'Work/Meetings/tellme.md');
		assert.strictEqual(result.created, false);

		const content = vault.files.get('Work/Meetings/tellme.md');
		assert.ok(content?.includes('First note.'));
		assert.ok(content?.includes('Second note.'));
		assert.strictEqual((content?.match(/---/g) || []).length, 2); // Frontmatter opened and closed once
	});

	void test('New File Mode: creates separate timestamped file for each note', async () => {
		const { app, vault } = createMockApp();
		const writer = new NoteWriter(app);

		const routing: RoutingResult = {
			targetPath: 'Personal/Ideas',
			targetType: 'folder',
			status: 'resolved',
			matchSource: 'highlight_keyword',
			confidence: 1.0,
		};

		const result = await writer.write('Brand new idea.', routing, {
			writeMode: 'new_file',
			defaultFolder: 'tellme',
		});

		assert.ok(result.filePath.startsWith('Personal/Ideas/'));
		assert.ok(result.filePath.endsWith('.md'));
		assert.strictEqual(result.created, true);

		const content = vault.files.get(result.filePath);
		assert.ok(content?.includes('---'));
		assert.ok(content?.includes('routing_status: resolved'));
		assert.ok(content?.includes('Brand new idea.'));
	});

	void test('Emergency Fallback: unresolved routing writes to tellme/ with routing_status: unresolved', async () => {
		const { app, vault } = createMockApp();
		const writer = new NoteWriter(app);

		const routing: RoutingResult = {
			targetPath: 'tellme',
			targetType: 'folder',
			status: 'unresolved',
			matchSource: 'fallback',
			confidence: 0,
		};

		const result = await writer.write('Unrouted fleeting thoughts.', routing, {
			writeMode: 'append',
			defaultFolder: 'tellme',
		});

		assert.strictEqual(result.filePath, 'tellme/tellme.md');
		assert.strictEqual(result.status, 'unresolved');

		const content = vault.files.get('tellme/tellme.md');
		assert.ok(content?.includes('routing_status: unresolved'));
		assert.ok(content?.includes('Unrouted fleeting thoughts.'));
	});
});
