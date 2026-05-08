import {ulid} from 'ulid';
import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {
	getMovePendingState,
	moveChildWithinParent,
	moveNodeToSiblingContainer,
	setMovePendingState,
} from '../../actions/move/move-actions-utils.js';
import {materializeAndPersist} from '../../event/event-materialize-and-persist.js';
import {resolveActorId} from '../../event/event-persist.js';
import {MovePosition} from '../../event/event.model.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {
	getOrderedChildren,
	resolveAndPersistRankForMove,
} from '../../repository/rank.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getRenderedChildren, getState, patchState} from '../../state/state.js';
import {getPersistRoot} from '../../storage/paths.js';

export const moveCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	const persistRoot = persistRootResult.value;
	const {modifier} = getCmdState().commandMeta;

	const syncNavigationToPendingMove = (): Result<null> => {
		const pendingMoveState = getMovePendingState();
		if (!pendingMoveState) return failed('No pending move state');

		const movedNodeId = pendingMoveState.payload.id;
		const movedNode = getState().nodes[movedNodeId];
		if (!movedNode) return failed('Moved node not found');

		const parentId = pendingMoveState.payload.parent;
		const parent = getState().nodes[parentId];
		if (!parent) return failed('Move parent not found');

		const selectedIndex = getRenderedChildren(parentId).findIndex(
			x => x.id === movedNodeId,
		);
		if (selectedIndex === -1) {
			return failed('Moved node not found among rendered children');
		}

		navigationUtils.navigate({currentNode: parent, selectedIndex});
		return succeeded('Synchronized navigation to moved node', null);
	};

	const applyMovePreview = (moveResult: Result<unknown>): Result<null> => {
		if (isFail(moveResult)) return failed(moveResult.message);

		const navResult = syncNavigationToPendingMove();
		if (isFail(navResult)) return failed(navResult.message);

		return succeeded('Updated move preview', null);
	};

	const {currentNode, selectedIndex} = getState();
	const targetNode = getRenderedChildren(currentNode.id)[selectedIndex];

	if (!targetNode) {
		patchState({mode: Mode.DEFAULT});
		return failed('No move target');
	}

	if (modifier === 'start') {
		if (targetNode.readonly) return failed('Target node is read-only');
		if (selectedIndex === -1) return failed('No item selected');
		if (!targetNode.parentNodeId) return failed('Target has no parent');

		const siblings = getOrderedChildren(targetNode.parentNodeId);
		const currentIndex = siblings.findIndex(({id}) => id === targetNode.id);

		if (currentIndex === -1) {
			return failed('Target not found among siblings');
		}

		const previousSibling = siblings[currentIndex - 1];
		const nextSibling = siblings[currentIndex + 1];

		const position: MovePosition =
			nextSibling != null
				? {at: 'before', sibling: nextSibling.id}
				: previousSibling != null
				? {at: 'after', sibling: previousSibling.id}
				: {at: 'start'};

		const rankResult = resolveAndPersistRankForMove(
			targetNode.parentNodeId,
			targetNode.id,
			position,
			userRes.value,
			persistRoot,
		);

		if (isFail(rankResult)) return rankResult;

		setMovePendingState({
			id: ulid(),
			action: 'move.node',
			payload: {
				id: targetNode.id,
				parent: targetNode.parentNodeId,
				rank: rankResult.value,
			},
			...userRes.value,
		});

		patchState({mode: Mode.MOVE});

		const navResult = syncNavigationToPendingMove();
		if (isFail(navResult)) return failed(navResult.message);

		return succeeded('Move initialized', null);
	}

	if (modifier === 'next') {
		patchState({mode: Mode.MOVE});
		return applyMovePreview(await moveChildWithinParent(1));
	}

	if (modifier === 'previous') {
		patchState({mode: Mode.MOVE});
		return applyMovePreview(await moveChildWithinParent(-1));
	}

	if (modifier === 'to-next') {
		patchState({mode: Mode.MOVE});
		return applyMovePreview(await moveNodeToSiblingContainer(1));
	}

	if (modifier === 'to-previous') {
		patchState({mode: Mode.MOVE});
		return applyMovePreview(await moveNodeToSiblingContainer(-1));
	}

	if (modifier === 'confirm') {
		patchState({mode: Mode.DEFAULT});

		const pendingMoveState = getMovePendingState();
		if (!pendingMoveState) return failed('No pending move to confirm');

		const result = materializeAndPersist(pendingMoveState, persistRoot);
		if (isFail(result)) return result;

		const navResult = syncNavigationToPendingMove();
		if (isFail(navResult)) return failed(navResult.message);

		setMovePendingState(null);
		return succeeded('Moved item', null);
	}

	if (modifier === 'cancel') {
		setMovePendingState(null);
		patchState({mode: Mode.DEFAULT});
		return succeeded('Cancelling move', null);
	}

	return failed('Invalid move modifier');
};
