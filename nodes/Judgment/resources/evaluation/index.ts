import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { EntryType, Question } from '../../shared/types';
import type { JudgmentCredentials } from '../../shared/models';

import {
	asEntryType,
	buildQuestions,
	isJsonObject,
	readListParameter,
	readOptionsParameter,
} from '../../shared/questions';
import type { QuestionInput } from '../../shared/questions';
import { packStates, unpackAnswers } from '../../shared/state';
import { createTransport } from '../../shared/transport';
import { buildStateFields, resolveState as resolveStateParameter, stateParameterNames } from '../../shared/stateFields';
import { readBooleanOption, resolveModel } from '../../shared/models';
import { errorNode } from '../../shared/errors';
import type { QuestionAnswers } from '../../shared/transport';
import {
	findUnparsedJson,
	getAnswer,
	getAnswerChoice,
	getAnswerConfidence,
	getAnswerValue,
	isLowConfidence,
} from '../../shared/extract';
import { buildQuestionFields } from '../../shared/descriptions';

const showOnlyForEvaluation = {
	resource: ['evaluation'],
};

const showOnlyForEvaluationEvaluate = {
	operation: ['evaluate'],
	resource: ['evaluation'],
};

const showOnlyForEvaluationMany = {
	operation: ['evaluateMany'],
	resource: ['evaluation'],
};

export const evaluationDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForEvaluation,
		},
		options: [
			{
				name: 'Evaluate',
				value: 'evaluate',
				action: 'Evaluate one state against typed questions',
				description:
					'Send one state and a set of questions in a single call, and read one answer per question',
			},
			{
				name: 'Evaluate Many',
				value: 'evaluateMany',
				action: 'Evaluate one state per input item against typed questions',
				description:
					'Pack every input item into one state and ask the same questions about all of them at once',
			},
		],
		default: 'evaluate',
	},
	...buildStateFields({ show: showOnlyForEvaluationEvaluate }),
	{
		displayName: 'State Field',
		name: 'stateField',
		type: 'string',
		default: 'text',
		displayOptions: {
			show: showOnlyForEvaluationMany,
		},
		description:
			'Which field of each incoming item holds the state. Leave as text when items are plain strings.',
	},
	{
		displayName: 'Questions',
		name: 'questions',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		// A default question is what makes the AI tool variant usable: n8n generates the tool from
		// this node and offers no way to fill the collection from the agent, so an empty default
		// would leave the tool with nothing to ask.
		// The default must name exactly the fields declared in `values`. n8n builds the value it
		// hands back to the node from this object, so a key missing here is silently dropped even
		// when the workflow stores it.
		default: {
			question: [
				{
					id: 'answer',
					questionType: 'noul',
					questionInstructions: 'Does the state satisfy the condition described in the tool description?',
					trueDescription: '',
					falseDescription: '',
					choiceOptions: { entry: [{ option: '', optionDescription: '' }] },
					levels: { questionLevel: [{ questionLevelDescription: '' }] },
				},
			],
		},
		placeholder: 'Add Question',
		displayOptions: {
			show: showOnlyForEvaluation,
		},
		description:
			'Questions about the state. Send every question you might need in one call: they run in parallel, so extra questions barely change the response time.',
		options: [
			{
				displayName: 'Question',
				name: 'question',
				values: buildQuestionFields() as INodeProperties[],
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
			show: showOnlyForEvaluation,
		},
		options: [
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				default: '',
				placeholder: 'jev-latest',
				description: 'Override the model used for this evaluation. Defaults to the model set on the credential.',
			},
			{
				displayName: 'Fail on Unparsed Answers',
				name: 'failOnUnparsed',
				type: 'boolean',
				default: true,
				description:
					'Whether to raise an error when the API could not turn an answer into a typed value. When off, unparsed answers are returned with their raw output instead.',
			},
		],
	},
];

