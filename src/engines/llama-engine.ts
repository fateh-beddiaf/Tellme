import type { ModelManager } from '../models/model-manager.ts';
import type { ModelDownloadProgress } from '../models/types.ts';
import { LLAMA_ENGINE, type EngineAsset } from './engine-registry.ts';
import { ProgramInstaller } from './program-installer.ts';
import { LlamaServerManager, type LlamaEndpoint } from './llama-server.ts';

/**
 * The built-in cleanup engine: llama.cpp's `llama-server`, downloaded like
 * the speech engine and started only while notes are being cleaned.
 *
 * GPU: where a separate GPU (Vulkan) build exists (Windows/Linux x64), the
 * user's "Use graphics card" setting picks that build; it also contains the
 * CPU backends, so it still works on a PC without a usable GPU. On Apple
 * Silicon the single build already uses Metal.
 */
export class LlamaEngine {
	private installer: ProgramInstaller;
	private server: LlamaServerManager;

	constructor(modelManager: ModelManager) {
		this.installer = new ProgramInstaller(LLAMA_ENGINE, modelManager, 'cleanup engine');
		this.server = new LlamaServerManager(this.installer);
	}

	get releaseName(): string {
		return this.installer.releaseName;
	}

	/** Whether a separate GPU build exists for this computer. */
	hasGpuBuild(): boolean {
		return this.installer.getAsset(true) !== null;
	}

	/** The build to use for this setting (GPU build only where one exists). */
	private useGpuBuild(useGpu: boolean): boolean {
		return useGpu && this.hasGpuBuild();
	}

	getAsset(useGpu: boolean): EngineAsset | null {
		return this.installer.getAsset(this.useGpuBuild(useGpu));
	}

	/**
	 * Which installed build to run for this setting (true = GPU build), or
	 * null if none fits. The GPU build also runs processor-only
	 * (`--gpu-layers 0`), so turning the GPU off never forces a second download.
	 */
	private installedBuild(useGpu: boolean): boolean | null {
		const gpuInstalled = this.hasGpuBuild() && this.installer.getInstalledPath(true) !== null;
		if (this.useGpuBuild(useGpu)) {
			return gpuInstalled ? true : null;
		}
		if (this.installer.getInstalledPath(false) !== null) {
			return false;
		}
		return gpuInstalled ? true : null;
	}

	isInstalled(useGpu: boolean): boolean {
		return this.installedBuild(useGpu) !== null;
	}

	isInstalling(): boolean {
		return this.installer.isInstalling();
	}

	install(useGpu: boolean, onProgress?: (progress: ModelDownloadProgress) => void): Promise<string> {
		return this.installer.install(this.useGpuBuild(useGpu), onProgress);
	}

	/** A running server for this model (starting it if needed). */
	acquire(modelPath: string, useGpu: boolean): Promise<LlamaEndpoint> {
		const gpuBuild = this.installedBuild(useGpu);
		if (gpuBuild === null) {
			return Promise.reject(new Error('The cleanup engine is not installed yet.'));
		}
		return this.server.acquire(modelPath, useGpu, gpuBuild);
	}

	/** Push the idle shutdown back after a request. */
	touch(): void {
		this.server.touch();
	}

	isRunning(): boolean {
		return this.server.isRunning();
	}

	stop(): void {
		this.server.stop();
	}

	cleanupOrphan(): Promise<void> {
		return this.server.cleanupOrphan();
	}
}
