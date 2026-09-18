# n8n-nodes-judgment

An n8n community node package for typed judgements about text or application state. It asks Choice,
Score and Noul questions and returns values they can branch on. It is deliberately vendor-neutral:
the resources and input modes outlive any single provider, and the transport is the seam where a
second one would be added. The wire format it speaks today is TypeSafe System One.

Start with `README.md` for what the node does. This file covers how to work on it.

## Names and identifiers

Three names that must stay in step, because n8n resolves one from the other at load time:

| Thing | Value | Where |
| --- | --- | --- |
| npm package | `n8n-nodes-judgment` | `package.json` → `name` |
| Node | `judgment` (class `Judgment`) | `nodes/Judgment/Judgment.node.ts` |
| Credential | `judgmentApi` (class `JudgmentApi`) | `credentials/JudgmentApi.credentials.ts` |

The internal `name` fields are load-bearing: `n8n.nodes` / `n8n.credentials` in `package.json` point
at compiled `dist/` paths, and the credential `name` is what workflows store in their saved
`credentials` block. Renaming the credential type breaks every existing workflow that uses it, so
treat `judgmentApi` as frozen once published.

The package name is unscoped and must stay that way: n8n's community-node installer looks the value
up verbatim on the public registry, so `n8n-nodes-judgment` installs but `@evgreg/...` would be a
different package. Do not add a `publishConfig.access` field; that only matters for scoped names.

An earlier scoped publish (`@evgreg/n8n-nodes-judgment@0.1.0`) is listed in npm's search index but
its registry document was never readable, so it cannot be installed. The unscoped name supersedes it.

## Commands

All tooling goes through `@n8n/node-cli` (`n8n-node`), exposed as npm scripts.

| Command | What it does |
|---|---|
| `npm run lint` | `n8n-node lint`. **This is the primary quality gate.** |
| `npm run lint:fix` | Auto-fixes what it can. |
| `npm run build` | `n8n-node build`: clears `dist`, runs `tsc`, copies icons and schema JSON. |
| `npm run build:watch` | Raw `tsc --watch`. Does **not** copy assets, so icons go missing in `dist/`. |
| `npm run check:fields` | Validates `fixedCollection` consistency. See below. |
| `npm run smoke` | Drives the built node against the live API without n8n. |
| `npm run e2e` | Drives the built node through a real n8n in Docker. |
| `npm run n8n:up` / `n8n:logs` / `n8n:down` | Start, follow and stop the Docker n8n. |
| `npm run n8n:reset` | Wipes the n8n volume and starts clean. |
| `npm run release` | `scripts/release.mjs`: version bump, changelog stub, commit, tag, push. Does not publish. |

### Releasing

`npm run release` pushes a tag. `publish.yml` then **stages** the package with a provenance
attestation and stops — the version is not installable until a maintainer approves it at
npmjs.com → package → **Staged versions**. Nothing goes live from a tag alone.

CI does not call `n8n-node release`. In CI that command runs a hardcoded `npm publish`, which cannot
be redirected to the staging endpoint, so the workflow runs lint, build and `npm stage publish`
itself. The consequence is that the lint and build steps live in `publish.yml` as well as in
`ci.yml`; change one and check the other.

**`n8n-node release` is unusable and `release-it` has been removed.** The command passes `-n` to
release-it, and no release-it major ever accepted that flag, so it fails before the first prompt. It
also passes config keys such as `--git.requireBranch` on the command line, which release-it expects
in a config file. `@n8n/node-cli` does not depend on release-it at all — it shells out to whatever
`release-it` is on the PATH — which is how the two drifted apart unnoticed. `scripts/release.mjs`
replaces it: bump, changelog stub, commit, tag, push. It refuses on a dirty tree, an unpushed
commit, a branch other than `dev`/`master`, or an existing tag, because a tag is a promise about a
commit. It leaves the changelog body empty on purpose; the notes are the one part that cannot be
derived.

**There is no test runner.** No `test` script, no vitest/jest, no `*.test.ts`. CI runs exactly
`npm ci && npm run lint && npm run build`. Behavioural verification goes through `smoke`, `check:fields`
and `e2e` above.

**`npm install` needs `--force --ignore-scripts` on this machine.** `@n8n/node-cli` pins
`eslint@9.29.0` as a peer while the project has `eslint@9.39.4`, and the tree contains `isolated-vm`,
a native module that fails to compile against Node 26. Neither affects lint or build.

