export function normalizePath(path) {
	if (!path) return '';
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

export async function requestUrl(options) {
	return { status: 200, json: {}, text: '', headers: {} };
}

export class App {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {
	setName() { return this; }
	setHeading() { return this; }
	setDesc() { return this; }
	addText() { return this; }
	addDropdown() { return this; }
	addButton() { return this; }
	addToggle() { return this; }
	setClass() { return this; }
	addExtraButton() { return this; }
}
export class Notice {
	constructor(msg) { this.message = msg; }
}
export class TFile {}
export class TFolder {}
export const Platform = { isDesktop: true, isMobile: false };
