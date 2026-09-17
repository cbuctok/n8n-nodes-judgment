import type { INodeProperties } from 'n8n-workflow';

import { asEntryType } from './questions';
import type { EntryType } from './types';

export type StateInputMode = 'text' | 'fields' | 'json';

export interface StateParameterNames {
	mode: string;
	text: string;
	fields: string;
	json: string;
}

/** The parameter names produced by `buildStateFields`, so readers and fields stay in sync. */
export function stateParameterNames(name = 'state'): StateParameterNames {
	return {
		mode: name,
		text: `${name}Text`,
		fields: `${name}Fields`,
		json: `${name}Json`,
	};
}

function asMode(value: unknown): StateInputMode {
	return value === 'fields' || value === 'json' ? value : 'text';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}


/**
 * Builds an object from the name/value rows of a fields-mode state. Blank rows are skipped so a
 * half-filled collection does not add noise to the state.
 */
export function readFieldRows(raw: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!isRecord(raw) || !Array.isArray(raw.field)) {
		return out;
	}

	for (const row of raw.field as unknown[]) {
		if (!isRecord(row)) {
			continue;
		}
		const name = typeof row.fieldName === 'string' ? row.fieldName.trim() : '';
		if (name === '') {
			continue;
		}
		out[name] = typeof row.fieldValue === 'string' ? row.fieldValue : String(row.fieldValue ?? '');
	}

	return out;
}

/**
 * Resolves the state from whichever input mode the user picked.
 *
 * Each branch reads only the parameter belonging to its own mode. n8n keeps stale values for hidden
 * parameters, so reading the raw JSON while the user is in fields mode would quietly pick up an
 * earlier value.
 */
export function resolveState(
	this: { getNodeParameter(name: string, itemIndex: number, fallback?: unknown): unknown },
	names: StateParameterNames,
	itemIndex: number,
): EntryType {
	const mode = asMode(this.getNodeParameter(names.mode, itemIndex, 'text'));

	if (mode === 'text') {
		return asEntryType(this.getNodeParameter(names.text, itemIndex, ''));
	}

	if (mode === 'json') {
		return asEntryType(this.getNodeParameter(names.json, itemIndex, ''));
	}

	return readFieldRows(this.getNodeParameter(names.fields, itemIndex, {}));
}

/**
 * The shared State block. Every resource that evaluates something uses this, so the mode switch
 * behaves identically everywhere and users only have to learn it once.
 */
export function buildStateFields(
	displayOptions: INodeProperties['displayOptions'],
	name = 'state',
): INodeProperties[] {
	const names = stateParameterNames(name);
	const showOnly = (mode: StateInputMode): INodeProperties['displayOptions'] => ({
		show: {
			...displayOptions?.show,
			[names.mode]: [mode],
		},
	});

	const label = name === 'state' ? 'State' : `${name} To Evaluate`;

	return [
		{
			displayName: label,
			name: names.mode,
			type: 'options',
			noDataExpression: true,
			displayOptions,
			options: [
				{
					name: 'Text',
					value: 'text',
					description: 'A single piece of text to evaluate',
				},
				{
					name: 'Fields Below',
					value: 'fields',
					description: 'Named fields, so questions can point at them by name',
				},
				{
					name: 'Using JSON',
					value: 'json',
					description: 'A JSON object or array, for nested or repeating structures',
				},
			],
			default: 'text',
			description: 'The content to evaluate, supplied as text, as named fields, or as raw JSON',
		},
		{
			displayName: 'Text',
			name: names.text,
			type: 'string',
			typeOptions: { rows: 4 },
			default: '',
			displayOptions: showOnly('text'),
			placeholder: 'Paste the text to evaluate',
			description: 'The text to evaluate. Use an expression to take it from a previous node.',
		},
		{
			displayName: 'Fields',
			name: names.fields,
			type: 'fixedCollection',
			typeOptions: {
				multipleValues: true,
				sortable: true,
			},
			default: { field: [{ fieldName: '', fieldValue: '' }] },
			placeholder: 'Add Field',
			displayOptions: showOnly('fields'),
			description: 'Named parts of the state. Questions refer to them with backticked paths, for example `message` or `order.total`.',
			options: [
				{
					displayName: 'Field',
					name: 'field',
					values: [
						{
							displayName: 'Name',
							name: 'fieldName',
							type: 'string',
							default: '',
							required: true,
							placeholder: 'e.g. message',
							description: 'The name a question uses to point at this value',
						},
						{
							displayName: 'Value',
							name: 'fieldValue',
							type: 'string',
							default: '',
							placeholder: 'e.g. {{ $json.body }}',
							description: 'The value to evaluate. Use an expression to take it from a previous node.',
						},
					],
				},
			],
		},
		{
			displayName: 'JSON',
			name: names.json,
			type: 'json',
			default: '',
			displayOptions: showOnly('json'),
			placeholder: '{ "message": "…", "order": { "reference": "A-104" } }',
			description:
				'A JSON object or array. Use this for nested or repeating structures that fields cannot express.',
		},
	];
}
