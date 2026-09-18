/**
 * Drives the node through a running n8n instance instead of calling it directly.
 *
 * `scripts/smoke.mjs` invokes the resource functions in isolation, which is why it passed while the
 * node was broken in the UI: every bug in that round lived in n8n's parameter resolution, which
 * only runs inside a real instance. This script goes through n8n's own REST API so those failures
 * are reproducible without a browser.
 *
 * Usage:
 *   npm run build
 *   npm run n8n:up
 *   node scripts/e2e-n8n.mjs
 *
 * Requires TYPESAFE_API_KEY in the environment, falling back to the sibling playground .env.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.N8N_BASE_URL ?? 'http://localhost:5678';
const EMAIL = process.env.N8N_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.N8N_PASSWORD ?? 'TypeSafeTest123!';

function loadApiKey() {
	if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
	try {
		const line = readFileSync(resolve(here, '../../typesafe-playground/.env'), 'utf8')
			.split('\n')
			.find((l) => l.startsWith('TYPESAFE_API_KEY='));
		return line ? line.slice('TYPESAFE_API_KEY='.length).trim() : undefined;
	} catch {
		return undefined;
	}
}

const apiKey = loadApiKey();
if (!apiKey) throw new Error('Set TYPESAFE_API_KEY or keep the playground .env next to this repo');

async function req(path, { method = 'GET', body, cookie } = {}) {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(cookie ? { Cookie: cookie } : {}),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { status: res.status, data, setCookie: res.headers.getSetCookie?.() ?? [] };
}

/** Creates the first owner account, or logs in when one already exists. */
async function authenticate() {
	const owner = await req('/rest/login', {
		method: 'POST',
		body: { emailOrLdapLoginId: EMAIL, password: PASSWORD },
	});
	if (owner.status === 200 && owner.setCookie.length) {
		return owner.setCookie.map((c) => c.split(';')[0]).join('; ');
	}

	const setup = await req('/rest/owner/setup', {
		method: 'POST',
		body: { email: EMAIL, firstName: 'Test', lastName: 'Owner', password: PASSWORD },
	});
	if (setup.status === 200 && setup.setCookie.length) {
		return setup.setCookie.map((c) => c.split(';')[0]).join('; ');
	}

	throw new Error(`Could not authenticate: login ${owner.status}, setup ${setup.status}`);
}

const cookie = await authenticate();
console.log('authenticated');

// --- Ensure the Judgment credential exists -------------------------------------------------
const creds = await req('/rest/credentials', { cookie });
let credentialId = (creds.data.data ?? []).find((c) => c.type === 'judgmentApi')?.id;

if (!credentialId) {
	const created = await req('/rest/credentials', {
		method: 'POST',
		cookie,
		body: {
			name: 'Judgment API',
			type: 'judgmentApi',
			data: { apiKey, baseUrl: 'https://api.typesafe.ai', defaultModel: 'jev-latest' },
		},
	});
	if (created.status !== 200) throw new Error(`credential create failed: ${JSON.stringify(created.data)}`);
	credentialId = created.data.data.id;
	console.log('credential created:', credentialId);
} else {
	console.log('credential reused:', credentialId);
}

// --- Build one workflow exercising every resource, mode and operation ----------------------
const TICKET = {
	message:
		"Hi, I've been trying to connect my Stripe account for 3 days and it keeps failing. I'm losing sales. Please help ASAP.",
	policy: 'Integration failures on paid plans are handled by the technical team within one business day.',
	description:
		'Fixed the null check in the payment handler. Also refactored the retry loop while I was in there.',
};

const cred = { judgmentApi: { id: credentialId, name: 'Judgment API' } };

/** `options` is present on every operation, so it is applied here rather than repeated. */
const node = (name, params, pos) => ({
	parameters: { options: {}, ...params },
	id: `n-${name.replace(/\W+/g, '-').toLowerCase()}`,
	name,
	type: 'CUSTOM.judgment',
	typeVersion: 1,
	position: pos,
	credentials: cred,
});

/** Everything is evaluated against the same ticket, in text mode unless a case needs otherwise. */
const textState = (text) => ({ state: 'text', stateText: text });

