import {failed, Result} from '../model/result-types.js';

export const failAt = (step: number, message: string): Result<never> => {
	logger.error(`[boot:${step}] ${message}`);
	return failed(`[boot:${step}] ${message}`);
};

export const formatUnknownError = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;

	try {
		return JSON.stringify(error, null, 2);
	} catch {
		return String(error);
	}
};