function readQuestions(this: IExecuteFunctions, itemIndex: number): QuestionInput[] {
	const raw = this.getNodeParameter('questions', itemIndex, {}) as Record<string, unknown>;
	if (!isJsonObject(raw) || !Array.isArray(raw.question)) {
		return [];
	}

	return (raw.question as unknown[]).filter(isJsonObject).map((entry) => ({
		id: typeof entry.id === 'string' ? entry.id : '',
		type:
			entry.questionType === 'choice' || entry.questionType === 'score' ? entry.questionType : 'noul',
		instructions: asEntryType(entry.questionInstructions),
		trueDescription: asEntryType(entry.trueDescription),
		falseDescription: asEntryType(entry.falseDescription),
		options: readOptionsParameter(entry.choiceOptions, 'entry', 'option', 'optionDescription'),
		levels: readListParameter(entry.levels, 'questionLevel', 'questionLevelDescription'),
	}));
}

function resolveState(this: IExecuteFunctions, itemIndex: number, many: boolean): EntryType {
	if (!many) {
		return resolveStateParameter.call(this, stateParameterNames(), itemIndex);
	}

	const stateField = (this.getNodeParameter('stateField', itemIndex, 'text') as string).trim();
	const items = this.getInputData();
	const states: EntryType[] = items.map((item) => {
		const source = stateField === '' ? item.json : item.json[stateField];
		return asEntryType(source);
	});

	return packStates(states, 'items');
}

async function requestAnswers(
	this: IExecuteFunctions,
	itemIndex: number,
	many: boolean,
): Promise<{
	response: QuestionAnswers;
	questions: Record<string, Question>;
	evaluationOptions: Record<string, unknown>;
}> {
	const inputs = readQuestions.call(this, itemIndex);

	if (inputs.length === 0) {
		throw new NodeOperationError(errorNode(this), 'Add at least one question before evaluating', {
			itemIndex,
			description:
				'A request needs at least one question. Questions that are irrelevant for a given item cost almost nothing, so ask every question the workflow might need.',
		});
	}

	const { questions, issues } = buildQuestions(inputs);
	if (issues.length > 0) {
		throw new NodeOperationError(
			errorNode(this),
			`Question "${issues[0].id}" is incomplete: ${issues[0].message}`,
			{ itemIndex },
		);
	}

	const state = resolveState.call(this, itemIndex, many);
	const evaluationOptions = this.getNodeParameter('options', itemIndex, {}) as Record<string, unknown>;
	const credentials = (await this.getCredentials('judgmentApi')) as JudgmentCredentials;
	const model = resolveModel(evaluationOptions, credentials);

	const transport = createTransport({ executeContext: this, baseUrl: credentials.baseUrl });
	const response = await transport({
		state,
		questions,
		model,
	});

	return { response, questions, evaluationOptions };
}

export async function executeEvaluation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const many = (this.getNodeParameter('operation', itemIndex) as string) === 'evaluateMany';
	const { response, questions, evaluationOptions } = await requestAnswers.call(this, itemIndex, many);

	const failOnUnparsed = readBooleanOption(evaluationOptions, 'failOnUnparsed', true);
	const ids = Object.keys(questions);

	if (failOnUnparsed) {
		const unparsed = findUnparsedJson(response.raw, ids);
		if (unparsed.length > 0) {
			throw new NodeOperationError(
				errorNode(this),
				`The API could not parse an answer for question "${unparsed[0].id}"`,
				{
					itemIndex,
					description: `Raw output: ${JSON.stringify(unparsed[0].raw)}`,
				},
			);
		}
	}

	const itemCount = many ? this.getInputData().length : 1;
	const out: INodeExecutionData[] = [];

	for (const id of ids) {
		const answer = getAnswer(response.answers, id);
		const value = getAnswerValue(answer);
		const choice = getAnswerChoice(answer);
		const confidence = getAnswerConfidence(answer);
		const shared = {
			id,
			question: questions[id] as IDataObject,
			type: (questions[id] as Question).type,
			value,
			choice,
			confidence,
			lowConfidence: isLowConfidence(answer),
			answer: answer as IDataObject,
			usage: response.usage ?? null,
			model: response.model ?? null,
			requestId: response.requestId ?? null,
			status: response.status ?? null,
			raw: response.raw,
		};

		if (!many) {
			out.push({ json: shared, pairedItem: { item: itemIndex } });
			continue;
		}

		const unpacked = unpackAnswers(answer, itemCount);
		unpacked.forEach(({ answers: perItem }, index) => {
			out.push({
				json: { ...shared, answer: perItem as IDataObject, itemIndex: index },
				pairedItem: { item: index },
			});
		});
	}

	return out;
}
