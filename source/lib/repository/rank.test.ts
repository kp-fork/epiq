import {beforeEach, describe, expect, it, vi} from 'vitest';
import {failed, succeeded} from '../model/result-types.js';

const state = vi.hoisted(() => ({
	nodes: {} as any,
}));

const materializeAndPersist = vi.hoisted(() => vi.fn());
const rankBetween = vi.hoisted(() => vi.fn());

vi.mock('../../state/state.js', () => ({
	getState: () => state,
}));

vi.mock('../../utils/rank.js', () => ({
	rankBetween,
}));

vi.mock('../../event/create-rebalance-children-event.js', () => ({
	createRebalanceChildrenEvent: vi.fn(() =>
		succeeded('Created rebalance event', {
			action: 'rebalance.children',
			payload: {
				parentId: 'parent',
			},
		}),
	),
}));

vi.mock('../../event/event-materialize-and-persist.js', () => ({
	materializeAndPersist,
}));

describe('resolveAndPersistRankForCreate', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		state.nodes = {
			child1: {
				id: 'child1',
				parentNodeId: 'parent',
				rank: 'a0',
				isDeleted: false,
			},
		};
	});

	it('rebalances exhausted sibling ranks and retries rank resolution', async () => {
		rankBetween
			.mockReturnValueOnce(failed('Rank space exhausted'))
			.mockReturnValueOnce(succeeded('Resolved rank', 'm0'));

		materializeAndPersist.mockReturnValue(
			succeeded('Persisted rebalance event', undefined),
		);

		const {resolveAndPersistRankForCreate} = await import('./rank.js');

		const result = resolveAndPersistRankForCreate('parent', {
			userId: 'user-1',
			userName: 'Test User',
		});

		expect(result.value).toBe('m0');
		expect(materializeAndPersist).toHaveBeenCalledTimes(1);
		expect(rankBetween).toHaveBeenCalledTimes(2);
	});
});
