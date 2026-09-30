import { LLMOptions, CleanupResult } from './types';
import { OllamaProvider } from './providers/ollama';
import { CloudLLMProvider } from './providers/cloud-llm';
import { LocalLlamaProvider } from './providers/local-llama';
import type { LlamaEngine } from '../engines/llama-engine';

export class CleanupService {
	private ollamaProvider: OllamaProvider;
	private cloudLLMProvider: CloudLLMProvider;
	private localProvider: LocalLlamaProvider;

	constructor(llamaEngine: LlamaEngine) {
		this.localProvider = new LocalLlamaProvider(llamaEngine);
		this.ollamaProvider = new OllamaProvider();
		this.cloudLLMProvider = new CloudLLMProvider();
	}

	async cleanup(
		rawTranscript: string,
		options: LLMOptions,
	): Promise<CleanupResult> {
		if (!options.enabled || !rawTranscript.trim()) {
			return {
				cleanedText: rawTranscript.trim(),
				routingIntent: null,
				rawTranscript,
				durationMs: 0,
				provider: 'none (passthrough)',
			};
		}

		if (options.provider === 'local') {
			return this.localProvider.process(rawTranscript, options);
		}
		if (options.provider === 'ollama') {
			return this.ollamaProvider.process(rawTranscript, options);
		} else {
			return this.cloudLLMProvider.process(rawTranscript, options);
		}
	}
}
