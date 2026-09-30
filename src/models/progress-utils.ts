/**
 * Pure helpers for the model manager UI (no Obsidian/DOM imports, so they
 * are unit-testable under the node test runner).
 */

/**
 * Decides when a download progress event is worth painting.
 *
 * Downloads report progress per network chunk (tens of thousands of events
 * for a large model). Painting only when the whole-number percentage
 * changes, or at most every `minIntervalMs`, keeps the UI smooth; the
 * first event and 100% are always painted.
 */
export class ProgressThrottle {
	private lastPercentage = -1;
	private lastEmitAt = Number.NEGATIVE_INFINITY;
	private readonly minIntervalMs: number;

	constructor(minIntervalMs = 250) {
		this.minIntervalMs = minIntervalMs;
	}

	shouldEmit(percentage: number, now: number): boolean {
		const pct = Math.floor(percentage);
		const changed = pct !== this.lastPercentage;
		const due = now - this.lastEmitAt >= this.minIntervalMs;
		if (pct >= 100 || (changed && due) || this.lastPercentage < 0) {
			this.lastPercentage = pct;
			this.lastEmitAt = now;
			return true;
		}
		return false;
	}
}

/** Timer functions, injected so this module runs in Obsidian (window) and in node tests. */
export interface TimerApi {
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(id: never): void;
}

/**
 * Reject with `message` if `promise` hasn't settled within `timeoutMs`.
 * Obsidian's requestUrl has no timeout and can't be cancelled, so without
 * this a provider that never answers would stall the pipeline forever and
 * the note would never be written. (The request itself may keep running in
 * the background; we just stop waiting for it.)
 */
export async function withDeadline<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
	timers: TimerApi,
): Promise<T> {
	let timer: unknown;
	const deadline = new Promise<never>((_, reject) => {
		timer = timers.setTimeout(() => reject(new Error(message)), timeoutMs);
	});
	try {
		return await Promise.race([promise, deadline]);
	} finally {
		timers.clearTimeout(timer as never);
	}
}

/**
 * Resolve `promise`, or `fallback` if it takes longer than `timeoutMs`.
 * Used so an unreachable local server (e.g. Ollama not installed) can never
 * hold up rendering of the model list.
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	fallback: T,
	timers: TimerApi,
): Promise<T> {
	let timer: unknown;
	const timeout = new Promise<T>((resolve) => {
		timer = timers.setTimeout(() => resolve(fallback), timeoutMs);
	});
	try {
		return await Promise.race([promise.catch(() => fallback), timeout]);
	} finally {
		timers.clearTimeout(timer as never);
	}
}
