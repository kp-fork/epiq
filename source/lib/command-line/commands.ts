import {ulid} from 'ulid';
import {exportBoardLayout} from '../../export/export.js';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {setConfig} from '../config/user-config.js';
import {createIssueEvents} from '../event/common-events.js';
import {getEventTime} from '../event/date-utils.js';
import {loadMergedEvents, splitEventsAtTime} from '../event/event-load.js';
import {
	materializeAndPersist,
	materializeAndPersistAll,
} from '../event/event-materialize-and-persist.js';
import {materializeAll} from '../event/event-materialize.js';
import {resolveActorId} from '../event/event-persist.js';
import {AppEvent} from '../event/event.model.js';
import {resolveReopenParentFromLog} from '../event/log-utils.js';
import {CLOSED_SWIMLANE_ID} from '../event/static-ids.js';
import {CommandLineActionEntry, Mode} from '../model/action-map.model.js';
import {Filter, findInBreadCrumb} from '../model/app-state.model.js';
import {isTicketNode} from '../model/context.model.js';
import {failed, isFail, succeeded} from '../model/result-types.js';
import {findAncestor, nodeRepo} from '../repository/node-repo.js';
import {
	resolveAndPersistRankForCreate,
	resolveAndPersistRankForMove,
} from '../repository/rank.js';
import {getCmdArg, getCmdState} from '../state/cmd.state.js';
import {getSettingsState, patchSettingsState} from '../state/settings.state.js';
import {
	getRenderedChildren,
	getState,
	patchState,
	resetState,
	updateState,
} from '../state/state.js';
import {resolveClosestEpiqRoot} from '../storage/paths.js';
import {CmdKeywords} from './cmd-keywords.js';
import {CmdIntent} from './command-meta.js';
import {
	ConfigModifiers,
	EditModifiers,
	getCmdModifiers,
} from './command-modifiers.js';
import {editCommand} from './commands/edit.cmd.js';
import {initCommand} from './commands/init.cmd.js';
import {moveCommand} from './commands/move.cmd.js';
import {setAutoSyncDurationCommand} from './commands/set-auto-sync-duration.cmd.js';
import {setAutoSyncCommand} from './commands/set-auto-sync.cmd.js';
import {syncCommand} from './commands/sync.cmd.js';
import {parsePeekDateInput} from './validate-date.js';

const findTagByName = (name: string) =>
	Object.values(getState().tags).find(tag => tag.name === name);

const findContributorByName = (name: string) =>
	Object.values(getState().contributors).find(
		contributor => contributor.name === name,
	);

