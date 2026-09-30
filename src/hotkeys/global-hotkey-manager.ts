import * as electron from 'electron';
import { Notice } from 'obsidian';
import { hotkeyToAccelerator, RollingRepeatGuard } from './accelerator.ts';
import type { HotkeyModifier } from '../settings.ts';

/**
 * Minimum gap between two accepted global-hotkey fires. Windows re-fires
 * the shortcut while the combo is held (auto-repeat: ~500 ms delay, then
 * ~33 ms between repeats). 600 ms swallows the entire repeat train on
 * default Windows settings; the slowest Windows repeat-delay setting
 * (1000 ms) can let exactly ONE extra fire through per hold — accepted
 * trade-off, since anything longer delays genuine rapid double-presses.
 */
const MIN_FIRE_INTERVAL_MS = 600;

/**
 * Manages an OS-wide global shortcut via Electron's globalShortcut.
 * Global shortcuts fire on keydown only (no release events), so the
 * callback always uses toggle semantics regardless of the plugin's
 * recordingMode setting. The RollingRepeatGuard suppresses the OS
 * auto-repeat train so holding the combo toggles only once.
 */
export class GlobalHotkeyManager {
	private activeAccelerator: string | null = null;
	private onToggle: () => void;
	private repeatGuard = new RollingRepeatGuard(MIN_FIRE_INTERVAL_MS);
	private lastAcceptedAt = 0;

	constructor(onToggle: () => void) {
		this.onToggle = onToggle;
	}

	private get globalShortcut(): electron.RemoteGlobalShortcut | undefined {
		try {
			return electron?.remote?.globalShortcut;
		} catch {
			return undefined;
		}
	}

	isActive(): boolean {
		return this.activeAccelerator !== null;
	}

	/**
	 * Register the given combo as a global shortcut. Returns true on
	 * success; on failure shows a user-visible Notice and stays inactive.
	 */
	enable(modifier: HotkeyModifier, key: string): boolean {
		const shortcut = this.globalShortcut;
		if (!shortcut) {
			new Notice(
				'Global hotkeys are not supported in this environment (electron remote unavailable).',
			);
			return false;
		}

		const accelerator = hotkeyToAccelerator(modifier, key);
		if (!accelerator) {
			new Notice(
				`Invalid global hotkey: "${modifier} + ${key}". Use a single letter, digit, or "Space".`,
			);
			return false;
		}

		this.disable();
		this.repeatGuard.reset();
		this.lastAcceptedAt = 0;

		let registered = false;
		try {
			registered = shortcut.register(accelerator, () => {
				// Rolling guard: swallows the auto-repeat train while the
				// combo is held (timestamp updated on suppressed fires too).
				if (!this.repeatGuard.shouldAccept(Date.now())) {
					return;
				}
				this.lastAcceptedAt = Date.now();
				this.onToggle();
			});
		} catch {
			registered = false;
		}

		if (!registered) {
			new Notice(
				`Could not register "${accelerator}" as a global hotkey — it may already be taken by another app.`,
			);
			return false;
		}

		this.activeAccelerator = accelerator;
		return true;
	}

	/** Unregister the currently held accelerator (never touches other plugins' shortcuts). */
	disable(): void {
		if (!this.activeAccelerator) {
			return;
		}
		const accelerator = this.activeAccelerator;
		this.activeAccelerator = null;
		try {
			this.globalShortcut?.unregister(accelerator);
		} catch {
			// Best effort cleanup
		}
	}

	/**
	 * True when an ACCEPTED (non-auto-repeat) OS-level fire happened
	 * within the given window — used by the in-app DOM listener to avoid
	 * double-toggling when the global combo equals the in-app combo and
	 * Obsidian is focused. Suppressed repeat fires do not count.
	 */
	firedRecently(withinMs = 500): boolean {
		return Date.now() - this.lastAcceptedAt < withinMs;
	}
}
