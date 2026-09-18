/**
 * Imports a workflow template into a running n8n and executes it, reporting which nodes ran.
 *
 * A green execute is not enough on its own: a node that returns an empty array ends its branch
 * without an error, so the run reports success while later nodes never execute. This script reads
 * the per-node results out of the execution payload instead, which is the only reliable signal.
 *
 * Usage:
 *   npm run build
 *   npm run n8n:reset
 *   node scripts/verify-template.mjs templates/01-llm-as-a-judge/workflow.json
 *
 * Requires TYPESAFE_API_KEY in the environment, falling back to the sibling playground .env.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.N8N_BASE_URL ?? 'http://localhost:5678';
const EMAIL = process.env.N8N_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.N8N_PASSWORD ?? 'TypeSafeTest123!';

const templatePath = process.argv[2];
if (!templatePath) throw new Error('Usage: node scripts/verify-template.mjs <template.json>');

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

// --- Ensure the credential exists, and remember its id so the template can be repointed at it --
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
	if (created.status !== 200) {
		throw new Error(`credential create failed: ${JSON.stringify(created.data)}`);
	}
	credentialId = created.data.data.id;
	console.log('credential created:', credentialId);
} else {
	console.log('credential reused:', credentialId);
}

// --- Import the template, pointing its credential placeholder at the real one -----------------
const template = JSON.parse(readFileSync(resolve(here, '..', templatePath), 'utf8'));

/**
 * Templates ship with the identifier a user gets from Settings → Community Nodes, which is
 * `<npm package name>.<node name>`. A node loaded from the custom-nodes folder instead — which is
 * how docker-compose.yml mounts this repo — is registered under the `CUSTOM.` prefix. The type is
 * rewritten here rather than in the template so the shipped file matches what real users have.
 */
const LOCAL_TYPE_PREFIX = 'CUSTOM.';
const PACKAGE_TYPE_PREFIX = 'n8n-nodes-judgment.';

for (const node of template.nodes) {
	if (node.type.startsWith(PACKAGE_TYPE_PREFIX)) {
		node.type = LOCAL_TYPE_PREFIX + node.type.slice(PACKAGE_TYPE_PREFIX.length);
	}
	if (node.credentials?.judgmentApi) {
		node.credentials.judgmentApi = { id: credentialId, name: 'Judgment API' };
	}
}

const created = await req('/rest/workflows', { method: 'POST', cookie, body: template });
if (created.status !== 200) {
	throw new Error(
		`workflow create failed: ${created.status} ${JSON.stringify(created.data).slice(0, 600)}`,
	);
}
const workflowId = created.data.data.id;
console.log('workflow created:', workflowId);

// --- Run from the template's trigger, then read the per-node results --------------------------
const startNode =
	template.nodes.find((n) => n.type === 'n8n-nodes-base.manualTrigger') ??
	template.nodes.find((n) => n.type === 'n8n-nodes-base.webhook') ??
	template.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');

if (!startNode) throw new Error('Template has no trigger node to start from');

const run = await req(`/rest/workflows/${workflowId}/run`, {
	method: 'POST',
	cookie,
	body: { triggerToStartFrom: { name: startNode.name } },
});

const executionId =
	run.data?.data?.executionId ??
	run.data?.data?.id ??
	(run.data?.data?.resultData ? null : undefined);

if (!executionId) {
	console.log('run response:', JSON.stringify(run.data).slice(0, 800));
	process.exit(1);
}

let status = 'running';
for (let attempt = 0; attempt < 60 && status === 'running'; attempt++) {
	const got = await req(`/rest/executions/${executionId}`, { cookie });
	status = got.data?.data?.status ?? 'unknown';
	if (status === 'running') await new Promise((r) => setTimeout(r, 1500));
}

const full = await req(`/rest/executions/${executionId}?includeData=true`, { cookie });
const resultData = full.data?.data?.data?.resultData ?? {};

console.log(`\nexecution ${executionId}: ${status.toUpperCase()}`);

/**
 * n8n does not always return `resultData.runData` over the REST API, so the container log is the
 * authority on what actually ran. It records every node start and finish with its workflow id,
 * which is enough to tell a node that ran from one that was skipped.
 */
function readRunLog(workflowId) {
	const raw = execSync('docker compose logs n8n 2>&1', {
		cwd: resolve(here, '..'),
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	const events = new Map();
	for (const line of raw.split('\n')) {
		if (!line.includes(workflowId)) continue;
		const node = line.match(/Running node "([^"]+)" (started|finished [a-z]+)/);
		if (!node) continue;
		const [, name, what] = node;
		const state = events.get(name) ?? { started: false, finished: false, error: '' };
		if (what === 'started') state.started = true;
		else if (what === 'finished successfully') state.finished = true;
		else {
			state.finished = true;
			state.error = what.replace('finished ', '');
		}
		events.set(name, state);
	}
	return events;
}

const events = readRunLog(workflowId);
const executable = template.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
const width = Math.max(...executable.map((n) => n.name.length), 4);
console.log('\nnode'.padEnd(width) + '  result');
for (const node of executable) {
	const state = events.get(node.name);
	const result = !state?.started
		? 'NEVER RAN'
		: state.error
			? `FAILED (${state.error})`
			: state.finished
				? 'ok'
				: 'started, never finished';
	console.log(node.name.padEnd(width) + '  ' + result);
}

const problems = executable.filter((n) => {
	const state = events.get(n.name);
	return !state?.started || state.error || !state.finished;
});

if (resultData.error) {
	console.log('\nworkflow error:', JSON.stringify(resultData.error).slice(0, 600));
}

process.exit(problems.length === 0 && status === 'success' ? 0 : 1);
