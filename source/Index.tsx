import chalk from 'chalk';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import EpiqApp from './lib/components/EpiqApp.js';
import {syncEpiqFromRemote} from './git/sync.js';
import {loadSettingsFromConfig} from './lib/config/user-config.js';
import {bootStateFromEventLog} from './lib/event/event-boot.js';
import {loadMergedEvents} from './lib/event/event-load.js';
import {AppEvent} from './lib/event/event.model.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import {isFail} from './lib/model/result-types.js';
import {patchSettingsState} from './lib/state/settings.state.js';
import {patchState} from './lib/state/state.js';
import {resolveClosestEpiqProjectRoot} from './lib/storage/paths.js';
import './logger.js';

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
	hasProject: boolean;
	epiqRootDir: string | null;
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
	renderNode(<EpiqApp width={width} height={height} />);
};

const loadBootContext = (): BootContext => {
	const epiqRootDirResult = resolveClosestEpiqProjectRoot(process.cwd());

	if (isFail(epiqRootDirResult)) {
		return {hasProject: false, epiqRootDir: null, events: []};
	}

	return {
		hasProject: true,
		epiqRootDir: epiqRootDirResult.value,
		events: [],
	};
};

async function bootApp() {
	const settings = loadSettingsFromConfig();

	if (!isFail(settings)) {
		patchSettingsState(settings.value);
	}

	const bootContext = loadBootContext();

	if (bootContext.hasProject) {
		await syncEpiqFromRemote();
		const eventsResult = loadMergedEvents(bootContext.epiqRootDir!);
		if (!isFail(eventsResult)) {
			bootContext.events = eventsResult.value;
		}
	}

	const eventLogBootResult = bootStateFromEventLog({
		hasProject: bootContext.hasProject,
		eventLog: bootContext.events,
	});

	if (isFail(eventLogBootResult)) {
		logger.info(`Failed to boot state: ${eventLogBootResult.message}`);
	}

	patchState({hasProject: bootContext.hasProject});

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
