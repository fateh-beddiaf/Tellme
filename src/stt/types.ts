export type STTProvider =
	| 'whisper.cpp'
	| 'groq'
	| 'openai'
	| 'openrouter'
	| 'custom';

export interface STTOptions {
	provider: STTProvider;
	whisperCliPath: string;
	whisperModelPath: string;
	apiKey: string;
	apiUrl: string;
	model: string;
	language: string;
}

export interface STTResult {
	text: string;
	durationMs: number;
	provider: STTProvider;
}

export class STTError extends Error {
	provider: STTProvider;

	constructor(message: string, provider: STTProvider) {
		// Sanitize message to ensure no secret API keys are included
		const sanitizedMessage = message.replace(
			/(?:sk-[a-zA-Z0-9_-]{20,}|gsk_[a-zA-Z0-9_-]{20,})/g,
			'[REDACTED_KEY]',
		);
		super(sanitizedMessage);
		this.name = 'STTError';
		this.provider = provider;
	}
}