export const commands: CommandLineActionEntry[] = [
	{
		systemOnly: true,
		intent: CmdIntent.Move,
		mode: Mode.COMMAND_LINE,
		action: moveCommand,
	},
	{
		intent: CmdIntent.Delete,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {currentNode, selectedIndex} = getState();
			const child = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!child) return failed('Unable to resolve child to delete');

			return materializeAndPersist({
				id: ulid(),
				action: 'delete.node',
				payload: {
					id: child.id,
				},
				...userRes.value,
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Filter,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const {modifier, inputString} = getCmdState().commandMeta;
			const regex = /(!=|=)/;
			const [filterTarget, _filterOperator] = modifier.split(regex);
			const isValidModifier = (val: string): val is Filter['target'] =>
				getCmdModifiers(CmdKeywords.FILTER)
					.map(x => x.split(regex)[0])
					.includes(val);

			if (!filterTarget || !isValidModifier(filterTarget))
				return failed('Invalid filter modifier');

			const filter: Filter = {
				target: filterTarget,
				operator: '=',
				value: inputString.trim(),
			};

			updateState(s => ({
				...s,
				filters: modifier === 'clear' ? [] : [...s.filters, filter],
				mode: Mode.DEFAULT,
			}));

			return succeeded('Viewing help', null);
		},
	},
	{
		intent: CmdIntent.ViewHelp,
		mode: Mode.COMMAND_LINE,
		action: () => {
			patchState({mode: Mode.HELP});
			return succeeded('Viewing help', null);
		},
	},
	{
		intent: CmdIntent.CloseIssue,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {currentNode, selectedIndex} = getState();
			const target = getRenderedChildren(currentNode.id)[selectedIndex];

			if (!target) return failed('Unable to close issue, no target found');
			if (!isTicketNode(target)) return failed('Cannot close in this context');

			const closeSwimlane = getState().nodes[CLOSED_SWIMLANE_ID];
			if (!closeSwimlane) return failed('Unable to locate closed swimlane');

			if (target.parentNodeId === closeSwimlane.id) {
				return failed('Issue is already closed');
			}

			const rankResult = resolveAndPersistRankForMove(
				closeSwimlane.id,
				target.id,
				{
					at: 'end',
				},
				userRes.value,
			);
			if (isFail(rankResult)) return rankResult;

			const result = materializeAndPersist({
				id: ulid(),
				action: 'close.issue',
				payload: {
					id: target.id,
					parent: closeSwimlane.id,
					rank: rankResult.value,
				},
				...userRes.value,
			});

			if (isFail(result)) return result;

			return succeeded('Issue closed', null);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.ReopenIssue,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {currentNode, selectedIndex} = getState();
			const target = getRenderedChildren(currentNode.id)[selectedIndex];

			if (!target) return failed('Unable to reopen issue, no target found');

			const ticketResult =
				target.context === 'TICKET'
					? succeeded('Resolved ticket', target)
					: findAncestor(target.id, 'TICKET');

			if (isFail(ticketResult)) {
				return failed('Cannot reopen in this context');
			}

			const ticket = ticketResult.value;

			const closeSwimlane = getState().nodes[CLOSED_SWIMLANE_ID];
			if (!closeSwimlane) return failed('Unable to locate closed swimlane');

			if (ticket.parentNodeId !== closeSwimlane.id) {
				return failed('Issue is not closed');
			}
			if (!isTicketNode(ticket)) return failed('Target node is not issue');

			const previousParentId = resolveReopenParentFromLog(ticket);
			if (!previousParentId) {
				return failed('Unable to resolve previous parent from issue history');
			}

			if (previousParentId === closeSwimlane.id) {
				return failed('Previous parent resolves to closed swimlane');
			}

			const previousParent = getState().nodes[previousParentId];
			if (!previousParent) return failed('Previous parent no longer exists');

			const rankResult = resolveAndPersistRankForMove(
				previousParent.id,
				ticket.id,
				{
					at: 'end',
				},
				userRes.value,
			);
			if (isFail(rankResult)) return rankResult;

			const result = materializeAndPersist({
				id: ulid(),
				action: 'reopen.issue',
				payload: {
					id: ticket.id,
					parent: previousParent.id,
					rank: rankResult.value,
				},
				...userRes.value,
			});

			if (isFail(result)) return result;

			return succeeded('Issue reopened', null);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Init,
		mode: Mode.COMMAND_LINE,
		action: initCommand,
	},
	{
		intent: CmdIntent.NewItem,
		mode: Mode.COMMAND_LINE,
		action: (_cmdAction, cmdState) => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			if (!cmdState.inputString) {
				return failed(`provide a name for your ${cmdState.modifier}`);
			}

			const {breadCrumb, currentNode, selectedIndex} = getState();

			const createAndNavigate = (
				event: AppEvent<
					| 'add.workspace'
					| 'add.board'
					| 'add.swimlane'
					| 'add.issue'
					| 'add.field'
				>,
			) => {
				const result = materializeAndPersist(event);
				if (isFail(result)) return result;

				const createdNode = nodeRepo.getNode(result.value.result.id);
				if (!createdNode) return failed('Created node not found');

				if (!createdNode.parentNodeId) return result;

				const parentNode = nodeRepo.getNode(createdNode.parentNodeId);
				if (!parentNode) return failed('Parent node not found');

				navigationUtils.navigate({
					currentNode: parentNode,
					selectedIndex: nodeRepo
						.getSiblings(createdNode.parentNodeId)
						.findIndex(({id}) => id === createdNode.id),
				});

				return result;
			};

			if (cmdState.modifier === 'board') {
				const {rootNodeId} = getState();
				const workspace = nodeRepo.getNode<'WORKSPACE'>(rootNodeId);
				if (!workspace) return failed('Workspace not found');

				const rankResult = resolveAndPersistRankForCreate(
					workspace.id,
					userRes.value,
				);
				if (isFail(rankResult)) return rankResult;

				return createAndNavigate({
					id: ulid(),
					action: 'add.board',
					payload: {
						id: ulid(),
						name: cmdState.inputString,
						parent: workspace.id,
						rank: rankResult.value,
					},
					...userRes.value,
				});
			}

			if (cmdState.modifier === 'swimlane') {
				const boardResult = findInBreadCrumb(breadCrumb, 'BOARD');
				if (isFail(boardResult))
					return failed('Unable to add swimlane in this context');

				const rankResult = resolveAndPersistRankForCreate(
					boardResult.value.id,
					userRes.value,
				);
				if (isFail(rankResult)) return rankResult;

				return createAndNavigate({
					id: ulid(),
					action: 'add.swimlane',
					payload: {
						id: ulid(),
						name: cmdState.inputString,
						parent: boardResult.value.id,
						rank: rankResult.value,
					},
					...userRes.value,
				});
			}

			if (cmdState.modifier === 'issue') {
				const selectedNode = getRenderedChildren(currentNode.id)[selectedIndex];
				const swimlane =
					currentNode.context === 'SWIMLANE'
						? currentNode
						: currentNode.context === 'BOARD' &&
						  selectedNode?.context === 'SWIMLANE'
						? selectedNode
						: (() => {
								const swimlaneResult = findInBreadCrumb(breadCrumb, 'SWIMLANE');
								return isFail(swimlaneResult) ? null : swimlaneResult.value;
						  })();

				if (!swimlane) {
					return failed('Unable to add issue in this context');
				}

				const rankResult = resolveAndPersistRankForCreate(
					swimlane.id,
					userRes.value,
				);
				if (isFail(rankResult)) return rankResult;

				const issueEventsResult = createIssueEvents({
					name: cmdState.inputString,
					parent: swimlane.id,
					rank: rankResult.value,
					user: userRes.value,
				});
				if (isFail(issueEventsResult)) return issueEventsResult;

				const issueEvents = issueEventsResult.value;

				const issueResults = materializeAndPersistAll(issueEvents);

				if (issueResults.some(x => isFail(x))) {
					return failed(
						'Issue create failed: ' +
							issueResults
								.filter(isFail)
								.map(r => r.message)
								.filter(Boolean)
								.join(', '),
					);
				}

				const issueResult = issueResults[0];
				if (!issueResult || isFail(issueResult))
					return failed('Issue creation failed');

				const issueEvent = issueEvents.find(
					(event): event is AppEvent<'add.issue'> =>
						event.action === 'add.issue',
				);

				const ticketId = issueEvent?.payload.id;
				if (!ticketId) return failed('Unable to determine ticket id');

				navigationUtils.navigate({
					currentNode: swimlane,
					selectedIndex: nodeRepo
						.getSiblings(swimlane.id)
						.findIndex(({id}) => id === ticketId),
				});

				return succeeded('Issue created', null);
			}
			return succeeded('Success', null);
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Rename,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {currentNode, selectedIndex} = getState();
			const node = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!node) return failed('Missing node');
			if (node.readonly) return failed('Cannot rename readonly node');

			const newName = getCmdArg();
			if (!newName) return failed('Provide a new name');

			return materializeAndPersist({
				id: ulid(),
				action: 'edit.title',
				payload: {id: node.id, name: newName},
				...userRes.value,
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.UntagTicket,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {modifier, inputString} = getCmdState().commandMeta;
			const name = (modifier || inputString).trim();
			if (!name) return failed('Provide a tag');

			const existingTag = findTagByName(name);
			if (!existingTag) return failed(`Tag "${name}" does not exist`);

			const {selectedNode} = getState();
			if (!selectedNode) return failed('Invalid untag target');

			const ticketResult = findAncestor(selectedNode.id, 'TICKET');
			if (isFail(ticketResult))
				return failed('Unable to untag issue in this context');

			const ticket = ticketResult.value;

			const tagsField = nodeRepo.getFieldByTitle(ticket.id, 'Tags');
			if (!tagsField) return failed('Unable to locate tags field');

			const tagNode = getRenderedChildren(tagsField.id).find(
				child => child.props?.value === existingTag.id,
			);

			if (!tagNode) return failed('Issue is not tagged with that tag');

			return materializeAndPersist({
				id: ulid(),
				action: 'untag.issue',
				payload: {
					id: tagNode.id,
					target: ticket.id,
					tagId: existingTag.id,
				},
				...userRes.value,
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.TagTicket,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {modifier, inputString} = getCmdState().commandMeta;
			const name = (modifier || inputString).trim();
			if (!name) return failed('Provide a tag');

			const {selectedIndex, currentNode} = getState();
			const selected = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!selected) return failed('Invalid tag target');

			const ticketResult = findAncestor(selected.id, 'TICKET');
			if (isFail(ticketResult))
				return failed('Unable to tag issue in this context');

			const ticket = ticketResult.value;
			const existingTag = findTagByName(name);

			let tagId: string;

			if (existingTag) {
				tagId = existingTag.id;
			} else {
				const newTagId = ulid();
				const createResult = materializeAndPersist({
					id: ulid(),
					action: 'create.tag',
					payload: {
						id: newTagId,
						name,
					},
					userId: userRes.value.userId,
					userName: userRes.value.userName,
				});

				if (isFail(createResult)) return createResult;
				tagId = createResult.value.result.id;
			}

			const tagsField = nodeRepo.getFieldByTitle(ticket.id, 'Tags');
			if (!tagsField) return failed('Unable to locate tags field');

			const alreadyTagged = getRenderedChildren(tagsField.id).some(
				child => child.props?.value === tagId,
			);

			if (alreadyTagged) return failed('Already tagged with that tag');

			const rankResult = resolveAndPersistRankForCreate(
				tagsField.id,
				userRes.value,
			);
			if (isFail(rankResult)) return rankResult;

			return materializeAndPersist({
				id: ulid(),
				action: 'tag.issue',
				payload: {
					id: ulid(),
					target: ticket.id,
					tagId,
					rank: rankResult.value,
				},
				...userRes.value,
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.AssignUserToTicket,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {modifier, inputString} = getCmdState().commandMeta;
			const name = (modifier || inputString).trim();
			if (!name) return failed('Provide an assignee');

			const {selectedIndex, currentNode} = getState();
			const selected = getRenderedChildren(currentNode.id)[selectedIndex];
			if (!selected) return failed('Invalid assign target');

			const ticketResult = findAncestor(selected.id, 'TICKET');
			if (isFail(ticketResult))
				return failed('Unable to assign issue in this context');

			const ticket = ticketResult.value;
			const existingContributor = findContributorByName(name);

			let contributorId: string;

			if (existingContributor) {
				contributorId = existingContributor.id;
			} else {
				const newContributorId = ulid();
				const createResult = materializeAndPersist({
					id: ulid(),
					action: 'create.contributor',
					payload: {
						id: newContributorId,
						name,
					},
					userId: userRes.value.userId,
					userName: userRes.value.userName,
				});

				if (isFail(createResult)) return createResult;
				contributorId = createResult.value.result.id;
			}

			const assigneesField = nodeRepo.getFieldByTitle(ticket.id, 'Assignees');
			if (!assigneesField) return failed('Unable to locate assignees field');

			const alreadyAssigned = getRenderedChildren(assigneesField.id).some(
				child => child.props?.value === contributorId,
			);

			if (alreadyAssigned) return failed('Assignee already assigned');

			const rankResult = resolveAndPersistRankForCreate(
				assigneesField.id,
				userRes.value,
			);
			if (isFail(rankResult)) return rankResult;

			return materializeAndPersist({
				id: ulid(),
				action: 'assign.issue',
				payload: {
					id: ulid(),
					target: ticket.id,
					contributor: contributorId,
					rank: rankResult.value,
				},
				...userRes.value,
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.UnassignUserFromTicket,
		mode: Mode.COMMAND_LINE,
		action: () => {
			const userRes = resolveActorId();
			if (isFail(userRes)) return failed('Unable to resolve user ID');

			const {modifier, inputString} = getCmdState().commandMeta;
			const name = (modifier || inputString).trim();
			if (!name) return failed('Provide an assignee to remove');

			const existingContributor = findContributorByName(name);
			if (!existingContributor)
				return failed(`Assignee "${name}" does not exist`);

			const {selectedNode} = getState();
			if (!selectedNode) return failed('Invalid unassign target');

			const ticketResult = findAncestor(selectedNode.id, 'TICKET');
			if (isFail(ticketResult))
				return failed('Unable to unassign in this context');

			const ticket = ticketResult.value;

			const assigneesField = nodeRepo.getFieldByTitle(ticket.id, 'Assignees');
			if (!assigneesField) return failed('Unable to locate assignees field');

			const assigneeNode = getRenderedChildren(assigneesField.id).find(
				child => child.props?.value === existingContributor.id,
			);

			if (!assigneeNode) return failed(`Issue is not assigned to "${name}"`);

			return materializeAndPersist({
				id: ulid(),
				action: 'unassign.issue',
				payload: {
					id: assigneeNode.id,
					target: ticket.id,
					contributor: existingContributor.id,
				},
				...userRes.value,
			});
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Sync,
		mode: Mode.COMMAND_LINE,
		action: syncCommand,
	},
	{
		intent: CmdIntent.Peek,
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const boardNodeResult = findInBreadCrumb(getState().breadCrumb, 'BOARD');
			if (isFail(boardNodeResult)) return boardNodeResult;

			const epiqRootDirResult = resolveClosestEpiqRoot(process.cwd());
			if (isFail(epiqRootDirResult)) throw new Error(epiqRootDirResult.message);

			const eventsResult = loadMergedEvents(epiqRootDirResult.value);

			if (isFail(eventsResult)) return failed(eventsResult.message);
			const allEvents = eventsResult.value;

			const {modifier} = getCmdState().commandMeta;
			let targetTime: number;

			if (modifier === 'now') {
				const resetResult = resetState();
				if (isFail(resetResult)) return resetResult;

				const materializeResult = materializeAll(allEvents);
				if (materializeResult.some(isFail)) {
					return failed(materializeResult.map(x => x.message).join(', '));
				}

				patchState({
					mode: Mode.DEFAULT,
					readOnly: false,
					timeMode: 'live',
					unappliedEvents: [],
				});

				return succeeded('Peeking now', true);
			}

			if (modifier === 'prev') {
				const previousEvent = getState().eventLog.at(-2);
				const previousTime = getEventTime(previousEvent);
				if (previousTime === null) return failed('No previous event to peek');
				targetTime = previousTime;
			} else if (modifier === 'next') {
				const nextEvent = getState().unappliedEvents.at(0);
				const nextTime = getEventTime(nextEvent);
				if (nextTime === null) return failed('No next event to peek');
				targetTime = nextTime;
			} else {
				const targetDate = parsePeekDateInput(modifier);
				if (!targetDate) {
					return failed('Invalid peek date');
				}

				targetTime = targetDate.getTime();
			}

			const boardId = boardNodeResult.value.id;
			const {appliedEvents, unappliedEvents} = splitEventsAtTime(
				allEvents,
				targetTime,
			);

			const resetResult = resetState();
			if (isFail(resetResult)) return resetResult;

			const materializeResult = materializeAll(appliedEvents);
			if (materializeResult.some(isFail)) {
				return failed(materializeResult.map(x => x.message).join(', '));
			}

			const boardNode = getState().nodes[boardId];
			if (!boardNode) {
				return failed('Board did not exist at peek date');
			}

			navigationUtils.navigate({
				currentNode: boardNode,
				selectedIndex: 0,
			});

			patchState({
				mode: Mode.DEFAULT,
				readOnly: true,
				timeMode: 'peek',
				unappliedEvents: unappliedEvents,
			});

			return succeeded(`Peeking `, true);
		},
	},

	{
		intent: CmdIntent.Export,
		mode: Mode.COMMAND_LINE,
		action: async () => {
			const exportResult = await exportBoardLayout();
			if (isFail(exportResult)) return exportResult;

			patchState({
				mode: Mode.DEFAULT,
			});

			return succeeded('Export successful', true);
		},
	},
	{
		intent: CmdIntent.Exit,
		mode: Mode.COMMAND_LINE,
		action: async () => {
			navigationUtils.exit();
			return succeeded('Exit successful', true);
		},
	},
	{
		intent: CmdIntent.Edit,
		mode: Mode.COMMAND_LINE,
		action: (_, cmdState) => {
			if (cmdState.modifier === EditModifiers.DESCRIPTION) {
				return editCommand();
			}

			if (cmdState.modifier === EditModifiers.TITLE) {
				const userRes = resolveActorId();
				if (isFail(userRes)) return failed('Unable to resolve user ID');

				const {currentNode, selectedIndex} = getState();
				const node = getRenderedChildren(currentNode.id)[selectedIndex];
				if (!node) return failed('Missing node');
				if (node.readonly) return failed('Cannot rename readonly node');

				const newName = cmdState.inputString.trim();
				if (!newName) return failed('Provide a new name');

				return materializeAndPersist({
					id: ulid(),
					action: 'edit.title',
					payload: {id: node.id, name: newName},
					...userRes.value,
				});
			}

			return failed('Unknown edit command');
		},
		onSuccess: () => patchState({mode: Mode.DEFAULT}),
	},
	{
		intent: CmdIntent.Config,
		mode: Mode.COMMAND_LINE,
		action: (_, cmdState) => {
			const value = cmdState.inputString.trim();

			switch (cmdState.modifier) {
				case ConfigModifiers.USERNAME: {
					const {userId, preferredEditor, userName} = getSettingsState();

					const resolvedUserName = value || userName;
					const resolvedUserId = userId ?? ulid();

					if (!resolvedUserName || !resolvedUserId) {
						return failed('Unable to resolve user name or id');
					}

					const persistResult = setConfig({
						userName: resolvedUserName,
						userId: resolvedUserId,
						preferredEditor: preferredEditor ?? '',
					});
					if (isFail(persistResult)) return persistResult;

					patchSettingsState({
						userName: resolvedUserName,
						userId: resolvedUserId,
					});

					patchState({mode: Mode.DEFAULT});

					return succeeded(`Username set to "${resolvedUserName}"`, null);
				}

				case ConfigModifiers.EDITOR: {
					if (!value) return failed('No editor provided');

					const persistResult = setConfig({preferredEditor: value});
					if (isFail(persistResult)) return persistResult;

					patchSettingsState({preferredEditor: value});
					patchState({mode: Mode.DEFAULT});

					return succeeded(`Editor configuration set to "${value}"`, null);
				}

				case ConfigModifiers.VIEW: {
					if (value !== 'wide' && value !== 'dense') {
						return failed('Invalid view mode');
					}

					patchSettingsState({viewMode: value});

					return succeeded(`View set to "${value}"`, null);
				}

				case ConfigModifiers.AUTOSYNC:
					return setAutoSyncCommand();

				case ConfigModifiers.SYNC_DEBOUNCE_MS:
					return setAutoSyncDurationCommand();

				default:
					return failed('Unknown config command');
			}
		},
	},
];
