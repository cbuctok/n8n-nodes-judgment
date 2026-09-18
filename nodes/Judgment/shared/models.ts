import type { IDataObject } from 'n8n-workflow';

/** Model used when neither the node nor the credential sets one. */
export const DEFAULT_MODEL = 'jev-latest';

/** Probability at or above which a Noul answer counts as a yes. */
export const DEFAULT_THRESHOLD = 0.5;

/** The credential fields this node reads. */
export interface JudgmentCredentials extends IDataObject {
	apiKey?: string;
	baseUrl?: string;
	defaultModel?: string;
}

/**
 * Resolves the model for a request.
 *
 * The API requires `model` on every call, so an unset model falls back to the credential and then
 * to the API's own default name rather than being omitted from the body.
 */
export function resolveModel(
	nodeOptions: Record<string, unknown>,
	credentials: JudgmentCredentials,
): string {
	const nodeModel = nodeOptions.model;
	if (typeof nodeModel === 'string' && nodeModel.trim() !== '') {
		return nodeModel.trim();
	}

	const credentialModel = credentials.defaultModel;
	if (typeof credentialModel === 'string' && credentialModel.trim() !== '') {
		return credentialModel.trim();
	}

	return DEFAULT_MODEL;
}

export function readBooleanOption(options: Record<string, unknown>, name: string, fallback: boolean): boolean {
	const value = options[name];
	return typeof value === 'boolean' ? value : fallback;
}
