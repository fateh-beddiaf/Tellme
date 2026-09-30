import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import type { App } from 'obsidian';
import { normalizePath, requestUrl } from 'obsidian';
import type { ModelInfo, ModelDownloadProgress, ModelStatus } from './types.ts';
import { sha256File } from '../engines/program-installer.ts';

export interface ModelManagerOptions {
	modelsDirectory?: string;
	ollamaUrl?: string;
}

export class ModelManager {
	private app: App;
	private modelsDir: string;
	private activeDownloads = new Map<string, { abort: () => void }>();

	constructor(app: App, modelsDirectory?: string) {
		this.app = app;
		this.modelsDir = modelsDirectory || this.getDefaultModelsDir();
	}

	getDefaultModelsDir(): string {
		try {
			// Resolve vault .obsidian/plugins/tellme/models directory
			const adapter = this.app.vault.adapter as { getBasePath?: () => string };
			const basePath = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
			if (basePath) {
				const fullPath = path.join(
					basePath,
					this.app.vault.configDir,
					'plugins',
					'tellme',
					'models',
				);
				return fullPath;
			}
		} catch {
			// Fallback below
		}
		// Vault-relative fallback when the adapter cannot provide a base path.
		return normalizePath(`${this.app.vault.configDir}/plugins/tellme/models`);
	}

	getModelsDirectory(): string {
		return this.modelsDir;
	}

	setModelsDirectory(dir: string): void {
		this.modelsDir = dir;
	}

	async ensureModelsDirectory(): Promise<string> {
		const dir = this.modelsDir;
		if (!fs.existsSync(dir)) {
			await fs.promises.mkdir(dir, { recursive: true });
		}
		return dir;
	}

	getModelFilePath(model: ModelInfo): string {
		if (!model.fileName) {
			return '';
		}
		return path.join(this.modelsDir, model.fileName);
	}

	async checkDiskSpace(
		requiredBytes: number,
		targetDir = this.modelsDir,
	): Promise<{ ok: boolean; freeBytes: number; error?: string }> {
		try {
			// Ensure directory or parent exists for statfs
			let checkPath = targetDir;
			while (checkPath && !fs.existsSync(checkPath)) {
				const parent = path.dirname(checkPath);
				if (parent === checkPath) {
					break;
				}
				checkPath = parent;
			}

			if (typeof fs.promises.statfs === 'function') {
				const stats = await fs.promises.statfs(checkPath || '.');
				const freeBytes = stats.bavail * stats.bsize;
				// Require needed bytes + 50 MB safety margin
				const safetyMargin = 50 * 1024 * 1024;
				const ok = freeBytes >= requiredBytes + safetyMargin;
				return { ok, freeBytes };
			}
		} catch (error) {
			// If statfs is not supported on this platform, proceed safely
			console.warn('[Tellme] Could not check disk space:', error);
		}

		return { ok: true, freeBytes: requiredBytes * 2 };
	}

	async getFileModelStatus(
		model: ModelInfo,
		activeModelPath = '',
	): Promise<ModelStatus> {
		if (this.activeDownloads.has(model.id)) {
			return 'downloading';
		}

		const filePath = this.getModelFilePath(model);
		if (!filePath) {
			return 'available';
		}

		try {
			if (fs.existsSync(filePath)) {
				const stat = await fs.promises.stat(filePath);
				if (stat.size > 0) {
					// Check if this model is currently set as active
					const normActive = path.normalize(activeModelPath).toLowerCase();
					const normCurrent = path.normalize(filePath).toLowerCase();
					if (normActive && normActive === normCurrent) {
						return 'active';
					}
					return 'installed';
				}
			}
		} catch {
			// File access issue
		}

		return 'available';
	}

	async getOllamaInstalledModels(ollamaUrl = 'http://localhost:11434'): Promise<string[]> {
		const base = ollamaUrl.replace(/\/+$/, '');
		try {
			const res = await requestUrl({
				url: `${base}/api/tags`,
				method: 'GET',
			});

			if (res.status === 200 && res.json) {
				const data = res.json as { models?: Array<{ name?: string }> };
				if (Array.isArray(data.models)) {
					return data.models.map((m) => m.name || '').filter(Boolean);
				}
			}
		} catch {
			// Ollama not running or unreachable
		}
		return [];
	}

