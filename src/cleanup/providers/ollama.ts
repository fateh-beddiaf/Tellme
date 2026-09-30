import { requestUrl } from 'obsidian';
import { DEFAULT_SYSTEM_PROMPT, buildUserPrompt } from '../prompt';
import { parseCleanupResponse } from '../parser';
import { LLMOptions, CleanupResult, LLMError } from '../types';
import { withDeadline } from '../../models/progress-utils';

/** Local models can take a while to load on first use; never wait forever. */
const OLLAMA_TIMEOUT_MS = 180 * 1000;

export class OllamaProvider {
	async process(
		rawTranscript: string,
		options: LLMOptions,
	): Promise<CleanupResult> {
		const baseUrl = (options.ollamaUrl.trim() || 'http://localhost:11434').replace(/\/+$/, '');
		const chatUrl = `${baseUrl}/api/chat`;
		const model = options.ollamaModel.trim() || 'gemma3:4b';
		const systemPrompt = options.systemPromptOverride || DEFAULT_SYSTEM_PROMPT;
		const userPrompt = buildUserPrompt(rawTranscript);

		const startTime = Date.now();

		try {
			const response = await withDeadline(
				requestUrl({
					url: chatUrl,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model,
						messages: [
							{ role: 'system', content: systemPrompt },
							{ role: 'user', content: userPrompt },
						],
						stream: false,
						format: 'json',
						options: {
							temperature: 0.2,
						},
					}),
				}),
				OLLAMA_TIMEOUT_MS,
				`no answer from Ollama after ${OLLAMA_TIMEOUT_MS / 1000} seconds`,
				window,
			);

			const durationMs = Date.now() - startTime;

			if (response.status < 200 || response.status >= 300) {
				throw new LLMError(
					`Ollama API returned status ${response.status}: ${response.text}`,
					'ollama',
				);
			}

			const data = response.json as {
				message?: { content?: string };
				response?: string;
			};
			const rawContent = data?.message?.content || data?.response || '';

			const parsed = parseCleanupResponse(rawContent, rawTranscript);

			return {
				cleanedText: parsed.cleanedText,
				routingIntent: parsed.routingIntent,
				rawTranscript,
				durationMs,
				provider: `ollama (${model})`,
			};
		} catch (error) {
			if (error instanceof LLMError) {
				throw error;
			}
			const message =
				error instanceof Error ? error.message : 'Connection failed';
			throw new LLMError(
				`Failed to reach Ollama at ${baseUrl} (${message}). Please ensure Ollama is running and model "${model}" is installed.`,
				'ollama',
			);
		}
	}
}
