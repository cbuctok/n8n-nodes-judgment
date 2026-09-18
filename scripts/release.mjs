/**
 * Cuts a release: bump, changelog entry, commit, tag, push.
 *
 *   npm run release
 *
 * The tag push is the whole point. `publish.yml` notices it, stages the package on npm with a
 * provenance attestation, and stops; nothing becomes installable until a staged version is approved
 * on npmjs.com. This script deliberately does not publish.
 *
 * Why not `n8n-node release`: it passes `-n` to release-it, and no release-it major has ever
 * accepted that flag, so the command fails before the first prompt. It also passes config keys such
 * as `--git.requireBranch` on the command line, which release-it expects in a config file. The four
 * steps that actually matter are short enough to do directly.
 *
 * Requires a clean tree and no upstream drift, because a tag is a promise about a commit. Refusing
 * early is cheaper than a tag pointing at something nobody reviewed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const BUMPS = ['patch', 'minor', 'major'];

function run(command, args) {
	return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
}

function git(...args) {
	return run('git', args);
}

function fail(message) {
	console.error(`\n  ${message}\n`);
	process.exit(1);
}

function readPackage() {
	return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
}

/** `1.2.3` -> `[1, 2, 3]`. Prerelease suffixes are not supported by this script. */
function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) fail(`package.json version "${version}" is not a plain major.minor.patch`);
	return match.slice(1).map(Number);
}

function bumpVersion(version, bump) {
	const [major, minor, patch] = parseVersion(version);
	if (bump === 'major') return `${major + 1}.0.0`;
	if (bump === 'minor') return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}

/** Replaces the version in package.json without reformatting the rest of the file. */
function writeVersion(version) {
	const path = resolve(root, 'package.json');
	const before = readFileSync(path, 'utf8');
	const after = before.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
	if (after === before) fail('could not find a version field in package.json');
	writeFileSync(path, after);
}

/**
 * Inserts a new section under the `# Changelog` heading. The body is left as a placeholder on
 * purpose: the notes are the one part of a release that cannot be derived, and an empty section is
 * a louder prompt than a forgotten one.
 */
function writeChangelog(version) {
	const path = resolve(root, 'CHANGELOG.md');
	const text = readFileSync(path, 'utf8');
	const heading = '## ';
	const section = `## ${version}\n\n- \n\n`;

	if (text.includes(`\n${heading}${version}\n`))
		fail(`CHANGELOG.md already has a ${version} section`);

	const firstEntry = text.indexOf(`\n${heading}`);
	if (firstEntry === -1) fail('CHANGELOG.md has no previous release section to insert before');

	writeFileSync(path, text.slice(0, firstEntry + 1) + section + text.slice(firstEntry + 1));
}

function ensureReleasable() {
	const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
	const dirty = git('status', '--porcelain');
	if (dirty) fail('working tree is dirty; commit or stash first');
	if (!['dev', 'master'].includes(branch)) {
		fail(`refusing to release from "${branch}"; releases come from dev or master`);
	}

	try {
		git('fetch', '--quiet', 'origin');
	} catch {
		fail('could not reach origin; a release must not be cut offline');
	}

	const drift = git('rev-list', '--count', `origin/${branch}..HEAD`);
	const behind = git('rev-list', '--count', `HEAD..origin/${branch}`);
	if (drift !== '0') fail(`${drift} unpushed commit(s) on ${branch}; push first`);
	if (behind !== '0') fail(`local ${branch} is ${behind} commit(s) behind origin; pull first`);

	return { branch, version: readPackage().version };
}

async function chooseBump(current) {
	if (!process.stdin.isTTY) {
		fail('no terminal available for the version prompt; run this locally');
	}

	const options = BUMPS.map((bump) => `${bump}  ->  ${bumpVersion(current, bump)}`);
	console.log(`\n  current version: ${current}\n`);
	options.forEach((option, index) => console.log(`  ${index + 1}) ${option}`));
	console.log();

	// Resolves on both the answer and `close`. A pseudoterminal can deliver the input without ever
	// signalling close, and a promise that only listens for one of them hangs the whole script.
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise((done) => {
		readline.question('  Choose a bump [1]: ', (reply) => {
			readline.close();
			done(reply);
		});
		readline.on('close', () => done(''));
	});

	const trimmed = answer.trim();
	if (trimmed === '') return BUMPS[0];

	const index = Number(trimmed);
	if (!Number.isInteger(index) || index < 1 || index > BUMPS.length) fail('unrecognised choice');
	return BUMPS[index - 1];
}

async function main() {
	const { branch, version: current } = ensureReleasable();
	const bump = await chooseBump(current);
	const next = bumpVersion(current, bump);

	// Checked against the version being released rather than the one in package.json, which is
	// always the previously released version. Testing the current one would refuse every release.
	if (git('tag', '-l', next)) fail(`tag ${next} already exists; pick a larger bump`);

	console.log(`\n  ${branch}: ${current} -> ${next}\n`);
	console.log('  Edit CHANGELOG.md, then commit. The tag is pushed for you.\n');

	writeVersion(next);
	writeChangelog(next);

	// `git add` aborts on a path that does not exist, and package-lock.json is not guaranteed to be
	// tracked. Adding the version and changelog explicitly, then staging whatever else a dependency
	// bump touched, keeps a missing lockfile from failing the release after the version is written.
	git('add', 'package.json', 'CHANGELOG.md');
	try {
		git('add', 'package-lock.json');
	} catch {
		// No lockfile in this repository; nothing to stage.
	}

	git('commit', '-m', `Release ${next}`);
	git('tag', next);

	try {
		git('push', 'origin', branch);
		git('push', 'origin', next);
	} catch {
		fail(
			`release ${next} is committed and tagged locally but not pushed.\n` +
				`  Push it by hand once the reason is clear:\n` +
				`    git push origin ${branch} && git push origin ${next}\n` +
				`  Or undo it entirely:\n` +
				`    git tag -d ${next} && git reset --hard HEAD~1`,
		);
	}

	console.log(`\n  Pushed ${next}. CI is staging it on npm; approve it at`);
	console.log('  npmjs.com -> the package -> Staged versions -> Approve\n');
}

await main();
