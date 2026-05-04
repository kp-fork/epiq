import fs from 'node:fs';
import {ulid} from 'ulid';
import {z} from 'zod';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getEpiqDirPath, getProjectFilePath} from '../storage/paths.js';

const EpiqProjectSchema = z.object({
	projectId: z.string().min(1),
	stateBranch: z.string().min(1),
	createdAt: z.string().datetime(),
});

export type EpiqProject = z.infer<typeof EpiqProjectSchema>;

const createProjectFile = (): EpiqProject => ({
	projectId: ulid(),
	stateBranch: 'epiq/state',
	createdAt: new Date().toISOString(),
});

export const readProjectFile = (repoRoot: string): Result<EpiqProject> => {
	const filePath = getProjectFilePath(repoRoot);

	if (!fs.existsSync(filePath)) {
		return failed('Missing .epiq/project.json');
	}

	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		const json = JSON.parse(raw) as unknown;

		const result = EpiqProjectSchema.safeParse(json);

		if (!result.success) {
			return failed(
				`Invalid .epiq/project.json: ${result.error.issues
					.map(issue => `${issue.path.join('.')}: ${issue.message}`)
					.join(', ')}`,
			);
		}

		return succeeded('Read project.json', result.data);
	} catch (error) {
		return failed(
			error instanceof Error
				? `Failed to read .epiq/project.json: ${error.message}`
				: 'Failed to read .epiq/project.json',
		);
	}
};

export const readProjectId = (repoRoot: string): Result<string> => {
	const result = readProjectFile(repoRoot);
	if (isFail(result)) return failed(result.message);

	return succeeded('Read projectId', result.value.projectId);
};

export const ensureProjectFile = (repoRoot: string): Result<null> => {
	const epiqDir = getEpiqDirPath(repoRoot);
	const projectFilePath = getProjectFilePath(repoRoot);

	try {
		fs.mkdirSync(epiqDir, {recursive: true});

		if (fs.existsSync(projectFilePath)) {
			const readResult = readProjectFile(repoRoot);
			if (isFail(readResult)) return failed(readResult.message);

			return succeeded('Project already initialized', null);
		}

		const project = createProjectFile();

		fs.writeFileSync(
			projectFilePath,
			JSON.stringify(project, null, 2) + '\n',
			'utf8',
		);

		return succeeded('Created project.json', null);
	} catch (error) {
		return failed(
			error instanceof Error
				? `Failed to initialize project: ${error.message}`
				: 'Failed to initialize project',
		);
	}
};
