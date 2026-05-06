import fs from 'node:fs';
import path from 'node:path';
import {ensureLocalEpiqIgnored} from '../../../git/ensure-local-events-ignored.js';
import {git} from '../../../git/git-commands.js';
import {
	ensureWorktreesDir,
	getRepoRootDir,
	getWorktreesRoot,
} from '../../../git/git-storage.js';
import {
	commitAndGetSha,
	execGit,
	hasInProgressGitOperation,
	hasLocalBranch,
} from '../../../git/git-utils.js';
import {
	createStateBranch,
	ensureStateBranchWorktree,
	pushStateBranch,
	stageStateBranchOwnEventFile,
} from '../../../git/git.js';
import {hydrateEventsFromStateBranch} from '../../../git/merge.js';
import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {getUserSetupStatus} from '../../config/setup-utils.js';
import {createDefaultEvents} from '../../event/event-boot.js';
import {materializeAndPersistAll} from '../../event/event-materialize-and-persist.js';
import {getPersistFileName, persist} from '../../event/event-persist.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {
	ensureProjectFile,
	getProjectFileContents,
} from '../../project-setup/project-setup.js';
import {getSettingsState} from '../../state/settings.state.js';
import {getState, patchState} from '../../state/state.js';
import {hasLocalProjectFile} from '../../storage/paths.js';

const hasDiff = async (repoRoot: string) => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['status', '--porcelain'],
	});

	if (isFail(result)) return result;

	return succeeded('Checked git diff', result.value.stdout.trim().length > 0);
};

const failAt = (step: number, message: string) =>
	failed(`[${step}] ${message}`);

