import {
	normalizePath,
	Notice,
	Platform,
	Plugin,
	TFolder,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	TellmeSettings,
	TellmeSettingTab,
} from './settings';
import { AudioRecorder, RecordingResult } from './audio/recorder';
import { FeedbackService } from './audio/feedback';
import { STTService } from './stt/stt-service';
import { STTResult, STTError } from './stt/types';
import { CleanupService } from './cleanup/cleanup-service';
import { CleanupResult, LLMError } from './cleanup/types';
import { VaultIndexer } from './routing/vault-indexer';
import { RoutingEngine } from './routing/routing-engine';
import { NoteWriter } from './routing/note-writer';
import { RoutingResult, WriteNoteResult } from './routing/types';
import { ModelManager } from './models/model-manager';
import { WhisperEngine } from './engines/whisper-engine';
import { LlamaEngine } from './engines/llama-engine';
import type { ModelDownloadProgress } from './models/types';
import { DownloadNotice } from './models/download-notice';
import { ProgressThrottle } from './models/progress-utils';
import { GlobalHotkeyManager } from './hotkeys/global-hotkey-manager';
import { isSameCombo } from './hotkeys/accelerator';
import type { HotkeyCombo } from './hotkeys/accelerator';

export default class TellmePlugin extends Plugin {
	settings!: TellmeSettings;
	recorder!: AudioRecorder;
	sttService!: STTService;
	cleanupService!: CleanupService;
	vaultIndexer!: VaultIndexer;
	routingEngine!: RoutingEngine;
	noteWriter!: NoteWriter;
	modelManager!: ModelManager;
	whisperEngine!: WhisperEngine;
	llamaEngine!: LlamaEngine;
	globalHotkeyManager!: GlobalHotkeyManager;
	feedbackService!: FeedbackService;
	statusBarItemEl!: HTMLElement;
	lastRecordingResult: RecordingResult | null = null;
	lastSTTResult: STTResult | null = null;
	lastCleanupResult: CleanupResult | null = null;
	lastRoutingResult: RoutingResult | null = null;
	lastWriteResult: WriteNoteResult | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.recorder = new AudioRecorder();
		this.sttService = new STTService();
		this.vaultIndexer = new VaultIndexer(this.app);
		this.routingEngine = new RoutingEngine();
		this.noteWriter = new NoteWriter(this.app);
		this.modelManager = new ModelManager(this.app);
		this.whisperEngine = new WhisperEngine(this.modelManager);
		this.llamaEngine = new LlamaEngine(this.modelManager);
		this.cleanupService = new CleanupService(this.llamaEngine);
		// A crash can leave the cleanup engine running (Windows doesn't kill
		// child processes with their parent) — reap it, and stop ours if the
		// window closes without a normal plugin unload.
		void this.llamaEngine.cleanupOrphan();
		this.registerDomEvent(window, 'beforeunload', () => this.llamaEngine.stop());
		this.feedbackService = new FeedbackService();
		this.globalHotkeyManager = new GlobalHotkeyManager(() => {
			void this.toggleRecording();
		});

		// Add settings tab
		this.addSettingTab(new TellmeSettingTab(this.app, this));

		// Status bar item for recording indicator
		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar('');

		// Register native commands
		this.addCommand({
			id: 'toggle-recording',
			name: 'Toggle voice recording',
			callback: async () => {
				await this.toggleRecording();
			},
		});

		this.addCommand({
			id: 'start-recording',
			name: 'Start voice recording',
			callback: async () => {
				await this.startRecording();
			},
		});

		this.addCommand({
			id: 'stop-recording',
			name: 'Stop voice recording',
			callback: async () => {
				await this.stopRecording();
			},
		});

		// Register in-focus keyboard listener
		this.registerHotkeyListeners();

		// Register the OS-wide global shortcut when enabled (toggle semantics)
		this.applyGlobalHotkeySettings();

