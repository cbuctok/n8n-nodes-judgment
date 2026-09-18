import type { IDataObject } from 'n8n-workflow';

const CONFIDENCE_FLAG_THRESHOLD = 0.8;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The provider returns an answer object for every question it was asked, so an id missing from
 * `answers` means the response was not shaped the way the node expects. Returning null keeps that
 * case explicit instead of handing back an empty object that looks like a real answer.
 */
export function getAnswer(answers: Record<string, unknown>, id: string): IDataObject | null {
	const answer = answers[id];
	return isRecord(answer) ? (answer as IDataObject) : null;
}

/**
 * Pulls the numeric value out of an answer. Each question type names its value differently, so the
 * node reports whichever one is present under a single `value` field. For a Choice answer the
 * reported value is the probability of the selected option.
 */
export function getAnswerValue(answer: IDataObject | null): number | null {
	if (answer === null) {
		return null;
	}

	for (const key of ['noul', 'score'] as const) {
		const value = answer[key];
		if (typeof value === 'number') {
			return value;
		}
	}

	const probabilities = answer.probabilities;
	if (isRecord(probabilities)) {
		const choice = answer.choice;
		if (typeof choice === 'string' && typeof probabilities[choice] === 'number') {
			return probabilities[choice] as number;
		}
	}

	return null;
}

export function getAnswerChoice(answer: IDataObject | null): string | null {
	if (answer === null) {
		return null;
	}
	return typeof answer.choice === 'string' ? answer.choice : null;
}

export function getAnswerConfidence(answer: IDataObject | null): number | null {
	if (answer === null) {
		return null;
	}
	return typeof answer.confidence === 'number' ? answer.confidence : null;
}

/**
 * Flags answers the model was not sure about. This is a reporting aid, not a decision: the node
 * sets `lowConfidence` so later steps can branch on it, and never suppresses or alters the answer.
 * Noul answers carry no confidence of their own, so they are never flagged.
 */
export function isLowConfidence(answer: IDataObject | null): boolean {
	const confidence = getAnswerConfidence(answer);
	return confidence !== null && confidence < CONFIDENCE_FLAG_THRESHOLD;
}

/**
 * Finds answers the API could not turn into a typed value. These arrive with `type: "unparsed"`
 * and a `raw` payload, which means the question could not be answered in the requested shape.
 */
export function findUnparsedJson(
	raw: IDataObject,
	ids: string[],
): Array<{ id: string; raw: unknown }> {
	const answers = isRecord(raw.answers) ? raw.answers : {};
	const unparsed: Array<{ id: string; raw: unknown }> = [];
	for (const id of ids) {
		const answer = answers[id];
		if (isRecord(answer) && answer.type === 'unparsed') {
			unparsed.push({ id, raw: answer.raw });
		}
	}
	return unparsed;
}
