import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { asEntryType, buildQuestions } from '../../shared/questions';
import { createTransport } from '../../shared/transport';
import { buildStateFields, resolveState as resolveStateParameter, stateParameterNames } from '../../shared/stateFields';
import { DEFAULT_THRESHOLD, resolveModel } from '../../shared/models';
import { findUnparsedJson, getAnswer } from '../../shared/extract';
import type { JudgmentCredentials } from '../../shared/models';

const showOnlyForNoul = {
	resource: ['noul'],
};

export const noulDescription: INodeProperties[] = [
	...buildStateFields({ show: showOnlyForNoul }),
	{
		displayName: 'Questions',
		// Not `questions`: the Evaluation resource defines a collection of that name with a
		// different shape, and n8n enforces the required fields of only one of them.
		name: 'noulQuestions',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {
			noulQuestion: [
				{ noulName: '', noulInstructions: '', noulTrueDescription: '', noulFalseDescription: '' },
			],
		},
		placeholder: 'Add Question',
		displayOptions: {
			show: showOnlyForNoul,
		},
		description:
			'Yes/no questions about the state. Ask one narrow question per condition: a broad question hides the separate judgements, and combining them here would make the probability hard to interpret.',
		options: [
			{
				displayName: 'Question',
				// Must differ from the Evaluation collection's sub-field, which is also named
				// `question`. n8n resolves sub-fields by name across the node, so two collections
				// sharing one silently override each other's fields.
				name: 'noulQuestion',
				values: [
					{
						displayName: 'Name',
						name: 'noulName',
						type: 'string',
						default: '',
						required: true,
						description:
							'Name for this question. It is not sent to the model, so put the full question in Question. Used to identify the answer in the output.',
					},
					{
						displayName: 'Question',
						name: 'noulInstructions',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
						required: true,
						description:
							'The yes/no question to evaluate. Phrase it so a high probability means yes. Reference structured state fields with backticked paths such as `message.body`.',
					},
					{
						displayName: 'Yes Means',
						name: 'noulTrueDescription',
						type: 'string',
						typeOptions: { rows: 2 },
						default: '',
						description: 'What a high probability means. Worth setting when the boundary is subtle.',
					},
					{
						displayName: 'No Means',
						name: 'noulFalseDescription',
						type: 'string',
						typeOptions: { rows: 2 },
						default: '',
						description: 'What a low probability means',
					},
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: showOnlyForNoul,
		},
		options: [
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				default: '',
				placeholder: 'jev-latest',
				description: 'Override the model used for this evaluation',
			},
			{
				displayName: 'Threshold',
				name: 'threshold',
				type: 'number',
				default: 0.5,
				typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
				description:
					'Probability at or above which the answer counts as a yes. The raw probability is always returned as well, so this only affects the boolean.',
			},
		],
	},
];

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One call per input item rather than one packed call for all of them, because a Noul is usually
 * thresholded into a branch and each item decides its own routing. Cost is still one request per
 * item, with every question for that item batched into it.
 */
export async function executeNoul(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const raw = this.getNodeParameter('noulQuestions', itemIndex, {}) as IDataObject;
	const entries = isObject(raw) && Array.isArray(raw.noulQuestion) ? (raw.noulQuestion as unknown[]) : [];

	const inputs = entries.filter(isObject).map((entry) => ({
		id: typeof entry.noulName === 'string' && entry.noulName.trim() !== '' ? entry.noulName.trim() : 'question',
		type: 'noul' as const,
		instructions: asEntryType(entry.noulInstructions),
		trueDescription: asEntryType(entry.noulTrueDescription),
		falseDescription: asEntryType(entry.noulFalseDescription),
	}));

	if (inputs.length === 0) {
		return [];
	}

	const { questions } = buildQuestions(inputs);
	const noulOptions = this.getNodeParameter('options', itemIndex, {}) as Record<string, unknown>;
	const credentials = (await this.getCredentials('judgmentApi')) as JudgmentCredentials;
	const model = resolveModel(noulOptions, credentials);
	const threshold =
		typeof noulOptions.threshold === 'number' && Number.isFinite(noulOptions.threshold)
			? noulOptions.threshold
			: DEFAULT_THRESHOLD;

	const transport = createTransport({ executeContext: this, baseUrl: credentials.baseUrl });
	const response = await transport({
		state: resolveStateParameter.call(this, stateParameterNames(), itemIndex),
		questions,
		model,
	});

	const ids = inputs.map((input) => `${input.id}_noul`);
	const unparsed = findUnparsedJson(response.raw, ids);
	if (unparsed.length > 0) {
		return unparsed.map(({ id, raw: rawOutput }) => ({
			json: {
				id,
				parsed: false,
				rawOutput: rawOutput as IDataObject,
				usage: response.usage ?? null,
				model: response.model ?? null,
				requestId: response.requestId ?? null,
			},
			pairedItem: { item: itemIndex },
		}));
	}

	return ids.map((id) => {
		const answer = getAnswer(response.answers, id);
		const probability = answer && typeof answer.noul === 'number' ? answer.noul : null;

		return {
			json: {
				id: id.replace(/_noul$/, ''),
				value: probability,
				probability,
				boolean: probability === null ? null : probability >= threshold,
				threshold,
				answer,
				usage: response.usage ?? null,
				model: response.model ?? null,
				requestId: response.requestId ?? null,
				raw: response.raw,
			},
			pairedItem: { item: itemIndex },
		};
	});
}
