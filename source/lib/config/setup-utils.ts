import {readProjectFile} from '../project-setup/project-setup.js';
import {failed, isFail, isSuccess} from '../model/result-types.js';
import {getSettingsState} from '../state/settings.state.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';

export const getUserSetupStatus = (): {
	hasPreferredEditor: boolean;
	hasUserName: boolean;
	userName: string | null;
	preferredEditor: string | null;
	isSetup: boolean;
} => {
	const settings = getSettingsState();
	const hasUserName = Boolean(settings.userName?.trim());
	const hasPreferredEditor = Boolean(settings.preferredEditor?.trim());
	return {
		isSetup: hasPreferredEditor && hasUserName,
		hasPreferredEditor,
		hasUserName,
		userName: settings.userName,
		preferredEditor: settings.preferredEditor,
	};
};
export const isRepositoryInitialized = () => {
	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRootResult))
		return failed('Unable to determine if repository is initialized');
	const projectFileResult = readProjectFile(repoRootResult.value);

	return isSuccess(projectFileResult);
};
