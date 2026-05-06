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
	EDIT_TITLE: 'edit:title',
	EDIT_DESCRIPTION: 'edit:description',

	SET_EDITOR: 'config:editor',
	SET_VIEW: 'config:view',
	SET_USERNAME: 'config:username',
	SET_AUTOSYNC: 'config:autosync',

	// Git
	SYNC: 'sync',

	EXPORT: 'export',

	NONE: '',
} as const;
export type CmdKeyword = (typeof CmdKeywords)[keyof typeof CmdKeywords];
