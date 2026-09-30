import { AbstractInputSuggest, type App } from 'obsidian';

/**
 * Drop-down of a provider's model IDs under a text field. Clicking the field
 * shows the whole list; typing filters it. Any ID can still be typed by hand.
 */
export class ModelSuggest extends AbstractInputSuggest<string> {
	private getModels: () => string[];
	private onPick: (model: string) => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		getModels: () => string[],
		onPick: (model: string) => void,
	) {
		super(app, inputEl);
		this.getModels = getModels;
		this.onPick = onPick;
		this.limit = 500;
	}

	protected getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		const models = this.getModels();
		return q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
	}

	renderSuggestion(model: string, el: HTMLElement): void {
		el.setText(model);
	}

	selectSuggestion(model: string): void {
		this.setValue(model);
		this.onPick(model);
		this.close();
	}
}
