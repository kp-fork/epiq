import {ulid} from 'ulid';
import {openEditorOnText} from '../../editor/editor.js';
import {materializeAndPersist} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {BreadCrumb, findInBreadCrumb} from '../../model/app-state.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {getRenderedChildren, getState} from '../../state/state.js';

export const editCommand = () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {breadCrumb, selectedNode} = getState();
	const issueResult = findInBreadCrumb(
		[...breadCrumb, selectedNode] as BreadCrumb,
		'TICKET',
	);
	if (isFail(issueResult)) return failed('Edit target must be an issue');

	const issueNode = issueResult.value;
	if (issueNode.readonly) return failed('Cannot edit readonly field');
	const target = getRenderedChildren(issueNode.id).find(
		x => x.title === 'Description',
	);
	if (!target) return failed('No target found');
	if (target.readonly) return failed('Cannot edit readonly field');

	const currentValue = target.props.value;

	if (typeof currentValue !== 'string') {
		return failed('Selected field is not editable text');
	}

	const editResult = openEditorOnText(currentValue);
	if (isFail(editResult)) return failed('Failed to edit field');

	const updatedValue = editResult.value;

	if (updatedValue === currentValue) {
		return succeeded('No changes made', null);
	}

	if (target.title === 'Description') {
		return materializeAndPersist({
			id: ulid(),
			action: 'edit.description',
			payload: {
				id: target.id,
				md: updatedValue,
			},
			...userRes.value,
		});
	}

	if (target.title === 'Title') {
		return materializeAndPersist({
			id: ulid(),
			action: 'edit.title',
			payload: {
				id: target.id,
				name: updatedValue,
			},
			...userRes.value,
		});
	}

	return failed(`Editing not supported for "${target.title}"`);
};
