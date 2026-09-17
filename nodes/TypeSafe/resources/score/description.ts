import type { INodeProperties } from 'n8n-workflow';

import { buildStateFields } from '../../shared/stateFields';

export const showOnlyForScore = {
	resource: ['score'],
};

export const showOnlyForScoreRate = {
	operation: ['rate'],
	resource: ['score'],
};

export const showOnlyForScoreComposite = {
	operation: ['composite'],
	resource: ['score'],
};

/**
 * Builds a level collection.
 *
 * A level set is an ordered list of descriptions that a rating is positioned against. Each
 * collection needs its own container and leaf names because n8n resolves sub-fields node-wide and
 * silently drops a field when two collections declare the same name.
 */
function levelCollection(config: {
	name: string;
	container: string;
	leaf: string;
	placeholder: string;
	description: string;
	displayOptions?: INodeProperties['displayOptions'];
}): INodeProperties {
	const row = { [config.leaf]: '' };
	return {
		displayName: 'Levels',
		name: config.name,
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		default: { [config.container]: [row, { ...row }] },
		placeholder: 'Add Level',
		description: config.description,
		...(config.displayOptions ? { displayOptions: config.displayOptions } : {}),
		options: [
			{
				displayName: 'Level',
				name: config.container,
				values: [
					{
						displayName: 'Description',
						name: config.leaf,
						type: 'string',
						default: '',
						description: 'One point on the scale, written so it stands on its own',
					},
				],
			},
		],
	};
}

