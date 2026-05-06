import {
	getPersistFileName,
	resolveActorId,
} from '../lib/event/event-persist.js';
import {failed, isFail} from '../lib/model/result-types.js';
import {getState} from '../lib/state/state.js';
import {syncEpiqWithRemote} from './sync.js';

const AUTO_SYNC_INTERVAL_MS = 15_000;

let lastAutoSyncStartedAt = 0;
let queuedAutoSyncTimer: NodeJS.Timeout | undefined;
let autoSyncInFlight = false;

const isSyncing = () =>
	autoSyncInFlight || getState().syncStatus.status === 'syncing';

export const autoSync = async () => {
	if (isSyncing()) {
		return failed('Sync already in progress');
	}

	const userRes = resolveActorId();
	if (isFail(userRes) || !userRes.value) {
		return failed('Unable to resolve event log path');
	}

	autoSyncInFlight = true;
	lastAutoSyncStartedAt = Date.now();

	try {
		const ownEventFileName = getPersistFileName(userRes.value);
		return await syncEpiqWithRemote({ownEventFileName});
	} finally {
		autoSyncInFlight = false;
	}
};

export const queueAutoSync = () => {
	if (isSyncing()) return;

	const now = Date.now();
	const elapsed = now - lastAutoSyncStartedAt;
	const delay = Math.max(0, AUTO_SYNC_INTERVAL_MS - elapsed);

	if (queuedAutoSyncTimer) return;

	queuedAutoSyncTimer = setTimeout(async () => {
		queuedAutoSyncTimer = undefined;

		if (isSyncing()) return;

		await autoSync();
	}, delay);
};
