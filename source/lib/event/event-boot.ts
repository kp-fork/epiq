import chalk from 'chalk';
import {monotonicFactory, ulid} from 'ulid';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {Mode} from '../model/action-map.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {nodes} from '../state/node-builder.js';
import {
	getRenderedChildren,
	getState,
	initWorkspaceState,
	patchState,
} from '../state/state.js';
import {rankBetween} from '../utils/rank.js';
import {materializeAll} from './event-materialize.js';
import {AppEvent} from './event.model.js';
import {CLOSED_BOARD_ID, CLOSED_SWIMLANE_ID} from './static-ids.js';

const SYSTEM_ACTOR_ID = `system` as const;
const SYSTEM_ACTOR_NAME = `ACTOR` as const;

const nextId = monotonicFactory();

export function getBootNavigationTarget() {
	const workspace = Object.values(getState().nodes).find(
		node => node.context === 'WORKSPACE',
	);

	if (!workspace) {
		throw new Error('No workspace found in event log');
	}

	const [firstBoard] = getRenderedChildren(workspace.id);
	const [firstSwimlane] = firstBoard ? getRenderedChildren(firstBoard.id) : [];

	logger.debug('Boot navigation target:', {
		workspace: workspace?.id,
		firstBoard: firstBoard?.id,
		firstSwimlane: firstSwimlane?.id,
	});
	if (firstSwimlane) {
		const children = getState().renderedChildrenIndex?.[firstSwimlane.id] ?? [];
		return {
			currentNode: firstSwimlane,
			selectedIndex: children.length > 0 ? 0 : -1,
		};
	} else if (firstBoard) {
		return {
			currentNode: firstBoard,
			selectedIndex: 0,
		};
	} else if (workspace) {
		return {
			currentNode: workspace,
			selectedIndex: 0,
		};
	} else {
		return {
			currentNode: getState().nodes[getState().rootNodeId],
			selectedIndex: 0,
		};
	}
}

export function navigateToInitialNode() {
	const navigationTarget = getBootNavigationTarget();
	navigationUtils.navigate(navigationTarget);
}

export function createDefaultEvents(): Result<readonly AppEvent[]> {
	const workspaceId = nextId();
	const boardId = nextId();
	const swimlaneId1 = nextId();
	const swimlaneId2 = nextId();
	const swimlaneId3 = nextId();

	const workspaceRank = rankBetween(undefined, undefined);
	if (isFail(workspaceRank)) return workspaceRank;

	const defaultBoardRank = rankBetween(undefined, undefined);
	if (isFail(defaultBoardRank)) return defaultBoardRank;

	const closedBoardRank = rankBetween(defaultBoardRank.value, undefined);
	if (isFail(closedBoardRank)) return closedBoardRank;

	const todoRank = rankBetween(undefined, undefined);
	if (isFail(todoRank)) return todoRank;

	const inProgressRank = rankBetween(todoRank.value, undefined);
	if (isFail(inProgressRank)) return inProgressRank;

	const doneRank = rankBetween(inProgressRank.value, undefined);
	if (isFail(doneRank)) return doneRank;

	const closedSwimlaneRank = rankBetween(undefined, undefined);
	if (isFail(closedSwimlaneRank)) return closedSwimlaneRank;

	return succeeded('Created default events', [
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'init.workspace',
			payload: {
				id: workspaceId,
				name: 'Workspace',
				rank: workspaceRank.value,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.board',
			payload: {
				id: boardId,
				name: 'Default',
				parent: workspaceId,
				rank: defaultBoardRank.value,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.swimlane',
			payload: {
				id: swimlaneId1,
				name: 'Todo',
				parent: boardId,
				rank: todoRank.value,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.swimlane',
			payload: {
				id: swimlaneId2,
				name: 'In progress',
				parent: boardId,
				rank: inProgressRank.value,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.swimlane',
			payload: {
				id: swimlaneId3,
				name: 'Done',
				parent: boardId,
				rank: doneRank.value,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.board',
			payload: {
				id: CLOSED_BOARD_ID,
				name: 'Closed',
				parent: workspaceId,
				rank: closedBoardRank.value,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'add.swimlane',
			payload: {
				id: CLOSED_SWIMLANE_ID,
				name: 'Closed',
				parent: CLOSED_BOARD_ID,
				rank: closedSwimlaneRank.value,
			},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'lock.node',
			payload: {id: CLOSED_BOARD_ID},
		},
		{
			id: ulid(),
			userId: SYSTEM_ACTOR_ID,
			userName: SYSTEM_ACTOR_NAME,
			action: 'lock.node',
			payload: {id: CLOSED_SWIMLANE_ID},
		},
	] as const satisfies readonly AppEvent[]);
}

export function bootStateFromEventLog(eventLog: AppEvent[]): Result {
	if (!eventLog.some(e => e.action === 'init.workspace')) {
		const workspace = nodes.workspace(
			'temporary-uninitialized-workspace',
			'Workspace',
			'a0',
		);

		const initResult = initWorkspaceState(workspace);
		if (isFail(initResult)) return initResult;

		patchState({
			hasProject: false,
			mode: Mode.DEFAULT,
		});

		return succeeded('Booted uninitialized workspace placeholder', null);
	}

	const results = materializeAll(eventLog);

	const failures = results.filter(isFail);
	if (failures.length > 0) {
		return failed(
			[
				chalk.bold.red('Materializing failed'),
				'',
				...failures.map(
					(x, i) => `${chalk.dim.gray(`${i + 1}.`)} ${chalk.dim(x.message)}`,
				),
				'\n',
			].join('\n\n See complete log: \n\n') +
				eventLog.map(x => JSON.stringify(x)).join('\n'),
		);
	}

	navigateToInitialNode();
	return succeeded('State booted successfully', null);
}
