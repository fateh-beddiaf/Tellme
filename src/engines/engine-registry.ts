/**
 * Pinned, checksum-verified downloads of the programs that run local models.
 * Pure data + helpers (no Obsidian/Node imports) so it is unit-testable.
 *
 * Every entry was verified 2026-09-27: downloaded from the official
 * ggml-org GitHub release, SHA-256 compared against the digest GitHub
 * publishes for the asset, extracted, and the binary path confirmed.
 * Pin a specific build — never "latest" — so an upstream change can't
 * break users; bump deliberately after testing.
 */

export type ArchiveFormat = 'zip' | 'tar.gz';

export interface EngineAsset {
	url: string;
	sha256: string;
	sizeBytes: number;
	archive: ArchiveFormat;
	/** Path of the executable inside the extracted archive (forward slashes). */
	binaryPath: string;
}

export interface EngineRelease {
	/** Folder name under the plugin's engines/ directory; changes on every bump. */
	id: string;
	displayName: string;
	/**
	 * Keyed by `${process.platform}-${process.arch}`; a GPU-accelerated
	 * variant, when one exists, uses the same key with a `-gpu` suffix.
	 */
	assets: Record<string, EngineAsset>;
}

const WHISPER_BASE_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130';

/** whisper.cpp v1.9.4 (release build b5130). macOS has no official prebuilt CLI. */
export const WHISPER_ENGINE: EngineRelease = {
	id: 'whisper-cpp-b5130',
	displayName: 'whisper.cpp v1.9.4',
	assets: {
		'win32-x64': {
			url: `${WHISPER_BASE_URL}/whisper-bin-x64.zip`,
			sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
			sizeBytes: 8573270,
			archive: 'zip',
			binaryPath: 'Release/whisper-cli.exe',
		},
		'win32-arm64': {
			url: `${WHISPER_BASE_URL}/whisper-bin-win-cpu-arm64.zip`,
			sha256: '799543b926ab5b6c2d60cab269a2092e0ae8d27820e9e15429e59de3699546fc',
			sizeBytes: 4361895,
			archive: 'zip',
			binaryPath: 'Release/whisper-cli.exe',
		},
		'linux-x64': {
			url: `${WHISPER_BASE_URL}/whisper-bin-ubuntu-x64.tar.gz`,
			sha256: '53e7fd8b5764edad916b8848dd0af6abb1ff1d3b86c899e79c78652412536c32',
			sizeBytes: 9793438,
			archive: 'tar.gz',
			binaryPath: 'whisper-bin-ubuntu-x64/whisper-cli',
		},
		'linux-arm64': {
			url: `${WHISPER_BASE_URL}/whisper-bin-ubuntu-arm64.tar.gz`,
			sha256: '93532a0e3777f26f041ffa358ee77dd88b1a33a86847c1990745327ff335a5d6',
			sizeBytes: 4605905,
			archive: 'tar.gz',
			binaryPath: 'whisper-bin-ubuntu-arm64/whisper-cli',
		},
	},
};

const LLAMA_BASE_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b11218';

/**
 * llama.cpp build b11218 — runs the built-in cleanup models (llama-server).
 * `-gpu` entries are the Vulkan builds (NVIDIA/AMD/Intel GPUs); they also
 * contain the CPU backends, so they still run where no GPU is usable.
 * macOS arm64 uses Metal automatically; the macOS x64 build is CPU-only.
 */