export const initCommand = async () => {
	const projectFileContents = getProjectFileContents();

	// :init
	// 1. fail if not in git repo
	const repoRootResult = await getRepoRootDir(process.cwd());
	if (isFail(repoRootResult)) {
		return failAt(1, repoRootResult.message);
	}
	const repoRoot = repoRootResult.value;

	// 2. fail if pending git operation
	const pendingGitOperationResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(pendingGitOperationResult)) {
		return failAt(2, pendingGitOperationResult.message);
	}
	if (pendingGitOperationResult.value) {
		return failAt(
			2,
			'Cannot initialize Epiq while a git operation is in progress',
		);
	}

	// 3 fail if there are files in the diff
	const diffResult = await hasDiff(repoRoot);
	if (isFail(diffResult)) {
		return failAt(2.5, diffResult.message);
	}

	if (diffResult.value) {
		return failAt(
			3,
			'Cannot initialize Epiq with uncommitted changes. Commit or stash your changes first.',
		);
	}

	// 4. fail if .epiq/project.json already exists
	if (hasLocalProjectFile(repoRoot)) {
		return failAt(4, 'Epiq project already initialized');
	}

	// 5. resolve repo root/user ids from ~/.epiq-global/config.json
	const setupStatus = getUserSetupStatus();
	if (!setupStatus.isSetupDone || !setupStatus.userName) {
		return failAt(
			5,
			'Missing Epiq user configuration (userId / userName). Run setup first.',
		);
	}

	const settings = getSettingsState();
	const userName = settings.userName;
	const userId = settings.userId;
	if (!userId || !userName) {
		return failAt(5, 'Missing Epiq user id');
	}

	// 6. create state branch (or fail if state branch already exists)
	const stateBranch = projectFileContents.stateBranch;
	const stateBranchExistsResult = await hasLocalBranch({
		repoRoot,
		branch: stateBranch,
	});

	if (isFail(stateBranchExistsResult)) {
		return failAt(6, stateBranchExistsResult.message);
	}

	const createStateBranchResult = await createStateBranch({
		repoRoot,
		stateBranchName: projectFileContents.stateBranch,
	});
	if (isFail(createStateBranchResult)) {
		return failAt(6, createStateBranchResult.message);
	}

	// 7. ensure ~/.epiq-global/worktrees/ exists
	const ensureWorktreesDirResult = ensureWorktreesDir();
	if (isFail(ensureWorktreesDirResult)) {
		return failAt(7, ensureWorktreesDirResult.message);
	}

	// 8. ensure worktree for state branch exists
	const stateBranchRoot = path.join(
		getWorktreesRoot(),
		projectFileContents.projectId,
	);

	const ensureWorktreeResult = await ensureStateBranchWorktree({
		repoRoot,
		stateBranchRoot,
		stateBranchName: projectFileContents.stateBranch,
	});
	if (isFail(ensureWorktreeResult)) {
		return failAt(8, ensureWorktreeResult.message);
	}

	// 9. Create .epiq folder in state branch
	// and write initial event log to worktree:
	// ~/.epiq-global/worktrees/<tree-id>/.epiq/events/<userid>.<username>.jsonl
	const stateEpiqDir = path.join(stateBranchRoot, '.epiq');
	fs.mkdirSync(stateEpiqDir, {recursive: true});

	const defaultEventsResult = createDefaultEvents({userId, userName});
	if (isFail(defaultEventsResult)) {
		return failAt(9, defaultEventsResult.message);
	}

	for (const event of defaultEventsResult.value) {
		const persistResult = persist({event, rootDir: stateBranchRoot});
		if (isFail(persistResult)) return failAt(9, persistResult.message);
	}

	// 10. commit initial event log on state branch
	const stageStateEventFileResult = await stageStateBranchOwnEventFile({
		stateBranchRoot,
		eventFileName: getPersistFileName({userId, userName}),
	});
	if (isFail(stageStateEventFileResult)) {
		return failAt(10, stageStateEventFileResult.message);
	}

	const commitStateBranchResult = await commitAndGetSha({
		cwd: stateBranchRoot,
		message: '[epiq:init]',
	});
	if (isFail(commitStateBranchResult)) {
		return failAt(10, commitStateBranchResult.message);
	}

	// 11. switch back to original branch (no-op)

	// 12. ensure .epiq/events and .epiq/log are ignored
	const ignoreResult = await ensureLocalEpiqIgnored(repoRoot);
	if (isFail(ignoreResult)) {
		return failAt(12, ignoreResult.message);
	}

	// 13. create .epiq/project.json
	const projectResult = ensureProjectFile({
		repoRoot,
		fileContents: projectFileContents,
	});
	if (isFail(projectResult)) {
		return failAt(13, projectResult.message);
	}

	// 14. commit .epiq/project.json on original branch
	const stageProjectResult = await git.stage({
		cwd: repoRoot,
		pathspec: ['.epiq/project.json', '.gitignore'],
	});
	if (isFail(stageProjectResult)) {
		return failAt(14, stageProjectResult.message);
	}

	const commitProjectResult = await git.commit({
		cwd: repoRoot,
		message: '[epiq:init-project]',
	});
	if (isFail(commitProjectResult)) {
		return failAt(14, commitProjectResult.message);
	}

	// 15. sync state branch events into local .epiq/events
	const hydrateResult = hydrateEventsFromStateBranch({
		repoRoot,
		stateBranchRoot,
	});
	if (isFail(hydrateResult)) {
		return failAt(15, hydrateResult.message);
	}

	let successMessage = 'Project initialized!';

	// 16. try - push state branch / set upstream
	const pushStateResult = await pushStateBranch({
		repoRoot,
		stateBranchRoot,
	});
	if (isFail(pushStateResult)) {
		successMessage += ` Warn: [init:16] ${pushStateResult.message}`;
	}

	// 17. try - push original branch
	const pushOriginalResult = await git.push({cwd: repoRoot});
	if (isFail(pushOriginalResult)) {
		successMessage += ` Warn: [init:17] ${pushOriginalResult.message}`;
	}

	// 18. boot app
	const materializeResults = materializeAndPersistAll(
		defaultEventsResult.value,
	);
	const failures = materializeResults.filter(isFail);

	if (failures.length > 0) {
		return failAt(18, failures.map(f => f.message).join('\n'));
	}

	const {rootNodeId, nodes} = getState();

	navigationUtils.navigate({
		currentNode: nodes[rootNodeId],
		selectedIndex: 0,
	});

	patchState({
		hasProject: true,
		mode: Mode.DEFAULT,
	});

	return succeeded(successMessage, null);
};
