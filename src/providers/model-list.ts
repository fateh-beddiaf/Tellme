import { requestUrl } from 'obsidian';
import {
	candidateBases,
	describeHttpFailure,
	filterModels,
	parseModelIds,
	PROVIDER_BASE_URLS,
	type ApiPurpose,
} from './openai-compat';
import { withDeadline } from '../models/progress-utils';

/** A model list answers in well under a second; a silent server shouldn't hang the button. */
const MODEL_LIST_TIMEOUT_MS = 20 * 1000;

export interface ModelListResult {
	ok: boolean;
	/** Models that fit the purpose (see filterModels). */
	models: string[];
	/** The base URL that answered — for custom providers, save this. */
	baseUrl: string;
	/** Plain-language status for the user. */
	message: string;
}

/**
 * Connect to a provider and list its models. For custom providers every
 * likely base URL is tried (the user may have pasted only the site address),
 * and the one that works is returned so the settings can be corrected.
 * Never throws; the API key is never included in messages.
 */
export async function discoverModels(
	provider: string,
	customUrl: string,
	apiKey: string,
	purpose: ApiPurpose,
): Promise<ModelListResult> {
	const builtIn = PROVIDER_BASE_URLS[provider];
	const bases = provider === 'custom' ? candidateBases(customUrl) : builtIn ? [builtIn] : [];
	if (bases.length === 0) {
		return { ok: false, models: [], baseUrl: '', message: 'Enter the provider URL first.' };
	}
	if (!apiKey.trim() && provider !== 'openrouter') {
		return { ok: false, models: [], baseUrl: '', message: 'Enter your API key first.' };
	}

	let failure = '';
	for (const baseUrl of bases) {
		const result = await tryList(`${baseUrl}/models`, apiKey);
		if (result.ids) {
			const models = filterModels(result.ids, purpose);
			return {
				ok: true,
				models,
				baseUrl,
				message: `Connected — ${models.length} model${models.length === 1 ? '' : 's'} available.`,
			};
		}
		// Remember the first real answer; later guesses mostly produce 404s.
		failure ||= result.failure;
	}

	// Gemini: fall back to Google's native model list if the OpenAI one fails.
	if (provider === 'gemini') {
		const native = await tryList(
			`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`,
			'',
		);
		if (native.ids) {
			const models = filterModels(native.ids, purpose);
			return {
				ok: true,
				models,
				baseUrl: builtIn ?? '',
				message: `Connected — ${models.length} models available.`,
			};
		}
	}

	return {
		ok: false,
		models: [],
		baseUrl: '',
		message: `Could not connect: ${failure || 'no answer from the server'}.`,
	};
}

async function tryList(url: string, apiKey: string): Promise<{ ids?: string[]; failure: string }> {
	try {
		const response = await withDeadline(
			requestUrl({
				url,
				method: 'GET',
				headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {},
				throw: false,
			}),
			MODEL_LIST_TIMEOUT_MS,
			'timeout',
			window,
		);
		if (response.status >= 200 && response.status < 300) {
			let body: unknown = null;
			try {
				body = response.json;
			} catch {
				// not JSON
			}
			const ids = parseModelIds(body);
			if (ids.length > 0) {
				return { ids, failure: '' };
			}
			return { failure: 'the server answered, but not with a model list. Check the URL' };
		}
		return { failure: describeHttpFailure(response.status) };
	} catch {
		const host = safeHost(url);
		return { failure: `couldn't reach ${host}. Check the address and your internet connection` };
	}
}

function safeHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return 'the server';
	}
}
