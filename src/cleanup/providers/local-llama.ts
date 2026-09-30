import { DEFAULT_SYSTEM_PROMPT, buildUserPrompt } from '../prompt';
import { parseCleanupResponse } from '../parser';
import { LLMOptions, CleanupResult, LLMError } from '../types';
import type { LlamaEngine } from '../../engines/llama-engine';
import { postJson } from '../../engines/llama-server';
import { CLEANUP_RESPONSE_SCHEMA } from '../../engines/llama-args';

/** Generous: a 4B model on an older laptop CPU can take a while on long notes. */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Cleanup through the built-in llama.cpp engine. The engine is started on
 * demand (the first note after a pause waits for the model to load), and
 * the answer is grammar-constrained to the cleanup JSON schema, so small
 * models can't wander off-format.
 */
export class LocalLlamaProvider {
	private engine: LlamaEngine;

	constructor(engine: LlamaEngine) {
		this.engine = engine;
	}

	async process(rawTranscript: string, options: LLMOptions): Promise<CleanupResult> {
		const modelPath = options.localModelPath.trim();
		if (!modelPath) {
			throw new LLMError(
				'No cleanup model chosen yet. Open Settings → Tellme → Local model manager and download a cleanup model.',
				'local',
			);
		}
		if (!this.engine.isInstalled(options.localUseGpu)) {
			throw new LLMError(
				'The cleanup engine is not installed yet. Open Settings → Tellme → Cleanup and click "Download cleanup engine" (it also comes automatically with any cleanup model download).',
				'local',
			);
		}

		const startTime = Date.now();
		try {
			const endpoint = await this.engine.acquire(modelPath, options.localUseGpu);
			const response = await postJson(
				endpoint,
				'/v1/chat/completions',
				{
					messages: [
						{ role: 'system', content: options.systemPromptOverride || DEFAULT_SYSTEM_PROMPT },
						{ role: 'user', content: buildUserPrompt(rawTranscript) },
					],
					temperature: 0.2,
					response_format: {
						type: 'json_schema',
						json_schema: { name: 'cleanup', schema: CLEANUP_RESPONSE_SCHEMA },
					},
				},
				REQUEST_TIMEOUT_MS,
			);
			this.engine.touch();

			if (response.status < 200 || response.status >= 300) {
				throw new LLMError(
					`The cleanup engine returned an error (HTTP ${response.status}).`,
					'local',
				);
			}

			const body = response.body as { choices?: Array<{ message?: { content?: string } }> };
			const content = body?.choices?.[0]?.message?.content ?? '';
			const parsed = parseCleanupResponse(content, rawTranscript);

			return {
				cleanedText: parsed.cleanedText,
				routingIntent: parsed.routingIntent,
				rawTranscript,
				durationMs: Date.now() - startTime,
				provider: 'built-in (llama.cpp)',
			};
		} catch (error) {
			if (error instanceof LLMError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : 'Unknown error';
			throw new LLMError(`Built-in cleanup failed: ${message}`, 'local');
		}
	}
}
