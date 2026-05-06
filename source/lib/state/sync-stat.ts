import {failed, Result} from '../model/result-types.js';
import {patchState} from './state.js';

export const setSyncing = (msg = 'Syncing...') => {
	patchState({
		syncStatus: {
			status: 'syncing',
			msg,
		},
	});
};

export const setSynced = (msg = 'Synced') => {
	patchState({
		syncStatus: {
			status: 'synced',
			msg,
		},
	});
};

export const setOutOfSync = (msg: string) => {
	patchState({
		syncStatus: {
			status: 'outOfSync',
			msg,
		},
	});
};

export const failSync = <T>(message: string): Result<T> => {
	setOutOfSync(message);
	return failed(message);
};
