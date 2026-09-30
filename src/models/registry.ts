// Model registry metadata sources (verified 2026-09-16):
// - Sizes / RAM / speed & quality descriptions for Whisper models come from the
//   exact table in OpenWhispr's LOCAL_WHISPER_SETUP.md
//   (https://github.com/OpenWhispr/openwhispr — LOCAL_WHISPER_SETUP.md).
// - Actual byte sizes and .bin file names verified against the whisper.cpp
//   HuggingFace repo (https://huggingface.co/ggerganov/whisper.cpp/tree/main).
// - Ollama model tags and download sizes verified against https://ollama.com/library
//   and each model's /tags page (no llama3.2 entries — replaced with currently
//   relevant small models per OpenWhispr's "user picks freely" philosophy).
// - gemma4 QAT entries verified 2026-09-17 against https://ollama.com/library/gemma4
//   and /library/gemma4/tags (no llama3.2-era guesses; see entry comments).
// - RAM requirements for Ollama models are NOT stated on the source pages,
//   therefore marked "unverified" instead of guessed.
// - Built-in (llama.cpp) cleanup models verified 2026-09-27 via the Hugging Face
//   API (https://huggingface.co/api/models/<repo>?blobs=true): ungated
//   (no login), Apache-2.0, exact file name, byte size and SHA-256 (lfs.sha256).
//   Gemma 4 comes from ggml-org (the llama.cpp team); Google's own GGUF repos
//   are login-gated, so they are deliberately not used.

import type { ModelInfo } from './types.ts';

export const WHISPER_MODELS: ModelInfo[] = [
	{
		id: 'whisper-tiny',
		name: 'Whisper Tiny (Multilingual)',
		type: 'stt',
		profile: 'fast',
		sizeBytes: 78 * 1024 * 1024, // HF actual: 77.7 MB
		sizeFormatted: '75 MB',
		ramRequired: '~1 GB RAM',
		description:
			'Basic quality, fastest speed. Best for: quick notes.',
		fileName: 'ggml-tiny.bin',
		downloadUrl:
			'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
	},
	{
		id: 'whisper-base',
		name: 'Whisper Base (Multilingual)',
		type: 'stt',
		profile: 'balanced',
		sizeBytes: 148 * 1024 * 1024, // HF actual: 148 MB
		sizeFormatted: '142 MB',
		ramRequired: '~1 GB RAM',
		description:
			'Good quality, fast speed. Best for: everyday notes — the recommended choice.',
		fileName: 'ggml-base.bin',
		downloadUrl:
			'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
	},
	{
		id: 'whisper-small',
		name: 'Whisper Small (Multilingual)',
		type: 'stt',
		profile: 'accurate',
		sizeBytes: 488 * 1024 * 1024, // HF actual: 488 MB
		sizeFormatted: '466 MB',
		ramRequired: '~2 GB RAM',
		description:
			'Better quality, medium speed. Best for: professional use.',
		fileName: 'ggml-small.bin',
		downloadUrl:
			'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
	},
	{
		id: 'whisper-medium',
		name: 'Whisper Medium (Multilingual)',
		type: 'stt',
		profile: 'accurate',
		sizeBytes: Math.round(1.53 * 1024 * 1024 * 1024), // HF actual: 1.53 GB
		sizeFormatted: '1.5 GB',
		ramRequired: '~5 GB RAM',
		description:
			'High quality, slow speed. Best for: high accuracy.',
		fileName: 'ggml-medium.bin',
		downloadUrl:
			'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
	},
	{
		id: 'whisper-large-v3',
		name: 'Whisper Large v3 (Multilingual)',
		type: 'stt',
		profile: 'accurate',
		sizeBytes: Math.round(3.1 * 1024 * 1024 * 1024), // HF actual: 3.1 GB
		sizeFormatted: '3 GB',
		ramRequired: '~10 GB RAM',
		description:
			'Best quality, slowest speed. Best for: maximum quality.',
		fileName: 'ggml-large-v3.bin',
		downloadUrl:
			'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
	},
	{
		id: 'whisper-large-v3-turbo',
		name: 'Whisper Large v3 Turbo',
		type: 'stt',
		profile: 'accurate',
		sizeBytes: Math.round(1.62 * 1024 * 1024 * 1024), // HF actual: 1.62 GB
		sizeFormatted: '1.6 GB',
		ramRequired: '~6 GB RAM',
		description:
			'High quality, fast speed. Best for: fast + accurate.',
		fileName: 'ggml-large-v3-turbo.bin',
		downloadUrl:
			'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
	},
];

/**
 * Built-in cleanup models: GGUF files run by the auto-managed llama.cpp
 * engine (no Ollama needed). Each download is SHA-256 verified.
 */
