import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';

type InitProjectUIProps = {
	width: number;
	height: number;
};

export const InitProjectUI: React.FC<InitProjectUIProps> = ({
	width,
	height,
}) => {
	return (
		<Box
			height={height - 4}
			flexDirection="column"
			width={width}
			paddingTop={1}
			paddingLeft={2}
			borderStyle="round"
			borderColor={theme.secondary}
			rowGap={1}
		>
			<Text color={theme.accent} bold>
				Initialize project
			</Text>

			<Text>{`This folder is not an ${chalk.hex(theme.accent)(
				'epiq',
			)} project yet.`}</Text>

			<Text color={theme.primary}>
				To start tracking issues here, we need to initialize a new{' '}
				<Text color={theme.primary} backgroundColor={theme.secondary}>
					{' .epiq/project.json '}
				</Text>{' '}
				file in this repository.
			</Text>

			<Box marginTop={1} flexDirection="column">
				<Box>
					<Text color={theme.accent}>{'   '}</Text>
					<Text color={theme.primary}>Type </Text>
					<Text backgroundColor={theme.secondary}>{' :init '}</Text>
				</Box>
			</Box>

			<Box marginTop={1}>
				<Text color={theme.secondary2}>
					(This will create the local epiq project files)
				</Text>
			</Box>
		</Box>
	);
};
