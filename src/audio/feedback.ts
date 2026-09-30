/**
 * Start/stop recording feedback: a soft two-tone chime (Web Audio,
 * no audio files shipped) and a best-effort system notification that
 * fires only while the Obsidian window is unfocused/minimized.
 * Every method is failure-safe: feedback must never break recording.
 */
export class FeedbackService {
	private audioCtx: AudioContext | null = null;

	private ensureAudioContext(): AudioContext | null {
		try {
			if (!this.audioCtx) {
				const Ctx =
					window.AudioContext ??
					(window as unknown as { webkitAudioContext?: typeof AudioContext })
						.webkitAudioContext;
				if (!Ctx) {
					return null;
				}
				this.audioCtx = new Ctx();
			}
			return this.audioCtx;
		} catch {
			return null;
		}
	}

	/** Play one soft sine note at the given frequency and start offset. */
	private playNote(
		ctx: AudioContext,
		frequency: number,
		startOffsetSec: number,
		durationSec: number,
	): void {
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();

		oscillator.type = 'sine';
		oscillator.frequency.value = frequency;

		const startTime = ctx.currentTime + startOffsetSec;
		// Gentle attack/release envelope keeps the chime soft rather than a click.
		gain.gain.setValueAtTime(0.0001, startTime);
		gain.gain.exponentialRampToValueAtTime(0.15, startTime + 0.01);
		gain.gain.exponentialRampToValueAtTime(
			0.0001,
			startTime + durationSec,
		);

		oscillator.connect(gain);
		gain.connect(ctx.destination);
		oscillator.start(startTime);
		oscillator.stop(startTime + durationSec);
	}

	/** Rising two-note chime: recording started. */
	playStart(): void {
		try {
			const ctx = this.ensureAudioContext();
			if (!ctx) {
				return;
			}
			this.playNote(ctx, 520, 0, 0.12);
			this.playNote(ctx, 780, 0.1, 0.14);
		} catch {
			// Sound is best-effort
		}
	}

	/** Falling two-note chime: recording stopped. */
	playStop(): void {
		try {
			const ctx = this.ensureAudioContext();
			if (!ctx) {
				return;
			}
			this.playNote(ctx, 780, 0, 0.12);
			this.playNote(ctx, 520, 0.1, 0.14);
		} catch {
			// Sound is best-effort
		}
	}

	/**
	 * System notification — only while the window is unfocused, so it
	 * complements (rather than duplicates) the in-app Notice.
	 */
	private notify(body: string): void {
		try {
			if (document.hasFocus() && !document.hidden) {
				return;
			}
			if (typeof Notification !== 'function' || Notification.permission === 'denied') {
				return;
			}
			new Notification('Tellme', { body });
		} catch {
			// Notifications are best-effort
		}
	}

	notifyStart(): void {
		this.notify('Recording started (Tellme)');
	}

	notifyStop(): void {
		this.notify('Recording stopped (Tellme)');
	}

	/** Request notification permission once (best-effort, ignored if unsupported). */
	static requestPermission(): void {
		try {
			if (typeof Notification === 'function' && Notification.permission === 'default') {
				Notification.requestPermission().catch(() => {
					// Best-effort
				});
			}
		} catch {
			// Best-effort
		}
	}

	/** Release the AudioContext (called from plugin unload). */
	close(): void {
		const ctx = this.audioCtx;
		this.audioCtx = null;
		if (ctx) {
			ctx.close().catch(() => {
				// Best effort
			});
		}
	}
}