**A build needs `n8n:reset` before it counts as verification.** Plain `n8n:restart` reuses the Docker
volume, so old workflows and credentials accumulate between runs and can mask a failure. Reset for
anything you intend to believe.

### The two test layers, and why both exist

`smoke` calls the resource functions directly with a fake `this`. It is fast and it caught real API
mistakes, but it **never exercises n8n's parameter resolution**. Every parameter bug in this node's
history lived in that gap, so a green `smoke` run is not evidence the node works.

`e2e` runs the same requests through a real n8n. It is the only layer that covers parameter
resolution, and the one to trust. Verify a run by node coverage, not by exit status: a node that
returns an empty array ends its branch without error, so the workflow reports success while later
nodes never execute. Read the container log:

```
docker compose logs n8n | grep 'Running node'
```

Credentials for the Docker instance are `admin@example.com` / `TypeSafeTest123!` at
<http://localhost:5678>.

**Prettier is never invoked by a script.** The n8n lint config does not include
`eslint-config-prettier`, so run `npx prettier --write <file>` manually. `.prettierrc.js` is
authoritative: **tabs**, single quotes, trailing commas, semicolons, print width 100, LF.

### scripts/smoke.mjs

Executes the compiled resources with a fake n8n `this` context and real HTTP calls, so node logic can
be verified without launching n8n. It reads `TYPESAFE_API_KEY` from the environment, falling back to
`../typesafe-playground/.env` (a sibling repo) so the key is never committed here.

**Run `npm run build` first** — it imports from `dist/`, not from the TypeScript sources.

It builds parameter objects by hand, so **its field names must be kept in step with the parameter
definitions.** When they drift it does not fail loudly: it feeds the node a shape n8n would never
produce, and the resulting errors look like node bugs. Every rename in this file's history required a
matching edit here. If `smoke` fails in a way that makes no sense, check the field names before
touching the node.

## Architecture

```
nodes/Judgment/
  Judgment.node.ts            INodeType: resource switch, execute loop, error handling
  Judgment.node.json          codex metadata
  resources/
    evaluation/index.ts       Evaluate / Evaluate Many — the general-purpose path
    choice/index.ts           Decide / Rank
    score/index.ts            Score logic: Rate and Composite
    score/description.ts      Score field definitions, kept separate to stay readable
    noul/index.ts             yes/no questions with a threshold
  shared/
    types.ts                  Provider v1 request/response shapes + API base URL, declared locally
    questions.ts              UI values -> API question JSON, plus validation
    stateFields.ts            the Text / Fields / JSON input-mode block and its reader
    descriptions.ts           reusable INodeProperties for the question collection
    transport.ts              authenticated POST /v1/systemone
    extract.ts                answer reading + low-confidence flagging
    state.ts                  pack/unpack state for multi-item requests
    models.ts                 model resolution and credential defaults
    errors.ts                 errorNode(): builds the node descriptor error classes need
credentials/JudgmentApi.credentials.ts
icons/judgment{,.dark}.svg
scripts/
  smoke.mjs                   resources against the live API, no n8n
  check-node-fields.mjs       fixedCollection consistency check
  e2e-n8n.mjs                 the node through a real n8n over its REST API
e2e/judgment-e2e.workflow.json  importable workflow covering every operation
docker-compose.yml            n8n for e2e, with the package linked in at startup
dist/                         build output, gitignored, referenced by package.json
```

Each resource module exports an `<resource>Description: INodeProperties[]` and an
`execute<Resource>(this: IExecuteFunctions, itemIndex)`. `Judgment.node.ts` only routes between them
and owns the catch block.

### The node declares no runtime dependencies, on purpose

`nodes/` and `credentials/` must not import third-party packages. `@n8n/community-nodes/no-restricted-imports`
rejects it, because n8n Cloud refuses community nodes with dependencies. That is why
`shared/types.ts` re-declares the provider request and response types instead of importing them from
`@typesafe-ai/sdk`.

`@typesafe-ai/sdk` is a **devDependency used only as a type reference**. If you add a type there,
check the SDK's `dist/index.d.mts` rather than guessing. Do not import it from `nodes/` or
`credentials/`.

### Requests go through n8n's HTTP helper, not the SDK client

`shared/transport.ts` calls `helpers.httpRequestWithAuthentication('typeSafeApi', ...)`. The SDK
client resolves its API key from `process.env` or a constructor argument, and neither fits n8n's
credential model. The helper also brings n8n's proxy support and timeouts along for free.

### One call per item, many questions per call

