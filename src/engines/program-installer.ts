import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as child_process from 'child_process';
import type { ModelManager } from '../models/model-manager.ts';
import type { ModelDownloadProgress } from '../models/types.ts';
import {
	installFolderName,
	resolveEngineAsset,
	type EngineAsset,
	type EngineRelease,
} from './engine-registry.ts';

/**
 * Downloads an official program build (whisper.cpp, llama.cpp) into
 * `<plugin>/engines/<release id>[-gpu]/`: stream to a temp file, verify its
 * SHA-256 against the pinned value, unpack with the OS's own `tar` into a
 * staging folder, then swap it into place. Temp files are always removed,
 * and nothing is installed unless the checksum matches.
 */
export class ProgramInstaller {
	private release: EngineRelease;
	private modelManager: ModelManager;
	/** Human name used in progress text and errors, e.g. "speech engine". */
	private label: string;
	private installing = new Map<string, Promise<string>>();

	constructor(release: EngineRelease, modelManager: ModelManager, label: string) {
		this.release = release;
		this.modelManager = modelManager;
		this.label = label;
	}

	get releaseName(): string {
		return this.release.displayName;
	}

	/** The download for this computer (GPU variant if asked and available), or null. */
	getAsset(gpu = false): EngineAsset | null {
		return resolveEngineAsset(this.release, process.platform, process.arch, gpu);
	}

	getEnginesDir(): string {
		return path.join(path.dirname(this.modelManager.getModelsDirectory()), 'engines');
	}

	private getInstallDir(gpu: boolean): string {
		return path.join(this.getEnginesDir(), installFolderName(this.release, gpu));
	}

	/** Path of the installed program, or null when it isn't installed. */
	getInstalledPath(gpu = false): string | null {
		const asset = this.getAsset(gpu);
		if (!asset) {
			return null;
		}
		const binary = path.join(this.getInstallDir(gpu), ...asset.binaryPath.split('/'));
		return fs.existsSync(binary) ? binary : null;
	}

	isInstalling(): boolean {
		return this.installing.size > 0;
	}

	/** Download + verify + unpack. Concurrent calls for the same variant share one install. */
	install(gpu = false, onProgress?: (progress: ModelDownloadProgress) => void): Promise<string> {
		const key = gpu ? 'gpu' : 'cpu';
		let pending = this.installing.get(key);
		if (!pending) {
			pending = this.doInstall(gpu, onProgress).finally(() => {
				this.installing.delete(key);
			});
			this.installing.set(key, pending);
		}
		return pending;
	}

	private async doInstall(
		gpu: boolean,
		onProgress?: (progress: ModelDownloadProgress) => void,
	): Promise<string> {
		const asset = this.getAsset(gpu);
		if (!asset) {
			throw new Error(
				`No ready-made ${this.label} for this computer (${process.platform}-${process.arch}).`,
			);
		}

		const enginesDir = this.getEnginesDir();
		await fs.promises.mkdir(enginesDir, { recursive: true });

		const folder = installFolderName(this.release, gpu);
		const archivePath = path.join(enginesDir, `${folder}.download`);
		const stagingDir = path.join(enginesDir, `${folder}.partial`);
		const installDir = this.getInstallDir(gpu);
		const step = (statusText: string): void =>
			onProgress?.({
				modelId: folder,
				bytesDownloaded: asset.sizeBytes,
				totalBytes: asset.sizeBytes,
				percentage: 99,
				statusText,
			});

		try {
			await this.modelManager.downloadHttpStream(
				asset.url,
				archivePath,
				{ id: folder, sizeBytes: asset.sizeBytes },
				() => {
					// Program downloads are small; no cancel handle needed.
				},
				onProgress,
			);

			step('Checking the download is genuine...');
			const actual = await sha256File(archivePath);
			if (actual !== asset.sha256) {
				throw new Error(
					`The downloaded ${this.label} failed its safety check (checksum mismatch). Nothing was installed — please try again.`,
				);
			}

			step('Unpacking...');
			await fs.promises.rm(stagingDir, { recursive: true, force: true });
			await fs.promises.mkdir(stagingDir, { recursive: true });
			await extractArchive(archivePath, stagingDir, asset, this.label);

			const stagedBinary = path.join(stagingDir, ...asset.binaryPath.split('/'));
			if (!fs.existsSync(stagedBinary)) {
				throw new Error(`The ${this.label} download did not contain the expected program.`);
			}
			if (process.platform !== 'win32') {
				await fs.promises.chmod(stagedBinary, 0o755);
			}

			await fs.promises.rm(installDir, { recursive: true, force: true });
			await fs.promises.rename(stagingDir, installDir);

			const installed = this.getInstalledPath(gpu);
			if (!installed) {
				throw new Error(`The ${this.label} was unpacked but could not be found afterwards.`);
			}
			return installed;
		} finally {
			await fs.promises.rm(archivePath, { force: true }).catch(() => undefined);
			await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}

export async function sha256File(filePath: string): Promise<string> {
	const hash = crypto.createHash('sha256');
	for await (const chunk of fs.createReadStream(filePath)) {
		hash.update(chunk as Buffer);
	}
	return hash.digest('hex');
}

/**
 * Unpack with the operating system's own `tar` — no extra dependency.
 * On Windows we call System32's bsdtar explicitly (it reads .zip; a `tar`
 * earlier on PATH, e.g. Git's GNU tar, cannot).
 */
function extractArchive(
	archivePath: string,
	targetDir: string,
	asset: EngineAsset,
	label: string,
): Promise<void> {
	const tarPath =
		process.platform === 'win32'
			? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
			: 'tar';
	const args =
		asset.archive === 'zip'
			? ['-xf', archivePath, '-C', targetDir]
			: ['-xzf', archivePath, '-C', targetDir];

	return new Promise<void>((resolve, reject) => {
		child_process.execFile(tarPath, args, { windowsHide: true }, (error, _stdout, stderr) => {
			if (error) {
				reject(new Error(`Could not unpack the ${label}: ${stderr.trim() || error.message}`));
				return;
			}
			resolve();
		});
	});
}
