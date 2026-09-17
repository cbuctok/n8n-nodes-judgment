import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { asEntryType, buildQuestions, readListParameter } from '../../shared/questions';
import type { QuestionInput } from '../../shared/questions';
import { createTransport } from '../../shared/transport';
import { resolveState as resolveStateParameter, stateParameterNames } from '../../shared/stateFields';
import { resolveModel } from '../../shared/models';
import { findUnparsedJson, getAnswer, getAnswerConfidence, getAnswerValue } from '../../shared/extract';
import type { TypeSafeCredentials } from '../../shared/models';
import { errorNode } from '../../shared/errors';

import { scoreDescription } from './description';

export { scoreDescription };

interface Dimension {
	name: string;
	instructions: unknown;
	levels: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads dimensions from rows.
 *
 * A dimension either carries its own levels or borrows the shared set, so the shared levels are
 * resolved once and handed in. `levelsSource` defaults to `shared` so a row that has not been
 * touched yet inherits the shared scale instead of contributing an empty rubric.
 */
function readDimensions(raw: unknown, sharedLevels: string[]): Dimension[] {
	if (!isObject(raw) || !Array.isArray(raw.dimension)) {
		return [];
	}

	return (raw.dimension as unknown[])
		.filter(isObject)
		.map((entry) => {
			// A dimension either states its own levels one per line, or borrows the shared scale.
			const usesOwnLevels = entry.dimensionLevelsSource === 'own';
			return {
				name: typeof entry.dimensionName === 'string' ? entry.dimensionName.trim() : '',
				instructions: entry.dimensionInstructions,
				levels: usesOwnLevels ? splitLevels(entry.ownLevels) : sharedLevels,
			};
		})
		.filter((dimension) => dimension.name !== '');
}

/**
 * Resolves the shared level set for dimensions that borrow it. Returns an empty list when the user
 * is in JSON mode, where each dimension states its own levels.
 */
function readSharedLevels(this: IExecuteFunctions, itemIndex: number): string[] {
	return this.getNodeParameter('sharedLevelsMode', itemIndex, 'fields') === 'json'
		? asLevelList(this.getNodeParameter('sharedLevelsJson', itemIndex, ''))
		: readListParameter(this.getNodeParameter('sharedLevels', itemIndex, {}), 'sharedLevel', 'sharedLevelDescription');
}

/** Accepts level descriptions as plain strings or as objects with a description field. */
function asLevelList(raw: unknown): string[] {
	const parsed = asEntryType(raw);
	if (!Array.isArray(parsed)) {
		return [];
	}

	return parsed
		.map((level) => {
			if (typeof level === 'string') {
				return level.trim();
			}
			if (isObject(level) && typeof level.description === 'string') {
				return level.description.trim();
			}
			return '';
		})
		.filter((level) => level !== '');
}

/**
 * Reads dimensions from a JSON array. Each entry needs a name, instructions, and an ordered list of
 * level descriptions. Levels may be plain strings or objects, because the API accepts either.
 */
function readDimensionsJson(raw: unknown): Dimension[] {
	const parsed = asEntryType(raw);
	if (!Array.isArray(parsed)) {
		return [];
	}

	return parsed
		.map((entry) => {
			if (!isObject(entry)) {
				return { name: '', instructions: null, levels: [] as string[] };
			}
			const name = typeof entry.name === 'string' ? entry.name.trim() : '';
			return { name, instructions: entry.instructions ?? null, levels: asLevelList(entry.levels) };
		})
		.filter((dimension) => dimension.name !== '');
}

/** Reads weights from a JSON object of dimension name to number. */
/**
 * Splits a multiline level list into descriptions. Blank lines are dropped so a trailing newline
 * does not add an empty level to the rubric.
 */
function splitLevels(raw: unknown): string[] {
	if (typeof raw !== 'string') {
		return [];
	}
	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '');
}

function readWeightsJson(raw: unknown): Map<string, number> {
	const weights = new Map<string, number>();
	const parsed = asEntryType(raw);
	if (!isObject(parsed)) {
		return weights;
	}

	for (const [name, value] of Object.entries(parsed)) {
		const weight = typeof value === 'number' ? value : Number(value);
		if (name.trim() !== '' && Number.isFinite(weight) && weight >= 0) {
			weights.set(name.trim(), weight);
		}
	}

	return weights;
}

function readWeights(raw: unknown): Map<string, number> {
	const weights = new Map<string, number>();
	if (!isObject(raw) || !Array.isArray(raw.weight)) {
		return weights;
	}

	for (const entry of raw.weight as unknown[]) {
		if (!isObject(entry)) {
			continue;
		}
		const name = typeof entry.weightDimension === 'string' ? entry.weightDimension.trim() : '';
		const weight = typeof entry.weightValue === 'number' ? entry.weightValue : Number(entry.weightValue);
		if (name !== '' && Number.isFinite(weight) && weight >= 0) {
			weights.set(name, weight);
		}
	}

	return weights;
}

/**
 * Normalizes a raw score into 0-1 using its own legend, then combines the normalized values with
 * the configured weights. The legend is what makes this possible: a score of 1.6 out of three
 * levels is not comparable to a score of 4 out of five until both are divided by their range.
 */
