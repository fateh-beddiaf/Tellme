import * as fs from 'fs';
import type { ModelManager } from '../models/model-manager.ts';
import type { ModelDownloadProgress } from '../models/types.ts';
import { HOMEBREW_WHISPER_CANDIDATES, WHISPER_ENGINE, type EngineAsset } from './engine-registry.ts';
import { ProgramInstaller } from './program-installer.ts';

export type WhisperCliSource = 'custom' | 'bundled' | 'homebrew';

export interface ResolvedWhisperCli {
	path: string;
	source: WhisperCliSource;
}

/**
 * The whisper.cpp program ("speech engine") that runs Whisper models.
 *
 * Normal users never see a path: the plugin downloads the official build
 * (see ProgramInstaller). macOS has no official build, so there the plugin
 * uses a Homebrew install (`brew install whisper-cpp`) if present. A
 * non-empty custom path from the Advanced settings always wins.
 */
export class WhisperEngine {
	private installer: ProgramInstaller;

	constructor(modelManager: ModelManager) {
		this.installer = new ProgramInstaller(WHISPER_ENGINE, modelManager, 'speech engine');
	}

	/** The download for this computer, or null when there is none (macOS). */
	getAsset(): EngineAsset | null {
		return this.installer.getAsset();
	}

	get releaseName(): string {
		return this.installer.releaseName;
	}

	/** Path of the downloaded program if it is installed, else null. */
	getBundledCliPath(): string | null {
		return this.installer.getInstalledPath();
	}

	/** macOS only: a Homebrew-installed whisper-cli, if any. */
	findHomebrewCli(): string | null {
		if (process.platform !== 'darwin') {
			return null;
		}
		return HOMEBREW_WHISPER_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
	}

	/** Which program to run: custom path > downloaded engine > Homebrew. */
	resolveCliPath(customPath: string): ResolvedWhisperCli | null {
		const custom = customPath.trim();
		if (custom) {
			return { path: custom, source: 'custom' };
		}
		const bundled = this.getBundledCliPath();
		if (bundled) {
			return { path: bundled, source: 'bundled' };
		}
		const brew = this.findHomebrewCli();
		if (brew) {
			return { path: brew, source: 'homebrew' };
		}
		return null;
	}

	isInstalling(): boolean {
		return this.installer.isInstalling();
	}

	/** Download + verify + unpack the engine. Concurrent calls share one install. */
	install(onProgress?: (progress: ModelDownloadProgress) => void): Promise<string> {
		if (!this.getAsset() && process.platform === 'darwin') {
			return Promise.reject(
				new Error(
					'whisper.cpp has no ready-made Mac download. Install it once with Homebrew: brew install whisper-cpp',
				),
			);
		}
		return this.installer.install(false, onProgress);
	}
}
