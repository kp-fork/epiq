import fs from 'node:fs';
import {
	captureNavigationAnchor,
	restoreNavigationAnchor,
} from '../lib/actions/default/restore-navigation.js';
import {bootStateFromEventLog} from '../lib/event/event-boot.js';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {
	getPersistFileName,
	resolveActorId,
} from '../lib/event/event-persist.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {patchState} from '../lib/state/state.js';
import {failSync, setSynced, setSyncing} from '../lib/state/sync-state.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {getStateBranch} from './git-constants.js';
import {
	ensureStateBranchLayout,
	getEventFilePath,
	getRepoRootDir,
	getStateBranchRoot,
} from './git-storage.js';
import {
	execGit,
	hasInProgressGitOperation,
	hasStateBranchChanges,
	isDetachedHead,
	isNonFastForward,
	pullBranchRebaseIfPresent,
} from './git-utils.js';
import {
	bootstrapStateBranchStorage,
	createStateBranchSyncCommit,
	ensureInitialCommit,
	pushStateBranch,
	stageStateBranchOwnEventFile,
} from './git.js';
import {hydrateEventsFromStateBranch, mergeEventFile} from './merge.js';

export const syncEpiqFromRemote = async (
	cwd = process.cwd(),
): Promise<Result<{repoRoot: string; stateBranchRoot: string}>> => {
	logger.info('[sync] syncEpiqFromRemote:start', cwd);

	setSyncing('Syncing from remote');

	const ready = await ensureSyncReady({
		cwd,
		ensureUpstream: false,
	});
	if (isFail(ready)) return failSync(ready.message);

	const {repoRoot, stateBranchRoot} = ready.value;

	logger.info('[sync] ready', {
		repoRoot,
		stateBranchRoot,
	});

	const stateBranchResult = getStateBranch(cwd);
	if (isFail(stateBranchResult)) return failSync(stateBranchResult.message);

	const stateBranch = stateBranchResult.value;

	logger.info('[sync] pulling state branch', stateBranch);

	const pullResult = await pullBranchRebaseIfPresent({
		cwd: stateBranchRoot,
		branch: stateBranch,
	});
	if (isFail(pullResult)) return failSync(pullResult.message);

	const hydrateResult = hydrateEventsFromStateBranch({
		repoRoot,
		stateBranchRoot,
	});
	if (isFail(hydrateResult)) return failSync(hydrateResult.message);

	logger.info('[sync] hydrated local events from state branch');

	setSynced('Synced from remote');

	logger.info('[sync] syncEpiqFromRemote:done');

	return succeeded('Synced state branch', {
		repoRoot,
		stateBranchRoot,
	});
};

type SyncSummary = {
	repoRoot: string;
	stateBranchRoot: string;
	createdCommit: boolean;
	commitSha?: string;
	pulled: boolean;
	pushed: boolean;
	hydrated: boolean;
	bootstrapped: boolean;
};

type SyncArgs = {
	cwd?: string;
	ownEventFileName: string;
};

type SyncOwnFileCommitResult = {
	createdCommit: boolean;
	commitSha?: string;
};

export const mergeOwnEventFileToStateBranch = ({
	repoRoot,
	stateBranchRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	stateBranchRoot: string;
	ownEventFileName: string;
}): Result<boolean> => {
	const localFile = getEventFilePath({
		root: repoRoot,
		fileName: ownEventFileName,
	});

	const stateBranchFile = getEventFilePath({
		root: stateBranchRoot,
		fileName: ownEventFileName,
	});

	if (!fs.existsSync(localFile)) {
		return succeeded('Local own event file missing, nothing to merge', false);
	}

	return mergeEventFile({
		sourceFile: localFile,
		targetFile: stateBranchFile,
	});
};
const ensureSyncReady = async ({
	cwd,
	ensureUpstream,
}: {
	cwd: string;
	ensureUpstream: boolean;
}): Promise<
	Result<{
		repoRoot: string;
		stateBranchRoot: string;
		bootstrapped: boolean;
	}>
