export interface ParsedLLMResponse {
	cleanedText: string;
	routingIntent: string | null;
}

export function parseCleanupResponse(
	rawResponse: string,
	fallbackTranscript: string,
): ParsedLLMResponse {
	const trimmed = rawResponse.trim();
	if (!trimmed) {
		return {
			cleanedText: fallbackTranscript.trim(),
			routingIntent: null,
		};
	}

	// 1. Try extracting from markdown codeblock ```json ... ``` or ``` ... ```
	const codeblockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
	const candidateText = codeblockMatch ? codeblockMatch[1]?.trim() ?? trimmed : trimmed;

	// 2. Try parsing JSON
	try {
		// Attempt parsing the candidate text directly
		const parsed = JSON.parse(candidateText) as Record<string, unknown>;
		return extractValidFields(parsed, fallbackTranscript);
	} catch {
		// 3. Try finding the first '{' and last '}' substring in raw response
		const firstBrace = trimmed.indexOf('{');
		const lastBrace = trimmed.lastIndexOf('}');
		if (firstBrace !== -1 && lastBrace > firstBrace) {
			try {
				const jsonSlice = trimmed.substring(firstBrace, lastBrace + 1);
				const parsed = JSON.parse(jsonSlice) as Record<string, unknown>;
				return extractValidFields(parsed, fallbackTranscript);
			} catch {
				// Fallthrough to plain text fallback
			}
		}
	}

	// 4. Fallback: If model returned plain text without JSON structure, use the text
	const cleaned = trimmed.replace(/```(?:json)?|```/g, '').trim();
	return {
		cleanedText: cleaned || fallbackTranscript.trim(),
		routingIntent: null,
	};
}

function extractValidFields(
	parsed: Record<string, unknown>,
	fallbackTranscript: string,
): ParsedLLMResponse {
	let cleanedText = '';
	if (typeof parsed['cleaned_text'] === 'string') {
		cleanedText = parsed['cleaned_text'].trim();
	} else if (typeof parsed['cleanedText'] === 'string') {
		cleanedText = parsed['cleanedText'].trim();
	} else if (typeof parsed['text'] === 'string') {
		cleanedText = parsed['text'].trim();
	} else {
		cleanedText = fallbackTranscript.trim();
	}

	let routingIntent: string | null = null;
	const rawIntent = parsed['routing_intent'] ?? parsed['routingIntent'] ?? parsed['intent'];
	if (typeof rawIntent === 'string' && rawIntent.trim()) {
		const intentTrimmed = rawIntent.trim();
		if (intentTrimmed.toLowerCase() !== 'null' && intentTrimmed.toLowerCase() !== 'none') {
			routingIntent = intentTrimmed;
		}
	}

	return {
		cleanedText: cleanedText || fallbackTranscript.trim(),
		routingIntent,
	};
}
