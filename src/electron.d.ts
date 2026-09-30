// Hand-written minimal typings for the 'electron' module as it exists in the
// Obsidian renderer. Only the surface this plugin uses is declared; the
// runtime code guards against the module not exposing `remote` at all.
declare module 'electron' {
	export interface RemoteGlobalShortcut {
		register(accelerator: string, callback: () => void): boolean;
		unregister(accelerator: string): void;
		unregisterAll(): void;
		isRegistered(accelerator: string): boolean;
	}

	export interface ElectronRemote {
		globalShortcut?: RemoteGlobalShortcut;
	}

	export const remote: ElectronRemote;
}