Questions in one request run in parallel and share a state, so the node batches aggressively:

- **Evaluate** sends one request per input item containing every question.
- **Evaluate Many** packs all input items into a single state and sends **one** request.
- **Noul** sends one request per item; each item may contain several questions.

## Input modes

Every operation takes its state through three interchangeable modes driven by one option field, the
same idea as the HTTP Request node's `Body Content Type` + `Specify Body` pair:

| Mode value | Shown fields | Use it when |
| --- | --- | --- |
| `text` | `<name>Text` (string) | One piece of text |
| `fields` | `<name>Fields` (fixedCollection of name/value rows) | The state has named parts |
| `json` | `<name>Json` (json) | Nested or repeating structures |

`buildStateFields()` in `shared/stateFields.ts` generates the whole block so all four resources
behave identically, and `resolveState()` reads it back. Rank's candidate list uses the same pattern
via `candidatesMode` / `candidatesFields` / `candidatesJson`.

The same pattern covers every list a user supplies:

| Mode option | Fields |
| --- | --- |
| `candidatesMode` | `candidatesFields` (rows) / `candidatesJson` |
| `dimensionsMode` | `dimensions` (rows) / `dimensionsJson` |
| `weightsMode` | equal / `weights` (rows) / `weightsJson` |

`weightsMode` has a third `equal` value rather than treating "no rows" as equal, so as to keep
"everyone gets 1" distinguishable from "the user has not filled this in yet".

**Read only the parameter belonging to the selected mode.** n8n retains values for parameters that
are hidden by `displayOptions`, so reading `stateJson` while the user is in text mode silently picks
up a stale value from an earlier edit. `resolveState()` branches on the mode first for exactly this
reason, and there is a smoke assertion covering it.

**Every mode needs its own guard.** The emptiness check in `executeScore` originally read the rows
parameter directly, so JSON mode returned `[]` with no error. Any early return that inspects user
input has to resolve the mode first, or it silently no-ops for the other modes.

## Dependencies and the security posture

The node ships **no runtime dependencies**. `package.json` has no `dependencies` field, `files` is
just `dist`, and the compiled output requires only `n8n-workflow`, which n8n provides at runtime.
Verify with `npm pack --dry-run` (about 93 kB, 56 files) and by grepping `dist/` for imports.

`npm audit` reports advisories in the build toolchain. They are real but unreachable from a user:
the vulnerable packages are pulled in by `@n8n/node-cli` and are only ever executed on a developer
machine. Do not "fix" them the obvious ways:

- **`npm audit fix` is unsafe here.** It resolved the advisories by downgrading `@n8n/node-cli` to
  0.1.0, which broke `npm run lint` outright. Keep the CLI on a recent release instead; upgrading to
  `0.48.4` cleared several advisories on its own.
- **`overrides` are rejected by the linter.** `@n8n/community-nodes/no-overrides-field` fails the
  build, and the reasoning is sound: every community package installs into its own isolated tree, so
  an override cannot affect anything outside it. Overriding `brace-expansion` to a patched major
  also breaks `eslint`'s `minimatch`, which needs the older API.

On the last two advisories, `npm audit --omit=dev` still reports `form-data` and `lodash` because
`n8n-workflow` is a peerDependency and npm installs it to resolve the types. Two things make them not
this package's problem:

- `n8n-workflow`'s version is deliberately `*`. n8n supplies it at runtime, and pinning it would
  fight the host. The vulnerable copies are nested inside it
  (`node_modules/n8n-workflow/node_modules/...`), so they are n8n's to patch.
- Nothing this package ships imports either library. `npm pack` yields 56 files, and `grep` over
  `dist/` finds no reference to them outside `tsconfig.tsbuildinfo`, a TypeScript cache that
  `incremental: true` writes into `outDir`. That cache is byte-for-byte what the CLI's own template
  produces, so `tsconfig.json` is left alone rather than diverging from n8n's canonical config.

So the working approach is: keep `@n8n/node-cli` current, and treat advisories inside the dev
toolchain or inside the host-provided `n8n-workflow` as upstream concerns rather than defects here.
The check that matters is whether `dist/` imports the package, and it does not.

## Linting beyond `npm run lint`

`npm run lint` is the gate that must pass. Three extra checks are available:

- `npm run check:fields` validates every `fixedCollection` is internally consistent — that its
  `default` carries a row under the collection's own container name listing exactly the leaves
  `values` declares. An inconsistency there makes n8n drop the field silently.
