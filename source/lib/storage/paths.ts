import fs from 'node:fs';
import path from 'node:path';
import {failed, Result, succeeded} from '../model/result-types.js';

export const isLocal = process.env['IS_LOCAL'] === 'true';

export const EPIQ_DIR_NAME = '.epiq';
export const GLOBAL_CONFIG_DIR_NAME = '.epiq-global';
export const EVENTS_DIR_NAME = 'events';
export const PROJECT_FILE_NAME = 'project.json';

export const getExportsDirPath = (root: string): string =>
	path.join(root, EPIQ_DIR_NAME);

export const getEpiqDirPath = (root: string): string =>
	path.join(root, EPIQ_DIR_NAME);

export const getProjectFilePath = (root: string): string =>
	path.join(getEpiqDirPath(root), PROJECT_FILE_NAME);

export const getEventsDirPath = (root: string): string =>
	path.join(getEpiqDirPath(root), EVENTS_DIR_NAME);

const hasLocalEpiqDir = (dir: string): boolean => {
	const candidate = path.join(dir, EPIQ_DIR_NAME);

	return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
};

export const hasLocalProjectFile = (dir: string): boolean => {
	const candidate = getProjectFilePath(dir);

	return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
};

export const resolveClosestEpiqRoot = (startDir: string): Result<string> => {
	let dir = path.resolve(startDir);

	while (true) {
		if (hasLocalEpiqDir(dir)) {
			return succeeded('Resolved closest .epiq root', dir);
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			return failed('No .epiq directory found in any parent');
		}

		dir = parent;
	}
};

export const resolveClosestEpiqProjectRoot = (
	startDir: string,
): Result<string> => {
	let dir = path.resolve(startDir);

	while (true) {
		if (hasLocalProjectFile(dir)) {
			return succeeded('Resolved closest epiq project root', dir);
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			return failed('No .epiq/project.json found in any parent');
		}

		dir = parent;
	}
};

export const ensureEventsDir = (epiqRoot: string): Result<string> => {
	const eventsPath = getEventsDirPath(epiqRoot);

	try {
		fs.mkdirSync(eventsPath, {recursive: true});
		return succeeded('Resolved events dir', eventsPath);
	} catch (error) {
		return failed(
			error instanceof Error
				? `Failed to ensure events dir: ${error.message}`
				: 'Failed to ensure events dir',
		);
	}
};