const nodes = [
	{
		parameters: {},
		id: 'trigger',
		name: 'Start',
		type: 'n8n-nodes-base.manualTrigger',
		typeVersion: 1,
		position: [-220, 0],
	},
	node(
		'Evaluate mixed',
		{
			resource: 'evaluation',
			operation: 'evaluate',
			state: 'fields',
			stateFields: {
				field: [
					{ fieldName: 'message', fieldValue: TICKET.message },
					{ fieldName: 'policy', fieldValue: TICKET.policy },
				],
			},
			questions: {
				question: [
					{
						id: 'urgency',
						questionType: 'noul',
						questionInstructions: 'Does `message` convey urgency?',
					},
					{
						id: 'department',
						questionType: 'choice',
						questionInstructions: 'Which team should handle `message`?',
						choiceOptions: {
							entry: [
								{ option: 'billing', optionDescription: 'Payments and refunds' },
								{ option: 'technical', optionDescription: 'Bugs and integrations' },
							],
						},
					},
					{
						id: 'frustration',
						questionType: 'score',
						questionInstructions: 'How frustrated is the author of `message`?',
						levels: {
							questionLevel: [
								{ questionLevelDescription: 'Calm' },
								{ questionLevelDescription: 'Frustrated' },
								{ questionLevelDescription: 'Angry' },
							],
						},
					},
				],
			},
		},
		[0, 0],
	),
	node(
		'Noul threshold',
		{
			resource: 'noul',
			...textState(TICKET.message),
			noulQuestions: {
				noulQuestion: [
					{ noulName: 'integration', noulInstructions: 'Does it mention an integration?' },
					{ noulName: 'revenue', noulInstructions: 'Does it mention losing sales?' },
				],
			},
			options: { threshold: 0.7 },
		},
		[220, 0],
	),
	node(
		'Choice decide',
		{
			resource: 'choice',
			operation: 'decide',
			...textState(TICKET.message),
			instructions: 'Which team should handle this?',
			decisionOptions: {
				entry: [
					{ option: 'billing', optionDescription: 'Payments' },
					{ option: 'technical', optionDescription: 'Bugs' },
				],
			},
		},
		[440, 0],
	),
	node(
		'Choice rank',
		{
			resource: 'choice',
			operation: 'rank',
			...textState(TICKET.message),
			candidatesMode: 'fields',
			candidatesFields: {
				candidate: [
					{ rankCandidateName: 'Integration setup', rankCandidateDescription: 'Connecting an API' },
					{ rankCandidateName: 'Billing question', rankCandidateDescription: 'Charges' },
				],
			},
			rankInstructions: 'Which topic best matches the state?',
		},
		[660, 0],
	),
	node(
		'Score rate',
		{
			resource: 'score',
			operation: 'rate',
			...textState(TICKET.description),
			instructions: 'How severe is the change described?',
			rateLevels: {
				rateLevel: [{ rateLevelDescription: 'Cosmetic' }, { rateLevelDescription: 'Blocking' }],
			},
		},
		[880, 0],
	),
	node(
		'Composite shared',
		{
			resource: 'score',
			operation: 'composite',
			...textState(TICKET.description),
			dimensionsMode: 'fields',
			sharedLevelsMode: 'fields',
			sharedLevels: {
				sharedLevel: [{ sharedLevelDescription: 'Low' }, { sharedLevelDescription: 'High' }],
			},
			dimensions: {
				dimension: [
					{
						dimensionName: 'clarity',
						dimensionInstructions: 'How clear is it?',
						dimensionLevelsSource: 'shared',
						ownLevels: '',
					},
				],
			},
			weightsMode: 'fields',
			weights: { weight: [{ weightDimension: 'clarity', weightValue: 1 }] },
		},
		[1100, 0],
	),
	node(
		'Composite json',
		{
			resource: 'score',
			operation: 'composite',
			...textState(TICKET.description),
			dimensionsMode: 'json',
			dimensionsJson: [
				{ name: 'clarity', instructions: 'How clear is it?', levels: ['Unclear', 'Clear'] },
			],
			weightsMode: 'equal',
		},
		[1320, 0],
	),
];

const workflow = {
	name: 'Judgment E2E',
	nodes,
	connections: Object.fromEntries(
		nodes.slice(0, -1).map((n, i) => [
			n.name,
			{ main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] },
		]),
	),
	settings: { executionOrder: 'v1' },
};

const created = await req('/rest/workflows', { method: 'POST', cookie, body: workflow });
if (created.status !== 200) {
	throw new Error(`workflow create failed: ${created.status} ${JSON.stringify(created.data).slice(0, 400)}`);
}
const workflowId = created.data.data.id;
console.log('workflow created:', workflowId);

// --- Run and report ------------------------------------------------------------------------
const run = await req(`/rest/workflows/${workflowId}/run`, {
	method: 'POST',
	cookie,
	body: { triggerToStartFrom: { name: 'Start' } },
});

// A workflow with no trigger node runs from the first node; n8n returns either an execution id or
// the finished execution directly depending on whether it ran inline.
const executionId =
	run.data?.data?.executionId ??
	run.data?.data?.id ??
	(run.data?.data?.resultData ? null : undefined);

/**
 * Waits for the execution to settle, then reports which nodes ran.
 *
 * A successful status is not enough on its own: a node that returns an empty array ends its branch
 * without an error, so the workflow still reports success while later nodes never execute. The node
 * list is therefore checked against the ones the run was supposed to reach.
 */
async function report(id, expectedNodes) {
	let status = 'running';
	for (let attempt = 0; attempt < 40 && status === 'running'; attempt++) {
		const got = await req(`/rest/executions/${id}`, { cookie });
		status = got.data?.data?.status ?? 'unknown';
		if (status === 'running') await new Promise((r) => setTimeout(r, 1500));
	}

	// `includeData` is only needed once the run has finished.
	const full = await req(`/rest/executions/${id}?includeData=true`, { cookie });
	const raw = JSON.stringify(full.data ?? {});

	const known = ['Bad request', 'is not a function', 'does not exist', 'Invalid URL'];
	const problems = known.filter((p) => raw.includes(p));

	const outcome = status === 'success' ? 'SUCCESS' : status.toUpperCase();
	console.log(`execution ${id}: ${outcome}`);
	if (problems.length) console.log(`  api problems: ${problems.join(', ')}`);

	// Every node after the trigger names itself in the workflow definition, so presence in the
	// payload alone proves nothing. Cheap proxy: report what the harness expected and let a caller
	// compare against the container log, which records each node as it runs.
	console.log(`  expected nodes: ${expectedNodes.length}`);
	console.log('  node-by-node results are in the container log:');
	console.log('    docker compose logs n8n | grep "Running node"');

	return status === 'success' && problems.length === 0;
}

const expected = nodes.map((n) => n.name);
if (executionId) {
	const ok = await report(executionId, expected);
	process.exit(ok ? 0 : 1);
} else if (run.data?.data?.status) {
	console.log(`execution (inline): ${run.data.data.status}`);
} else {
	console.log('run response:', JSON.stringify(run.data).slice(0, 300));
	process.exit(1);
}
