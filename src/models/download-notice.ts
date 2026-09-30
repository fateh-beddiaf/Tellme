import { Notice, ProgressBarComponent } from 'obsidian';

/**
 * A persistent Obsidian notice showing live download progress, so the user
 * can follow a model download even after closing the settings window.
 * Uses Obsidian's native ProgressBarComponent (since 1.4.4) inside a
 * duration-0 Notice updated in place.
 */
export class DownloadNotice {
	private notice: Notice;
	private bar: ProgressBarComponent;
	private textEl: HTMLElement;

	constructor(modelName: string) {
		const fragment = createFragment();
		const wrapper = fragment.createDiv({ cls: 'tellme-download-notice' });
		wrapper.createDiv({
			text: `Downloading ${modelName}`,
			cls: 'tellme-download-notice-title',
		});
		this.bar = new ProgressBarComponent(wrapper);
		this.bar.setValue(0);
		this.textEl = wrapper.createDiv({
			text: 'Starting download...',
			cls: 'tellme-download-notice-text',
		});
		// duration 0 = stays until we hide it (or the user dismisses it)
		this.notice = new Notice(fragment, 0);
	}

	update(percentage: number, statusText: string): void {
		this.bar.setValue(percentage);
		this.textEl.setText(statusText);
	}

	complete(message: string): void {
		this.bar.setValue(100);
		this.textEl.setText(message);
		window.setTimeout(() => this.notice.hide(), 5000);
	}

	fail(message: string): void {
		this.textEl.setText(message);
		window.setTimeout(() => this.notice.hide(), 8000);
	}
}
