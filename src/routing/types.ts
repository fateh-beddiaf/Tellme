export type RoutingStatus = 'resolved' | 'unresolved';

export type RoutingMatchSource =
	| 'explicit_intent'
	| 'highlight_keyword'
	| 'vault_tree'
	| 'fallback';

export type WriteMode = 'append' | 'new_file';

export interface HighlightKeywordConfig {
	keyword: string;
	targetPath: string;
}

export interface VaultItem {
	path: string;
	name: string;
	type: 'folder' | 'file';
	tokens: string[];
}

export interface RoutingResult {
	targetPath: string;
	targetType: 'folder' | 'file';
	status: RoutingStatus;
	matchSource: RoutingMatchSource;
	matchedQuery?: string;
	confidence: number;
}

export interface RoutingOptions {
	defaultFolder: string;
	highlightKeywords?: HighlightKeywordConfig[];
}

export interface WriteNoteResult {
	filePath: string;
	created: boolean;
	status: RoutingStatus;
	durationMs: number;
}