> => {
	const repoRootResult = await getRepoRootDir(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.value;

	logger.info('[sync] repo root', repoRoot);

	const stateBranchRootResult = getStateBranchRoot({repoRoot});
	if (isFail(stateBranchRootResult)) {
		return failed(stateBranchRootResult.message);
	}

	const stateBranchRoot = stateBranchRootResult.value;

	// Read-only boot hydration should not be blocked by the user's working
	// repo state. It only needs to reconstruct/read the Epiq state branch.
	//
	// Push-capable sync still stays conservative because it may create commits
	// and push state.
	if (ensureUpstream) {
		const repoOpResult = await hasInProgressGitOperation(repoRoot);
		if (isFail(repoOpResult)) return failed(repoOpResult.message);

		if (repoOpResult.value) {
			return failed(
				'Cannot sync while a git operation is in progress in the current repo',
			);
		}
	}

	const initResult = await ensureInitialCommit(repoRoot);
	if (isFail(initResult)) return failed(initResult.message);

	const bootstrapResult = await bootstrapStateBranchStorage({
		repoRoot,
		stateBranchRoot,
		ensureUpstream,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	logger.info('[sync] bootstrap result', {
		bootstrapped: bootstrapResult.value,
		stateBranchRoot,
	});

	const stateOpResult = await hasInProgressGitOperation(stateBranchRoot);
	if (isFail(stateOpResult)) return failed(stateOpResult.message);

	if (stateOpResult.value) {
		return failed(
			'Cannot sync while a git operation is in progress in the state branch',
		);
	}

	const layoutResult = ensureStateBranchLayout(repoRoot, stateBranchRoot);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	return succeeded('Sync preconditions satisfied', {
		repoRoot,
		stateBranchRoot,
		bootstrapped: bootstrapResult.value,
	});
};

const commitOwnEventFileToStateBranch = async ({
	repoRoot,
	stateBranchRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	stateBranchRoot: string;
	ownEventFileName: string;
}): Promise<Result<SyncOwnFileCommitResult>> => {
	logger.info('[sync] merging own event file', ownEventFileName);

	const mergeResult = mergeOwnEventFileToStateBranch({
		repoRoot,
		stateBranchRoot,
		ownEventFileName,
	});
	if (isFail(mergeResult)) return failed(mergeResult.message);

	const changedResult = await hasStateBranchChanges(stateBranchRoot);
	if (isFail(changedResult)) return failed(changedResult.message);

	if (!mergeResult.value && !changedResult.value) {
		logger.info('[sync] own event file already up to date');

		return succeeded('Own event file already up to date in state branch', {
			createdCommit: false,
		});
	}

	const stageResult = await stageStateBranchOwnEventFile({
		stateBranchRoot,
		eventFileName: ownEventFileName,
	});
	if (isFail(stageResult)) return failed(stageResult.message);

	logger.info('[sync] creating sync commit');

	const commitResult = await createStateBranchSyncCommit({
		repoRoot,
		stateBranchRoot,
	});
	if (isFail(commitResult)) return failed(commitResult.message);

	logger.info('[sync] created sync commit', commitResult.value);

	return succeeded('Merged, staged, and committed own event file', {
		createdCommit: true,
		commitSha: commitResult.value,
	});
};

export const syncEpiqWithRemote = async ({
	cwd = process.cwd(),
	ownEventFileName,
}: SyncArgs): Promise<Result<SyncSummary>> => {
	logger.info('[sync] syncEpiqWithRemote:start', {
		cwd,
		ownEventFileName,
	});

	// Validate filename
	if (ownEventFileName.includes('/') || ownEventFileName.includes('\\')) {
		return failed('Own event file must be a file name, not a path');
	}

	if (!ownEventFileName.endsWith('.jsonl')) {
		return failed('Own event file must end with .jsonl');
	}

	setSyncing('Syncing');

	const ready = await ensureSyncReady({
		cwd,
		ensureUpstream: true,
	});
	if (isFail(ready)) return failSync(ready.message);

	const {repoRoot, stateBranchRoot, bootstrapped} = ready.value;

	logger.info('[sync] sync ready', {
		repoRoot,
		stateBranchRoot,
		bootstrapped,
	});

	// Detached mode guard
	const detachedResult = await isDetachedHead(repoRoot);
	if (isFail(detachedResult)) return failSync(detachedResult.message);

	if (detachedResult.value) {
		return failSync(
			'Cannot run :sync while the repository is in detached HEAD state',
		);
	}

	let createdCommit = false;
	let commitSha: string | undefined;
	let pulled = false;
	let pushed = false;
	let hydrated = false;

	const stateBranchResult = getStateBranch(repoRoot);
	if (isFail(stateBranchResult)) return failSync(stateBranchResult.message);

	const stateBranch = stateBranchResult.value;

	const pullResult = await pullBranchRebaseIfPresent({
		cwd: stateBranchRoot,
		branch: stateBranch,
	});
	if (isFail(pullResult)) return failSync(pullResult.message);

	pulled = pullResult.value;

	logger.info('[sync] pull result', pulled);

	const hydrateResult = hydrateEventsFromStateBranch({
		repoRoot,
		stateBranchRoot,
	});
	if (isFail(hydrateResult)) return failSync(hydrateResult.message);

	hydrated = hydrateResult.value;

	logger.info('[sync] hydrate result', hydrated);

	const syncOwnResult = await commitOwnEventFileToStateBranch({
		repoRoot,
		stateBranchRoot,
		ownEventFileName,
	});
	if (isFail(syncOwnResult)) return failSync(syncOwnResult.message);

	createdCommit = syncOwnResult.value.createdCommit;
	commitSha = syncOwnResult.value.commitSha;

	logger.info('[sync] sync own result', {
		createdCommit,
		commitSha,
	});

	if (createdCommit || bootstrapped) {
		const pushResult = await pushStateBranch({stateBranchRoot, repoRoot});

		let finalPushResult = pushResult;

		if (isFail(pushResult) && isNonFastForward(pushResult.message)) {
			logger.info('[sync] non-fast-forward, retrying sync');

			const pullRetryResult = await pullBranchRebaseIfPresent({
				cwd: stateBranchRoot,
				branch: stateBranch,
			});
			if (isFail(pullRetryResult)) {
				return failSync(pullRetryResult.message);
			}

			const retrySyncOwnResult = await commitOwnEventFileToStateBranch({
				repoRoot,
				stateBranchRoot,
				ownEventFileName,
			});

			if (isFail(retrySyncOwnResult)) {
				return failSync(retrySyncOwnResult.message);
			}

			logger.info('[sync] retry sync result', retrySyncOwnResult.value);

			if (retrySyncOwnResult.value.createdCommit) {
				createdCommit = true;
				commitSha = retrySyncOwnResult.value.commitSha;
			}

			finalPushResult = await pushStateBranch({
				stateBranchRoot,
				repoRoot,
			});
		}

		if (isFail(finalPushResult)) {
			return failSync(finalPushResult.message);
		}

		pushed = finalPushResult.value;

		logger.info('[sync] pushed to state branch', pushed);
	} else {
		logger.info('[sync] no commit created, skipped push');
	}

	if (createdCommit) {
		const finalShaResult = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: stateBranchRoot,
		});

		if (isFail(finalShaResult)) {
			return failSync(finalShaResult.message);
		}

		commitSha = finalShaResult.value.stdout.trim();

		logger.info('[sync] final sync commit sha', commitSha);
	}

	setSynced(
		pushed
			? 'Synced and pushed'
			: pulled || hydrated || createdCommit
			? 'Synced local state'
			: 'Already synced',
	);

	logger.info('[sync] syncEpiqWithRemote:done', {
		pulled,
		pushed,
		hydrated,
		createdCommit,
		bootstrapped,
		commitSha,
	});

	return succeeded('Synced event logs with state branch', {
		repoRoot,
		stateBranchRoot,
		createdCommit,
		commitSha,
		pulled,
		pushed,
		hydrated,
		bootstrapped,
	});
};

// Consider better place for this fn
export const syncAndHydrateState = async () => {
	const navigationAnchor = captureNavigationAnchor();

	const userRes = resolveActorId();
	if (isFail(userRes) || !userRes.value) {
		return failed('Unable to resolve event log path');
	}

	const ownEventFileName = getPersistFileName(userRes.value);

	const syncResult = await syncEpiqWithRemote({ownEventFileName});
	if (isFail(syncResult)) {
		return failed(`Unable to sync state. ${syncResult.message}`);
	}

	const epiqRootDirResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(epiqRootDirResult)) return epiqRootDirResult;

	const allLoadedEventsResult = loadMergedEvents(epiqRootDirResult.value);
	if (isFail(allLoadedEventsResult)) {
		return failed(`Unable to load events. ${allLoadedEventsResult.message}`);
	}

	const bootResult = bootStateFromEventLog({
		eventLog: allLoadedEventsResult.value,
		hasProject: true,
	});
	if (isFail(bootResult)) {
		return failed(`Unable to boot synced state. ${bootResult.message}`);
	}

	patchState({
		hasProject: true,
		syncStatus: {
			msg: 'Synced',
			status: 'synced',
		},
	});

	const restoreResult = restoreNavigationAnchor(navigationAnchor);
	if (isFail(restoreResult)) return restoreResult;

	return succeeded('Synced', true);
};
