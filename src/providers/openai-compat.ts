/**
 * Pure helpers for OpenAI-compatible providers (Groq, OpenAI, OpenRouter,
 * Gemini's OpenAI endpoint, and any "custom" server). No Obsidian/Node
 * imports so they are unit-testable.
 *
 * Users paste all kinds of URLs: a base (`https://api.x.com/v1`), a full
 * endpoint (`…/chat/completions`), or just the site (`https://api.x.com`).
 * These helpers turn any of them into the exact request URLs.
 */

export type ApiPurpose = 'chat' | 'transcription';

const PURPOSE_SUFFIX: Record<ApiPurpose, string> = {
	chat: '/chat/completions',
	transcription: '/audio/transcriptions',
};

/** Paths people paste that are not part of the base URL. */
const KNOWN_SUFFIXES = ['/chat/completions', '/audio/transcriptions', '/completions', '/models'];

/** Base URLs of the built-in cloud providers. */
export const PROVIDER_BASE_URLS: Record<string, string> = {
	groq: 'https://api.groq.com/openai/v1',
	openai: 'https://api.openai.com/v1',
	openrouter: 'https://openrouter.ai/api/v1',
	gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

/** Add https:// when the user typed just "api.example.com/v1". */
function withScheme(input: string): string {
	const trimmed = input.trim();
	return trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

/** Strip trailing slashes and any known endpoint path, leaving the base URL. */
export function toBaseUrl(input: string): string {
	let url = withScheme(input).replace(/\/+$/, '');
	const query = url.indexOf('?');
	if (query >= 0) {
		url = url.slice(0, query).replace(/\/+$/, '');
	}
	for (const suffix of KNOWN_SUFFIXES) {
		if (url.toLowerCase().endsWith(suffix)) {
			return url.slice(0, -suffix.length).replace(/\/+$/, '');
		}
	}
	return url;
}

/**
 * The URL to call for this purpose. A URL that already ends in the right
 * endpoint path is used verbatim (keeps query strings such as Azure's
 * `?api-version=`); anything else is treated as a base URL.
 */
export function endpointFor(input: string, purpose: ApiPurpose): string {
	const trimmed = withScheme(input).replace(/\/+$/, '');
	const path = trimmed.split('?')[0]?.replace(/\/+$/, '').toLowerCase() ?? '';
	if (path.endsWith(PURPOSE_SUFFIX[purpose])) {
		return trimmed;
	}
	return `${toBaseUrl(trimmed)}${PURPOSE_SUFFIX[purpose]}`;
}

/**
 * Base URLs worth trying for a custom provider, most likely first: what the
 * user typed, then the common versioned paths (`/v1`, `/api/v1`, …).
 */
export function candidateBases(input: string): string[] {
	const base = toBaseUrl(input);
	if (!base) {
		return [];
	}
	const candidates = [base];
	if (!/\/v\d+[a-z0-9]*$/i.test(base)) {
		candidates.push(`${base}/v1`, `${base}/api/v1`, `${base}/openai/v1`);
	}
	return [...new Set(candidates)];
}

/** Model IDs from an OpenAI-style (`data[].id`) or Gemini-style (`models[].name`) list. */
export function parseModelIds(body: unknown): string[] {
	const ids: string[] = [];
	const record = (body ?? {}) as { data?: unknown; models?: unknown };
	const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
	for (const item of list as Array<{ id?: unknown; name?: unknown }>) {
		const raw = typeof item?.id === 'string' ? item.id : typeof item?.name === 'string' ? item.name : '';
		const id = raw.replace(/^models\//, '').trim();
		if (id) {
			ids.push(id);
		}
	}
	return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

const TRANSCRIPTION_HINT = /whisper|transcri|speech-to-text|\bstt\b/i;
const NOT_CHAT_HINT = /whisper|transcri|\btts\b|text-to-speech|embed|moderation|dall-e|image|rerank|guard/i;

/**
 * Keep the models that fit the job (speech models for transcription, chat
 * models for cleanup). If the heuristic would hide everything, show all —
 * better an unfiltered list than an empty one.
 */
export function filterModels(ids: string[], purpose: ApiPurpose): string[] {
	const filtered =
		purpose === 'transcription'
			? ids.filter((id) => TRANSCRIPTION_HINT.test(id))
			: ids.filter((id) => !NOT_CHAT_HINT.test(id));
	return filtered.length > 0 ? filtered : ids;
}

/** Plain-language reason for a failed model-list request. */
export function describeHttpFailure(status: number): string {
	if (status === 401 || status === 403) {
		return `the server refused the API key (HTTP ${status}). Check the key — and for a custom provider, the address`;
	}
	if (status === 404) {
		return 'no model list was found at this address (HTTP 404). Check the URL';
	}
	if (status === 429) {
		return 'the provider says too many requests (HTTP 429). Wait a moment and try again';
	}
	if (status >= 500) {
		return `the provider had a server error (HTTP ${status}). Try again later`;
	}
	return `unexpected answer from the server (HTTP ${status})`;
}
