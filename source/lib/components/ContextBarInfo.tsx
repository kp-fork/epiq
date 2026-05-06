import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {AppState} from '../model/app-state.model.js';
import {theme} from '../theme/themes.js';

interface Props {
	width: number;
	mode: ModeUnion;
	availableHints: AppState['availableHints'];
}

const padOrTrim = (value: string, width: number) => {
	if (value.length === width) return value;
	if (value.length > width) return value.slice(0, width);
	return value.padEnd(width, ' ');
};

const getClampedHints = (availableHints: string[], width: number) => {
	const clampedHints: string[] = [];
	let usedWidth = 0;

	for (const hint of availableHints) {
		const separator = clampedHints.length > 0 ? ' | ' : '';
		const nextWidth = separator.length + hint.length;

		if (usedWidth + nextWidth > width - 4) break;

		clampedHints.push(hint);
		usedWidth += nextWidth;
	}

	return clampedHints;
};

export const ContextBarInfo: React.FC<Props> = ({width, availableHints}) => {
	const innerWidth = Math.max(0, width - 2);
	const hintLine = getClampedHints(availableHints, width).join(' | ');

	const border = chalk.hex(theme.secondary);
	const contentColor = chalk.hex(theme.secondary2);

	const topBorder = border(`╭${'─'.repeat(innerWidth)}╮`);
	const bottomBorder = border(`╰${'─'.repeat(innerWidth)}╯`);
	const middleLine = `${border('│')}${contentColor(
		padOrTrim(` ${hintLine} `, innerWidth),
	)}${border('│')}`;

	return (
		<Box flexDirection="column" width={width}>
			<Text>{topBorder}</Text>
			<Text>{middleLine}</Text>
			<Text>{bottomBorder}</Text>
		</Box>
	);
};