- `npm run smoke` calls the resource functions directly against the live API. It bypasses n8n's
  parameter resolution, so passing here does **not** mean the node works in n8n. Keep its field names
  in step with the parameter definitions; it silently exercises the wrong shape otherwise.
- `npm run build && docker compose restart n8n && npm run e2e` runs the node through a real n8n.
  This is the only check that covers parameter resolution, which is where most of this node's bugs
  have been.

### aislop

`aislop scan` scores the repository. **Use version 0.16.1 or newer.** On 0.12.1 it reported
`complexity/function-too-long` for `asEntryType`, claiming 198 lines where the TypeScript compiler
measures 30 — a parser bug that disappears on upgrade. The score went from 53 to 72 on 0.16.1 with
no code change. If the MCP server still reports the old score, it is holding the pre-upgrade version
in memory and needs a session restart; trust `aislop scan` from the shell instead.

The remaining findings on a clean checkout are expected:

| Finding | Why it stays |
| --- | --- |
| `form-data`, `lodash` (error) | Nested inside `n8n-workflow`, a peerDependency n8n supplies at runtime. Nothing in `dist/` imports them. |
| `qs`, `stream-json`, `uuid` | Inside the `@n8n/node-cli` dev toolchain. `qs` is graded dev-only by 0.16.1. |
| `duplicate-block` ×2 | The two `levelCollection`/`node` **call sites** of factories that already removed the real duplication. |
| `double-type-assertion` | `NodeApiError` requires `JsonObject`; an `Error` cannot satisfy it structurally. |
| `hardcoded-url` | The provider's public API root. It is a default that the credential's Base URL overrides. |

Do not reach for `npm audit fix` or `overrides` to silence the dependency rows — see the section
above for what each one breaks.

## Gotchas

These were all found by hitting real failures. Do not undo them.

- **`model` is required by the API, not optional.** Omitting it returns `422` with
  `{"type":"missing","loc":["body","model"]}`, and an empty string returns `400 Unknown model:`.
  Always send a model. `resolveModel()` in `shared/models.ts` falls back node option → credential →
  `jev-latest` and must never return an empty string.
- **Answer ids are `"<id>_<type>"`, not the bare id.** The API keeps question ids and answer ids in
  separate namespaces, and both descriptions hold keys with the suffix. This lets `urgency_noul` and
  `urgency_choice` coexist while the UI shows one `id` column. So `buildQuestions()` returns prefixed
  keys and callers must build ids as `` `${questionId}_${type}` `` when reading answers.
- **A `fixedCollection` cannot be nested inside another `fixedCollection`.** n8n does not populate
  a collection declared within a collection's rows, so it always arrives empty. `Score → Composite`
  used a nested `ownLevel` collection for per-dimension scales and it was silently `{}` at runtime;
  the levels are a newline-separated string field instead. This is the bug that hid behind a
  `return []` guard for several iterations.
- **Never return an empty array to signal bad input.** A node returning `[]` ends its branch with no
  error, so the workflow reports success while every later node is skipped. `executeScore` did this
  when it read no dimensions, and the only symptom was a later node never running. Throw a
  `NodeOperationError` instead.
- **`displayOptions` on a collection sub-field is worth avoiding.** It is not forbidden — n8n's own
  Slack node uses it dozens of times — but when the condition cannot resolve at that point the field
  is dropped from the value handed to the node. The question fields now carry none, because gating
  on the sibling `questionType` made `id`, `questionType` and `instructions` all come back
  `undefined`. Gate on the collection itself, not on its members.
- **A `fixedCollection`'s `default` decides the shape the node receives.** n8n builds the returned
  value from `default`, so a leaf declared in `values` but missing from `default` is dropped even
  when the saved workflow contains it. Containers, leaves and `default` keys must agree exactly;
  `npm run check:fields` checks this.
- **`fixedCollection` sub-fields nest one level deeper than they look.** The value shape is
  `{ question: [ { id, choiceOptions: { entry: [...] }, levels: { level: [...] } } ] }`. Passing the
  question entry straight to `readOptionsParameter` returns `[]` silently. Pass `entry.choiceOptions`
  and `entry.levels`. This bit twice during development.
- **Node-level `options` collides with a question's own `options` field.** Both are called `options`,
  and the sub-field won. The question option list is therefore named `choiceOptions` with sub-field
  `entry`, while the node-level collection (holding `model`, `failOnUnparsed`, `threshold`) keeps
  `options`. `readOptionsParameter` reads `entry` and still accepts a legacy `options` key.
