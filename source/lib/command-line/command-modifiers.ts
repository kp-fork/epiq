import {MIN_AUTOSYNC_DURATION_MS} from '../../git/auto-sync.js';
import {
	getUserSetupStatus,
	isRepositoryInitialized,
	YesNo,
} from '../config/setup-utils.js';
import {editorConfig} from '../editor/editor-config.js';
import {AnyContext, NavNodeCtx} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getState} from '../state/state.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {
	ticketAssigneesFromBreadCrumb,
	ticketTagsFromBreadCrumb,
} from '../utils/ticket.utils.js';
import {CmdKeyword, CmdKeywords} from './cmd-keywords.js';
import {generatePeekOffsetHints} from './validate-date.js';

const EDITABLE_NODES: AnyContext[] = ['BOARD', 'TICKET', 'SWIMLANE'];

export type CommandMap = {
	[K in keyof typeof NavNodeCtx]: (typeof CmdKeywords)[keyof typeof CmdKeywords][];
};

const GLOBAL_COMMANDS = [
	CmdKeywords.SYNC,
	CmdKeywords.HELP,
	CmdKeywords.EXPORT,
	CmdKeywords.SET_VIEW,
	CmdKeywords.SET_EDITOR,
	CmdKeywords.SET_USERNAME,
	CmdKeywords.SET_AUTOSYNC,
	CmdKeywords.SET_AUTOSYNC_DEBOUNCE_MS,
];

const EDIT_COMMANDS = [
	CmdKeywords.NEW,
	CmdKeywords.EDIT_TITLE,
	CmdKeywords.DELETE,
	CmdKeywords.MOVE,
];

const TICKET_COMMANDS = [
	CmdKeywords.TAG,
	CmdKeywords.UNTAG,
	CmdKeywords.ASSIGN,
	CmdKeywords.UNASSIGN,
	CmdKeywords.CLOSE_ISSUE,
	CmdKeywords.RE_OPEN_ISSUE,
	CmdKeywords.EDIT_DESCRIPTION,
];

const PRESENTATION_COMMANDS = [CmdKeywords.FILTER, CmdKeywords.PEEK];

const COMMANDS_BY_CONTEXT: CommandMap = {
	WORKSPACE: [...GLOBAL_COMMANDS, ...EDIT_COMMANDS],
	BOARD: [...PRESENTATION_COMMANDS, ...GLOBAL_COMMANDS, ...EDIT_COMMANDS],
	SWIMLANE: [...PRESENTATION_COMMANDS, ...GLOBAL_COMMANDS, ...EDIT_COMMANDS],
	TICKET: [...GLOBAL_COMMANDS, ...EDIT_COMMANDS, ...TICKET_COMMANDS],
	FIELD: [...GLOBAL_COMMANDS, ...TICKET_COMMANDS],
	FIELD_LIST: [...GLOBAL_COMMANDS, ...TICKET_COMMANDS],
	TEXT: [...GLOBAL_COMMANDS],
};

const getNewModifiers = (context: AnyContext): string[] => {
	if (context === 'WORKSPACE') return ['board'];

	return ['issue', 'swimlane', 'board'];
};

const getAvailableBaseCommands = (): CmdKeyword[] => {
	const {selectedNode, readOnly, breadCrumb} = getState();

	const {isSetupDone} = getUserSetupStatus();
	if (!isSetupDone) {
		return [
			CmdKeywords.HELP,
			CmdKeywords.SET_EDITOR,
			CmdKeywords.SET_USERNAME,
			CmdKeywords.SET_AUTOSYNC,
		];
	}

	if (!isRepositoryInitialized()) {
		return [CmdKeywords.HELP, CmdKeywords.INIT];
	}

	if (readOnly) {
		return [
			CmdKeywords.HELP,
			CmdKeywords.PEEK,
			CmdKeywords.EXPORT,
			CmdKeywords.SET_VIEW,
		];
	}

	const selectedContext = selectedNode?.context;
	const selectedIsEditable =
		selectedContext && EDITABLE_NODES.includes(selectedContext);

	const commandsInBreadcrumbContext = [
		...new Set(
			[...breadCrumb, selectedNode]
				.map(c => c?.context)
				.flatMap(c => (c ? COMMANDS_BY_CONTEXT[c] : [])),
		),
	];

	return commandsInBreadcrumbContext.filter(command => {
		if (command === CmdKeywords.MOVE) {
			return false;
		}

		if (command === CmdKeywords.EDIT_TITLE || command === CmdKeywords.DELETE) {
			return selectedIsEditable;
		}

		return true;
	});
};

export const getCmdModifiers = (keyword: CmdKeyword): string[] => {
	const {currentNode} = getState();
	const currentContext = currentNode.context ?? 'WORKSPACE';

	const modifiers: Partial<Record<CmdKeyword, string[]>> = {
		[CmdKeywords.NONE]: getAvailableBaseCommands(),

		[CmdKeywords.EXIT]: ['confirm'],
		[CmdKeywords.EXPORT]: [],
		[CmdKeywords.SYNC]: [],
		[CmdKeywords.INIT]: [],
		[CmdKeywords.HELP]: [],

		[CmdKeywords.PEEK]: [...generatePeekOffsetHints(), 'now', 'prev', 'next'],

		[CmdKeywords.EDIT_TITLE]: [],
		[CmdKeywords.EDIT_DESCRIPTION]: ['confirm'],
		[CmdKeywords.DELETE]: ['confirm'],
		[CmdKeywords.RE_OPEN_ISSUE]: ['confirm'],
		[CmdKeywords.CLOSE_ISSUE]: ['confirm'],

		[CmdKeywords.MOVE]: [
			'start',
			'confirm',
			'next',
			'previous',
			'to-next',
			'to-previous',
			'cancel',
		],
		[CmdKeywords.FILTER]: ['tag', 'assignee', 'description', 'title', 'clear'],
		[CmdKeywords.TAG]: [
			...new Set([...Object.keys(TAGS_DEFAULT), ...nodeRepo.getExistingTags()]),
		],
		[CmdKeywords.UNTAG]: [
			...(ticketTagsFromBreadCrumb()?.value?.map(({name}) => name) ?? []),
		],
		[CmdKeywords.UNASSIGN]: [
			...(ticketAssigneesFromBreadCrumb()?.value?.map(({name}) => name) ?? []),
		],
		[CmdKeywords.ASSIGN]: nodeRepo.getExistingAssignees(),

		[CmdKeywords.NEW]: getNewModifiers(currentContext),

		// Settings
		[CmdKeywords.SET_VIEW]: ['dense', 'wide'],
		[CmdKeywords.SET_EDITOR]: [...editorConfig],
		[CmdKeywords.SET_USERNAME]: [],
		[CmdKeywords.SET_AUTOSYNC]: ['yes', 'no'] satisfies YesNo[],
		[CmdKeywords.SET_AUTOSYNC_DEBOUNCE_MS]: [],
	};

	return modifiers[keyword] ?? [];
};
