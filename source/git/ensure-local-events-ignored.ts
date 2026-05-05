import fs from 'node:fs';
import path from 'node:path';
import {Result, succeeded} from '../lib/model/result-types.js';
import {logger} from '../logger.js';

export const ensureLocalEpiqIgnored = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const gitignorePath = path.join(repoRoot, '.gitignore');

	let content = fs.existsSync(gitignorePath)
		? fs.readFileSync(gitignorePath, 'utf8')
		: '';

	const ignorePatterns = ['.epiq/events/', '.epiq/log/'];
	const lines = content.split('\n').map(line => line.trim());

	const missingPatterns = ignorePatterns.filter(
		pattern =>
			!lines.some(
				line =>
					line === pattern ||
					line === pattern.replace(/\/$/, '') ||
					line === '/' + pattern ||
					line === '/' + pattern.replace(/\/$/, ''),
			),
	);

	if (missingPatterns.length === 0) {
		return succeeded('Local epiq paths already ignored', false);
	}

	const markerComment = '# [epiq]: local hydrated state is never committed';

	const block = [markerComment, ...missingPatterns].join('\n');

	content = content.trimEnd() + `\n\n${block}\n`;

	fs.writeFileSync(gitignorePath, content, 'utf8');

	logger.info(
		`Added ${missingPatterns.join(', ')} to .gitignore (epiq local state)`,
	);

	return succeeded('Local epiq paths ignored', true);
};
