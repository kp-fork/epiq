import {resultStatuses, isFail} from '../model/result-types.js';
import {getPersistRoot} from '../storage/paths.js';
import {materialize} from './event-materialize.js';
import {persist} from './event-persist.js';
import {AppEvent, EventAction, MaterializeResult} from './event.model.js';

export function materializeAndPersist<A extends EventAction>(
	event: AppEvent<A>,
	rootDir: string,
): MaterializeResult<A> {
	const materialized = materialize(event);

	if (materialized.status !== resultStatuses.Success) {
		return materialized;
	}

	const persistResult = persist({
		event,
		rootDir,
	});

	if (isFail(persistResult)) return persistResult;

	return materialized;
}

export function materializeAndPersistAll<const T extends readonly AppEvent[]>(
	events: T,
	rootDir: string,
) {
	return events.map(event => materializeAndPersist(event, rootDir));
}

export const persistEvent = async <A extends EventAction>(
	event: AppEvent<A>,
) => {
	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	return materializeAndPersist(event, persistRootResult.value);
};