export const LOCAL_LLM_MODELS: ModelInfo[] = [
	{
		id: 'llama-gemma4-e2b',
		name: 'Gemma 4 (E2B) — recommended',
		type: 'llm',
		profile: 'fast',
		sizeBytes: 2841481184,
		sizeFormatted: '2.6 GB',
		// Measured 2026-09-27: peak 2.1 GB (GPU) / 2.7 GB (CPU-only) for the engine process
		ramRequired: '≈3 GB RAM',
		description:
			"Best all-rounder in our tests: removes fillers in English and Arabic, keeps every detail, and turns reminders into tasks. About 1–2 s per note with a graphics card, 10–20 s on a processor.",
		license: 'Google · Apache-2.0',
		fileName: 'gemma-4-E2B-it-Q4_0.gguf',
		downloadUrl: 'https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_0.gguf',
		sha256: '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52',
	},
	// More models (e.g. Qwen 3.5 4B, Gemma 4 E4B) are added once benchmarked.
];

export const OLLAMA_MODELS: ModelInfo[] = [
	{
		id: 'ollama-gemma3-1b',
		name: 'Gemma 3 (1B)',
		type: 'llm',
		profile: 'fast',
		sizeBytes: 815 * 1024 * 1024, // ollama.com: 815MB
		sizeFormatted: '815 MB',
		ramRequired: 'unverified',
		description:
			"Google's Gemma 3 — the current, most capable model that runs on a single GPU (Ollama library).",
		ollamaModelName: 'gemma3:1b',
	},
	{
		id: 'ollama-qwen3.5-2b',
		name: 'Qwen 3.5 (2B)',
		type: 'llm',
		profile: 'balanced',
		sizeBytes: Math.round(2.7 * 1024 * 1024 * 1024), // ollama.com: 2.7GB
		sizeFormatted: '2.7 GB',
		ramRequired: 'unverified',
		description:
			'Qwen 3.5 family of open-source multimodal models with a 256K context window (Ollama library).',
		ollamaModelName: 'qwen3.5:2b',
	},
	{
		id: 'ollama-gemma3-4b',
		name: 'Gemma 3 (4B)',
		type: 'llm',
		profile: 'balanced',
		sizeBytes: Math.round(3.3 * 1024 * 1024 * 1024), // ollama.com: 3.3GB
		sizeFormatted: '3.3 GB',
		ramRequired: 'unverified',
		description:
			'Gemma 3 4B — the current, most capable model that runs on a single GPU (Ollama library).',
		ollamaModelName: 'gemma3:4b',
	},
	{
		id: 'ollama-gemma4-e2b',
		name: 'Gemma 4 (E2B QAT)',
		type: 'llm',
		profile: 'balanced',
		sizeBytes: Math.round(4.3 * 1024 * 1024 * 1024), // ollama.com: 4.3GB
		sizeFormatted: '4.3 GB',
		ramRequired: 'unverified',
		description:
			'Built by Google DeepMind — "designed to deliver frontier-level performance at each size". The E2B variant supports audio input and a 128K context window (Ollama library).',
		ollamaModelName: 'gemma4:e2b-it-qat',
	},
	{
		id: 'ollama-gemma4-e4b',
		name: 'Gemma 4 (E4B QAT)',
		type: 'llm',
		profile: 'accurate',
		sizeBytes: Math.round(6.1 * 1024 * 1024 * 1024), // ollama.com: 6.1GB
		sizeFormatted: '6.1 GB',
		ramRequired: 'unverified',
		description:
			'Built by Google DeepMind — "designed to deliver frontier-level performance at each size". The E4B variant supports audio input and a 128K context window (Ollama library).',
		ollamaModelName: 'gemma4:e4b-it-qat',
	},
	{
		id: 'ollama-qwen3.5-4b',
		name: 'Qwen 3.5 (4B)',
		type: 'llm',
		profile: 'accurate',
		sizeBytes: Math.round(3.4 * 1024 * 1024 * 1024), // ollama.com: 3.4GB
		sizeFormatted: '3.4 GB',
		ramRequired: 'unverified',
		description:
			'Qwen 3.5 family of open-source multimodal models with a 256K context window (Ollama library).',
		ollamaModelName: 'qwen3.5:4b',
	},
	{
		id: 'ollama-phi4-mini',
		name: 'Phi-4 Mini (3.8B)',
		type: 'llm',
		profile: 'accurate',
		sizeBytes: Math.round(2.5 * 1024 * 1024 * 1024), // ollama.com: 2.5GB
		sizeFormatted: '2.5 GB',
		ramRequired: 'unverified',
		description:
			'Microsoft Phi-4 Mini — adds multilingual support, reasoning, math, and function calling (Ollama library).',
		ollamaModelName: 'phi4-mini:3.8b',
	},
];

export const ALL_MODELS: ModelInfo[] = [
	...WHISPER_MODELS,
	...LOCAL_LLM_MODELS,
	...OLLAMA_MODELS,
];

export function getModelById(id: string): ModelInfo | undefined {
	return ALL_MODELS.find((m) => m.id === id);
}
