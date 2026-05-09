import {failed, Result} from '../model/result-types.js';
import {isStateInitialized, patchState} from './state.js';

const patchSyncStatus = ({
	status,
	msg,
}: {
	status: 'synced' | 'outOfSync' | 'syncing';
	msg: string;
}) => {
	if (!isStateInitialized()) return;

	patchState({
		syncStatus: {
			status,
			msg,
		},
	});
};

export const setSyncing = (msg = 'Syncing...') => {
	patchSyncStatus({
		status: 'syncing',
		msg,
	});
};

export const setSynced = (msg = 'Synced') => {
	patchSyncStatus({
		status: 'synced',
		msg,
	});
};

export const setOutOfSync = (msg: string) => {
	patchSyncStatus({
		status: 'outOfSync',
		msg,
	});
};

export const failSync = <T>(message: string): Result<T> => {
	setOutOfSync(message);
	return failed(message);
};
