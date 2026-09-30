import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import TellmePlugin from './main';
import { STTProvider } from './stt/types';
import { LLMProvider } from './cleanup/types';
import { WriteMode, HighlightKeywordConfig } from './routing/types';
import { ModelManagerUI } from './models/model-manager-ui';
import { FeedbackService } from './audio/feedback';
import { formatMegabytes } from './engines/engine-registry';
import { discoverModels } from './providers/model-list';
import { toBaseUrl, type ApiPurpose } from './providers/openai-compat';
import { ModelSuggest } from './ui/model-suggest';
import { showSavedNotice, showSuccessNotice } from './ui/notices';

/** Wait for a pause in typing before confirming the save. */
const SAVED_NOTICE_DELAY_MS = 600;

/** Settings wiring for one cloud provider section (transcription or cleanup). */
interface CloudConnectionFields {
	purpose: ApiPurpose;
	provider: string;
	getKey(): string;
	setKey(value: string): void;
	getUrl(): string;
	setUrl(value: string): void;
	getModel(): string;
	setModel(value: string): void;
}

/** File name from a path with either separator (no Node path in UI code). */
function basename(filePath: string): string {
	return filePath.split(/[\\/]/).pop() ?? filePath;
}

export type RecordingMode = 'hold' | 'toggle';
export type HotkeyModifier = 'Alt' | 'Ctrl' | 'Meta' | 'Shift' | 'None';

export interface TellmeSettings {
	defaultFolder: string;
	writeMode: WriteMode;
	highlightKeywords: HighlightKeywordConfig[];
	recordingMode: RecordingMode;
	hotkeyModifier: HotkeyModifier;
	hotkeyKey: string;
	globalHotkeyEnabled: boolean;
	globalHotkeyModifier: HotkeyModifier;
	globalHotkeyKey: string;
	feedbackSoundEnabled: boolean;
	feedbackNotificationsEnabled: boolean;
	sttProvider: STTProvider;
	whisperCliPath: string;
	whisperModelPath: string;
	sttApiKey: string;
	sttModelName: string;
	sttCustomUrl: string;
	sttLanguage: string;
	llmEnabled: boolean;
	llmProvider: LLMProvider;
	ollamaUrl: string;
	ollamaModel: string;
	/** Built-in cleanup engine: path of the active GGUF model (set on download). */
	localLlmModelPath: string;
	/** Built-in cleanup engine: use the graphics card when available. */
	localLlmUseGpu: boolean;
	llmApiKey: string;
	llmModelName: string;
	llmCustomUrl: string;
}

export const DEFAULT_SETTINGS: TellmeSettings = {
	defaultFolder: 'tellme',
	writeMode: 'append',
	highlightKeywords: [],
	recordingMode: 'hold',
	hotkeyModifier: 'Ctrl',
	hotkeyKey: 'Space',
	globalHotkeyEnabled: false,
	globalHotkeyModifier: 'Shift',
	globalHotkeyKey: 'Space',
	feedbackSoundEnabled: true,
	feedbackNotificationsEnabled: true,
	sttProvider: 'whisper.cpp',
	whisperCliPath: '',
	whisperModelPath: '',
	sttApiKey: '',
	sttModelName: '',
	sttCustomUrl: '',
	sttLanguage: 'auto',
	llmEnabled: true,
	llmProvider: 'local',
	ollamaUrl: 'http://localhost:11434',
	ollamaModel: 'gemma3:4b',
	localLlmModelPath: '',
	// Measured 2026-09-27 (GTX 1070): 5-12x faster; the GPU build falls back to
	// the processor at no extra cost when no GPU is usable.
	localLlmUseGpu: true,
	llmApiKey: '',
	llmModelName: '',
	llmCustomUrl: '',
};

export class TellmeSettingTab extends PluginSettingTab {
	plugin: TellmePlugin;
	private modelManagerUI: ModelManagerUI;
	private keywordsContainer: HTMLElement | null = null;
	/** Model lists per provider/URL/key, so re-rendering the tab doesn't refetch. */
	private modelCache = new Map<string, string[]>();
	private savedTimer: number | null = null;
	private savedNotice: Notice | null = null;

