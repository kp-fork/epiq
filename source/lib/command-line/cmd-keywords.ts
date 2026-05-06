export const CmdKeywords = {
	EXIT: 'exit',
	INIT: 'init',
	HELP: 'help',
	NEW: 'new',
	TAG: 'tag',
	UNTAG: 'untag',
	MOVE: 'move',

	PEEK: 'peek',
	FILTER: 'filter',

	ASSIGN: 'assign',
	UNASSIGN: 'unassign',
	DELETE: 'delete',

	CLOSE_ISSUE: 'close',
	RE_OPEN_ISSUE: 'reopen',

	// Edit
	EDIT_TITLE: 'edit:title',
	EDIT_DESCRIPTION: 'edit:description',

	// Settings
	SET_EDITOR: 'config:editor',
	SET_VIEW: 'config:view',
	SET_USERNAME: 'config:userName',
	SET_AUTOSYNC: 'config:autoSync',
	SET_AUTOSYNC_DEBOUNCE_MS: 'config:syncDebounceMs',

	// Git
	SYNC: 'sync',

	EXPORT: 'export',

	NONE: '',
} as const;
export type CmdKeyword = (typeof CmdKeywords)[keyof typeof CmdKeywords];
