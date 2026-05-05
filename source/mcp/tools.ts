import {ulid} from 'ulid';
import {syncEpiqWithRemote} from '../git/sync.js';
import {loadSettingsFromConfig} from '../lib/config/user-config.js';
import {createIssueEvents} from '../lib/event/common-events.js';
import {bootStateFromEventLog} from '../lib/event/event-boot.js';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {getPersistFileName} from '../lib/event/event-persist.js';
import {AppEvent, MovePosition} from '../lib/event/event.model.js';
import {CLOSED_SWIMLANE_ID} from '../lib/event/static-ids.js';
import {isTicketNode, Ticket} from '../lib/model/context.model.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {
	resolveAndPersistRankForCreate,
	resolveAndPersistRankForMove,
} from '../lib/repository/rank.js';
import {getRenderedChildren, getState} from '../lib/state/state.js';
import {resolveClosestEpiqRoot} from '../lib/storage/paths.js';
import {sanitizeInlineText} from '../lib/utils/string.utils.js';
import {getFieldValue} from '../lib/utils/ticket.utils.js';

type SyncInput = ToolInput;

type MoveIssueInput = ToolInput & {
	issueId: string;
	parentId: string;
	position?: MovePosition;
};

type ToolInput = {
	repoRoot?: string;
};

type ListIssuesInput = ToolInput & {
	includeClosed?: boolean;
};

type ListSwimlanesInput = ToolInput & {
	boardId?: string;
};

type CreateIssueInput = ToolInput & {
	title: string;
	parentId: string;
};

type CloseIssueInput = ToolInput & {
	issueId: string;
};

type BootResult = {
	root: string;
};

type Actor = {
	userId: string;
	userName: string;
};

const boot = (repoRoot?: string): Result<BootResult> => {
	const epiqRootResult = resolveClosestEpiqRoot(repoRoot ?? process.cwd());
	if (isFail(epiqRootResult)) return epiqRootResult;

	const eventsResult = loadMergedEvents(epiqRootResult.value);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const bootResult = bootStateFromEventLog({
		eventLog: eventsResult.value,
		hasProject: true,
	});
	if (isFail(bootResult)) return failed(bootResult.message);

	return succeeded('Booted Epiq state', {root: epiqRootResult.value});
};

const getActor = (): Result<Actor> => {
	const actorResult = loadSettingsFromConfig();
	if (isFail(actorResult)) return failed(actorResult.message);

	if (!actorResult.value.userId) return failed('Unable to retrieve user id');
	if (!actorResult.value.userName)
		return failed('Unable to retrieve user name');

	return succeeded('Resolved actor', {
		userId: actorResult.value.userId,
		userName: actorResult.value.userName,
	});
};

const getReferencedIds = (
	ticket: Ticket,
	fieldTitle: 'Tags' | 'Assignees',
): string[] => {
	const children = getRenderedChildren(ticket.id);
	const fieldNode = children.find(node => node.title === fieldTitle);

	if (!fieldNode) return [];

	return getRenderedChildren(fieldNode.id)
		.map(child =>
			typeof child.props?.value === 'string' ? child.props.value : '',
		)
		.filter((value): value is string => Boolean(value));
};

const getIssueTags = (ticket: Ticket) =>
	getReferencedIds(ticket, 'Tags')
		.map(tagId => nodeRepo.getTag(tagId))
		.filter(tag => tag != undefined)
		.map(tag => ({id: tag.id, name: tag.name}));

const getIssueAssignees = (ticket: Ticket) =>
	getReferencedIds(ticket, 'Assignees')
		.map(id => nodeRepo.getContributor(id))
		.filter(Boolean)
		.map(c => ({id: c!.id, name: c!.name}));

export const listBoards = (input: ToolInput = {}) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const boards = Object.values(getState().nodes)
		.filter(n => n.context === 'BOARD')
		.map(n => ({
			id: n.id,
			title: n.title,
			parentId: n.parentNodeId,
			readonly: Boolean(n.readonly),
		}));

	return succeeded('Listed boards', boards);
};

