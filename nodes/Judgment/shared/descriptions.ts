import type { INodeProperties } from 'n8n-workflow';

/**
 * The `questions` collection is shared by the Evaluate and Evaluate Many operations, so it lives
 * here instead of in either resource folder. Only the display options differ between the two.
 */
export const questionIdField: INodeProperties = {
	displayName: 'ID',
	name: 'id',
	type: 'string',
	default: '',
	required: true,
	placeholder: 'e.g. urgency',
	description:
		'Name for this question. It is not sent to the model, so put the full question in Instructions. Answers come back keyed by this ID.',
};

export const questionTypeField: INodeProperties = {
	displayName: 'Type',
	name: 'questionType',
	type: 'options',
	noDataExpression: true,
	default: 'noul',
	options: [
		{
			name: 'Choice',
			value: 'choice',
			description: 'Pick one option from a set you define',
		},
		{
			name: 'Noul',
			value: 'noul',
			description: 'Answer a yes/no question with a probability',
		},
		{
			name: 'Score',
			value: 'score',
			description: 'Rate the state along ordered levels',
		},
	],
};

export const questionInstructionsField: INodeProperties = {
	displayName: 'Instructions',
	// Must not be `instructions`: the Choice and Score resources define a top-level parameter of
	// that name, and n8n resolves the outer one, so questions inside this collection would always
	// read as empty.
	name: 'questionInstructions',
	type: 'string',
	typeOptions: { rows: 3 },
	default: '',
	required: true,
	description:
		'The question to ask about the state. The model never sees the ID, so this text must carry the entire meaning on its own. Reference structured state fields with backticked paths such as `ticket.message`.',
};

export const noulTrueDescriptionField: INodeProperties = {
	displayName: 'Yes Means',
	name: 'trueDescription',
	type: 'string',
	typeOptions: { rows: 2 },
	default: '',
	description:
		'What a high probability (near 1) means. Worth setting when the yes/no boundary is subtle.',
};

export const noulFalseDescriptionField: INodeProperties = {
	displayName: 'No Means',
	name: 'falseDescription',
	type: 'string',
	typeOptions: { rows: 2 },
	default: '',
	description: 'What a low probability (near 0) means',
};

export const choiceOptionsField: INodeProperties = {
	displayName: 'Options',
	name: 'choiceOptions',
	type: 'fixedCollection',
	typeOptions: {
		multipleValues: true,
		sortable: true,
	},
	default: { entry: [{ option: '', optionDescription: '' }, { option: '', optionDescription: '' }] },
	placeholder: 'Add Option',
	description:
		'The labels that may be selected. The response reports a probability for each one, not just the winner.',
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
						'What this option covers, and what it does not. Describing neighbouring options explicitly sharpens the boundary between them.',
				},
			],
		},
	],
};

export const scoreLevelsField: INodeProperties = {
	displayName: 'Levels',
	name: 'levels',
	type: 'fixedCollection',
	typeOptions: {
		multipleValues: true,
		sortable: true,
	},
	default: { questionLevel: [{ questionLevelDescription: '' }, { questionLevelDescription: '' }] },
	placeholder: 'Add Level',
	description:
		'Ordered level descriptions, lowest first. The answer is a position along these levels and can land between two of them.',
	options: [
		{
			displayName: 'Level',
			name: 'questionLevel',
			values: [
				{
					displayName: 'Description',
					name: 'questionLevelDescription',
					type: 'string',
					default: '',
					description: 'One point on the scale, written so it stands on its own',
				},
			],
		},
	],
};

/**
 * Builds the fields of the question collection.
 *
 * No field here carries `displayOptions`, not even the caller's resource conditions. n8n evaluates
 * a fixedCollection sub-field's conditions in a context where they cannot resolve, and a field whose
 * condition fails is dropped from the value handed to the node — so a sub-field with any
 * `displayOptions` at all comes back undefined. The per-type fields are always present instead, and
 * the readers take the ones that apply.
 */
export function buildQuestionFields(): INodeProperties[] {
	return [
		questionIdField,
		questionTypeField,
		questionInstructionsField,
		noulTrueDescriptionField,
		noulFalseDescriptionField,
		choiceOptionsField,
		scoreLevelsField,
	];
}
