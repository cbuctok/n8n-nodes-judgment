import type { ChoiceQuestion, EntryType, JsonValue, Question, QuestionType } from './types';

export type QuestionOption = {
	value: string;
	description?: string;
};

export type QuestionInput = {
	id: string;
	type: QuestionType;
	instructions: EntryType;
	/** Noul only: description of a yes answer. */
	trueDescription?: EntryType;
	/** Noul only: description of a no answer. */
	falseDescription?: EntryType;
	/** Choice only: the labels that may be selected. */
	options?: QuestionOption[];
	/** Score only: ordered level descriptions, lowest first. */
	levels?: string[];
};

export interface GeneratedQuestion {
	id: string;
	question: Question;
}

export interface QuestionValidationIssue {
	id: string;
	message: string;
}

/**
 * True for values that carry no content: undefined, null, an empty or whitespace-only string, or an
 * empty collection. Used to drop untouched optional fields before they reach the API, which rejects
 * empty criteria.
 */
export function isBlank(value: unknown): boolean {
	if (value === undefined || value === null) {
		return true;
	}
	if (typeof value === 'string') {
		return value.trim() === '';
	}
	if (Array.isArray(value)) {
		return value.length === 0;
	}
	return false;
}

export function isJsonObject(value: unknown): value is Record<string, JsonValue> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns the free-text and collection fields of a question into the structured JSON shapes that
 * System One accepts for instructions and criteria. Plain strings are returned as-is so simple
 * questions stay simple; anything object-shaped is passed through untouched.
 *
 * Supports both a JSON string and a form-native object, because n8n's JSON field yields either
 * depending on how the user typed the value.
 */
/**
 * Coerces a value from an n8n parameter into something the API accepts as state, instructions or
 * criteria.
 *
 * n8n hands a JSON-typed parameter back either as a parsed value or as the raw string, depending on
 * how it was typed, and an untouched text field is an empty string rather than undefined. Strings
 * that look like JSON are parsed; anything unparseable is passed through as text rather than thrown
 * away, so a user's typo becomes a visible API error instead of a silently empty field.
 */
export function asEntryType(value: unknown): EntryType {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') {
			return null;
		}
		if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
			try {
				return JSON.parse(trimmed) as EntryType;
			} catch {
				return value;
			}
		}
		return value;
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	if (Array.isArray(value) || isJsonObject(value)) {
		return value as EntryType;
	}

	return null;
}

/**
 * Returns the rows of a `fixedCollection` parameter, or an empty list when the collection is absent.
 *
 * Each caller supplies its own container name because n8n resolves sub-field names node-wide, so no
 * single name can be assumed and every collection needs its own.
 */
function collectionRows(raw: unknown, container: string): Record<string, JsonValue>[] {
	if (!isJsonObject(raw) || !Array.isArray(raw[container])) {
		return [];
	}
	return (raw[container] as unknown[]).filter(isJsonObject);
}

export function readListParameter(raw: unknown, container: string, leaf: string): string[] {
	return collectionRows(raw, container)
		.map((entry) => entry[leaf])
		.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
		.map((value) => value.trim());
}

/**
 * Reads `{ label, description }` rows out of a `fixedCollection`.
 *
 * `container` and `leaf` are supplied by the caller because every collection carries its own
 * sub-field names, which n8n requires to be unique across the node.
 */
export function readOptionsParameter(
	raw: unknown,
	container: string,
	labelKey: string,
	descriptionKey: string,
): QuestionOption[] {
	return collectionRows(raw, container)
		.map((entry) => {
			const label = entry[labelKey];
			const description = entry[descriptionKey];
			return {
				value: typeof label === 'string' ? label.trim() : '',
				description:
					typeof description === 'string' && description.trim() !== ''
						? description.trim()
						: undefined,
			};
		})
		.filter((option) => option.value !== '');
}

/**
 * Builds the `questions` map for one question. Each generated key is `<id>_<type>` because the
 * The API stores question ids and answer ids in separate namespaces, so `urgency_choice` and
 * `urgency_noul` can coexist without colliding, while the node still shows a single `id` per row.
 */
function buildNoul(id: string, key: string, input: QuestionInput): GeneratedQuestion {
	// Blank descriptions are dropped rather than sent as empty strings: the API rejects an empty
	// criterion, and an untouched optional field in the UI is always an empty string.
	const criteria: { true?: EntryType; false?: EntryType } = {};
	if (!isBlank(input.trueDescription)) {
		criteria.true = input.trueDescription;
	}
	if (!isBlank(input.falseDescription)) {
		criteria.false = input.falseDescription;
	}

	return {
		id: key,
		question: {
			type: 'noul',
			instructions: input.instructions,
			...(Object.keys(criteria).length > 0 ? { criteria } : {}),
		},
	};
}

function buildChoice(
	id: string,
	key: string,
	input: QuestionInput,
): GeneratedQuestion | QuestionValidationIssue {
	const options = input.options ?? [];
	if (options.length === 0) {
		return { id, message: 'Choice questions need at least one option' };
	}

	const criteria: Record<string, EntryType> = {};
	for (const option of options) {
		criteria[option.value] = option.description ?? null;
	}

	return {
		id: key,
		question: {
			type: 'choice',
			instructions: input.instructions,
			criteria: criteria as ChoiceQuestion['criteria'],
		},
	};
}

function buildScore(
	id: string,
	key: string,
	input: QuestionInput,
): GeneratedQuestion | QuestionValidationIssue {
	const levels = input.levels ?? [];
	if (levels.length < 2) {
		return {
			id,
			message:
				'Score questions need at least two levels because the answer is a position on an ordered rubric',
		};
	}

	return {
		id: key,
		question: { type: 'score', instructions: input.instructions, criteria: levels },
	};
}

export function buildQuestion(input: QuestionInput): GeneratedQuestion | QuestionValidationIssue {
	const id = input.id.trim();
	if (id === '') {
		return { id: '(empty)', message: 'Question ID must not be empty' };
	}

	// The API keeps question ids and answer ids in separate namespaces, so the generated key carries
	// the type as a suffix. That lets `urgency_noul` and `urgency_choice` coexist while the node
	// shows a single `id` per row.
	const key = `${id}_${input.type}`;

	if (input.type === 'noul') {
		return buildNoul(id, key, input);
	}
	if (input.type === 'choice') {
		return buildChoice(id, key, input);
	}
	return buildScore(id, key, input);
}

export function buildQuestions(
	inputs: QuestionInput[],
): { questions: Record<string, Question>; issues: QuestionValidationIssue[] } {
	const questions: Record<string, Question> = {};
	const issues: QuestionValidationIssue[] = [];

	for (const input of inputs) {
		const result = buildQuestion(input);
		if ('question' in result) {
			questions[result.id] = result.question;
		} else {
			issues.push(result);
		}
	}

	return { questions, issues };
}
