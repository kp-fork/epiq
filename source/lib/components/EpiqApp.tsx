import {Box} from 'ink';
import React from 'react';
import {hasPendingDefaultEvents} from '../event/event-boot.js';
import {isSuccess} from '../model/result-types.js';
import {getUserSetupStatus} from '../config/setup-utils.js';
import {Mode} from '../model/action-map.model.js';
import {findInBreadCrumb} from '../model/app-state.model.js';
import {getRenderedChildren, getState, useAppState} from '../state/state.js';
import {ContextBar} from './ContextBar.js';
import {HelpUI} from './Help.js';
import {InitProjectUI} from './InitProjectUI.js';
import SettingsUI from './SettingsUI.js';
import {Topbar} from './Topbar.js';
import {WorkspaceUI} from './WorkspaceUI.js';

type EpiqAppProps = {
	height: number;
	width: number;
};

export default function EpiqApp({width, height}: EpiqAppProps) {
	const state = useAppState();
	const filters = state.filters;

	if (state.mode === Mode.HELP) {
		return (
			<Box flexDirection="column">
				<HelpUI width={width} />
			</Box>
		);
	}

	const {isSetup, hasPreferredEditor, hasUserName, userName, preferredEditor} =
		getUserSetupStatus();

	const isSetupMode = !isSetup;
	const isUninitializedRepo =
		isSetup && (!state.hasProject || hasPendingDefaultEvents());

	if (isSetupMode) {
		return (
			<Box flexDirection="column">
				<Box flexDirection="column">
					<Topbar hideBreadCrumb filters={filters} />
					<SettingsUI
						height={height}
						width={width}
						hasUserName={hasUserName}
						hasPreferredEditor={hasPreferredEditor}
						userName={userName ?? ''}
						preferredEditor={preferredEditor ?? ''}
					/>
				</Box>

				<ContextBar
					width={width}
					mode={state.mode}
					availableHints={state.availableHints}
				/>
			</Box>
		);
	}

	if (isUninitializedRepo) {
		return (
			<Box flexDirection="column">
				<Box flexDirection="column">
					<Topbar hideBreadCrumb filters={filters} />
					<InitProjectUI height={height} width={width} />
				</Box>

				<ContextBar
					width={width}
					mode={state.mode}
					availableHints={state.availableHints}
				/>
			</Box>
		);
	}

	const board = findInBreadCrumb(getState().breadCrumb ?? [], 'BOARD');

	if (isSuccess(board)) {
		const boardId = board.value.id;
		const numberOfSwimlanes = getRenderedChildren(boardId).length;
		const swimlanePart = 3;
		const swimlaneMaxWidth = Math.floor(width / swimlanePart);
		const swimlaneDynamicWidth = Math.floor(
			width / Math.max(numberOfSwimlanes, 1),
		);
		const colWidth = Math.min(swimlaneDynamicWidth, swimlaneMaxWidth);

		width = colWidth * Math.max(numberOfSwimlanes, swimlanePart);
	}

	return (
		<Box flexDirection="column">
			<Box flexDirection="column">
				<Topbar filters={filters} />
				<WorkspaceUI
					width={width}
					height={height}
					currentNode={state.currentNode}
					selectedIndex={state.selectedIndex}
					breadCrumb={state.breadCrumb}
					viewMode={state.viewMode}
					mode={state.mode}
				/>
			</Box>

			<ContextBar
				width={width}
				mode={state.mode}
				availableHints={state.availableHints}
			/>
		</Box>
	);
}
