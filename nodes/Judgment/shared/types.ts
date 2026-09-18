/**
 * Judgement provider request and response shapes.
 *
 * The wire format follows TypeSafe System One, the provider this node targets today. Supporting
 * another provider means adding a transport, not rewriting the node.
 *
 * These are declared locally instead of imported from `@typesafe-ai/sdk` on purpose. n8n Cloud
 * does not accept community nodes that ship runtime dependencies, and the linter rejects any
 * import of a third-party package from `nodes/`. Requesting the same shapes over n8n's own
 * authenticated HTTP helper keeps the node dependency-free while staying typed.
 *
 * Field names and semantics follow the v1 API: https://docs.typesafe.ai/api
 */

/**
 * Default API root. Every entry point that talks to the API defaults to this and accepts an
 * override, so it is declared once here rather than repeated as a literal.
 */
export const DEFAULT_API_BASE_URL = 'https://api.typesafe.ai';

/** A JSON-compatible value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Text, a JSON object or array, or null. Accepted by state, instructions, and criteria. */
export type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null;

/**
 * The question kinds this node can build. Declared here once and re-exported from `questions.ts`,
 * which is the module that turns the UI values into these names.
 */
export type QuestionType = 'noul' | 'choice' | 'score';

/** A yes/no question. The answer is the probability that the answer is yes. */
export type NoulQuestion = {
	type: 'noul';
	instructions?: EntryType;
	criteria?: { true?: EntryType; false?: EntryType } | null;
};

/** A question that selects one label from a fixed set. */
export type ChoiceQuestion = {
	type: 'choice';
	instructions?: EntryType;
	criteria: { [label: string]: EntryType };
};

/** A question that places the state on an ordered rubric. */
export type ScoreQuestion = {
	type: 'score';
	instructions?: EntryType;
	criteria: EntryType[];
};

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** Questions keyed by the ids the caller chose. */
export type Questions = Record<string, Question>;

export type NoulAnswer = {
	type: 'noul';
	/** Probability the answer is yes, from 0 to 1. Noul answers carry no separate confidence. */
	noul: number;
};

export type ChoiceAnswer = {
	type: 'choice';
	choice: string;
	probabilities: Record<string, number>;
	confidence: number;
};

export type ScoreAnswer = {
	type: 'score';
	/** Position along the levels, which can land between two of them. */
	score: number;
	/** Level descriptions keyed by their index. */
	legend: Record<string, string>;
	probabilities: Record<string, number>;
	confidence: number;
};

export type UnparsedAnswer = {
	type: 'unparsed';
	raw: unknown;
};

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer | UnparsedAnswer;

export type QuestionUsage = {
	input_tokens: number;
	output_tokens: number;
};

export type SystemOneResponse = {
	model: string;
	answers: Record<string, Answer>;
	usage: QuestionUsage;
};