		// Ensure fallback folder exists
		await this.ensureDefaultFolder();
	}

	onunload(): void {
		this.llamaEngine?.stop();
		this.globalHotkeyManager?.disable();
		this.feedbackService?.close();
		if (this.recorder?.isRecording()) {
			this.recorder.cancel();
		}
	}

	/**
	 * Apply (or re-apply / disable) the global hotkey after any change to
	 * the globalHotkey* settings. Safe to call repeatedly.
	 */
	/**
	 * Make sure a whisper.cpp program is available, downloading the official
	 * build (with a progress pop-up) when needed. Returns true when ready.
	 * Never throws: failures are shown to the user in the pop-up/notice.
	 */
	async ensureWhisperEngine(): Promise<boolean> {
		const engine = this.whisperEngine;
		if (engine.resolveCliPath(this.settings.whisperCliPath)) {
			return true;
		}
		if (engine.isInstalling()) {
			// Another caller already shows the progress pop-up.
			await engine.install().catch(() => undefined);
			return engine.resolveCliPath(this.settings.whisperCliPath) !== null;
		}
		if (!engine.getAsset()) {
			new Notice(
				process.platform === 'darwin'
					? 'One more step on Mac: install the speech engine once in Terminal with "brew install whisper-cpp", then record again.'
					: 'No ready-made speech engine exists for this computer. Set your own whisper.cpp program under Settings → Transcription → Advanced.',
				15000,
			);
			return false;
		}

		return this.installWithNotice('speech engine', engine.releaseName, (onProgress) =>
			engine.install(onProgress),
		);
	}

	/**
	 * Make sure the cleanup engine (llama.cpp) for the current GPU setting is
	 * installed, downloading it with a progress pop-up when needed.
	 * Returns true when ready. Never throws.
	 */
	async ensureLlamaEngine(): Promise<boolean> {
		const engine = this.llamaEngine;
		const useGpu = this.settings.localLlmUseGpu;
		if (engine.isInstalled(useGpu)) {
			return true;
		}
		if (engine.isInstalling()) {
			await engine.install(useGpu).catch(() => undefined);
			return engine.isInstalled(useGpu);
		}
		if (!engine.getAsset(useGpu)) {
			new Notice(
				`No ready-made cleanup engine exists for this computer (${process.platform}-${process.arch}). Choose Ollama or a cloud provider under Settings → Cleanup.`,
				15000,
			);
			return false;
		}
		return this.installWithNotice('cleanup engine', engine.releaseName, (onProgress) =>
			engine.install(useGpu, onProgress),
		);
	}

	/** Shared download pop-up for engine installs. */
	private async installWithNotice(
		label: string,
		releaseName: string,
		install: (onProgress: (progress: ModelDownloadProgress) => void) => Promise<string>,
	): Promise<boolean> {
		const notice = new DownloadNotice(`${label} (${releaseName})`);
		const throttle = new ProgressThrottle();
		try {
			await install((progress) => {
				// Verify/unpack steps share 99%, so always show a new step.
				const newStep = !progress.statusText.startsWith('Downloading');
				if (newStep || throttle.shouldEmit(progress.percentage, Date.now())) {
					notice.update(progress.percentage, progress.statusText);
				}
			});
			notice.complete(`Done — the ${label} is installed.`);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			notice.fail(`${label.charAt(0).toUpperCase()}${label.slice(1)} download stopped: ${message}`);
			return false;
		}
	}

	applyGlobalHotkeySettings(): void {
		if (!Platform.isDesktop) {
			return;
		}
		if (this.settings.globalHotkeyEnabled) {
			this.globalHotkeyManager.enable(
				this.settings.globalHotkeyModifier,
				this.settings.globalHotkeyKey,
			);
		} else {
			this.globalHotkeyManager.disable();
		}
	}

	private registerHotkeyListeners(): void {
		this.registerDomEvent(
			activeDocument,
			'keydown',
			(evt: KeyboardEvent) => {
				if (evt.repeat) {
					return;
				}

				if (!this.matchesHotkey(evt)) {
					return;
				}

				// Double-fire guard: when the global shortcut uses the same
				// combo and just fired (Obsidian focused), let the OS-level
				// handler win instead of toggling twice (start + instant stop).
				if (this.isDuplicateGlobalFire()) {
					return;
				}

				if (this.settings.recordingMode === 'hold') {
					if (!this.recorder.isRecording()) {
						evt.preventDefault();
						void this.startRecording();
					}
				} else if (this.settings.recordingMode === 'toggle') {
					evt.preventDefault();
					void this.toggleRecording();
				}
			},
		);

		this.registerDomEvent(
			activeDocument,
			'keyup',
			(evt: KeyboardEvent) => {
				if (this.settings.recordingMode !== 'hold') {
					return;
				}

				if (this.recorder.isRecording() && this.matchesKeyUp(evt)) {
					evt.preventDefault();
					void this.stopRecording();
				}
			},
		);
	}

	private isDuplicateGlobalFire(): boolean {
		if (!this.globalHotkeyManager.isActive()) {
			return false;
		}
		if (!this.globalHotkeyManager.firedRecently()) {
			return false;
		}
		const inAppCombo: HotkeyCombo = {
			modifier: this.settings.hotkeyModifier,
			key: this.settings.hotkeyKey,
		};
		const globalCombo: HotkeyCombo = {
			modifier: this.settings.globalHotkeyModifier,
			key: this.settings.globalHotkeyKey,
		};
		return isSameCombo(inAppCombo, globalCombo);
	}

	private matchesHotkey(evt: KeyboardEvent): boolean {
		const mod = this.settings.hotkeyModifier;
		const modMatch =
			(mod === 'Alt' && evt.altKey) ||
			(mod === 'Ctrl' && evt.ctrlKey) ||
			(mod === 'Meta' && evt.metaKey) ||
			(mod === 'Shift' && evt.shiftKey) ||
			(mod === 'None' && !evt.altKey && !evt.ctrlKey && !evt.metaKey);

		if (!modMatch) {
			return false;
		}

		const targetKey = this.settings.hotkeyKey.trim().toLowerCase();
		if (!targetKey) {
			return false;
		}

		if (targetKey === 'space' && (evt.code === 'Space' || evt.key === ' ')) {
			return true;
		}

		return (
			evt.key.toLowerCase() === targetKey ||
			evt.code.toLowerCase() === targetKey ||
			evt.code.toLowerCase() === `key${targetKey}`
		);
	}

	private matchesKeyUp(evt: KeyboardEvent): boolean {
		const targetKey = this.settings.hotkeyKey.trim().toLowerCase();
		if (targetKey === 'space' && (evt.code === 'Space' || evt.key === ' ')) {
			return true;
		}

		const keyMatch =
			evt.key.toLowerCase() === targetKey ||
			evt.code.toLowerCase() === targetKey ||
			evt.code.toLowerCase() === `key${targetKey}`;

		// In hold mode, releasing either the key or the modifier stops recording
		const mod = this.settings.hotkeyModifier;
		const modRelease =
			(mod === 'Alt' && evt.key === 'Alt') ||
			(mod === 'Ctrl' && evt.key === 'Control') ||
			(mod === 'Meta' && evt.key === 'Meta') ||
			(mod === 'Shift' && evt.key === 'Shift');

		return keyMatch || modRelease;
	}

	async startRecording(): Promise<void> {
		if (this.recorder.isRecording()) {
			return;
		}

		try {
			await this.recorder.start();
			this.updateStatusBar('🎙️ [Tellme] recording...');
			this.statusBarItemEl.addClass('tellme-statusbar-recording');
			this.recordingFeedback('start');
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown recording error';
			new Notice(`Microphone error: ${message}`);
		}
	}

	async stopRecording(): Promise<RecordingResult | null> {
		if (!this.recorder.isRecording()) {
			return null;
		}

		try {
			const result = await this.recorder.stop();
			this.updateStatusBar('');
			this.recordingFeedback('stop');

			if (result && result.filePath) {
				this.lastRecordingResult = result;
				await this.processTranscription(result);
			} else {
				new Notice(
					'No audio captured — the recording was too short, silent, or the window was suspended.',
				);
			}
			return result;
		} catch (error) {
			this.updateStatusBar('');
			this.recordingFeedback('stop');
			const message =
				error instanceof Error ? error.message : 'Unknown save error';
			new Notice(`Failed to process recording: ${message}`);
			return null;
		}
	}

	/** Start/stop feedback: soft chime + system notification while minimized. */
	private recordingFeedback(phase: 'start' | 'stop'): void {
		this.statusBarItemEl.removeClass('tellme-statusbar-recording');
		if (phase === 'start') {
			this.statusBarItemEl.addClass('tellme-statusbar-recording');
		}
		if (this.settings.feedbackSoundEnabled) {
			if (phase === 'start') {
				this.feedbackService.playStart();
			} else {
				this.feedbackService.playStop();
			}
		}
		if (this.settings.feedbackNotificationsEnabled) {
			if (phase === 'start') {
				this.feedbackService.notifyStart();
			} else {
				this.feedbackService.notifyStop();
			}
		}
	}

	async toggleRecording(): Promise<void> {
		if (this.recorder.isRecording()) {
			await this.stopRecording();
		} else {
			await this.startRecording();
		}
	}

	private async processTranscription(
		recording: RecordingResult,
	): Promise<WriteNoteResult | null> {
		// Stage 1: STT Transcription
		this.updateStatusBar('🎙️ [Tellme] transcribing...');

		let sttResult: STTResult;
		try {
			sttResult = await this.sttService.transcribe(
				recording.filePath,
				recording.buffer,
				{
					provider: this.settings.sttProvider,
					// Custom path (Advanced) > downloaded engine > Homebrew (macOS)
					whisperCliPath:
						this.whisperEngine.resolveCliPath(this.settings.whisperCliPath)?.path ?? '',
					whisperModelPath: this.settings.whisperModelPath,
					apiKey: this.settings.sttApiKey,
					apiUrl: this.settings.sttCustomUrl,
					model: this.settings.sttModelName,
					language: this.settings.sttLanguage,
				},
			);
			this.lastSTTResult = sttResult;
		} catch (error) {
			this.updateStatusBar('');
			const message =
				error instanceof STTError
					? error.message
					: error instanceof Error
						? error.message
						: 'Unknown transcription error';
			new Notice(`Transcription failed: ${message}`);
			return null;
		}

		if (!sttResult.text || !sttResult.text.trim()) {
			this.updateStatusBar('');
			new Notice(
				`Transcription completed (${sttResult.provider}), but no speech was detected.`,
			);
			return null;
		}

		const rawTranscript = sttResult.text.trim();

		// Stage 2: AI Cleanup + Intent Extraction
		let cleanupResult: CleanupResult;

		if (!this.settings.llmEnabled) {
			cleanupResult = {
				cleanedText: rawTranscript,
				routingIntent: null,
				rawTranscript,
				durationMs: 0,
				provider: 'none (passthrough)',
			};
			this.lastCleanupResult = cleanupResult;
		} else {
			this.updateStatusBar('🎙️ [Tellme] cleaning up...');

			try {
				cleanupResult = await this.cleanupService.cleanup(
					rawTranscript,
					{
						enabled: this.settings.llmEnabled,
						provider: this.settings.llmProvider,
						ollamaUrl: this.settings.ollamaUrl,
						ollamaModel: this.settings.ollamaModel,
						localModelPath: this.settings.localLlmModelPath,
						localUseGpu: this.settings.localLlmUseGpu,
						apiKey: this.settings.llmApiKey,
						apiUrl: this.settings.llmCustomUrl,
						model: this.settings.llmModelName,
					},
				);
				this.lastCleanupResult = cleanupResult;
			} catch (error) {
				const message =
					error instanceof LLMError
						? error.message
						: error instanceof Error
							? error.message
							: 'Unknown cleanup error';
				new Notice(`AI cleanup warning: ${message}. Using raw transcript.`);

				// Graceful fallback to raw transcript so user never loses data
				cleanupResult = {
					cleanedText: rawTranscript,
					routingIntent: null,
					rawTranscript,
					durationMs: 0,
					provider: 'fallback (error)',
				};
				this.lastCleanupResult = cleanupResult;
			}
		}

		// Stage 3: Deterministic Routing + Note Persistence
		this.updateStatusBar('🎙️ [Tellme] routing & saving note...');

		const vaultItems = this.vaultIndexer.getIndex();
		const routingResult = this.routingEngine.resolve(
			cleanupResult.cleanedText,
			cleanupResult.routingIntent,
			vaultItems,
			{
				defaultFolder: this.settings.defaultFolder,
				highlightKeywords: this.settings.highlightKeywords,
			},
			cleanupResult.rawTranscript,
		);
		this.lastRoutingResult = routingResult;

		const writeResult = await this.noteWriter.write(
			cleanupResult.cleanedText,
			routingResult,
			{
				writeMode: this.settings.writeMode,
				defaultFolder: this.settings.defaultFolder,
			},
		);
		this.lastWriteResult = writeResult;
		this.updateStatusBar('');

		if (routingResult.status === 'resolved') {
			new Notice(
				`Saved (${routingResult.matchSource}): ${writeResult.filePath}`,
			);
		} else {
			new Notice(
				`Saved to fallback (unresolved): ${writeResult.filePath}`,
			);
		}

		return writeResult;
	}

	private updateStatusBar(text: string): void {
		this.statusBarItemEl.setText(text);
	}

	async ensureDefaultFolder(): Promise<void> {
		try {
			const folderPath = normalizePath(
				this.settings.defaultFolder.trim() || 'tellme',
			);
			const existing = this.app.vault.getAbstractFileByPath(folderPath);
			if (!existing) {
				await this.app.vault.createFolder(folderPath);
			} else if (!(existing instanceof TFolder)) {
				return;
			}
		} catch {
			// Fail-safe: prevent folder creation error from breaking plugin initialization
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<TellmeSettings>,
		);
	}

	/** Set by the settings tab while it is open, to confirm each save visually. */
	onSettingsSaved: (() => void) | null = null;

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.onSettingsSaved?.();
	}
}
