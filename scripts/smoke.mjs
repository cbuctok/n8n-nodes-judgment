/**
 * Drives the built node against the real judgement API using a fake n8n `this` context.
 *
 * This is a development aid, not a test suite: the repo has no test runner, and this script exists
 * so the compiled node can be exercised end to end without launching n8n.
 *
 * Usage: TYPESAFE_API_KEY=... node scripts/smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function loadApiKey() {
	if (process.env.TYPESAFE_API_KEY) {
		return process.env.TYPESAFE_API_KEY;
	}
	const envPath = resolve(here, '../../typesafe-playground/.env');
	try {
		const line = readFileSync(envPath, 'utf8')
			.split('\n')
			.find((entry) => entry.startsWith('TYPESAFE_API_KEY='));
		return line ? line.slice('TYPESAFE_API_KEY='.length).trim() : undefined;
	} catch {
		return undefined;
	}
}

const apiKey = loadApiKey();
if (!apiKey) {
	throw new Error('Set TYPESAFE_API_KEY, or keep the playground .env next to this repo');
}

/**
 * Minimal stand-in for n8n's execute helper that performs a real HTTP request.
 *
 * `options.url` is already absolute: the node builds it from the credential's Base URL because
 * n8n's helper supplies an Authorization header rather than a baseURL to resolve against.
 */
