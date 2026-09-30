import { App, normalizePath, TFile, TFolder } from 'obsidian';
import type { RoutingResult, WriteMode, WriteNoteResult } from './types.ts';

export interface NoteWriterOptions {
	writeMode: WriteMode;
	defaultFolder: string;
}

export class NoteWriter {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	async write(
		cleanedText: string,
		routing: RoutingResult,
		options: NoteWriterOptions,
	): Promise<WriteNoteResult> {
		const startTime = Date.now();

		try {
			const result = await this.performWrite(cleanedText, routing, options);
			return {
				...result,
				durationMs: Date.now() - startTime,
			};
		} catch (error) {
			// Fail-safe emergency fallback (ZERO DATA LOSS)
			console.error('[Tellme] Error writing note to destination:', error);
			const fallbackResult = await this.performEmergencyFallback(
				cleanedText,
				options.defaultFolder,
			);
			return {
				...fallbackResult,
				durationMs: Date.now() - startTime,
			};
		}
	}

	private async performWrite(
		cleanedText: string,
		routing: RoutingResult,
		options: NoteWriterOptions,
	): Promise<{ filePath: string; created: boolean; status: typeof routing.status }> {
		const now = new Date();
		const isoTimestamp = now.toISOString();
		const localHeading = this.formatLocalTimestamp(now);

		let targetPath = normalizePath(routing.targetPath);
		if (!targetPath || targetPath === '.') {
			targetPath = normalizePath(options.defaultFolder || 'tellme');
		}

		if (options.writeMode === 'append') {
			// Determine target markdown file
			let targetFilePath: string;
			if (routing.targetType === 'file' && targetPath.toLowerCase().endsWith('.md')) {
				targetFilePath = targetPath;
			} else {
				targetFilePath = normalizePath(`${targetPath}/tellme.md`);
			}

			// Ensure parent folder exists
			await this.ensureFolderHierarchy(this.getParentFolder(targetFilePath));

			const existingFile = this.app.vault.getAbstractFileByPath(targetFilePath);
			if (existingFile instanceof TFile) {
				// Append to existing file under subheading
				const appendContent = `\n\n## ${localHeading}\n\n${cleanedText.trim()}\n`;
				await this.app.vault.append(existingFile, appendContent);
				return {
					filePath: targetFilePath,
					created: false,
					status: routing.status,
				};
			} else {
				// Create new file with frontmatter and initial heading
				const frontmatter = this.buildFrontmatter(isoTimestamp, routing.status);
				const fileContent = `${frontmatter}\n\n## ${localHeading}\n\n${cleanedText.trim()}\n`;
				await this.app.vault.create(targetFilePath, fileContent);
				return {
					filePath: targetFilePath,
					created: true,
					status: routing.status,
				};
			}
		} else {
			// Always create a new file
			const targetFolder =
				routing.targetType === 'folder'
					? targetPath
					: this.getParentFolder(targetPath);

			await this.ensureFolderHierarchy(targetFolder);

			const filename = this.generateTimestampedFilename(now);
			let filePath = normalizePath(`${targetFolder}/${filename}`);

			// Collision avoidance
			let counter = 1;
			while (this.app.vault.getAbstractFileByPath(filePath)) {
				filePath = normalizePath(`${targetFolder}/${filename.replace('.md', '')}-${counter}.md`);
				counter++;
			}

			const frontmatter = this.buildFrontmatter(isoTimestamp, routing.status);
			const fileContent = `${frontmatter}\n\n${cleanedText.trim()}\n`;

			await this.app.vault.create(filePath, fileContent);
			return {
				filePath,
				created: true,
				status: routing.status,
			};
		}
	}

	private async performEmergencyFallback(
		cleanedText: string,
		defaultFolder: string,
	): Promise<{ filePath: string; created: boolean; status: 'unresolved' }> {
		const now = new Date();
		const folder = normalizePath(defaultFolder || 'tellme');
		await this.ensureFolderHierarchy(folder);

		const fallbackPath = normalizePath(`${folder}/tellme.md`);
		const localHeading = this.formatLocalTimestamp(now);
		const existingFile = this.app.vault.getAbstractFileByPath(fallbackPath);

		if (existingFile instanceof TFile) {
			const appendContent = `\n\n## ${localHeading}\n\n${cleanedText.trim()}\n`;
			await this.app.vault.append(existingFile, appendContent);
			return {
				filePath: fallbackPath,
				created: false,
				status: 'unresolved',
			};
		} else {
			const frontmatter = this.buildFrontmatter(now.toISOString(), 'unresolved');
			const fileContent = `${frontmatter}\n\n## ${localHeading}\n\n${cleanedText.trim()}\n`;
			await this.app.vault.create(fallbackPath, fileContent);
			return {
				filePath: fallbackPath,
				created: true,
				status: 'unresolved',
			};
		}
	}

	private buildFrontmatter(timestamp: string, status: 'resolved' | 'unresolved'): string {
		return `---\ntimestamp: ${timestamp}\nrouting_status: ${status}\n---`;
	}

	private formatLocalTimestamp(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');

		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
	}

	private generateTimestampedFilename(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');

		return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}.md`;
	}

	private getParentFolder(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		if (lastSlash === -1) {
			return '';
		}
		return filePath.substring(0, lastSlash);
	}

	private async ensureFolderHierarchy(folderPath: string): Promise<void> {
		const clean = normalizePath(folderPath);
		if (!clean || clean === '.' || clean === '/') {
			return;
		}

		const parts = clean.split('/');
		let current = '';

		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const normalized = normalizePath(current);
			const abstract = this.app.vault.getAbstractFileByPath(normalized);
			if (!abstract) {
				try {
					await this.app.vault.createFolder(normalized);
				} catch {
					// Ignore folder exists race condition
				}
			} else if (!(abstract instanceof TFolder)) {
				return;
			}
		}
	}
}
