import chalk from 'chalk';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import {syncEpiqFromRemote} from './git/sync.js';
import EpiqApp from './lib/components/EpiqApp.js';
import {loadSettingsFromConfig} from './lib/config/user-config.js';
import {bootStateFromEventLog} from './lib/event/event-boot.js';
import {loadMergedEvents} from './lib/event/event-load.js';
import {AppEvent} from './lib/event/event.model.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import {failed, isFail, Result, succeeded} from './lib/model/result-types.js';
import {patchSettingsState} from './lib/state/settings.state.js';
import {getSafeState, patchState} from './lib/state/state.js';
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

const failAt = (step: number, message: string): Result<never> =>
	failed(`[boot:${step}] ${message}`);

const formatUnknownError = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;

	try {
		return JSON.stringify(error, null, 2);
	} catch {
		return String(error);
	}
};

const renderNode = (node: React.ReactNode): Result<void> => {
	try {
		if (!ink) {
			ink = render(node);
			return succeeded('Rendered app', undefined);
		}

		ink.rerender(node);
		return succeeded('Rerendered app', undefined);
	} catch (error) {
		return failed(`Unable to render app: ${formatUnknownError(error)}`);
	}
};

const renderApp = (): Result<void> => {
	const stateResult = getSafeState();
	if (isFail(stateResult)) return failed(stateResult.message);

	return renderNode(<EpiqApp width={width} height={height} />);
};

const loadBootContext = (): Result<BootContext> => {
	const epiqRootDirResult = resolveClosestEpiqProjectRoot(process.cwd());

	if (isFail(epiqRootDirResult)) {
		return succeeded('No Epiq project found', {
			hasProject: false,
			epiqRootDir: null,
			events: [],
		});
	}

	return succeeded('Resolved Epiq project root', {
		hasProject: true,
		epiqRootDir: epiqRootDirResult.value,
		events: [],
	});
};

const loadSettings = (): Result<boolean> => {
	const settings = loadSettingsFromConfig();

	if (isFail(settings)) {
		logger.info(`[boot] settings not loaded: ${settings.message}`);
		return succeeded('Settings missing or invalid, continuing', false);
	}

	patchSettingsState(settings.value);
	return succeeded('Loaded settings', true);
};

const syncAndLoadProjectEvents = async (
	bootContext: BootContext,
): Promise<Result<AppEvent[]>> => {
	if (!bootContext.hasProject) {
		return succeeded('No project found, skipped project event loading', []);
	}

	if (!bootContext.epiqRootDir) {
		return failed('Project root missing from boot context');
	}

	const syncResult = await syncEpiqFromRemote(bootContext.epiqRootDir);

	if (isFail(syncResult)) {
		return failed(syncResult.message);
	}

	const eventsResult = loadMergedEvents(bootContext.epiqRootDir);

	if (isFail(eventsResult)) {
		return failed(eventsResult.message);
	}

	logger.info('[boot] loaded events', {
		root: bootContext.epiqRootDir,
		count: eventsResult.value.length,
		actions: eventsResult.value.map(event => event.action),
	});

	return succeeded('Loaded project events', eventsResult.value);
};

async function bootApp(): Promise<Result<void>> {
	try {
		const settingsResult = loadSettings();
		if (isFail(settingsResult)) return failAt(1, settingsResult.message);

		const bootContextResult = loadBootContext();
		if (isFail(bootContextResult)) {
			return failAt(2, bootContextResult.message);
		}

		const bootContext = bootContextResult.value;

		const eventsResult = await syncAndLoadProjectEvents(bootContext);
		if (isFail(eventsResult)) return failAt(3, eventsResult.message);

		bootContext.events = eventsResult.value;

		const bootStateResult = bootStateFromEventLog({
			hasProject: bootContext.hasProject,
			eventLog: bootContext.events,
		});

		if (isFail(bootStateResult)) {
			return failAt(4, bootStateResult.message);
		}

		const stateResult = getSafeState();
		if (isFail(stateResult)) return failAt(5, stateResult.message);

		patchState({hasProject: bootContext.hasProject});

		const renderResult = renderApp();
		if (isFail(renderResult)) return failAt(6, renderResult.message);

		initListeners();

		return succeeded('Booted Epiq', undefined);
	} catch (error) {
		return failAt(0, formatUnknownError(error));
	}
}

process.stdout.on('resize', () => {
	width = process.stdout.columns || 120;
	height = process.stdout.rows || 20;

	if (!ink) return;

	const stateResult = getSafeState();
	if (isFail(stateResult)) {
		logger.info(`[boot:resize] ${stateResult.message}`);
		return;
	}

	const renderResult = renderApp();
	if (isFail(renderResult)) {
		logger.info(`[boot:resize] ${renderResult.message}`);
	}
});

void (async () => {
	console.clear();

	const bootResult = await bootApp();

	if (isFail(bootResult)) {
		logger.info(bootResult.message);
		console.error(chalk.red(`Failed to boot Epiq:\n${bootResult.message}`));
		process.exitCode = 1;
	}
})();
