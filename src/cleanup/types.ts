export type LLMProvider =
	| 'local'
	| 'ollama'
	| 'groq'
	| 'openrouter'
	| 'openai'
	| 'gemini'
	| 'custom';

export interface LLMOptions {
	enabled: boolean;
	provider: LLMProvider;
	ollamaUrl: string;
	ollamaModel: string;
	/** Built-in engine: path of the active GGUF model file. */
	localModelPath: string;
	/** Built-in engine: use the graphics card when available. */
	localUseGpu: boolean;
	apiKey: string;
	apiUrl: string;
	model: string;
	systemPromptOverride?: string;
}

export interface CleanupResult {
	cleanedText: string;
	routingIntent: string | null;
	rawTranscript: string;
	durationMs: number;
	provider: string;
}

export class LLMError extends Error {
	provider: string;

	constructor(message: string, provider: string) {
		// Sanitize to prevent API key leakage
		const sanitizedMessage = message.replace(
			/(?:sk-[a-zA-Z0-9_-]{20,}|gsk_[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]{30,})/g,
			'[REDACTED_KEY]',
		);
		super(sanitizedMessage);
		this.name = 'LLMError';
		this.provider = provider;
	}
}
