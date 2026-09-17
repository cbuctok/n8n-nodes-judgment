import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import {
	asEntryType,
	buildQuestions,
	isJsonObject,
	readOptionsParameter,
} from '../../shared/questions';
import type { QuestionInput } from '../../shared/questions';
import { createTransport } from '../../shared/transport';
import { buildStateFields, resolveState as resolveStateParameter, stateParameterNames } from '../../shared/stateFields';
import { readBooleanOption, resolveModel } from '../../shared/models';
import { findUnparsedJson, getAnswer, getAnswerChoice, getAnswerConfidence } from '../../shared/extract';
import type { TypeSafeCredentials } from '../../shared/models';

const showOnlyForChoice = {
	resource: ['choice'],
};

const showOnlyForChoiceDecide = {
	operation: ['decide'],
	resource: ['choice'],
};

export const choiceDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForChoice,
		},
		options: [
			{
				name: 'Decide',
				value: 'decide',
				action: 'Pick one option from a set',
				description:
					'Ask which of a set of options fits the state, and read the selected option with its probabilities',
			},
			{
				name: 'Rank',
				value: 'rank',
				action: 'Rank candidates by their probability',
				description:
					'Turn a choice over many candidate values into a ranked list, which is how reranking and search are built',
			},
		],
		default: 'decide',
	},
	...buildStateFields({ show: showOnlyForChoice }),
	{
		displayName: 'Instructions',
		name: 'instructions',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: {
			show: showOnlyForChoiceDecide,
		},
		description:
			'The question the options answer, for example "Which team should handle this message?". Reference structured state fields with backticked paths such as `ticket.message`.',
	},
	{
		displayName: 'Options',
		name: 'decisionOptions',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: { entry: [{ option: '', optionDescription: '' }, { option: '', optionDescription: '' }] },
		placeholder: 'Add Option',
		displayOptions: {
			show: showOnlyForChoiceDecide,
		},
		description: 'The labels that may be selected, each with a description of what it covers',
		options: [
			{
				displayName: 'Option',
				name: 'entry',
				values: [
					{
						displayName: 'Label',
						name: 'option',
						type: 'string',
						default: '',
						required: true,
						description: 'The value reported back when this option is selected',
					},
					{
						displayName: 'Description',
						name: 'optionDescription',
						type: 'string',
						default: '',
						description:
							'What this option covers, and what it does not. Describing neighbours explicitly sharpens the boundary between them.',
					},
				],
			},
		],
	},
	{
		displayName: 'Candidates',
		name: 'candidatesMode',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				operation: ['rank'],
				resource: ['choice'],
			},
		},
		options: [
			{
				name: 'Fields Below',
				value: 'fields',
				description: 'One row per candidate, which is easiest when a few items are ranked',
			},
			{
				name: 'Using JSON',
				value: 'json',
				description: 'A JSON array, which suits candidates that come from a previous node',
			},
		],
		default: 'fields',
		description: 'How to supply the list of candidates to rank',
	},
	{
		displayName: 'Candidates',
		name: 'candidatesFields',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: { candidate: [{ rankCandidateName: '', rankCandidateDescription: '' }] },
		placeholder: 'Add Candidate',
		displayOptions: {
			show: {
				operation: ['rank'],
				resource: ['choice'],
				candidatesMode: ['fields'],
			},
		},
		description:
			'The candidates to rank, best judged in order. Each name becomes a Choice option, so names must be unique.',
		options: [
			{
				displayName: 'Candidate',
				name: 'candidate',
				values: [
					{
						displayName: 'Name',
						name: 'rankCandidateName',
						type: 'string',
						default: '',
						required: true,
						placeholder: 'e.g. Billing: charges, invoices and refunds',
						description: 'The label reported back for this candidate',
					},
					{
						displayName: 'Description',
						name: 'rankCandidateDescription',
						type: 'string',
						default: '',
						description:
							'What this candidate contains. Leaving it blank is fine when the name already says enough.',
					},
				],
			},
		],
	},
	{
		displayName: 'Candidates JSON',
		name: 'candidatesJson',
		type: 'json',
		default: '',
		displayOptions: {
			show: {
				operation: ['rank'],
				resource: ['choice'],
				candidatesMode: ['json'],
			},
		},
		placeholder: '={{ $json.passages.map(p => ({ name: p.title, description: p.text })) }}',
		description:
			'An array of names, or an array of objects with name and description. Use an expression to take the candidates from a previous node.',
	},
	{
		displayName: 'Instructions',
		name: 'rankInstructions',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: {
			show: {
				operation: ['rank'],
				resource: ['choice'],
			},
		},
		description:
			'The question each candidate is judged against, for example "Which passage answers the question in `query`?"',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: showOnlyForChoice,
		},
		options: [
			{
				displayName: 'Include Candidates With Zero Probability',
				name: 'includeZeroProbability',
				type: 'boolean',
				default: true,
				description: 'Whether to keep candidates the model gave a probability of zero',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				default: '',
				placeholder: 'jev-latest',
				description: 'Override the model used for this evaluation',
			},
		],
	},
];

interface Candidate {
	value: string;
	description?: string;
}

