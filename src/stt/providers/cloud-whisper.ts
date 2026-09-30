import { requestUrl } from 'obsidian';
import { buildMultipartFormData } from '../multipart';
import { STTOptions, STTResult, STTError } from '../types';
import { endpointFor, PROVIDER_BASE_URLS } from '../../providers/openai-compat';
import { withDeadline } from '../../models/progress-utils';

/** Long recordings take a while to upload; past this we stop waiting. */
const CLOUD_STT_TIMEOUT_MS = 180 * 1000;

export class CloudWhisperProvider {
	async transcribe(
		audioBuffer: ArrayBuffer,
		options: STTOptions,
	): Promise<STTResult> {
		const apiKey = options.apiKey.trim();
		if (!apiKey) {
			throw new STTError(
				`API key is missing for ${options.provider}. Please enter an API key in settings.`,
				options.provider,
			);
		}

		const endpointUrl = this.resolveEndpoint(options);
		const modelName = this.resolveModel(options);

		const fields = [
			{ name: 'model', value: modelName },
			{ name: 'response_format', value: 'json' },
		];

		if (options.language && options.language !== 'auto') {
			fields.push({ name: 'language', value: options.language });
		}

		const files = [
			{
				name: 'file',
				filename: 'tellme_audio.wav',
				contentType: 'audio/wav',
				data: audioBuffer,
			},
		];

		const multipart = buildMultipartFormData(fields, files);
		const startTime = Date.now();

		try {
			const response = await withDeadline(
				requestUrl({
					url: endpointUrl,
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': multipart.contentType,
					},
					body: multipart.body,
				}),
				CLOUD_STT_TIMEOUT_MS,
				`no answer from ${options.provider} after ${CLOUD_STT_TIMEOUT_MS / 1000} seconds`,
				window,
			);

			const durationMs = Date.now() - startTime;

			if (response.status < 200 || response.status >= 300) {
				throw new STTError(
					`Cloud transcription API returned status ${response.status}: ${response.text}`,
					options.provider,
				);
			}

			const data = response.json as { text?: string };
			if (!data || typeof data.text !== 'string') {
				throw new STTError(
					'Invalid response format from cloud STT provider (missing text field).',
					options.provider,
				);
			}

			return {
				text: data.text.trim(),
				durationMs,
				provider: options.provider,
			};
		} catch (error) {
			if (error instanceof STTError) {
				throw error;
			}
			const message =
				error instanceof Error ? error.message : 'Network/API request failed';
			throw new STTError(
				`Cloud STT request failed (${options.provider}): ${message}`,
				options.provider,
			);
		}
	}

	/** Custom URL may be a base (…/v1) or a full …/audio/transcriptions endpoint. */
	private resolveEndpoint(options: STTOptions): string {
		if (options.apiUrl && options.apiUrl.trim()) {
			return endpointFor(options.apiUrl, 'transcription');
		}
		const base = PROVIDER_BASE_URLS[options.provider] ?? PROVIDER_BASE_URLS.groq ?? '';
		return endpointFor(base, 'transcription');
	}

	private resolveModel(options: STTOptions): string {
		if (options.model && options.model.trim()) {
			return options.model.trim();
		}

		switch (options.provider) {
			case 'groq':
				return 'whisper-large-v3';
			case 'openai':
				return 'whisper-1';
			case 'openrouter':
				return 'openai/whisper-large-v3';
			default:
				return 'whisper-large-v3';
		}
	}
}
