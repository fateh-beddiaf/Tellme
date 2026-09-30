import type { HotkeyModifier } from '../settings.ts';

export interface HotkeyCombo {
	modifier: HotkeyModifier;
	key: string;
}

/**
 * Convert the plugin's settings vocabulary (modifier + key) into an
 * Electron Accelerator string (e.g. Ctrl+Space -> 'Control+Space').
 * Returns null when the combination cannot be represented or the key
 * is not a single letter, digit, or 'Space'.
 */
export function hotkeyToAccelerator(
	modifier: HotkeyModifier,
	key: string,
): string | null {
	const trimmedKey = key.trim().toLowerCase();

	let keyPart: string;
	if (trimmedKey === 'space') {
		keyPart = 'Space';
	} else if (/^[a-z0-9]$/.test(trimmedKey)) {
		keyPart = trimmedKey.toUpperCase();
	} else {
		return null;
	}

	switch (modifier) {
		case 'Alt':
			return `Alt+${keyPart}`;
		case 'Ctrl':
			return `Control+${keyPart}`;
		case 'Meta':
			return `Super+${keyPart}`;
		case 'Shift':
			return `Shift+${keyPart}`;
		case 'None':
			return keyPart;
		default:
			return null;
	}
}

/**
 * Case-insensitive comparison of two hotkey combos (used by the
 * double-fire guard when the global shortcut matches the in-app one).
 */
export function isSameCombo(a: HotkeyCombo, b: HotkeyCombo): boolean {
	return (
		a.modifier === b.modifier &&
		a.key.trim().toLowerCase() === b.key.trim().toLowerCase()
	);
}

/**
 * Rolling minimum-interval guard against OS keyboard auto-repeat.
 *
 * Windows RegisterHotKey (Electron globalShortcut) re-fires the callback
 * for as long as the combo is held: one fire at t=0, then a repeat delay
 * (250-1000 ms, default 500), then repeats every ~33 ms until release.
 * The guard must be ROLLING — the timestamp is updated on suppressed
 * events too — so each repeat re-arms the window and the whole train is
 * swallowed no matter how long the key is held. A fixed window measured
 * from the initial fire would let the first repeat (500 ms later) through.
 */
export class RollingRepeatGuard {
	// -Infinity so the very first event is never suppressed.
	private lastEventAt = Number.NEGATIVE_INFINITY;
	private readonly minIntervalMs: number;

	constructor(minIntervalMs: number) {
		this.minIntervalMs = minIntervalMs;
	}

	/** Returns true when this event counts as a new physical press. */
	shouldAccept(now: number): boolean {
		const suppressed = now - this.lastEventAt < this.minIntervalMs;
		this.lastEventAt = now;
		return !suppressed;
	}

	reset(): void {
		this.lastEventAt = Number.NEGATIVE_INFINITY;
	}
}