	constructor(app: App, plugin: TellmePlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.modelManagerUI = new ModelManagerUI(plugin);
	}

	display(): void {
		const { containerEl } = this;

		// Preserve scroll position across full re-renders (the scroller is
		// the vertical-tab-content panel, not necessarily containerEl itself).
		const scroller =
			containerEl.closest('.vertical-tab-content') ?? containerEl;
		const scrollTop = scroller.scrollTop;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Storage')
			.setHeading();

		new Setting(containerEl)
			.setName('Default folder')
			.setDesc('Fallback folder where unrouted or unresolved notes are saved.')
			.addText((text) =>
				text
					.setPlaceholder('Tellme')
					.setValue(this.plugin.settings.defaultFolder)
					.onChange(async (value) => {
						this.plugin.settings.defaultFolder = value.trim() || 'tellme';
						await this.plugin.saveSettings();
						await this.plugin.ensureDefaultFolder();
					}),
			);

		new Setting(containerEl)
			.setName('Write behavior')
			.setDesc('Choose whether to append to an existing note or create a new file.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('append', 'Append to tellme.md in destination folder')
					.addOption('new_file', 'Create new file for each note')
					.setValue(this.plugin.settings.writeMode)
					.onChange(async (value) => {
						this.plugin.settings.writeMode = value as WriteMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Highlight keywords')
			.setHeading();

		new Setting(containerEl)
			.setName('Keyword mappings')
			.setDesc('Map spoken keywords or trigger phrases (e.g. Path meeting) directly to vault folders or notes without AI.')
			.addButton((btn) =>
				btn
					.setButtonText('Add keyword')
					.setCta()
					.onClick(async () => {
						if (!this.plugin.settings.highlightKeywords) {
							this.plugin.settings.highlightKeywords = [];
						}
						this.plugin.settings.highlightKeywords.push({
							keyword: '',
							targetPath: '',
						});
						await this.plugin.saveSettings();
						this.refreshKeywordsSection();
					}),
			);

		// Keywords get their own container so add/delete only re-renders
		// this section instead of the whole tab (avoids scroll jumps).
		const keywordsContainer = containerEl.createDiv();
		this.renderHighlightKeywords(keywordsContainer);
		this.keywordsContainer = keywordsContainer;

		new Setting(containerEl)
			.setName('Recording')
			.setHeading();

		new Setting(containerEl)
			.setName('Recording mode')
			.setDesc('Choose between hold-to-record or click/press toggle to start and stop.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('hold', 'Hold to record (release to stop)')
					.addOption('toggle', 'Toggle (press to start, press to stop)')
					.setValue(this.plugin.settings.recordingMode)
					.onChange(async (value) => {
						this.plugin.settings.recordingMode = value as RecordingMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Trigger modifier')
			.setDesc('Modifier key for in-focus keyboard activation.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('Alt', 'Alt')
					.addOption('Ctrl', 'Ctrl')
					.addOption('Meta', 'Cmd / meta')
					.addOption('Shift', 'Shift')
					.addOption('None', 'None')
					.setValue(this.plugin.settings.hotkeyModifier)
					.onChange(async (value) => {
						this.plugin.settings.hotkeyModifier = value as HotkeyModifier;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Trigger key')
			.setDesc('Primary key name for in-focus shortcut activation (e.g. Space, r).')
			.addText((text) =>
				text
					.setPlaceholder('Space')
					.setValue(this.plugin.settings.hotkeyKey)
					.onChange(async (value) => {
						this.plugin.settings.hotkeyKey = value.trim() || 'Space';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Global hotkey')
			.setHeading();

		new Setting(containerEl)
			.setName('Enable global hotkey')
			.setDesc(
				'Hotkey works anywhere in the os, even while Obsidian is minimized. Always press to start and press again to stop (toggle) — hold-to-record stays in-app only.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.globalHotkeyEnabled)
					.onChange(async (value) => {
						this.plugin.settings.globalHotkeyEnabled = value;
						await this.plugin.saveSettings();
						this.plugin.applyGlobalHotkeySettings();
						if (value) {
							FeedbackService.requestPermission();
						}
					}),
			);

		new Setting(containerEl)
			.setName('Global modifier')
			.setDesc('Modifier key for the os-wide shortcut.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('Alt', 'Alt')
					.addOption('Ctrl', 'Ctrl')
					.addOption('Meta', 'Cmd / meta')
					.addOption('Shift', 'Shift')
					.addOption('None', 'None')
					.setValue(this.plugin.settings.globalHotkeyModifier)
					.onChange(async (value) => {
						this.plugin.settings.globalHotkeyModifier = value as HotkeyModifier;
						await this.plugin.saveSettings();
						this.plugin.applyGlobalHotkeySettings();
					}),
			);

		new Setting(containerEl)
			.setName('Global key')
			.setDesc('Key for the os-wide shortcut (single letter, digit, or space).')
			.addText((text) =>
				text
					.setPlaceholder('Space')
					.setValue(this.plugin.settings.globalHotkeyKey)
					.onChange(async (value) => {
						this.plugin.settings.globalHotkeyKey = value.trim() || 'Space';
						await this.plugin.saveSettings();
						this.plugin.applyGlobalHotkeySettings();
					}),
			);

		new Setting(containerEl)
			.setName('Recording feedback')
			.setHeading();

		new Setting(containerEl)
			.setName('Feedback sound')
			.setDesc(
				'Play a soft chime when recording starts and stops, including while Obsidian is minimized.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.feedbackSoundEnabled)
					.onChange(async (value) => {
						this.plugin.settings.feedbackSoundEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('System notifications')
			.setDesc(
				'Show a system notification when recording starts and stops while the window is unfocused.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.feedbackNotificationsEnabled)
					.onChange(async (value) => {
						this.plugin.settings.feedbackNotificationsEnabled = value;
						await this.plugin.saveSettings();
						if (value) {
							FeedbackService.requestPermission();
						}
					}),
			);

		new Setting(containerEl)
			.setName('Transcription')
			.setHeading();

		new Setting(containerEl)
			.setName('Transcription provider')
			.setDesc('Engine used to transcribe voice notes into raw text.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('whisper.cpp', 'whisper.cpp (local)')
					.addOption('groq', 'Groq (cloud BYOK - fast)')
					.addOption('openai', 'OpenAI (cloud BYOK)')
					.addOption('openrouter', 'OpenRouter (cloud BYOK)')
					.addOption('custom', 'Custom OpenAI-compatible')
					.setValue(this.plugin.settings.sttProvider)
					.onChange(async (value) => {
						this.plugin.settings.sttProvider = value as STTProvider;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.sttProvider === 'whisper.cpp') {
			// Engine + model status: updates in place, never re-renders the tab.
			this.renderSpeechEngineStatus(containerEl.createDiv());

			new Setting(containerEl)
				.setName('Speech model')
				.setDesc(
					this.plugin.settings.whisperModelPath
						? `Using ${basename(this.plugin.settings.whisperModelPath)}. Switch or download models in the local model manager below.`
						: 'No model yet — download one in the local model manager below (Whisper Base is a good start).',
				);

			// Power users only: bring your own whisper.cpp build / model file.
			const advanced = containerEl.createEl('details', { cls: 'tellme-advanced' });
			advanced.createEl('summary', { text: 'Advanced: use my own whisper.cpp program' });

			new Setting(advanced)
				.setName('Custom whisper.cpp program')
				.setDesc(
					'Full path to your own whisper-cli file. Leave empty to use the built-in speech engine.',
				)
				.addText((text) =>
					text
						.setPlaceholder('Leave empty for the built-in engine')
						.setValue(this.plugin.settings.whisperCliPath)
						.onChange(async (value) => {
							this.plugin.settings.whisperCliPath = value.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(advanced)
				.setName('Custom model file')
				.setDesc(
					'Full path to a whisper.cpp model (.bin) file. Filled in automatically when you download a model below.',
				)
				.addText((text) =>
					text
						.setPlaceholder('Path to model file')
						.setValue(this.plugin.settings.whisperModelPath)
						.onChange(async (value) => {
							this.plugin.settings.whisperModelPath = value.trim();
							await this.plugin.saveSettings();
						}),
				);
		} else {
			const s = this.plugin.settings;
			this.renderCloudConnection(containerEl, {
				purpose: 'transcription',
				provider: s.sttProvider,
				getKey: () => s.sttApiKey,
				setKey: (v) => (s.sttApiKey = v),
				getUrl: () => s.sttCustomUrl,
				setUrl: (v) => (s.sttCustomUrl = v),
				getModel: () => s.sttModelName,
				setModel: (v) => (s.sttModelName = v),
			});
		}

		new Setting(containerEl)
			.setName('Spoken language')
			.setDesc('Language code (use auto for automatic detection).')
			.addText((text) =>
				text
					.setPlaceholder('Auto')
					.setValue(this.plugin.settings.sttLanguage)
					.onChange(async (value) => {
						this.plugin.settings.sttLanguage = value.trim() || 'auto';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Cleanup')
			.setHeading();

		new Setting(containerEl)
			.setName('Enable AI cleanup')
			.setDesc('Clean filler words, fix grammar, and extract spoken routing intent using an LLM.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.llmEnabled)
					.onChange(async (value) => {
						this.plugin.settings.llmEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.llmEnabled) {
			new Setting(containerEl)
				.setName('Cleanup provider')
				.setDesc('Language model provider for note cleanup and intent parsing.')
				.addDropdown((dropdown) =>
					dropdown
						.addOption('local', 'Built-in (offline, recommended)')
						.addOption('ollama', 'Ollama (local, advanced)')
						.addOption('groq', 'Groq (cloud BYOK - fast)')
						.addOption('openrouter', 'OpenRouter (cloud BYOK)')
						.addOption('openai', 'OpenAI (cloud BYOK)')
						.addOption('gemini', 'Gemini (cloud BYOK)')
						.addOption('custom', 'Custom OpenAI-compatible')
						.setValue(this.plugin.settings.llmProvider)
						.onChange(async (value) => {
							this.plugin.settings.llmProvider = value as LLMProvider;
							await this.plugin.saveSettings();
							this.display();
						}),
				);

			if (this.plugin.settings.llmProvider === 'local') {
				// Engine status updates in place, never re-renders the tab.
				this.renderCleanupEngineStatus(containerEl.createDiv());

				const modelPath = this.plugin.settings.localLlmModelPath;
				new Setting(containerEl)
					.setName('Cleanup model')
					.setDesc(
						modelPath
							? `Using ${basename(modelPath)}. Switch or download models in the local model manager below.`
							: 'No model yet — download a cleanup model in the local model manager below.',
					);

				new Setting(containerEl)
					.setName('Use graphics card')
					.setDesc(
						this.plugin.llamaEngine.hasGpuBuild()
							? 'Much faster cleanup on most computers with a graphics card. If none is usable, the engine automatically runs on the processor instead.'
							: 'On this computer the engine picks the fastest option automatically.',
					)
					.addToggle((toggle) =>
						toggle
							.setValue(this.plugin.settings.localLlmUseGpu)
							.setDisabled(!this.plugin.llamaEngine.hasGpuBuild())
							.onChange(async (value) => {
								this.plugin.settings.localLlmUseGpu = value;
								await this.plugin.saveSettings();
								// The running engine restarts with the new choice on the next note.
								this.plugin.llamaEngine.stop();
								this.display();
							}),
					);
			} else if (this.plugin.settings.llmProvider === 'ollama') {
				new Setting(containerEl)
					.setName('Ollama URL')
					.setDesc('Base endpoint for local Ollama service.')
					.addText((text) =>
						text
							.setPlaceholder('Endpoint URL')
							.setValue(this.plugin.settings.ollamaUrl)
							.onChange(async (value) => {
								this.plugin.settings.ollamaUrl = value.trim() || 'http://localhost:11434';
								await this.plugin.saveSettings();
							}),
					);

				new Setting(containerEl)
					.setName('Ollama model')
					.setDesc('Installed model name in Ollama.')
					.addText((text) =>
						text
							.setPlaceholder('Model tag')
							.setValue(this.plugin.settings.ollamaModel)
							.onChange(async (value) => {
								this.plugin.settings.ollamaModel = value.trim() || 'gemma3:4b';
								await this.plugin.saveSettings();
							}),
					);
			} else {
				const s = this.plugin.settings;
				this.renderCloudConnection(containerEl, {
					purpose: 'chat',
					provider: s.llmProvider,
					getKey: () => s.llmApiKey,
					setKey: (v) => (s.llmApiKey = v),
					getUrl: () => s.llmCustomUrl,
					setUrl: (v) => (s.llmCustomUrl = v),
					getModel: () => s.llmModelName,
					setModel: (v) => (s.llmModelName = v),
				});
			}
		}

		// The model manager owns its own container and updates it in place
		// (see ModelManagerUI) — it never re-renders the whole settings tab.
		this.modelManagerUI.render(containerEl.createDiv(), () => {
			if (containerEl.isConnected) {
				this.display();
			}
		});

		// Every change already saves instantly; confirm it with a small green
		// "Saved" once the user pauses (not on every keystroke).
		this.plugin.onSettingsSaved = () => this.confirmSaved();

		// Restore the scroll position captured before the re-render.
		scroller.scrollTop = scrollTop;
	}

	private renderHighlightKeywords(containerEl: HTMLElement): void {
		const keywords = this.plugin.settings.highlightKeywords || [];

		if (keywords.length === 0) {
			const emptySetting = new Setting(containerEl);
			emptySetting.setDesc(
				'No highlight keywords configured yet. Click "add keyword" to create a mapping.',
			);
			return;
		}

		keywords.forEach((config, index) => {
			const rowSetting = new Setting(containerEl);
			rowSetting.setClass('tellme-keyword-row');
			rowSetting
				.addText((text) =>
					text
						.setPlaceholder('E.g. Meeting')
						.setValue(config.keyword)
						.onChange(async (val) => {
							config.keyword = val;
							await this.plugin.saveSettings();
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder('E.g. Work/meetings')
						.setValue(config.targetPath)
						.onChange(async (val) => {
							config.targetPath = val;
							await this.plugin.saveSettings();
						}),
				)
				.addExtraButton((btn) =>
					btn
						.setIcon('trash')
						.setTooltip('Delete keyword mapping')
						.onClick(async () => {
							this.plugin.settings.highlightKeywords.splice(index, 1);
							await this.plugin.saveSettings();
							this.refreshKeywordsSection();
						}),
				);
		});
	}

	/**
	 * Re-render only the keywords section (its own container) instead of
	 * the whole tab, so add/delete does not reset the settings scroll.
	 */
	hide(): void {
		this.plugin.onSettingsSaved = null;
		if (this.savedTimer !== null) {
			window.clearTimeout(this.savedTimer);
			this.savedTimer = null;
		}
	}

	/** Debounced "Saved" pop-up: one small notice after the last change. */
	private confirmSaved(): void {
		if (this.savedTimer !== null) {
			window.clearTimeout(this.savedTimer);
		}
		this.savedTimer = window.setTimeout(() => {
			this.savedTimer = null;
			this.savedNotice?.hide();
			this.savedNotice = showSavedNotice();
		}, SAVED_NOTICE_DELAY_MS);
	}

	/**
	 * Cloud provider fields: provider URL (custom only), API key, a "Test
	 * connection" button, and a model field with a drop-down of the models
	 * the provider actually offers. The list loads quietly when a key is
	 * already set; the button re-checks and reports in plain language. For a
	 * custom provider the working base URL is found and saved automatically.
	 */
	private renderCloudConnection(containerEl: HTMLElement, fields: CloudConnectionFields): void {
		const isCustom = fields.provider === 'custom';
		const cacheKey = (): string =>
			[fields.purpose, fields.provider, toBaseUrl(fields.getUrl()), fields.getKey()].join('|');
		let models = this.modelCache.get(cacheKey()) ?? [];
		let urlInput: HTMLInputElement | null = null;

		if (isCustom) {
			new Setting(containerEl)
				.setName('Provider URL')
				.setDesc(
					"The provider's API address, for example api.example.com/v1 — a full …/chat/completions address works too. Test connection finds the right one for you.",
				)
				.addText((text) => {
					urlInput = text.inputEl;
					text
						.setPlaceholder('Paste the API address')
						.setValue(fields.getUrl())
						.onChange(async (value) => {
							fields.setUrl(value.trim());
							await this.plugin.saveSettings();
						});
				});
		}

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Your provider API key (stored locally only, never shared).')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Enter API key')
					.setValue(fields.getKey())
					.onChange(async (value) => {
						fields.setKey(value.trim());
						await this.plugin.saveSettings();
					});
			});

		const connection = new Setting(containerEl).setName('Connection');
		const setStatus = (text: string, state: 'idle' | 'ok' | 'error'): void => {
			connection.setDesc(text);
			connection.descEl.toggleClass('tellme-status-ok', state === 'ok');
			connection.descEl.toggleClass('tellme-status-error', state === 'error');
		};
		setStatus(
			models.length > 0
				? `✓ Connected — ${models.length} models available.`
				: 'Not tested yet. Click the button to check your key and load the model list.',
			models.length > 0 ? 'ok' : 'idle',
		);

		const modelSetting = new Setting(containerEl).setName('Model');
		const describeModel = (): void => {
			const current = fields.getModel().trim();
			if (models.length === 0) {
				modelSetting.setDesc(
					isCustom
						? 'Test the connection to choose from the list, or type a model ID.'
						: 'Leave empty to use the provider default — or test the connection to choose from the list.',
				);
			} else if (current && !models.includes(current)) {
				modelSetting.setDesc(`⚠ "${current}" is not in this provider's list — check the spelling, or pick one from the list.`);
			} else {
				modelSetting.setDesc(`Click the field to choose from ${models.length} models, or type to search.`);
			}
		};
		modelSetting.addText((text) => {
			text
				.setPlaceholder(isCustom ? 'Choose a model' : 'Provider default')
				.setValue(fields.getModel())
				.onChange(async (value) => {
					fields.setModel(value.trim());
					await this.plugin.saveSettings();
					describeModel();
				});
			new ModelSuggest(this.app, text.inputEl, () => models, (picked) => {
				fields.setModel(picked);
				void this.plugin.saveSettings();
				describeModel();
			});
		});
		describeModel();

		const test = async (interactive: boolean): Promise<void> => {
			setStatus('Connecting...', 'idle');
			const result = await discoverModels(fields.provider, fields.getUrl(), fields.getKey(), fields.purpose);
			if (!result.ok) {
				setStatus(`✗ ${result.message}`, 'error');
				if (interactive) {
					new Notice(result.message, 8000);
				}
				return;
			}
			// Custom provider: save the base URL that actually answered.
			if (isCustom && result.baseUrl && toBaseUrl(fields.getUrl()) !== result.baseUrl) {
				fields.setUrl(result.baseUrl);
				if (urlInput) {
					urlInput.value = result.baseUrl;
				}
				await this.plugin.saveSettings();
			}
			models = result.models;
			this.modelCache.set(cacheKey(), models);
			setStatus(`✓ ${result.message}`, 'ok');
			describeModel();
			if (interactive) {
				showSuccessNotice(result.message);
			}
		};

		connection.addButton((button) =>
			button.setButtonText('Test connection').onClick(async () => {
				button.setDisabled(true);
				await test(true);
				button.setDisabled(false);
			}),
		);

		// Load the list quietly when we have what we need and haven't yet.
		const canAutoLoad = (fields.getKey() || fields.provider === 'openrouter') && (!isCustom || fields.getUrl());
		if (models.length === 0 && canAutoLoad) {
			void test(false);
		}
	}

	/**
	 * "Cleanup engine" row: whether llama.cpp (for the current GPU setting) is
	 * installed, with a one-click download. Re-renders only its own container.
	 */
	private renderCleanupEngineStatus(container: HTMLElement): void {
		container.empty();
		const engine = this.plugin.llamaEngine;
		const useGpu = this.plugin.settings.localLlmUseGpu;
		const setting = new Setting(container).setName('Cleanup engine');

		if (engine.isInstalled(useGpu)) {
			setting.setDesc(
				`✓ Installed (${engine.releaseName}). Starts by itself when a note needs cleaning and stops after 5 idle minutes.`,
			);
			return;
		}
		const asset = engine.getAsset(useGpu);
		if (!asset) {
			setting.setDesc(
				'No ready-made cleanup engine for this computer. Choose Ollama or a cloud provider above.',
			);
			return;
		}
		setting
			.setDesc(
				'Not installed yet — the program that runs cleanup models offline. It is also installed automatically when you download a cleanup model.',
			)
			.addButton((button) =>
				button
					.setButtonText(`Download cleanup engine (${formatMegabytes(asset.sizeBytes)})`)
					.setCta()
					.onClick(async () => {
						button.setDisabled(true).setButtonText('Downloading...');
						await this.plugin.ensureLlamaEngine();
						if (container.isConnected) {
							this.renderCleanupEngineStatus(container);
						}
					}),
			);
	}

	/**
	 * "Speech engine" row: shows whether the whisper.cpp program is ready and
	 * offers a one-click download. Re-renders only its own container.
	 */
	private renderSpeechEngineStatus(container: HTMLElement): void {
		container.empty();
		const engine = this.plugin.whisperEngine;
		const resolved = engine.resolveCliPath(this.plugin.settings.whisperCliPath);
		const setting = new Setting(container).setName('Speech engine');
		const refresh = (): void => this.renderSpeechEngineStatus(container);

		if (resolved?.source === 'custom') {
			setting.setDesc(`Using your own program: ${resolved.path}`);
			return;
		}
		if (resolved?.source === 'bundled') {
			setting.setDesc(`✓ Installed (${engine.releaseName}). Runs fully offline on this computer.`);
			return;
		}
		if (resolved?.source === 'homebrew') {
			setting.setDesc(`✓ Found whisper.cpp installed with Homebrew (${resolved.path}).`);
			return;
		}

		const asset = engine.getAsset();
		if (!asset) {
			setting
				.setDesc(
					process.platform === 'darwin'
						? 'Not installed. On Mac, open Terminal and run: brew install whisper-cpp — then click check again.'
						: 'No ready-made engine for this computer. Set your own program under advanced below.',
				)
				.addButton((button) =>
					button.setButtonText('Check again').onClick(refresh),
				);
			return;
		}

		setting
			.setDesc(
				`Not installed yet — the program that turns speech into text offline. It is also installed automatically when you download a speech model.`,
			)
			.addButton((button) =>
				button
					.setButtonText(`Download speech engine (${formatMegabytes(asset.sizeBytes)})`)
					.setCta()
					.onClick(async () => {
						button.setDisabled(true).setButtonText('Downloading...');
						await this.plugin.ensureWhisperEngine();
						if (container.isConnected) {
							refresh();
						}
					}),
			);
	}

	private refreshKeywordsSection(): void {
		if (this.keywordsContainer) {
			this.keywordsContainer.empty();
			this.renderHighlightKeywords(this.keywordsContainer);
		} else {
			this.display();
		}
	}
}
