export type User = {
	userId: string;
	userName: string;
};

export type SettingsState = {
	autoSyncIntervalMs: number | null;
	autoSync: boolean | null;
	preferredEditor: string | null;
	userName: string | null;
	userId: string | null;
};

let settingsState: SettingsState = {
	autoSyncIntervalMs: null,
	autoSync: null,
	preferredEditor: null,
	userName: null,
	userId: null,
};

export const getSettingsState = (): SettingsState => settingsState;

export const patchSettingsState = (
	patch: Partial<SettingsState>,
): SettingsState => {
	settingsState = {
		...settingsState,
		...patch,
	};
	return settingsState;
};
