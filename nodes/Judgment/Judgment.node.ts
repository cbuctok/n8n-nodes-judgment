import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { choiceDescription, executeChoice } from './resources/choice';
import { evaluationDescription, executeEvaluation } from './resources/evaluation';
import { noulDescription, executeNoul } from './resources/noul';
import { executeScore, scoreDescription } from './resources/score';

/**
 * `judgmentApi` requests carry the authentication mode chosen on the node, so the credential
 * reference is gated on it the same way the other resource parameters are.
 */
export class Judgment implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Judgment',
		name: 'judgment',
		icon: { light: 'file:../../icons/judgment.svg', dark: 'file:../../icons/judgment.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Make typed judgements about text or application state with System One models',
		defaults: {
			name: 'Judgment',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'judgmentApi',
				required: true,
			},
		],
		properties: [
			{
				displayName:
					'Answers are judgements, not facts. Check the confidence of the answers you act on automatically, and route uncertain cases to a person or to a reasoning model.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Choice',
						value: 'choice',
						description: 'Pick one option from a set, or rank a list of candidates',
					},
					{
						name: 'Evaluation',
						value: 'evaluation',
						description: 'Ask several mixed questions about one state in a single call',
					},
					{
						name: 'Noul',
						value: 'noul',
						description: 'Answer one or more yes/no questions with probabilities',
					},
					{
						name: 'Score',
						value: 'score',
						description: 'Rate the state along ordered levels, optionally combining dimensions',
					},
				],
				default: 'evaluation',
			},
			...evaluationDescription,
			...choiceDescription,
			...noulDescription,
			...scoreDescription,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;

				let results: INodeExecutionData[];
				switch (resource) {
					case 'choice':
						results = await executeChoice.call(this, itemIndex);
						break;
					case 'noul':
						results = await executeNoul.call(this, itemIndex);
						break;
					case 'score':
						results = await executeScore.call(this, itemIndex);
						break;
					default:
						results = await executeEvaluation.call(this, itemIndex);
						break;
				}

				returnData.push(...results);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				// A response object means the API answered and rejected the request. No response
				// means the request never got there, which is a different failure and gets a
				// different error type so the two are distinguishable in the UI.
				const hasResponse =
					typeof error === 'object' &&
					error !== null &&
					typeof (error as { response?: unknown }).response === 'object';

				// The AI tool variant runs on a context without `getNode`, so fall back to a plain
				// descriptor. Calling `this.getNode()` unguarded would replace the real failure with
				// a confusing "this.getNode is not a function".
				// DIAG
				const node =
					typeof this.getNode === 'function'
						? this.getNode()
						: {
								id: 'judgment',
								name: 'Judgment',
								type: 'CUSTOM.judgment',
								typeVersion: 1,
								position: [0, 0] as [number, number],
								parameters: {},
							};

				// Carry the underlying message into `description` so a wrapped failure never loses
				// its cause. Without this, n8n reports only the outer error name and the original
				// reason is invisible from the execution log.
				const cause = (error as Error).message;
				const description =
					cause && cause !== (error as Error).name
						? cause
						: String((error as { description?: string }).description ?? '');

				if (hasResponse) {
					// NodeApiError takes a JsonObject, which an Error does not structurally satisfy,
					// so the assertion has to widen through unknown.
					throw new NodeApiError(node, error as unknown as JsonObject, {
						itemIndex,
						...(description ? { description } : {}),
					});
				}

				throw new NodeOperationError(node, error as Error, {
					itemIndex,
					...(description ? { description } : {}),
				});
			}
		}

		return [returnData];
	}

}
