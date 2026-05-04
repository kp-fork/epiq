import chalk from 'chalk';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './lib/components/App.js';
import {syncEpiqFromRemote} from './git/sync.js';
import {loadSettingsFromConfig} from './lib/config/user-config.js';
import {bootStateFromEventLog} from './lib/event/event-boot.js';
import {loadMergedEvents} from './lib/event/event-load.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import {isFail} from './lib/model/result-types.js';
import {patchSettingsState} from './lib/state/settings.state.js';
import {resolveClosestEpiqRoot} from './lib/storage/paths.js';
import './logger.js';
import {AppEvent} from './lib/event/event.model.js';

meow(
	`${chalk.bold('Epiq CLI')}

${chalk.dim('Boot in directory:')}
  ${chalk.cyan('$ epiq')}

`,
	{
		importMeta: import.meta,
		flags: {
			init: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

type BootContext = {
	hasEpiqRoot: boolean;
	events: AppEvent[];
};

let width = process.stdout.columns || 120;
let height = process.stdout.rows || 20;
let ink: ReturnType<typeof render> | null = null;

const renderNode = (node: React.ReactNode) => {
	if (!ink) {
		ink = render(node);
		return;
	}

	ink.rerender(node);
};

const renderApp = () => {
	renderNode(<App width={width} height={height} />);
};

const loadBootContext = (): BootContext => {
	const epiqRootDirResult = resolveClosestEpiqRoot(process.cwd());

	if (isFail(epiqRootDirResult)) {
		logger.info('No .epiq directory found, starting in init mode');

		return {
			hasEpiqRoot: false,
			events: [],
		};
	}

	const eventsResult = loadMergedEvents(epiqRootDirResult.value);

	if (isFail(eventsResult)) {
		const noEventsFound = eventsResult.message.includes('No events found');

		if (noEventsFound) {
			logger.info('No events found, starting with empty state');

			return {
				hasEpiqRoot: true,
				events: [],
			};
		}

		throw new Error(eventsResult.message);
	}

	return {
		hasEpiqRoot: true,
		events: eventsResult.value,
	};
};

async function bootApp() {
	const settings = loadSettingsFromConfig();
	if (!isFail(settings)) {
		patchSettingsState(settings.value);
	}

	const bootContext = loadBootContext();

	if (bootContext.hasEpiqRoot) {
		await syncEpiqFromRemote();
	}

	const eventLogBootResult = bootStateFromEventLog(bootContext.events);
	if (isFail(eventLogBootResult)) {
		throw new Error(`Failed to boot state: ${eventLogBootResult.message}`);
	}

	renderApp();
	initListeners();
}

process.stdout.on('resize', () => {
	width = process.stdout.columns || 120;
	height = process.stdout.rows || 20;

	if (ink) {
		renderApp();
	}
});

(async () => {
	console.clear();
	await bootApp();
})();