	async getOllamaModelStatus(
		model: ModelInfo,
		installedModels: string[],
		activeModelName = '',
	): Promise<ModelStatus> {
		if (this.activeDownloads.has(model.id)) {
			return 'downloading';
		}

		const targetName = (model.ollamaModelName || '').toLowerCase();
		if (!targetName) {
			return 'available';
		}

		const isInstalled = installedModels.some((installed) => {
			const norm = installed.toLowerCase();
			return norm === targetName || norm.startsWith(`${targetName}:`) || targetName.startsWith(`${norm}:`);
		});

		if (isInstalled) {
			const normActive = activeModelName.trim().toLowerCase();
			if (normActive && (normActive === targetName || targetName.startsWith(normActive))) {
				return 'active';
			}
			return 'installed';
		}

		return 'available';
	}

	async getModelStatus(
		model: ModelInfo,
		options: {
			activeWhisperPath?: string;
			activeLocalLlmPath?: string;
			activeOllamaModel?: string;
			installedOllamaModels?: string[];
		} = {},
	): Promise<ModelStatus> {
		if (model.type === 'stt') {
			return this.getFileModelStatus(model, options.activeWhisperPath);
		} else if (model.fileName) {
			// Built-in cleanup model: a GGUF file run by llama-server
			return this.getFileModelStatus(model, options.activeLocalLlmPath);
		} else {
			const installed = options.installedOllamaModels ?? [];
			return this.getOllamaModelStatus(model, installed, options.activeOllamaModel);
		}
	}

	async downloadModelFile(
		model: ModelInfo,
		onProgress?: (progress: ModelDownloadProgress) => void,
	): Promise<string> {
		if (!model.downloadUrl || !model.fileName) {
			throw new Error(`Model ${model.name} has no download URL configured.`);
		}

		await this.ensureModelsDirectory();
		const finalPath = this.getModelFilePath(model);
		const tmpPath = `${finalPath}.tmp`;

		// 1. Disk space check
		const space = await this.checkDiskSpace(model.sizeBytes);
		if (!space.ok) {
			const freeMb = Math.round((space.freeBytes || 0) / (1024 * 1024));
			const reqMb = Math.round(model.sizeBytes / (1024 * 1024));
			throw new Error(
				`Insufficient disk space. Required: ${reqMb} MB, Available: ${freeMb} MB.`,
			);
		}

		// 2. Download with redirects and streaming
		let isAborted = false;
		let currentRequest: http.ClientRequest | null = null;

		const abort = (): void => {
			isAborted = true;
			if (currentRequest) {
				currentRequest.destroy();
			}
			try {
				if (fs.existsSync(tmpPath)) {
					fs.unlinkSync(tmpPath);
				}
			} catch {
				// Ignore cleanup error
			}
		};

		this.activeDownloads.set(model.id, { abort });

		// Resume: a previous attempt that was interrupted leaves its partial
		// .tmp file behind; continue from its size instead of starting over.
		let resumeFrom = 0;
		try {
			const partial = await fs.promises.stat(tmpPath);
			if (partial.size > 0 && partial.size < model.sizeBytes) {
				resumeFrom = partial.size;
			}
		} catch {
			// No partial file — fresh download
		}

		let checksumFailed = false;
		try {
			await this.downloadHttpStream(
				model.downloadUrl,
				tmpPath,
				model,
				(req) => {
					currentRequest = req;
				},
				onProgress,
				0,
				resumeFrom,
			);

			// Verify the file when the catalog pins its SHA-256 (large files:
			// a few seconds; protects against truncated or tampered downloads).
			if (model.sha256) {
				onProgress?.({
					modelId: model.id,
					bytesDownloaded: model.sizeBytes,
					totalBytes: model.sizeBytes,
					percentage: 99,
					statusText: 'Checking the download is genuine...',
				});
				const actual = await sha256File(tmpPath);
				if (actual !== model.sha256) {
					checksumFailed = true;
					throw new Error('the downloaded file failed its safety check (checksum mismatch). Nothing was installed — please try again');
				}
			}

			// Atomic rename tmp -> final
			if (fs.existsSync(finalPath)) {
				await fs.promises.unlink(finalPath);
			}
			await fs.promises.rename(tmpPath, finalPath);

			onProgress?.({
				modelId: model.id,
				bytesDownloaded: model.sizeBytes,
				totalBytes: model.sizeBytes,
				percentage: 100,
				statusText: 'Download completed successfully.',
			});

			return finalPath;
		} catch (error) {
			if (isAborted) {
				throw new Error('Download was cancelled.');
			}
			const msg = error instanceof Error ? error.message : 'Unknown download error';
			if (checksumFailed) {
				// A bad file must never be resumed or installed.
				await fs.promises.rm(tmpPath, { force: true }).catch(() => undefined);
				throw new Error(`Failed to download ${model.name}: ${msg}`);
			}
			// Network trouble: keep the partial file so the next attempt resumes.
			throw new Error(
				`Download of ${model.name} was interrupted (${msg}). Click Download again to continue where it stopped.`,
			);
		} finally {
			this.activeDownloads.delete(model.id);
		}
	}

