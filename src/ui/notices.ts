import { Notice } from 'obsidian';

/**
 * A green "it worked" notice (connection OK). Styled via
 * `.notice:has(.tellme-notice-success)` in styles.css, so it needs no
 * newer-than-minAppVersion Notice API.
 */
export function showSuccessNotice(message: string, durationMs = 3000): void {
	const fragment = createFragment();
	fragment.createSpan({ text: `✓ ${message}`, cls: 'tellme-notice-success' });
	new Notice(fragment, durationMs);
}

/** The small green "Saved" confirmation shown after a settings change. */
export function showSavedNotice(): Notice {
	const fragment = createFragment();
	fragment.createSpan({ text: '✓ Saved', cls: 'tellme-notice-saved' });
	return new Notice(fragment, 1200);
}
