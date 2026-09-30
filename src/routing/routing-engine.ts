import type {
	RoutingResult,
	RoutingOptions,
	VaultItem,
} from './types.ts';
import { findHighlightMatch, findBestVaultMatch } from './matcher.ts';

export class RoutingEngine {
	resolve(
		cleanedText: string,
		routingIntent: string | null,
		vaultItems: VaultItem[],
		options: RoutingOptions,
		rawTranscript = '',
	): RoutingResult {
		const defaultFolder = (options.defaultFolder || 'tellme').trim().replace(/^[./\\]+|[./\\]+$/g, '');

		// Step 1: Explicit path / intent spoken in this recording (from Stage 2 LLM output)
		if (routingIntent && routingIntent.trim()) {
			const intentTrimmed = routingIntent.trim();

			// Check if intent matches an indexed folder or file in the vault
			const vaultMatch = findBestVaultMatch(intentTrimmed, vaultItems, 0.65);
			if (vaultMatch) {
				return {
					targetPath: vaultMatch.item.path,
					targetType: vaultMatch.item.type,
					status: 'resolved',
					matchSource: 'explicit_intent',
					matchedQuery: intentTrimmed,
					confidence: vaultMatch.confidence,
				};
			}

			// If intent was stated explicitly but not yet created in the vault tree,
			// treat the explicit path as a valid resolved destination folder
			const sanitizedPath = intentTrimmed.replace(/[\\:*?"<>|]/g, '').trim();
			if (sanitizedPath) {
				return {
					targetPath: sanitizedPath,
					targetType: 'folder',
					status: 'resolved',
					matchSource: 'explicit_intent',
					matchedQuery: intentTrimmed,
					confidence: 0.9,
				};
			}
		}

		// Step 2: Matching Highlight Keyword from the user's configured table
		const keywords = options.highlightKeywords || [];
		if (keywords.length > 0) {
			const match =
				findHighlightMatch(cleanedText, keywords) ||
				(rawTranscript ? findHighlightMatch(rawTranscript, keywords) : null);

			if (match) {
				const target = match.targetPath.trim();
				const isFile = target.toLowerCase().endsWith('.md');
				return {
					targetPath: target,
					targetType: isFile ? 'file' : 'folder',
					status: 'resolved',
					matchSource: 'highlight_keyword',
					matchedQuery: match.keyword,
					confidence: 1.0,
				};
			}
		}

		// Step 3: Fuzzy match against vault folder/file name tree (names only - never content)
		if (vaultItems.length > 0 && cleanedText.trim()) {
			// Extract first sentence or first line as primary subject
			const firstLine = cleanedText.split(/[\n.?!]/)[0]?.trim() || '';
			const candidateQuery = firstLine.length > 3 ? firstLine : cleanedText.trim();

			const bestMatch = findBestVaultMatch(candidateQuery, vaultItems, 0.6);
			if (bestMatch) {
				return {
					targetPath: bestMatch.item.path,
					targetType: bestMatch.item.type,
					status: 'resolved',
					matchSource: 'vault_tree',
					matchedQuery: candidateQuery,
					confidence: bestMatch.confidence,
				};
			}
		}

		// Step 4: Fallback to tellme/ root folder with routing_status: unresolved
		return {
			targetPath: defaultFolder || 'tellme',
			targetType: 'folder',
			status: 'unresolved',
			matchSource: 'fallback',
			confidence: 0,
		};
	}
}
