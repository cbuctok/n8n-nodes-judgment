import type { EntryType } from './types';

/**
 * Builds the `state` field of a request.
 *
 * System One takes a single state per request, but n8n users expect one node output per input
 * item. Rather than evaluating each item separately, the node packs every item into one state so
 * they share a single call, then splits the answers again on the way out.
 */
export function packStates(states: EntryType[], scale: string): EntryType {
	if (states.length === 1) {
		return states[0];
	}

	return {
		[scale]: states.map((state, index) => {
			if (typeof state === 'object' && state !== null && !Array.isArray(state)) {
				return { index, ...state } as EntryType;
			}
			return { index, item: state } as EntryType;
		}),
	};
}

export interface UnpackedAnswers<T> {
	/** Answers for one input item, or undefined when the model returned none for it. */
	answers: T | undefined;
	/** The raw answer, kept so callers can still expose it when unpacking finds nothing usable. */
	raw: T;
}

/**
 * Splits an answer that was produced for a packed state back into per-item answers.
 *
 * Answers follow the same index order as the items that went in, so position is the link between
 * an item and its answer. When the shape is anything other than an array of answer objects, the
 * whole answer is handed to every item instead of being dropped.
 */
export function unpackAnswers<T>(raw: T, itemCount: number): UnpackedAnswers<T>[] {
	if (itemCount <= 1) {
		return [{ answers: raw, raw }];
	}

	if (!Array.isArray(raw) || raw.length !== itemCount) {
		return Array.from({ length: itemCount }, () => ({ answers: raw, raw }));
	}

	return raw.map((entry) => ({ answers: entry as T, raw }));
}