export const LLAMA_ENGINE: EngineRelease = {
	id: 'llama-cpp-b11218',
	displayName: 'llama.cpp b11218',
	assets: {
		'win32-x64': {
			url: `${LLAMA_BASE_URL}/llama-b11218-bin-win-cpu-x64.zip`,
			sha256: 'c5db5974ee132c4db6eafd4415238112b7af8350bc2f3882545121b515ef602b',
			sizeBytes: 19155959,
			archive: 'zip',
			binaryPath: 'llama-server.exe',
		},
		'win32-x64-gpu': {
			url: `${LLAMA_BASE_URL}/llama-b11218-bin-win-vulkan-x64.zip`,
			sha256: 'a45ba045c6677b070841de10c411f91338bca52bebb2b7cb4e5f745ba3062f42',
			sizeBytes: 33062642,
			archive: 'zip',
			binaryPath: 'llama-server.exe',
		},
		'win32-arm64': {
			url: `${LLAMA_BASE_URL}/llama-b11218-bin-win-cpu-arm64.zip`,
			sha256: '38f4edd4200deaf53b1be9b5adcf741baada6dac8830e82af76042acae63a5a6',
			sizeBytes: 12041187,
			archive: 'zip',
			binaryPath: 'llama-server.exe',
		},
		'darwin-arm64': {
			url: `${LLAMA_BASE_URL}/llama-b11218-bin-macos-arm64.tar.gz`,
			sha256: '2baeafa6ade61f2daa533c7c32871529ded9a11ac569a0bc9986c3106de8961f',
			sizeBytes: 11756456,
			archive: 'tar.gz',
			binaryPath: 'llama-b11218/llama-server',
		},
		'darwin-x64': {
			url: `${LLAMA_BASE_URL}/llama-b11218-bin-macos-x64.tar.gz`,
			sha256: '49f0627026c1d2d2b4a8311e8bb0201c5ad3f4ee648803bc7ca63fea80211270',
			sizeBytes: 11310118,
			archive: 'tar.gz',
			binaryPath: 'llama-b11218/llama-server',
		},
		'linux-x64': {
			url: `${LLAMA_BASE_URL}/llama-b11218-bin-ubuntu-x64.tar.gz`,
			sha256: '9ed52d78e24bfdadad0637a6481fb79a4bb26ddd61cf40ae3d4c56f6bbead793',
			sizeBytes: 17404565,
			archive: 'tar.gz',
			binaryPath: 'llama-b11218/llama-server',
		},
		'linux-x64-gpu': {
			url: `${LLAMA_BASE_URL}/llama-b11218-bin-ubuntu-vulkan-x64.tar.gz`,
			sha256: 'cf624bdc9fb12975e2043ab2df6490993862e703ed28e0c371fff478cef4c85a',
			sizeBytes: 31344747,
			archive: 'tar.gz',
			binaryPath: 'llama-b11218/llama-server',
		},
		'linux-arm64': {
			url: `${LLAMA_BASE_URL}/llama-b11218-bin-ubuntu-arm64.tar.gz`,
			sha256: '531bb76f1038d7ebc00a90a64ff3294742f9ecc1a929afe55ee8732b006e03b0',
			sizeBytes: 13497983,
			archive: 'tar.gz',
			binaryPath: 'llama-b11218/llama-server',
		},
	},
};

/**
 * The downloadable asset for this OS/CPU (the GPU variant when `gpu` is
 * true and one exists), or null when there is none (e.g. whisper on macOS).
 */
export function resolveEngineAsset(
	release: EngineRelease,
	platform: string,
	arch: string,
	gpu = false,
): EngineAsset | null {
	const key = `${platform}-${arch}`;
	if (gpu) {
		return release.assets[`${key}-gpu`] ?? null;
	}
	return release.assets[key] ?? null;
}

/** Install folder name for an asset: `<release id>` or `<release id>-gpu`. */
export function installFolderName(release: EngineRelease, gpu: boolean): string {
	return gpu ? `${release.id}-gpu` : release.id;
}

/**
 * Where Homebrew puts whisper.cpp's CLI on macOS (Apple Silicon first,
 * then Intel). Used instead of a download because upstream ships no
 * macOS binary.
 */
export const HOMEBREW_WHISPER_CANDIDATES = [
	'/opt/homebrew/bin/whisper-cli',
	'/usr/local/bin/whisper-cli',
];

export function formatMegabytes(bytes: number): string {
	return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}