export const listSwimlanes = (input: ListSwimlanesInput = {}) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const swimlanes = Object.values(getState().nodes)
		.filter(n => n.context === 'SWIMLANE')
		.filter(n => !input.boardId || n.parentNodeId === input.boardId)
		.map(n => ({
			id: n.id,
			title: n.title,
			boardId: n.parentNodeId,
			isClosed: n.id === CLOSED_SWIMLANE_ID,
			readonly: Boolean(n.readonly),
		}));

	return succeeded('Listed swimlanes', swimlanes);
};

export const listIssues = (input: ListIssuesInput) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const issues = Object.values(getState().nodes)
		.filter(isTicketNode)
		.filter(n => input.includeClosed || n.parentNodeId !== CLOSED_SWIMLANE_ID)
		.map(n => ({
			id: n.id,
			title: sanitizeInlineText(n.title),
			description: getFieldValue(n, 'Description'),
			parentId: n.parentNodeId,
			isClosed: n.parentNodeId === CLOSED_SWIMLANE_ID,
			readonly: Boolean(n.readonly),
			tags: getIssueTags(n),
			assignees: getIssueAssignees(n),
		}));

	return succeeded('Listed issues', issues);
};

export const createIssue = (input: CreateIssueInput) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const rankResult = resolveAndPersistRankForCreate(
		input.parentId,
		actorResult.value,
	);
	if (isFail(rankResult)) return rankResult;

	const issueEventsResult = createIssueEvents({
		name: input.title,
		parent: input.parentId,
		user: actorResult.value,
		rank: rankResult.value,
	});

	if (isFail(issueEventsResult)) return issueEventsResult;

	const issueEvents = issueEventsResult.value;

	const results = materializeAndPersistAll(issueEvents);
	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	const issueId = issueEvents.find(e => e.action === 'add.issue')?.payload.id;
	if (!issueId) return failed('Unable to determine created issue id');

	return succeeded('Created issue', {
		id: issueId,
		title: input.title,
		parentId: input.parentId,
	});
};

export const closeIssue = (input: CloseIssueInput) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const rankResult = resolveAndPersistRankForMove(
		CLOSED_SWIMLANE_ID,
		input.issueId,
		{at: 'end'},
		actorResult.value,
	);
	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'close.issue',
		payload: {
			id: input.issueId,
			parent: CLOSED_SWIMLANE_ID,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'close.issue'>;

	const results = materializeAndPersistAll([event]);
	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	return succeeded('Closed issue', {id: input.issueId});
};

export const moveIssue = (input: MoveIssueInput) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	const actorResult = getActor();
	if (isFail(actorResult)) return actorResult;

	const rankResult = resolveAndPersistRankForMove(
		input.parentId,
		input.issueId,
		input.position ?? {at: 'end'},
		actorResult.value,
	);
	if (isFail(rankResult)) return rankResult;

	const event = {
		id: ulid(),
		...actorResult.value,
		action: 'move.node',
		payload: {
			id: input.issueId,
			parent: input.parentId,
			rank: rankResult.value,
		},
	} satisfies AppEvent<'move.node'>;

	const results = materializeAndPersistAll([event]);
	const failure = results.find(isFail);
	if (failure) return failed(failure.message);

	return succeeded('Moved issue', {
		id: input.issueId,
		parentId: input.parentId,
	});
};

export const sync = async (input: SyncInput = {}) => {
	const root = resolveClosestEpiqRoot(input.repoRoot ?? process.cwd());
	if (isFail(root)) return failed('Sync failed');

	const actor = getActor();
	if (isFail(actor)) return actor;

	const result = await syncEpiqWithRemote({
		cwd: root.value,
		ownEventFileName: getPersistFileName(actor.value),
	});

	if (isFail(result)) return result;
	return succeeded('Synced', result.value);
};

export const getEpiqState = (input: ToolInput = {}) => {
	const bootResult = boot(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	return succeeded('Retrieved Epiq state', {
		root: bootResult.value.root,
		nodes: getState().nodes,
		rootNodeId: getState().rootNodeId,
		currentNode: getState().currentNode,
		selectedIndex: getState().selectedIndex,
		eventLog: getState().eventLog,
	});
};
