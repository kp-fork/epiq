import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {getEpiqDirPath} from '../storage/paths.js';
import {failed, succeeded} from '../model/result-types.js';
import {EPIQ_VERSION} from '../../version.js';
import {ulid} from 'ulid';

const PROJECT_FILE_NAME = 'project.json';

export function ensureProjectFile(root: string) {
	const epiqDir = getEpiqDirPath(root);
	const projectFilePath = path.join(epiqDir, PROJECT_FILE_NAME);

	try {
		// ensure .epiq dir
		fs.mkdirSync(epiqDir, {recursive: true});

		// don't overwrite if it exists
		if (fs.existsSync(projectFilePath)) {
			return succeeded('Project already initialized', null);
		}

		const project = {
			projectId: ulid(),
			stateBranch: 'epiq/state',
			createdAt: new Date().toISOString(),
		};

		fs.writeFileSync(
			projectFilePath,
			JSON.stringify(project, null, 2),
			'utf-8',
		);

		return succeeded('Created project.json', null);
	} catch (err) {
		return failed(
			err instanceof Error
				? `Failed to initialize project: ${err.message}`
				: 'Failed to initialize project',
		);
	}
}