- **Options inside `fixedCollection` and `collection` are NOT readable with dot notation.**
  `this.getNodeParameter('options.model', i)` returns undefined. Read the whole collection with
  `this.getNodeParameter('options', i, {})` and index it. Use `readBooleanOption()` from
  `shared/models.ts` so a stored `false` is not mistaken for a missing value.
- **Nested `displayOptions` on a `fixedCollection`'s sub-fields are also gated by the outer field.**
  A sub-field showing only on `questionType: ['choice']` also needs the outer `resource`/`operation`
  conditions, which is why `buildQuestionFields(displayOptions)` takes them as an argument. The
  question-kind conditions use `_cnd: { eq: ... }` operators.
- **`package.json` → `n8n.nodes` / `n8n.credentials` point at compiled `dist/*.js` paths** and must be
  updated by hand when a node or credential is renamed. A stale entry is why a node silently fails to
  appear in n8n.
- **`n8n.strict: true`** makes `n8n-node lint` compare `eslint.config.mjs` byte-for-byte against the
  CLI's bundled default and fail on any deviation. The file must stay exactly:
  ```js
  import { config } from '@n8n/node-cli/eslint';

  export default config;
  ```
- **Icon paths resolve relative to the referencing source file.** Both the node and the credential
  use `file:../../icons/judgment.svg`. The linter checks these exist at lint time, so a wrong path is
  caught early, but only if the file genuinely exists on disk.
- **`@n8n/community-nodes/require-node-api-error` forbids rethrowing a raw catch parameter**, but
  allows `NodeApiError` and `NodeOperationError`. The catch block in `Judgment.node.ts` therefore
  only wraps and throws; it has no early rethrow of its own errors.
- **The credential test hits `GET /v1/models`**, which exists and returns `{"models":[...]}`. It is
  the cheapest endpoint that proves both the key and the base URL.
- **`POST /rest/credentials/test` fails for every credential on n8n 2.39.6, built-in ones included.**
  It answers `200` with `Node "Temp-Node" does not have any credentials of type "<type>" set`, because
  `credentials-tester.service.js` hands `RoutingNode` a synthetic node type whose `credentials` array
  the credential lookup then cannot match. `sms77Api`, a stock credential, fails identically, so this
  is an n8n bug and not something to chase here. Real execution is unaffected: the `e2e` run
  authenticates and completes. **Do not use that endpoint to decide whether the credential works** —
  rely on `npm run e2e`.
- **CI runs on `main`, the default branch is `master`.** A push to `master` does not trigger
  `.github/workflows/ci.yml`; pull requests do. `publish.yml` triggers on tags matching `*.*.*`.
- **`npm install` needs `--force --ignore-scripts` on this machine.** `@n8n/node-cli@0.33.1` pins
  `eslint@9.29.0` as a peer while the project has `eslint@9.39.4`, and n8n's dependency tree contains
  `isolated-vm`, a native module that fails to compile against Node 26. Neither affects lint or build.

## Working on this node

- Read the TypeSafe docs before changing question handling, since the wire format is theirs. The
  authoritative pages are
  `https://docs.typesafe.ai/api`, `/primitives`, `/primitives/advanced`, and `/confidence`.
  `https://docs.typesafe.ai/llms.txt` is the index; append `.md` to any page path for Markdown.
- Keep questions and thresholds easy to find. When adding a decision, put the question text and any
  threshold constant in one place rather than spreading them across the resource files.
- Every new question kind needs: a description builder in `shared/descriptions.ts`, handling in
  `buildQuestion()`, and an answer reader path. `shared/extract.ts` is where a new answer shape gets
  its `value`/`choice`/`confidence` mapping.
- Verify with `npm run lint && npm run build && node scripts/smoke.mjs` before considering a change
  done. Lint alone will not catch a wrong parameter path; only the smoke script exercises real
  requests.

## Reference docs

- TypeSafe: <https://docs.typesafe.ai/api>, <https://docs.typesafe.ai/primitives>, <https://docs.typesafe.ai/confidence>
- n8n node building: <https://docs.n8n.io/integrations/creating-nodes/overview/>, <https://docs.n8n.io/integrations/creating-nodes/build/reference/>, <https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/>
- The `@n8n/node-cli` tarball ships canonical agent docs under
  `dist/template/templates/shared/default/.agents/` (`nodes.md`, `properties.md`, `credentials.md`,
  `versioning.md`). Worth extracting for anything structural.