function combineDimensions(
	dimensions: Dimension[],
	answers: Record<string, unknown>,
	weights: Map<string, number>,
): {
	dimensions: Array<{
		name: string;
		score: number;
		normalized: number | null;
		confidence: number | null;
		weight: number;
		legend: unknown;
	}>;
	combinedScore: number | null;
} {
	const rows = dimensions.map((dimension) => {
		const answer = getAnswer(answers, `${dimension.name}_score`);
		const score = getAnswerValue(answer);
		const legend = answer && isObject(answer.legend) ? answer.legend : undefined;
		const levelCount = legend ? Object.keys(legend).length : dimension.levels.length;
		const maxScore = levelCount > 0 ? levelCount - 1 : null;
		const normalized = score !== null && maxScore !== null && maxScore > 0 ? score / maxScore : null;

		return {
			name: dimension.name,
			score: score ?? 0,
			normalized,
			confidence: getAnswerConfidence(answer),
			weight: weights.has(dimension.name) ? (weights.get(dimension.name) as number) : 1,
			legend: legend ?? null,
		};
	});

	const usable = rows.filter((row) => row.normalized !== null && row.weight > 0);
	const totalWeight = usable.reduce((sum, row) => sum + row.weight, 0);

	return {
		dimensions: rows,
		combinedScore:
			totalWeight > 0
				? usable.reduce((sum, row) => sum + (row.normalized as number) * row.weight, 0) / totalWeight
				: null,
	};
}

/**
 * Reads the weights for whichever mode the user picked. Equal weighting is a separate mode rather
 * than an empty row list, so "no weights set" and "everyone gets 1" stay distinguishable.
 */
function readWeightsForMode(this: IExecuteFunctions, itemIndex: number): Map<string, number> {
	const mode = this.getNodeParameter('weightsMode', itemIndex, 'equal');

	if (mode === 'equal') {
		return new Map();
	}

	return mode === 'json'
		? readWeightsJson(this.getNodeParameter('weightsJson', itemIndex, ''))
		: readWeights(this.getNodeParameter('weights', itemIndex, {}));
}

async function runQuestions(
	this: IExecuteFunctions,
	itemIndex: number,
	inputs: QuestionInput[],
): Promise<INodeExecutionData[]> {
	const { questions } = buildQuestions(inputs);
	const scoreOptions = this.getNodeParameter('options', itemIndex, {}) as Record<string, unknown>;
	const credentials = (await this.getCredentials('typeSafeApi')) as TypeSafeCredentials;
	const model = resolveModel(scoreOptions, credentials);

	const transport = createTransport({ executeContext: this, baseUrl: credentials.baseUrl });
	const response = await transport({
		state: resolveStateParameter.call(this, stateParameterNames(), itemIndex),
		questions,
		model,
	});

	const keys = inputs.map((input) => `${input.id}_score`);
	const unparsed = findUnparsedJson(response.raw, keys);
	if (unparsed.length > 0) {
		return unparsed.map(({ id, raw }) => ({
			json: {
				id,
				parsed: false,
				rawOutput: raw as IDataObject,
				usage: response.usage ?? null,
				model: response.model ?? null,
				requestId: response.requestId ?? null,
			},
			pairedItem: { item: itemIndex },
		}));
	}

	const { dimensions, combinedScore } = combineDimensions(
		this.getNodeParameter('dimensionsMode', itemIndex, 'fields') === 'json'
			? readDimensionsJson(this.getNodeParameter('dimensionsJson', itemIndex, ''))
			: readDimensions(this.getNodeParameter('dimensions', itemIndex, {}), readSharedLevels.call(this, itemIndex)),
		response.answers,
		readWeightsForMode.call(this, itemIndex),
	);

	return [
		{
			json: {
				dimensions,
				combinedScore,
				usage: response.usage ?? null,
				model: response.model ?? null,
				requestId: response.requestId ?? null,
				raw: response.raw,
			},
			pairedItem: { item: itemIndex },
		},
	];
}

export async function executeScore(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const operation = this.getNodeParameter('operation', itemIndex) as string;

	if (operation === 'composite') {
		const dimensions =
			this.getNodeParameter('dimensionsMode', itemIndex, 'fields') === 'json'
				? readDimensionsJson(this.getNodeParameter('dimensionsJson', itemIndex, ''))
				: readDimensions(this.getNodeParameter('dimensions', itemIndex, {}), readSharedLevels.call(this, itemIndex));
		if (dimensions.length === 0) {
			// Returning an empty array here would end the branch without an error, so the workflow
			// would report success while the following nodes never ran. Failing loudly is the only
			// way a missing dimension is visible.
			throw new NodeOperationError(
				errorNode(this),
				'The composite scoring node has no dimensions to rate',
				{
					itemIndex,
					description:
						'Add at least one dimension, or switch Dimensions to Using JSON and supply an array.',
				},
			);
		}

		return runQuestions.call(
			this,
			itemIndex,
			dimensions.map((dimension) => ({
				id: dimension.name,
				type: 'score',
				instructions: asEntryType(dimension.instructions),
				levels: dimension.levels,
			})),
		);
	}

	return runQuestions.call(this, itemIndex, [
		{
			id: 'rating',
			type: 'score',
			instructions: asEntryType(this.getNodeParameter('instructions', itemIndex, '')),
			levels: readListParameter(this.getNodeParameter('rateLevels', itemIndex, {}), 'rateLevel', 'rateLevelDescription'),
		},
	]);
}
