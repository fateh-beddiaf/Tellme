import type { VaultItem, HighlightKeywordConfig } from './types.ts';

export function tokenize(text: string): string[] {
	if (!text) {
		return [];
	}
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
		.split(/[\s_/-]+/)
		.map((t) => t.trim())
		.filter((t) => t.length >= 2);
}

export function escapeRegex(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_WORDS = [
	'path',
	'highlight',
	'folder',
	'مسار',
	'مجلد',
	'هايلايت',
];

function normalizePhrase(phrase: string): string {
	return phrase
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

export function findTriggerKeywordMatch(
	text: string,
	keywords: HighlightKeywordConfig[],
): HighlightKeywordConfig | null {
	if (!text || !keywords || keywords.length === 0) {
		return null;
	}

	const triggersPattern = TRIGGER_WORDS.map(escapeRegex).join('|');
	const triggerRegex = new RegExp(
		`(?:^|[\\s\\p{P}])(${triggersPattern})(?:[\\s\\p{P}]|[:\\-–—]+|$)`,
		'giu',
	);

	let match: RegExpExecArray | null;
	while ((match = triggerRegex.exec(text)) !== null) {
		const triggerWord = match[1];
		if (!triggerWord) {
			continue;
		}

		const afterIndex = match.index + match[0].length;
		const followingText = text.substring(afterIndex).trim();
		if (!followingText) {
			continue;
		}

		// Split following text into up to 3 words
		const words = followingText
			.split(/[\s\p{P}]+/u)
			.filter(Boolean)
			.slice(0, 3);

		if (words.length === 0) {
			continue;
		}

		// Try longest candidate first (3 words, then 2 words, then 1 word)
		for (let len = Math.min(words.length, 3); len >= 1; len--) {
			const candidate = normalizePhrase(words.slice(0, len).join(' '));
			if (!candidate) {
				continue;
			}

			for (const config of keywords) {
				const normalizedKw = normalizePhrase(config.keyword);
				if (normalizedKw && normalizedKw === candidate) {
					return config;
				}
			}
		}
	}

	return null;
}

export function findHighlightMatch(
	text: string,
	keywords: HighlightKeywordConfig[] = [],
): HighlightKeywordConfig | null {
	if (!text || !keywords || keywords.length === 0) {
		return null;
	}

	const validConfigs = keywords.filter((k) => k.keyword && k.keyword.trim().length > 0);
	if (validConfigs.length === 0) {
		return null;
	}

	// 1. Try Trigger-Word Detection with 3-word lookahead
	const triggerMatch = findTriggerKeywordMatch(text, validConfigs);
	if (triggerMatch) {
		return triggerMatch;
	}

	// 2. Direct Keyword Matching (strict word boundaries, longest phrase first)
	const sorted = [...validConfigs].sort(
		(a, b) => b.keyword.trim().length - a.keyword.trim().length,
	);

	for (const config of sorted) {
		const kw = config.keyword.trim();
		if (!kw) {
			continue;
		}

		// Enforce word boundaries using Unicode-aware whitespace/punctuation or start/end
		const regex = new RegExp(`(?:^|[\\s\\p{P}])${escapeRegex(kw)}(?:[\\s\\p{P}]|$)`, 'iu');
		if (regex.test(text)) {
			return config;
		}
	}

	return null;
}

export function calculateSimilarity(
	query: string,
	target: string,
	queryTokens?: string[],
	targetTokens?: string[],
): number {
	const q = query.trim().toLowerCase();
	const t = target.trim().toLowerCase();

	if (!q || !t) {
		return 0;
	}

	// 1. Exact match
	if (q === t) {
		return 1.0;
	}

	// 2. Normalized path suffix/prefix match
	const qClean = q.replace(/^[./\\]+|[./\\]+$/g, '');
	const tClean = t.replace(/^[./\\]+|[./\\]+$/g, '');
	if (qClean === tClean) {
		return 0.98;
	}
	if (tClean.endsWith('/' + qClean) || tClean.startsWith(qClean + '/')) {
		return 0.92;
	}

	// 3. Substring containment
	if (tClean.includes(qClean) || qClean.includes(tClean)) {
		const ratio = Math.min(qClean.length, tClean.length) / Math.max(qClean.length, tClean.length);
		return 0.75 + 0.15 * ratio;
	}

	// 4. Token overlap (Jaccard similarity)
	const qToks = queryTokens ?? tokenize(q);
	const tToks = targetTokens ?? tokenize(t);

	if (qToks.length > 0 && tToks.length > 0) {
		const tSet = new Set(tToks);
		let intersection = 0;
		for (const tok of qToks) {
			if (tSet.has(tok)) {
				intersection++;
			}
		}

		if (intersection > 0) {
			const jaccard = (2 * intersection) / (qToks.length + tToks.length);
			// Full query token containment bonus
			if (intersection === qToks.length) {
				return 0.75 + 0.15 * jaccard;
			}
			return 0.5 + 0.35 * jaccard;
		}
	}

	// 5. Levenshtein edit distance for short strings
	if (qClean.length < 20 && tClean.length < 20) {
		const dist = levenshteinDistance(qClean, tClean);
		const maxLen = Math.max(qClean.length, tClean.length);
		const sim = 1 - dist / maxLen;
		if (sim >= 0.7) {
			return sim * 0.85;
		}
	}

	return 0;
}

export function findBestVaultMatch(
	query: string,
	items: VaultItem[],
	minConfidence = 0.6,
): { item: VaultItem; confidence: number } | null {
	if (!query || !items || items.length === 0) {
		return null;
	}

	const queryTokens = tokenize(query);
	const scored: Array<{ item: VaultItem; score: number }> = [];

	for (const item of items) {
		// Score against both item path and item name
		const pathScore = calculateSimilarity(query, item.path, queryTokens, item.tokens);
		const nameScore = calculateSimilarity(query, item.name, queryTokens, item.tokens);
		const score = Math.max(pathScore, nameScore);

		if (score >= minConfidence) {
			scored.push({ item, score });
		}
	}

	if (scored.length === 0) {
		return null;
	}

	// Sort descending
	scored.sort((a, b) => b.score - a.score);

	const top = scored[0];
	if (!top) {
		return null;
	}

	// Disambiguation: If there's a tie between two distinct targets with high confidence,
	// consider it ambiguous to prevent routing into the wrong folder.
	if (scored.length > 1) {
		const second = scored[1];
		if (second && Math.abs(top.score - second.score) < 0.05 && top.item.path !== second.item.path) {
			// Ambiguous match -> safe fallback
			return null;
		}
	}

	return { item: top.item, confidence: top.score };
}

function levenshteinDistance(a: string, b: string): number {
	const matrix: number[][] = [];
	for (let i = 0; i <= b.length; i++) {
		matrix[i] = [i];
	}
	for (let j = 0; j <= a.length; j++) {
		const row = matrix[0];
		if (row) {
			row[j] = j;
		}
	}

	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
			const rowPrev = matrix[i - 1];
			const rowCurr = matrix[i];
			if (rowPrev && rowCurr) {
				const valAbove = rowPrev[j] ?? 0;
				const valLeft = rowCurr[j - 1] ?? 0;
				const valDiag = rowPrev[j - 1] ?? 0;
				rowCurr[j] = Math.min(
					valAbove + 1,
					valLeft + 1,
					valDiag + cost,
				);
			}
		}
	}

	const lastRow = matrix[b.length];
	return lastRow ? (lastRow[a.length] ?? 0) : 0;
}
