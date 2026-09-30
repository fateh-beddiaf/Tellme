import { Setting, Notice, ProgressBarComponent } from 'obsidian';
import type TellmePlugin from '../main.ts';
import type { ModelInfo, ModelType, ModelStatus } from './types.ts';
import { ALL_MODELS } from './registry.ts';
import { DownloadNotice } from './download-notice.ts';
import { ProgressThrottle, withTimeout } from './progress-utils.ts';

/** Max wait for the Ollama model list before rendering without it. */
const OLLAMA_STATUS_TIMEOUT_MS = 2000;

interface CardHandle {
	cardEl: HTMLElement;
	statusBadgeEl: HTMLElement;
	progressEl: HTMLElement;
	progressBar: ProgressBarComponent;
	progressTextEl: HTMLElement;
	actionsEl: HTMLElement;
}

/**
 * Local model manager panel.
 *
 * Performance rules (the panel used to rebuild every card, re-stat every
 * file and re-query Ollama on each download chunk):
 * - Cards render immediately from the last known status; statuses are
 *   then resolved in parallel and patched into the existing cards.
 * - Download progress updates only the downloading card's progress bar,
 *   throttled to visible changes.
 * - Structural changes (filter, activate, delete, finish) rebuild only the
 *   card list, never the settings tab.
 */
export class ModelManagerUI {
	private plugin: TellmePlugin;
	private currentFilter: 'all' | ModelType = 'all';
	private installedOllamaModels: string[] = [];
	private statusCache = new Map<string, ModelStatus>();
	private downloadProgress = new Map<string, { percentage: number; statusText: string }>();
	private cards = new Map<string, CardHandle>();
	private cardsContainer: HTMLElement | null = null;
	private statusGeneration = 0;
	/** Called when activating a model changed settings shown elsewhere in the tab. */
	private onSettingsChanged: () => void = () => {};

	constructor(plugin: TellmePlugin) {
		this.plugin = plugin;
	}

	render(containerEl: HTMLElement, onSettingsChanged?: () => void): void {
		if (onSettingsChanged) {
			this.onSettingsChanged = onSettingsChanged;
		}
		new Setting(containerEl)
			.setName('Local model manager')
			.setHeading();

		new Setting(containerEl)
			.setName('Model catalog')
			.setDesc(
				'Browse, download, and manage local models for voice transcription and note cleanup without requiring cloud AI.',
			);

		const filterContainer = containerEl.createDiv({ cls: 'tellme-model-filter-bar' });
		const filterButtons: Array<{ el: HTMLElement; filter: 'all' | ModelType }> = [];

		const createFilterBtn = (label: string, filter: 'all' | ModelType): void => {
			const btn = filterContainer.createEl('button', {
				text: label,
				cls: 'tellme-filter-btn',
			});
			btn.toggleClass('is-active', this.currentFilter === filter);
			btn.addEventListener('click', () => {
				this.currentFilter = filter;
				for (const b of filterButtons) {
					b.el.toggleClass('is-active', b.filter === filter);
				}
				this.renderCards();
			});
			filterButtons.push({ el: btn, filter });
		};

		createFilterBtn('All models', 'all');
		createFilterBtn('Speech to text (whisper.cpp)', 'stt');
		createFilterBtn('Cleanup (AI)', 'llm');

		this.cardsContainer = containerEl.createDiv({ cls: 'tellme-model-cards-container' });
		this.renderCards();
	}

	private visibleModels(): ModelInfo[] {
		// Cleanup cards follow the chosen provider: Ollama models only when
		// Ollama is selected, otherwise the built-in (llama.cpp) models.
		const ollamaSelected = this.plugin.settings.llmProvider === 'ollama';
		return ALL_MODELS.filter((m) => {
			if (this.currentFilter !== 'all' && m.type !== this.currentFilter) {
				return false;
			}
			if (m.type === 'llm') {
				return ollamaSelected === Boolean(m.ollamaModelName);
			}
			return true;
		});
	}

	private isDownloading(modelId: string): boolean {
		return (
			this.plugin.modelManager.isDownloading(modelId) ||
			this.downloadProgress.has(modelId)
		);
	}

	/** Rebuild only the card list (instant), then refresh statuses in the background. */
	private renderCards(): void {
		const container = this.cardsContainer;
		if (!container || !container.isConnected) {
			return;
		}
		container.empty();
		this.cards.clear();

		const models = this.visibleModels();
		for (const model of models) {
			const handle = this.buildCard(container, model);
			this.cards.set(model.id, handle);
			this.applyStatus(model, this.statusCache.get(model.id) ?? null);
		}

		void this.refreshStatuses(models);
	}

