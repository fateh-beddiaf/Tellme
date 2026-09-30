import { requestUrl } from 'obsidian';
import { DEFAULT_SYSTEM_PROMPT, buildUserPrompt } from '../prompt';
import { parseCleanupResponse } from '../parser';
import { LLMOptions, CleanupResult, LLMError } from '../types';
import { endpointFor, PROVIDER_BASE_URLS } from '../../providers/openai-compat';
import { withDeadline } from '../../models/progress-utils';

/** Cloud cleanup normally takes seconds; past this we save the raw text instead. */
const CLOUD_CLEANUP_TIMEOUT_MS = 90 * 1000;

export class CloudLLMProvider {
	async process(
		rawTranscript: string,
		options: LLMOptions,
	): Promise<CleanupResult> {
		const apiKey = options.apiKey.trim();
		if (!apiKey) {
			throw new LLMError(
				`API key is missing for ${options.provider}. Please set your API key in settings.`,
				options.provider,
			);
		}

		const endpoint = this.resolveEndpoint(options);
		const model = this.resolveModel(options);
		const systemPrompt = options.systemPromptOverride || DEFAULT_SYSTEM_PROMPT;
		const userPrompt = buildUserPrompt(rawTranscript);

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		};

		if (options.provider === 'openrouter') {
			headers['HTTP-Referer'] = 'https://obsidian.md';
			headers['X-Title'] = 'Tellme';
		}

		const startTime = Date.now();

		try {
			const bodyPayload: Record<string, unknown> = {
				model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt },
				],
				temperature: 0.2,
				response_format: { type: 'json_object' },
			};

			const response = await withDeadline(
				requestUrl({
					url: endpoint,
					method: 'POST',
					headers,
					body: JSON.stringify(bodyPayload),
					throw: false,
				}),
				CLOUD_CLEANUP_TIMEOUT_MS,
				`no answer from ${options.provider} after ${CLOUD_CLEANUP_TIMEOUT_MS / 1000} seconds (model "${model}")`,
				window,
			);

			const durationMs = Date.now() - startTime;

			if (response.status < 200 || response.status >= 300) {
				// 400/404 with a model name set is almost always a wrong model ID.
				const hint =
					response.status === 400 || response.status === 404
						? ` — check that "${model}" is a model this provider offers (pick it from the list in Settings → Cleanup → Model)`
						: '';
				throw new LLMError(
					`${options.provider} returned HTTP ${response.status}${hint}. Details: ${response.text.slice(0, 300)}`,
					options.provider,
				);
			}

			const data = response.json as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			const rawContent = data?.choices?.[0]?.message?.content || '';

			const parsed = parseCleanupResponse(rawContent, rawTranscript);

			return {
				cleanedText: parsed.cleanedText,
				routingIntent: parsed.routingIntent,
				rawTranscript,
				durationMs,
				provider: `${options.provider} (${model})`,
			};
		} catch (error) {
			if (error instanceof LLMError) {
				throw error;
			}
			const message =
				error instanceof Error ? error.message : 'API request failed';
			throw new LLMError(
				`Cloud LLM call failed (${options.provider}): ${message}`,
				options.provider,
			);
		}
	}

	/** Custom URL may be a base (…/v1) or a full …/chat/completions endpoint. */
	private resolveEndpoint(options: LLMOptions): string {
		if (options.apiUrl && options.apiUrl.trim()) {
			return endpointFor(options.apiUrl, 'chat');
		}
		const base = PROVIDER_BASE_URLS[options.provider] ?? PROVIDER_BASE_URLS.groq ?? '';
		return endpointFor(base, 'chat');
	}

	private resolveModel(options: LLMOptions): string {
		if (options.model && options.model.trim()) {
			return options.model.trim();
		}

		switch (options.provider) {
			case 'groq':
				return 'llama-3.3-70b-versatile';
			case 'openrouter':
				return 'meta-llama/llama-3.3-70b-instruct';
			case 'openai':
				return 'gpt-4o-mini';
			case 'gemini':
				return 'gemini-2.0-flash';
			default:
				return 'llama-3.3-70b-versatile';
		}
	}
}