	/**
	 * Stream a URL to a file (follows redirects, reports progress). `item` only
	 * needs an id and an expected size, so engine downloads reuse it too.
	 * With `resumeFrom` > 0 it asks for the rest of the file (HTTP Range) and
	 * appends; if the server ignores the range it starts over. Rejects when the
	 * connection ends before the promised number of bytes arrived.
	 */
	downloadHttpStream(
		url: string,
		destinationPath: string,
		model: Pick<ModelInfo, 'id' | 'sizeBytes'>,
		onRequestCreated: (req: http.ClientRequest) => void,
		onProgress?: (progress: ModelDownloadProgress) => void,
		redirectCount = 0,
		resumeFrom = 0,
	): Promise<void> {
		if (redirectCount > 5) {
			return Promise.reject(new Error('Too many HTTP redirects.'));
		}

		return new Promise<void>((resolve, reject) => {
			const parsedUrl = new URL(url);
			const client = parsedUrl.protocol === 'https:' ? https : http;

			const req = client.get(
				url,
				{
					headers: {
						'User-Agent': 'tellme-obsidian-plugin/1.0',
						...(resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {}),
					},
				},
				(res) => {
					// Handle redirects (301, 302, 303, 307, 308)
					if (
						res.statusCode &&
						res.statusCode >= 300 &&
						res.statusCode < 400 &&
						res.headers.location
					) {
						const redirectUrl = new URL(res.headers.location, url).toString();
						res.resume(); // Consume response to free memory
						this.downloadHttpStream(
							redirectUrl,
							destinationPath,
							model,
							onRequestCreated,
							onProgress,
							redirectCount + 1,
							resumeFrom,
						)
							.then(resolve)
							.catch(reject);
						return;
					}

					// 416 = the partial file doesn't fit the server's file: start over next time
					if (res.statusCode === 416) {
						res.resume();
						fs.rmSync(destinationPath, { force: true });
						reject(new Error('the partial download did not match; please try again'));
						return;
					}

					// 206 = the server sent only the missing part (resume works) — but
					// only trust it if it starts exactly where our partial file ends.
					const rangeStart = /^bytes (\d+)-/.exec(res.headers['content-range'] ?? '')?.[1];
					if (res.statusCode === 206 && Number(rangeStart) !== resumeFrom) {
						res.resume();
						fs.rmSync(destinationPath, { force: true });
						reject(new Error('the server resumed at the wrong position; please try again'));
						return;
					}
					const resuming = resumeFrom > 0 && res.statusCode === 206;
					if (res.statusCode !== 200 && !resuming) {
						res.resume();
						reject(
							new Error(
								`Server returned HTTP ${res.statusCode}: ${res.statusMessage || ''}`,
							),
						);
						return;
					}

					const startAt = resuming ? resumeFrom : 0;
					const contentLength = parseInt(res.headers['content-length'] || '0', 10);
					const totalBytes = contentLength ? startAt + contentLength : model.sizeBytes;
					let downloaded = startAt;
					// Append when resuming; a plain 200 means start over.
					const fileStream = fs.createWriteStream(destinationPath, { flags: resuming ? 'a' : 'w' });
					let failed = false;

					// A dropped connection must reject — never resolve with a cut-off
					// file. Reject only after the file is closed: a write still in
					// flight would otherwise land after a quick retry measured the
					// partial size, and the resumed bytes would be appended at the
					// wrong offset (corrupting models that have no checksum).
					const failAfterClose = (err: Error): void => {
						if (failed) {
							return;
						}
						failed = true;
						if (fileStream.closed) {
							reject(err);
							return;
						}
						fileStream.once('close', () => reject(err));
						fileStream.destroy();
					};
					res.on('aborted', () => failAfterClose(new Error('the connection was interrupted')));
					res.on('error', (err) => failAfterClose(err));

					res.on('data', (chunk: Buffer) => {
						downloaded += chunk.length;
						const percentage = totalBytes > 0 ? Math.min(99, Math.round((downloaded / totalBytes) * 100)) : 0;
						const downloadedMb = (downloaded / (1024 * 1024)).toFixed(1);
						const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);

						onProgress?.({
							modelId: model.id,
							bytesDownloaded: downloaded,
							totalBytes,
							percentage,
							statusText: `Downloading: ${downloadedMb} / ${totalMb} MB (${percentage}%)`,
						});
					});

					res.pipe(fileStream);

					fileStream.on('finish', () => {
						fileStream.close(() => {
							if (failed) {
								return;
							}
							if (contentLength && downloaded !== startAt + contentLength) {
								reject(new Error('the connection was interrupted'));
								return;
							}
							resolve();
						});
					});

					fileStream.on('error', (err) => {
						fileStream.close(() => {
							try {
								if (fs.existsSync(destinationPath)) {
									fs.unlinkSync(destinationPath);
								}
							} catch {
								// Ignore
							}
							reject(err);
						});
					});
				},
			);

			req.on('error', (err) => {
				reject(err);
			});

			onRequestCreated(req);
		});
	}

	async pullOllamaModel(
		model: ModelInfo,
		ollamaUrl = 'http://localhost:11434',
		onProgress?: (progress: ModelDownloadProgress) => void,
	): Promise<void> {
		if (!model.ollamaModelName) {
			throw new Error(`Model ${model.name} has no Ollama model tag configured.`);
		}

		const base = ollamaUrl.replace(/\/+$/, '');
		const targetName = model.ollamaModelName;

		this.activeDownloads.set(model.id, {
			abort: () => {
				// Ollama pull cancellation
			},
		});

		try {
			onProgress?.({
				modelId: model.id,
				bytesDownloaded: 0,
				totalBytes: model.sizeBytes,
				percentage: 0,
				statusText: `Initiating Ollama pull for ${targetName}...`,
			});

			// We use Node http/https client to stream newline-delimited JSON chunks from Ollama /api/pull
			await new Promise<void>((resolve, reject) => {
				const parsed = new URL(`${base}/api/pull`);
				const client = parsed.protocol === 'https:' ? https : http;

				const postData = JSON.stringify({
					name: targetName,
					stream: true,
				});

				const req = client.request(
					parsed,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Content-Length': Buffer.byteLength(postData),
						},
					},
					(res) => {
						if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
							let errBody = '';
							res.on('data', (d) => (errBody += d));
							res.on('end', () => {
								reject(
									new Error(
										`Ollama returned HTTP ${res.statusCode}: ${errBody || res.statusMessage}`,
									),
								);
							});
							return;
						}

						let buffer = '';
						res.on('data', (chunk: Buffer) => {
							buffer += chunk.toString('utf-8');
							const lines = buffer.split('\n');
							buffer = lines.pop() || '';

							for (const line of lines) {
								if (!line.trim()) {
									continue;
								}
								try {
									const data = JSON.parse(line) as {
										status?: string;
										completed?: number;
										total?: number;
										error?: string;
									};

									if (data.error) {
										reject(new Error(data.error));
										return;
									}

									const completed = data.completed || 0;
									const total = data.total || model.sizeBytes;
									const percentage =
										total > 0
											? Math.min(100, Math.round((completed / total) * 100))
											: 0;

									onProgress?.({
										modelId: model.id,
										bytesDownloaded: completed,
										totalBytes: total,
										percentage,
										statusText: data.status || `Pulling ${targetName}...`,
									});
								} catch {
									// Incomplete json line
								}
							}
						});

						res.on('end', () => {
							resolve();
						});

						res.on('error', (err) => {
							reject(err);
						});
					},
				);

				req.on('error', (err) => {
					reject(
						new Error(
							`Failed to connect to Ollama at ${base} (${err.message}). Is Ollama running?`,
						),
					);
				});

				req.write(postData);
				req.end();
			});

			onProgress?.({
				modelId: model.id,
				bytesDownloaded: model.sizeBytes,
				totalBytes: model.sizeBytes,
				percentage: 100,
				statusText: `Successfully installed ${targetName}.`,
			});
		} finally {
			this.activeDownloads.delete(model.id);
		}
	}

	async deleteModelFile(model: ModelInfo): Promise<void> {
		const filePath = this.getModelFilePath(model);
		if (filePath && fs.existsSync(filePath)) {
			await fs.promises.unlink(filePath);
		}
	}

	async deleteOllamaModel(
		model: ModelInfo,
		ollamaUrl = 'http://localhost:11434',
	): Promise<void> {
		if (!model.ollamaModelName) {
			return;
		}

		const base = ollamaUrl.replace(/\/+$/, '');
		const res = await requestUrl({
			url: `${base}/api/delete`,
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: model.ollamaModelName }),
		});

		if (res.status < 200 || res.status >= 300) {
			throw new Error(`Failed to delete Ollama model: status ${res.status}`);
		}
	}

	cancelDownload(modelId: string): void {
		const active = this.activeDownloads.get(modelId);
		if (active) {
			active.abort();
			this.activeDownloads.delete(modelId);
		}
	}

	isDownloading(modelId: string): boolean {
		return this.activeDownloads.has(modelId);
	}
}