	/** Resolve every visible model's status in parallel and patch the cards. */
	private async refreshStatuses(models: ModelInfo[]): Promise<void> {
		const generation = ++this.statusGeneration;

		if (models.some((m) => m.ollamaModelName)) {
			this.installedOllamaModels = await withTimeout(
				this.plugin.modelManager.getOllamaInstalledModels(
					this.plugin.settings.ollamaUrl,
				),
				OLLAMA_STATUS_TIMEOUT_MS,
				[],
				window,
			);
		}

		const statuses = await Promise.all(
			models.map((model) =>
				this.plugin.modelManager
					.getModelStatus(model, {
						activeWhisperPath: this.plugin.settings.whisperModelPath,
						activeLocalLlmPath: this.plugin.settings.localLlmModelPath,
						activeOllamaModel: this.plugin.settings.ollamaModel,
						installedOllamaModels: this.installedOllamaModels,
					})
					.catch((): ModelStatus => 'available'),
			),
		);

		// A newer render started while we were waiting — its results win.
		if (generation !== this.statusGeneration) {
			return;
		}

		models.forEach((model, i) => {
			const status = statuses[i] ?? 'available';
			this.statusCache.set(model.id, status);
			this.applyStatus(model, status);
		});
	}

	/** Build the static parts of a card once; dynamic parts are filled by applyStatus. */
	private buildCard(containerEl: HTMLElement, model: ModelInfo): CardHandle {
		const cardEl = containerEl.createDiv({ cls: 'tellme-model-card' });

		const header = cardEl.createDiv({ cls: 'tellme-model-header' });
		header.createEl('h4', { text: model.name, cls: 'tellme-model-title' });

		const badgeContainer = header.createDiv({ cls: 'tellme-model-badges' });
		badgeContainer.createSpan({
			text: model.type === 'stt' ? 'STT' : 'LLM',
			cls: `tellme-badge tellme-badge-type tellme-badge-${model.type}`,
		});
		badgeContainer.createSpan({
			text: model.profile.charAt(0).toUpperCase() + model.profile.slice(1),
			cls: `tellme-badge tellme-badge-profile tellme-badge-${model.profile}`,
		});
		const statusBadgeEl = badgeContainer.createSpan();

		const meta = cardEl.createDiv({ cls: 'tellme-model-meta' });
		meta.createSpan({ text: `💾 ${model.sizeFormatted}`, cls: 'tellme-model-meta-item' });
		meta.createSpan({ text: `⚡ ${model.ramRequired}`, cls: 'tellme-model-meta-item' });

		cardEl.createEl('p', { text: model.description, cls: 'tellme-model-desc' });
		if (model.license) {
			cardEl.createEl('p', { text: model.license, cls: 'tellme-model-license' });
		}

		const progressEl = cardEl.createDiv({ cls: 'tellme-model-progress-container' });
		const progressBar = new ProgressBarComponent(progressEl);
		const progressTextEl = progressEl.createSpan({ cls: 'tellme-model-progress-text' });

		const actionsEl = cardEl.createDiv({ cls: 'tellme-model-actions' });

		return { cardEl, statusBadgeEl, progressEl, progressBar, progressTextEl, actionsEl };
	}

