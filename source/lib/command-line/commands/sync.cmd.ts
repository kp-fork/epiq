import {syncAndHydrateState} from '../../../git/sync.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail} from '../../model/result-types.js';
import {setCmdInput} from '../../state/cmd.state.js';
import {getState, patchState} from '../../state/state.js';

export const syncCommand = async () => {
	if (getState().syncStatus.status === 'syncing') {
		return failed('Sync already in progress');
	}

	setCmdInput(() => '');

	patchState({
		syncStatus: {
			msg: 'Syncing',
			status: 'syncing',
		},
	});

	const result = await syncAndHydrateState();
	if (isFail(result)) {
		patchState({
			syncStatus: {
				msg: result.message,
				status: 'outOfSync',
			},
		});

		return result;
	}

	patchState({mode: Mode.DEFAULT});

	return result;
};