const helpers = {
	async httpRequestWithAuthentication(_credentialsType, options) {
		const response = await fetch(options.url, {
			method: options.method,
			headers: { ...options.headers, Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify(options.body),
		});
		const body = await response.json().catch(() => undefined);
		if (!response.ok) {
			const error = new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
			error.response = { status: response.status, body };
			throw error;
		}
		return {
			body,
			headers: { 'x-typesafe-request-id': response.headers.get('x-typesafe-request-id') ?? '' },
			statusCode: response.status,
		};
	},
};

/**
 * Emulates the one expression the harness uses, `{{ $json.<field> }}`, so an item-scoped state can
 * be exercised. Real n8n resolves expressions before the node sees them.
 */
function resolveExpression(value, itemIndex, inputItems) {
	if (typeof value !== 'string' || !value.startsWith('=')) {
		return value;
	}

	const body = value.replace(/^=/, '');
	const match = body.match(/^\{\{\s*\$json\.([A-Za-z0-9_]+)\s*\}\}$/);
	if (!match) {
		return value;
	}

	return inputItems[itemIndex]?.json?.[match[1]];
}

function makeContext(parameters, inputItems = [{ json: {} }]) {
	const get = (name, itemIndex = 0, fallback) => {
		if (parameters[name] === undefined) {
			return fallback;
		}
		return resolveExpression(parameters[name], itemIndex, inputItems);
	};
	return {
		helpers,
		getNode: () => ({ name: 'Judgment', type: 'n8n-nodes-judgment.judgment', typeVersion: 1 }),
		getInputData: () => inputItems,
		getNodeParameter: get,
		getCredentials: async () => ({ apiKey, baseUrl: 'https://api.typesafe.ai', defaultModel: 'jev-latest' }),
		continueOnFail: () => false,
	};
}

const ticket =
	"Hi, I've been trying to connect my Stripe account for 3 days and it keeps failing. I'm losing sales. Please help ASAP.";

const cases = [
	{
		label: 'Evaluation — mixed question types in one call',
		parameters: {
			resource: 'evaluation',
			operation: 'evaluate',
			state: 'text',
			stateText: ticket,
			questions: {
				question: [
					{
						id: 'urgency',
						questionType: 'noul',
						questionInstructions: 'Does this message convey urgency or time-sensitivity?',
					},
					{
						id: 'department',
						questionType: 'choice',
						questionInstructions: 'Which team should handle this?',
						choiceOptions: {
							entry: [
								{ option: 'billing', description: 'Payment, invoicing, refunds' },
								{ option: 'technical', description: 'Bugs, outages, integrations' },
								{ option: 'sales', description: 'Pricing, upgrades, new accounts' },
							],
						},
					},
					{
						id: 'frustration',
						questionType: 'score',
						questionInstructions: 'How frustrated does the customer appear?',
						levels: {
							questionLevel: [
								{ questionLevelDescription: 'Calm, stating facts' },
								{ questionLevelDescription: 'Frustrated but civil' },
								{ questionLevelDescription: 'Very angry, strong language' },
							],
						},
					},
				],
			},
			options: {},
		},
		run: 'evaluation',
	},
	{
		label: 'Noul — several yes/no questions, thresholded',
		parameters: {
			resource: 'noul',
			state: 'text',
			stateText: 'You have won $1,000. Reply with your password to claim.',
			questions: {
				question: [
					{
						noulName: 'requests_credentials',
						noulInstructions: 'Does the message ask for a password?',
					},
					{
						noulName: 'offers_reward',
						noulInstructions: 'Does the message announce an unexpected reward?',
					},
				],
			},
			options: { threshold: 0.7 },
		},
		run: 'noul',
	},
	{
		label: 'Choice Rank — order candidates by probability',
		parameters: {
			resource: 'choice',
			operation: 'rank',
			state: 'fields',
			stateFields: { field: [{ fieldName: 'question', fieldValue: 'How do I reset my password?' }] },
			candidatesMode: 'json',
			candidatesJson: [
				'Billing: charges, invoices and refunds',
				'Account: login, password and security',
				'Delivery: order status and returns',
			],
			rankInstructions: 'Which passage answers `question`?',
			options: {},
		},
		run: 'choice',
	},
	{
		label: 'Score Composite — weighted combination of dimensions',
		parameters: {
			resource: 'score',
			operation: 'composite',
			state: 'json',
			stateJson: '{ "description": "Fixed the null check in the payment handler, also refactored the retry loop." }',
			dimensionsMode: 'fields',
			weightsMode: 'fields',
			sharedLevelsMode: 'fields',
			sharedLevels: {
				sharedLevel: [
					{ sharedLevelDescription: 'Low' },
					{ sharedLevelDescription: 'Medium' },
					{ sharedLevelDescription: 'High' },
				],
			},
			dimensions: {
				dimension: [
					{
						dimensionName: 'clarity',
						dimensionInstructions: 'How clearly is the change described?',
						dimensionLevelsSource: 'shared',
						ownLevels: '',
					},
					{
						dimensionName: 'scope',
						dimensionInstructions: 'How focused is this on a single change?',
						dimensionLevelsSource: 'shared',
						ownLevels: '',
					},
				],
			},
			weights: {
				weight: [
					{ weightDimension: 'clarity', weightValue: 3 },
					{ weightDimension: 'scope', weightValue: 1 },
				],
			},
			options: {},
		},
		run: 'score',
	},
	{
		label: 'Score Composite — JSON dimensions with JSON weights',
		parameters: {
			resource: 'score',
			operation: 'composite',
			state: 'text',
			stateText: 'Fixed the null check in the payment handler, also refactored the retry loop.',
			dimensionsMode: 'json',
			dimensionsJson: JSON.stringify([
				{
					name: 'clarity',
					instructions: 'How clearly is the change described?',
					levels: ['Unclear', 'Mixed', 'Clear'],
				},
				{
					name: 'scope',
					instructions: 'How focused is this on a single change?',
					levels: ['One change', 'A few changes'],
				},
			]),
			weightsMode: 'json',
			weightsJson: JSON.stringify({ clarity: 3, scope: 1 }),
			options: {},
		},
		run: 'score',
	},
	{
		label: 'Score Composite — fields dimensions, equal weights',
		parameters: {
			resource: 'score',
			operation: 'composite',
			state: 'text',
			stateText: 'Fixed the null check in the payment handler.',
			dimensionsMode: 'fields',
			dimensions: {
				dimension: [
					{
						dimensionName: 'clarity',
						dimensionInstructions: 'How clearly is the change described?',
						// Own levels, one per line: a nested collection is never populated by n8n.
						dimensionLevelsSource: 'own',
						ownLevels: 'Unclear\nClear',
					},
				],
			},
			weightsMode: 'equal',
			options: {},
		},
		run: 'score',
	},
	{
		label: 'Evaluation Many — one state per input item, one packed call',
		parameters: {
			resource: 'evaluation',
			operation: 'evaluateMany',
			state: 'text',
			// Evaluate Many packs all items into one call, so the expression resolves per item
			// inside the node. The harness supplies the rows and the node loops over them.
			stateText: '={{ $json.text }}',
			questions: {
				question: [
					{
					id: 'urgency',
					questionType: 'noul',
					questionInstructions: 'Does this message convey urgency?',
				},
				],
			},
			options: {},
		},
		inputItems: [
			{ json: { text: 'URGENT: the site is down and we are losing orders!' } },
			{ json: { text: 'Just wondering when the next release is planned.' } },
		],
		run: 'evaluation',
	},
];

let failures = 0;

// The three state input modes and the candidate modes resolve locally, so they are asserted
// directly rather than sent to the API.
{
	const sf = await import(resolve(here, '../dist/nodes/Judgment/shared/stateFields.js'));
	const names = sf.stateParameterNames();
	const make = (params) => ({ getNodeParameter: (n, i, f) => (params[n] === undefined ? f : params[n]) });
	const checks = [
		['state text', sf.resolveState.call(make({ state: 'text', stateText: 'hello' }), names, 0), 'hello'],
		[
			'state fields',
			sf.resolveState.call(
				make({ state: 'fields', stateFields: { field: [{ fieldName: 'message', fieldValue: 'hi' }] } }),
				names,
				0,
			),
			{ message: 'hi' },
		],
		[
			'state json',
			sf.resolveState.call(make({ state: 'json', stateJson: '{"a":{"b":1}}' }), names, 0),
			{ a: { b: 1 } },
		],
		[
			'stale json ignored in text mode',
			sf.resolveState.call(make({ state: 'text', stateText: 'fresh', stateJson: '{"stale":true}' }), names, 0),
			'fresh',
		],
	];
	for (const [label, actual, expected] of checks) {
		const ok = JSON.stringify(actual) === JSON.stringify(expected);
		console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} -> ${JSON.stringify(actual)}`);
		if (!ok) failures += 1;
	}
}


for (const testCase of cases) {
	const context = makeContext(testCase.parameters, testCase.inputItems);
	const resource = testCase.parameters.resource;
	const execute =
		resource === 'score'
			? (await import(resolve(here, '../dist/nodes/Judgment/resources/score/index.js')))
			: null;

	try {
		let out;
		if (resource === 'evaluation') {
			const mod = await import(
				resolve(here, '../dist/nodes/Judgment/resources/evaluation/index.js')
			);
			out = await mod.executeEvaluation.call(context, 0);
		} else if (resource === 'noul') {
			const mod = await import(resolve(here, '../dist/nodes/Judgment/resources/noul/index.js'));
			out = await mod.executeNoul.call(context, 0);
		} else if (resource === 'choice') {
			const mod = await import(resolve(here, '../dist/nodes/Judgment/resources/choice/index.js'));
			out = await mod.executeChoice.call(context, 0);
		} else {
			out = await execute.executeScore.call(context, 0);
		}

		console.log(`\n=== ${testCase.label} ===`);
		console.log(JSON.stringify(out.map((item) => item.json), null, 2).slice(0, 1600));
	} catch (error) {
		failures += 1;
		console.log(`\n=== ${testCase.label} === FAILED`);
		console.log(error.stack ?? error.message);
	}
}

console.log(`\n${cases.length - failures}/${cases.length} cases ran`);
process.exit(failures > 0 ? 1 : 0);
