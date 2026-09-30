import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type { VaultItem } from './types.ts';
import { tokenize } from './matcher.ts';

export class VaultIndexer {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Scans the vault for folder and file names.
	 * CRITICAL CONSTITUTION RULE: Names and paths only. Never reads file contents.
	 */
	getIndex(): VaultItem[] {
		const allFiles = this.app.vault.getAllLoadedFiles();
		const items: VaultItem[] = [];

		for (const abstractFile of allFiles) {
			if (abstractFile instanceof TFolder) {
				const path = normalizePath(abstractFile.path);
				if (path && path !== '/' && path !== '.') {
					items.push({
						path,
						name: abstractFile.name,
						type: 'folder',
						tokens: tokenize(abstractFile.name + ' ' + path),
					});
				}
			} else if (abstractFile instanceof TFile) {
				if (abstractFile.extension === 'md') {
					const path = normalizePath(abstractFile.path);
					const baseName = abstractFile.basename;
					items.push({
						path,
						name: baseName,
						type: 'file',
						tokens: tokenize(baseName + ' ' + path),
					});
				}
			}
		}

		return items;
	}
}
