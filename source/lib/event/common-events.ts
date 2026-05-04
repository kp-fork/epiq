import {monotonicFactory, ulid} from 'ulid';
import {isFail, Result, succeeded} from '../model/result-types.js';
import {User} from '../state/settings.state.js';
import {midRank, rankBetween} from '../utils/rank.js';
import {AppEvent} from './event.model.js';

const nextId = monotonicFactory();

export const createIssueEvents = ({
	name,
	parent,
	rank,
	user: {userId, userName},
}: {
	name: string;
	parent: string;
	rank: string;
	user: User;
}): Result<readonly AppEvent[]> => {
	const issueId = nextId();
	const descriptionId = nextId();
	const assigneesId = nextId();
	const tagsId = nextId();

	const descriptionRank = midRank();
	if (isFail(descriptionRank)) return descriptionRank;

	const assigneesRank = rankBetween(descriptionRank.value, undefined);
	if (isFail(assigneesRank)) return assigneesRank;

	const tagsRank = rankBetween(assigneesRank.value, undefined);
	if (isFail(tagsRank)) return tagsRank;

	return succeeded('Created issue events', [
		{
			id: ulid(),
			userId,
			userName,
			action: 'add.issue',
			payload: {
				id: issueId,
				parent,
				name,
				rank,
			},
		},
		{
			id: ulid(),
			userId,
			userName,
			action: 'add.field',
			payload: {
				id: descriptionId,
				parent: issueId,
				name: 'Description',
				val: '',
				rank: descriptionRank.value,
			},
		},
		{
			id: ulid(),
			userId,
			userName,
			action: 'add.field',
			payload: {
				id: assigneesId,
				parent: issueId,
				name: 'Assignees',
				rank: assigneesRank.value,
			},
		},
		{
			id: ulid(),
			userId,
			userName,
			action: 'add.field',
			payload: {
				id: tagsId,
				parent: issueId,
				name: 'Tags',
				rank: tagsRank.value,
			},
		},
	] satisfies readonly AppEvent[]);
};