export const scoreDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForScore,
		},
		options: [
			{
				name: 'Composite',
				value: 'composite',
				action: 'Rate several dimensions and combine them with weights',
				description:
					'Score independent dimensions in one call, then combine them into a single weighted score in code. Adjusting a weight never requires new inference.',
			},
			{
				name: 'Rate',
				value: 'rate',
				action: 'Rate the state along ordered levels',
				description:
					'Ask how far along a set of named levels the state sits, and read the position with its probability distribution',
			},
		],
		default: 'rate',
	},
	...buildStateFields({ show: showOnlyForScore }),
	{
		displayName: 'Instructions',
		name: 'instructions',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: {
			show: showOnlyForScoreRate,
		},
		description:
			'What to rate, for example "How frustrated does the customer appear?". Ask about one dimension per question: a rating that mixes several factors hides the judgements you need in order to tune the weights.',
	},
	levelCollection({
		name: 'rateLevels',
		container: 'rateLevel',
		leaf: 'rateLevelDescription',
		placeholder: 'Add Level',
		description:
			'Ordered level descriptions, lowest first. Write each level so it stands on its own, because the score returned is a position along them and can land between two.',
		displayOptions: { show: showOnlyForScoreRate },
	}),
	{
		displayName: 'Dimensions',
		name: 'dimensionsMode',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForScoreComposite,
		},
		options: [
			{
				name: 'Fields Below',
				value: 'fields',
				description: 'One block per dimension, with its own levels. Best for a handful of dimensions.',
			},
			{
				name: 'Using JSON',
				value: 'json',
				description: 'A JSON array of dimensions, which suits dimensions generated from a list',
			},
		],
		default: 'fields',
		description:
			'How to supply the dimensions to rate. All dimensions share a single call and run in parallel, so adding one costs almost nothing.',
	},
	{
		displayName: 'Dimensions',
		name: 'dimensions',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: {
			dimension: [
				{
					dimensionName: '',
					dimensionInstructions: '',
					dimensionLevelsSource: 'shared',
					ownLevels: '',
				},
			],
		},
		placeholder: 'Add Dimension',
		displayOptions: {
			show: {
				...showOnlyForScoreComposite,
				dimensionsMode: ['fields'],
			},
		},
		description:
			'One rating per dimension. Each dimension is rated independently, and the node combines them with the weights below.',
		options: [
			{
				displayName: 'Dimension',
				name: 'dimension',
				values: [
					{
						displayName: 'Name',
						name: 'dimensionName',
						type: 'string',
						default: '',
						required: true,
						description: 'Name for this dimension. It is not sent to the model.',
					},
					{
						displayName: 'Instructions',
						name: 'dimensionInstructions',
						type: 'string',
						typeOptions: { rows: 2 },
						default: '',
						required: true,
						description: 'What this dimension rates',
					},
					{
						displayName: 'Levels Source',
						name: 'dimensionLevelsSource',
						type: 'options',
						noDataExpression: true,
						options: [
							{
								name: 'Use Shared Levels',
								value: 'shared',
								description: 'Rate this dimension on the level set defined below the dimensions',
							},
							{
								name: 'Define Levels Here',
								value: 'own',
								description: 'Give this dimension its own level set',
							},
						],
						default: 'shared',
						description:
							'Where this dimension gets its levels. Dimensions that share a scale can reuse one level set instead of repeating it.',
					},
					{
						displayName: 'Levels',
						name: 'ownLevels',
						type: 'string',
						typeOptions: { rows: 3 },
						// A plain string rather than a nested collection: n8n does not populate a
						// fixedCollection declared inside another collection's rows, so a nested one
						// always arrives empty. One level per line is also quicker to edit.
						default: '',
						placeholder: 'Unclear\nMixed\nClear',
						description:
							'Ordered level descriptions for this dimension, lowest first, one per line. Used when Levels Source is "Define Levels Here".',
					},
				],
			},
		],
	},
	{
		displayName: 'Shared Levels',
		name: 'sharedLevelsMode',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				...showOnlyForScoreComposite,
				dimensionsMode: ['fields'],
			},
		},
		options: [
			{
				name: 'Fields Below',
				value: 'fields',
				description: 'Type the levels once, as ordered rows',
			},
			{
				name: 'Using JSON',
				value: 'json',
				description: 'A JSON array of level descriptions',
			},
		],
		default: 'fields',
		description:
			'The level set shared by dimensions set to "Use Shared Levels". Keeps one scale in one place instead of repeating it per dimension.',
	},
	levelCollection({
		name: 'sharedLevels',
		container: 'sharedLevel',
		leaf: 'sharedLevelDescription',
		placeholder: 'Add Level',
		description:
			'Ordered level descriptions shared by dimensions that use them, lowest first',
		displayOptions: {
			show: {
				...showOnlyForScoreComposite,
				dimensionsMode: ['fields'],
				sharedLevelsMode: ['fields'],
			},
		},
	}),
	{
		displayName: 'Shared Levels JSON',
		name: 'sharedLevelsJson',
		type: 'json',
		default: '',
		displayOptions: {
			show: {
				...showOnlyForScoreComposite,
				dimensionsMode: ['fields'],
				sharedLevelsMode: ['json'],
			},
		},
		placeholder: '["Cosmetic", "Degraded but workable", "Blocking"]',
		description: 'An ordered array of level descriptions shared by dimensions that use them',
	},
	{
		displayName: 'Dimensions JSON',
		name: 'dimensionsJson',
		type: 'json',
		default: '',
		displayOptions: {
			show: {
				...showOnlyForScoreComposite,
				dimensionsMode: ['json'],
			},
		},
		placeholder:
			'[ { "name": "clarity", "instructions": "How clear is this?", "levels": ["Unclear", "Mixed", "Clear"] } ]',
		description:
			'An array of dimensions, each with a name, instructions, and an ordered list of level descriptions. Use an expression to build the list from a previous node.',
	},
	{
		displayName: 'Weights',
		name: 'weightsMode',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				...showOnlyForScoreComposite,
				dimensionsMode: ['fields'],
			},
		},
		options: [
			{
				name: 'Equal',
				value: 'equal',
				description: 'Every dimension counts the same',
			},
			{
				name: 'Fields Below',
				value: 'fields',
				description: 'Set a weight per dimension',
			},
			{
				name: 'Using JSON',
				value: 'json',
				description: 'A JSON object mapping dimension names to weights',
			},
		],
		default: 'equal',
		description:
			'How to weight the dimensions. The combined score is a weighted average over the normalized dimension scores.',
	},
	{
		displayName: 'Weights',
		name: 'weights',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
			sortable: true,
		},
		default: { weight: [{ weightDimension: '', weightValue: 1 }] },
		placeholder: 'Add Weight',
		displayOptions: {
			show: {
				...showOnlyForScoreComposite,
				dimensionsMode: ['fields'],
				weightsMode: ['fields'],
			},
		},
		description:
			'Weight per dimension. The combined score is a weighted average, so leaving every dimension out weights them equally. Weights are applied in the node, not by the model.',
		options: [
			{
				displayName: 'Weight',
				name: 'weight',
				values: [
					{
						displayName: 'Dimension',
						name: 'weightDimension',
						type: 'string',
						default: '',
						required: true,
						description: 'Must match the Name of one of the dimensions above',
					},
					{
						displayName: 'Weight',
						name: 'weightValue',
						type: 'number',
						default: 1,
						typeOptions: { minValue: 0 },
					},
				],
			},
		],
	},
	{
		displayName: 'Weights JSON',
		name: 'weightsJson',
		type: 'json',
		default: '',
		displayOptions: {
			show: {
				...showOnlyForScoreComposite,
				dimensionsMode: ['fields'],
				weightsMode: ['json'],
			},
		},
		placeholder: '={{ { "clarity": 3, "scope": 1 } }}',
		description:
			'An object mapping each dimension name to a number. Dimensions left out are weighted equally at 1.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: showOnlyForScore,
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
		],
	},
];
