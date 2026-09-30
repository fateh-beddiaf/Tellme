export type ModelType = 'stt' | 'llm';

export type ModelProfile = 'fast' | 'balanced' | 'accurate';

export type ModelStatus =
	| 'available'
	| 'downloading'
	| 'installed'
	| 'active'
	| 'error';

export interface ModelDownloadProgress {
	modelId: string;
	bytesDownloaded: number;
	totalBytes: number;
	percentage: number;
	statusText: string;
}

export interface ModelInfo {
	id: string;
	name: string;
	type: ModelType;
	profile: ModelProfile;
	sizeBytes: number;
	sizeFormatted: string;
	ramRequired: string;
	description: string;
	fileName?: string;
	downloadUrl?: string;
	ollamaModelName?: string;
	/** Pinned SHA-256 of the downloaded file, verified before it is installed. */
	sha256?: string;
	/** Publisher / license line shown on the card (e.g. "Google · Apache-2.0"). */
	license?: string;
}