	/** Fill a card's status badge, progress bar and buttons. `null` = still checking. */
	private applyStatus(model: ModelInfo, status: ModelStatus | null): void {
		const handle = this.cards.get(model.id);
		if (!handle) {
			return;
		}

		handle.statusBadgeEl.empty();
		handle.statusBadgeEl.className = '';
		if (status === 'active') {
			handle.statusBadgeEl.setText('Active');
			handle.statusBadgeEl.className = 'tellme-badge tellme-badge-active';
		} else if (status === 'installed') {
			handle.statusBadgeEl.setText('Installed');
			handle.statusBadgeEl.className = 'tellme-badge tellme-badge-installed';
		}

		const downloading = this.isDownloading(model.id);
		handle.progressEl.toggleClass('is-hidden', !downloading);
		if (downloading) {
			const progress = this.downloadProgress.get(model.id);
			handle.progressBar.setValue(progress?.percentage ?? 0);
			handle.progressTextEl.setText(progress?.statusText ?? 'Starting download...');
		}

		const actions = handle.actionsEl;
		actions.empty();

		if (downloading) {
			const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'mod-warning' });
			cancelBtn.addEventListener('click', () => {
				this.plugin.modelManager.cancelDownload(model.id);
				this.downloadProgress.delete(model.id);
				this.renderCards();
			});
			return;
		}

		if (status === null) {
			const checkingBtn = actions.createEl('button', { text: 'Checking...' });
			checkingBtn.disabled = true;
			return;
		}

		if (status === 'available') {
			const downloadBtn = actions.createEl('button', {
				text: `Download (${model.sizeFormatted})`,
				cls: 'mod-cta',
			});
			downloadBtn.addEventListener('click', () => {
				void this.startDownload(model);
			});
			return;
		}

		if (status === 'installed') {
			const activateBtn = actions.createEl('button', { text: 'Use model', cls: 'mod-cta' });
			activateBtn.addEventListener('click', () => {
				this.activateModel(model)
					.then(() => {
						new Notice(`Activated model: ${model.name}`);
						// Activation can switch the provider shown above the catalog.
						this.onSettingsChanged();
					})
					.catch((error) => {
						const msg = error instanceof Error ? error.message : 'Activation failed';
						new Notice(`Failed to activate model: ${msg}`);
					});
			});
		} else {
			const activeBtn = actions.createEl('button', { text: 'Active model', cls: 'mod-muted' });
			activeBtn.disabled = true;
		}

		const deleteBtn = actions.createEl('button', { text: 'Delete', cls: 'mod-warning' });
		deleteBtn.addEventListener('click', () => {
			void this.deleteModel(model);
		});
	}

	/** Paint one progress tick into the card (if the settings tab is open). */
	private paintProgress(modelId: string): void {
		const handle = this.cards.get(modelId);
		const progress = this.downloadProgress.get(modelId);
		if (!handle || !progress || !handle.cardEl.isConnected) {
			return;
		}
		handle.progressBar.setValue(progress.percentage);
		handle.progressTextEl.setText(progress.statusText);
	}

	private async deleteModel(model: ModelInfo): Promise<void> {
		try {
			if (model.fileName) {
				if (model.type === 'llm') {
					// Windows can't delete a file the engine has open.
					this.plugin.llamaEngine.stop();
				}
				await this.plugin.modelManager.deleteModelFile(model);
				await this.forgetIfActive(model);
			} else {
				await this.plugin.modelManager.deleteOllamaModel(
					model,
					this.plugin.settings.ollamaUrl,
				);
			}
			this.statusCache.set(model.id, 'available');
			new Notice(`Deleted model: ${model.name}`);
			this.renderCards();
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Unknown delete error';
			new Notice(`Failed to delete model: ${msg}`);
		}
	}

	private async startDownload(model: ModelInfo): Promise<void> {
		const notice = new DownloadNotice(model.name);
		const throttle = new ProgressThrottle();

		this.downloadProgress.set(model.id, {
			percentage: 0,
			statusText: 'Starting download...',
		});
		this.applyStatus(model, this.statusCache.get(model.id) ?? null);

		const onProgress = (progress: { percentage: number; statusText: string }): void => {
			if (!throttle.shouldEmit(progress.percentage, Date.now())) {
				return;
			}
			this.downloadProgress.set(model.id, {
				percentage: progress.percentage,
				statusText: progress.statusText,
			});
			this.paintProgress(model.id);
			notice.update(progress.percentage, progress.statusText);
		};

		try {
			if (model.fileName) {
				// A model is useless without the program that runs it: fetch
				// the engine first (no-op when already installed).
				if (model.type === 'stt') {
					await this.plugin.ensureWhisperEngine();
				} else {
					await this.plugin.ensureLlamaEngine();
				}
				await this.plugin.modelManager.downloadModelFile(model, onProgress);
			} else {
				await this.plugin.modelManager.pullOllamaModel(
					model,
					this.plugin.settings.ollamaUrl,
					onProgress,
				);
			}

			this.downloadProgress.delete(model.id);

			// Automatically activate the freshly downloaded model for seamless onboarding
			await this.activateModel(model);
			this.statusCache.set(model.id, 'active');
			notice.complete(`Done — ${model.name} is downloaded and ready to use.`);
			this.onSettingsChanged();
		} catch (error) {
			this.downloadProgress.delete(model.id);
			const msg = error instanceof Error ? error.message : 'Download failed';
			notice.fail(`Download stopped: ${msg}`);
			this.renderCards();
		}
	}

	/** After deleting a model file, clear the setting that pointed at it. */
	private async forgetIfActive(model: ModelInfo): Promise<void> {
		const filePath = this.plugin.modelManager.getModelFilePath(model);
		const settings = this.plugin.settings;
		if (model.type === 'stt' && settings.whisperModelPath === filePath) {
			settings.whisperModelPath = '';
		} else if (model.type === 'llm' && settings.localLlmModelPath === filePath) {
			settings.localLlmModelPath = '';
		} else {
			return;
		}
		await this.plugin.saveSettings();
	}

	private async activateModel(model: ModelInfo): Promise<void> {
		if (model.type === 'stt') {
			this.plugin.settings.sttProvider = 'whisper.cpp';
			this.plugin.settings.whisperModelPath = this.plugin.modelManager.getModelFilePath(model);
		} else if (model.fileName) {
			this.plugin.settings.llmEnabled = true;
			this.plugin.settings.llmProvider = 'local';
			this.plugin.settings.localLlmModelPath = this.plugin.modelManager.getModelFilePath(model);
		} else {
			this.plugin.settings.llmEnabled = true;
			this.plugin.settings.llmProvider = 'ollama';
			this.plugin.settings.ollamaModel = model.ollamaModelName || 'gemma3:4b';
		}
		await this.plugin.saveSettings();
	}
}
