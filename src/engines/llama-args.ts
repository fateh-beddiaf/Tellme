/**
 * Pure helpers for running llama.cpp's `llama-server` (no Node/Obsidian
 * imports, so they are unit-testable). Flags verified against the pinned
 * build's `--help` (b11218).
 */

export interface LlamaServerOptions {
	modelPath: string;
	port: number;
	/** Random per-launch secret: other local programs/web pages can't use the server. */
	apiKey: string;
	/** false = force processor-only even on a GPU build. */
	useGpu: boolean;
	contextSize: number;
}

export function buildLlamaServerArgs(options: LlamaServerOptions): string[] {
	return [
		'--model', options.modelPath,
		// Loopback only — never reachable from the network.
		'--host', '127.0.0.1',
		'--port', String(options.port),
		'--api-key', options.apiKey,
		'--ctx-size', String(options.contextSize),
		// One user, one request at a time: a single slot keeps memory low.
		'--parallel', '1',
		// "auto" lets the server fit as many layers as the GPU holds.
		'--gpu-layers', options.useGpu ? 'auto' : '0',
		// Cleanup must answer directly; thinking models would waste minutes.
		'--reasoning-budget', '0',
		'--no-webui',
	];
}

/** JSON schema the model's answer is constrained to (grammar-enforced by llama.cpp). */
export const CLEANUP_RESPONSE_SCHEMA = {
	type: 'object',
	properties: {
		cleaned_text: { type: 'string' },
		routing_intent: { type: ['string', 'null'] },
	},
	required: ['cleaned_text', 'routing_intent'],
	additionalProperties: false,
} as const;

/** Idle time after which the server is stopped to free memory. */
export const LLAMA_IDLE_SHUTDOWN_MS = 5 * 60 * 1000;

/** Max time to wait for a model to load before giving up. */
export const LLAMA_STARTUP_TIMEOUT_MS = 180 * 1000;