function readCandidateRows(raw: unknown): Candidate[] {
	if (!isJsonObject(raw) || !Array.isArray(raw.candidate)) {
		return [];
	}

	return (raw.candidate as unknown[])
		.filter(isJsonObject)
		.map((entry) => ({
			value: typeof entry.rankCandidateName === 'string' ? entry.rankCandidateName.trim() : '',
			description:
				typeof entry.rankCandidateDescription === 'string' && entry.rankCandidateDescription.trim() !== ''
					? entry.rankCandidateDescription.trim()
					: undefined,
		}))
		.filter((candidate) => candidate.value !== '');
}

function readCandidates(raw: unknown): Candidate[] {
	const parsed = asEntryType(raw);
	if (!Array.isArray(parsed)) {
		return [];
	}

	return parsed
		.map((entry) => {
			if (typeof entry === 'string') {
				return { value: entry.trim() };
			}
			if (isJsonObject(entry)) {
				const value =
					typeof entry.value === 'string'
						? entry.value
						: typeof entry.name === 'string'
							? entry.name
							: typeof entry.label === 'string'
								? entry.label
								: '';
				const description =
					typeof entry.description === 'string' && entry.description.trim() !== ''
						? entry.description
						: undefined;
				return { value: value.trim(), description };
			}
			return { value: '' };
		})
		.filter((candidate) => candidate.value !== '');
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		if (seen.has(candidate.value)) {
			return false;
		}
		seen.add(candidate.value);
		return true;
	});
}

async function rankByProbability(
	this: IExecuteFunctions,
	itemIndex: number,
	input: QuestionInput,
): Promise<INodeExecutionData[]> {
	const questionId = input.id;
	const { questions } = buildQuestions([input]);
	const choiceOptions = this.getNodeParameter('options', itemIndex, {}) as Record<string, unknown>;
	const credentials = (await this.getCredentials('typeSafeApi')) as TypeSafeCredentials;
	const model = resolveModel(choiceOptions, credentials);

	const transport = createTransport({ executeContext: this, baseUrl: credentials.baseUrl });
	const response = await transport({
		state: resolveStateParameter.call(this, stateParameterNames(), itemIndex),
		questions,
		model,
	});

	const answerKey = `${questionId}_choice`;
	const unparsed = findUnparsedJson(response.raw, [answerKey]);
	if (unparsed.length > 0) {
		return [
			{
				json: {
					id: questionId,
					parsed: false,
					ranked: [],
					rawOutput: unparsed[0].raw as IDataObject,
					usage: response.usage ?? null,
					model: response.model ?? null,
					requestId: response.requestId ?? null,
				},
				pairedItem: { item: itemIndex },
			},
		];
	}

	const answer = getAnswer(response.answers, answerKey);
	const choice = getAnswerChoice(answer);
	const probabilities = answer?.probabilities;
	const includeZero = readBooleanOption(choiceOptions, 'includeZeroProbability', true);

	const ranked = isJsonObject(probabilities)
		? Object.entries(probabilities)
				.filter(
					([, probability]) => includeZero || (typeof probability === 'number' && probability > 0),
				)
				.sort((a, b) => (b[1] as number) - (a[1] as number))
				.map(([option, probability], index) => ({
					option,
					probability: probability as number,
					rank: index + 1,
				}))
		: [];

	const top = ranked[0];

	return [
		{
			json: {
				id: questionId,
				choice,
				confidence: getAnswerConfidence(answer),
				topOption: top?.option ?? null,
				topProbability: top?.probability ?? null,
				ranked,
				answer: (answer ?? null) as IDataObject,
				usage: response.usage ?? null,
				model: response.model ?? null,
				requestId: response.requestId ?? null,
				raw: response.raw,
			},
			pairedItem: { item: itemIndex },
		},
	];
}

/**
 * Reads candidates from whichever input mode the user picked. Only the parameter for that mode is
 * read, because n8n keeps stale values behind hidden fields and a left-over JSON value would
 * otherwise win over the rows the user is actually editing.
 */
function readCandidatesForMode(this: IExecuteFunctions, itemIndex: number): Candidate[] {
	const mode = this.getNodeParameter('candidatesMode', itemIndex, 'fields');
	return mode === 'json'
		? readCandidates(this.getNodeParameter('candidatesJson', itemIndex, ''))
		: readCandidateRows(this.getNodeParameter('candidatesFields', itemIndex, {}));
}

export async function executeChoice(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const operation = this.getNodeParameter('operation', itemIndex) as string;

	if (operation === 'rank') {
		const candidates = dedupeCandidates(
			readCandidatesForMode.call(this, itemIndex),
		);
		if (candidates.length === 0) {
			return [];
		}

		return rankByProbability.call(this, itemIndex, {
			id: 'ranking',
			type: 'choice',
			instructions: asEntryType(this.getNodeParameter('rankInstructions', itemIndex, '')),
			options: candidates,
		});
	}

	const raw = this.getNodeParameter('decisionOptions', itemIndex, {}) as unknown;
	return rankByProbability.call(this, itemIndex, {
		id: 'decision',
		type: 'choice',
		instructions: asEntryType(this.getNodeParameter('instructions', itemIndex, '')),
		options: readOptionsParameter(raw, 'entry', 'option', 'optionDescription'),
	});
}
