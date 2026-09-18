# n8n-nodes-judgment

This is an n8n community node for typed judgements about text or application state. It asks Choice,
Score and Noul questions and returns values your workflow can branch on: a selected option, a
position on a scale, or a probability.

It is not tied to a single vendor. The abstraction — question kinds, thresholds and confidence — is
the point; the transport speaks [TypeSafe](https://typesafe.ai)'s
[System One](https://docs.typesafe.ai/concepts/system-one) API today because that is what it was
built against. Adding another provider means adding a transport, not rewriting the node. System One
models do not write text; they answer typed questions about your data, over the
[`POST /v1/systemone`](https://docs.typesafe.ai/api) endpoint.

The node name is **Judgment**; the credential is **Judgment API**.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

The package name to install is:

```
n8n-nodes-judgment
```

Enter it exactly as written in **Settings → Community Nodes → Install**. It is unscoped, so there is
no `@org/` prefix.

## Operations

The node is organised as **Resource → Operation**.

### Evaluation

- **Evaluate** — ask several questions of different types about one piece of state and get one
  output item per question. This is the operation to reach for first.
- **Evaluate Many** — ask the same questions about every incoming item. All items are packed into a
  single state and sent in **one** API call; answers are split back out per item.

### Choice

- **Decide** — pick one option from a set you define. Returns the selected option plus a probability
  for every option.
- **Rank** — treat a list of candidates as the options and return them ordered by probability. Useful
  for reranking retrieved documents.

### Score

- **Rate** — place the state on an ordered scale you define.
- **Composite** — rate several independent dimensions in one call, then combine them into a single
  weighted score. Weights are applied by the node, not the model, so changing a weight never
  requires new inference.

### Noul

Ask one or more yes/no questions and get the probability of a yes for each one, plus a boolean
derived from a threshold you set.

## Credentials

You need an API key, created in the provider console. For TypeSafe that is the
[TypeSafe console](https://console.typesafe.ai/keys).

| Field | Required | Notes |
| --- | --- | --- |
| API Key | Yes | Stored as a password field and sent as a bearer token. |
| Base URL | No | Defaults to the provider's public API root (`https://api.typesafe.ai` today). Change it for a proxy, a self-hosted endpoint, or another provider. |
| Default Model | No | Used when an operation does not override the model. Defaults to `jev-latest`. |

The credential test calls `GET /v1/models`, so a bad key or an unreachable base URL is reported when
the credential is saved rather than on the first workflow run.

## Compatibility

- Requires n8n running on Node.js 20 or newer.
- Built and verified against the TypeSafe v1 API (`POST /v1/systemone`). The node's resources,
  input modes and confidence handling are transport-independent; the HTTP layer is what would be
  swapped for a different provider.

## Usage

### Ask for one narrow judgement per question

System One models are built for fast, focused judgements. "Does this message convey urgency?" works
well. "Decide what to do with this ticket" does not, because it hides several judgements behind one
answer.

If a decision depends on several factors, ask about each factor separately and combine the answers
in your workflow. That way you can inspect and reweight the parts instead of rewriting a prompt.

### Ask everything at once

Questions in one request are evaluated in parallel and see the same state, so adding questions
barely changes the response time. Put every question the workflow might need into a single call,
including ones that only matter on some paths, and let later nodes ignore the answers they do not
need. Several small calls cost more and are slower than one call with several questions.

Questions in the same request cannot see each other's answers. If a second question depends on the
first answer, use a second node.

### Supplying the state

Every operation offers the same three input modes, so you only learn this once:

| Mode | Use it when |
| --- | --- |
| **Text** | The state is one piece of text, such as a message or an article. Paste it, or use an expression like `{{ $json.body }}`. |
| **Fields Below** | Questions need to point at named parts, for example `message` and `policy`. This is the default choice for most workflows. |
| **Using JSON** | The state is nested or repeating and rows cannot express it, such as a support ticket with an array of messages. |

Fields and JSON describe the same thing, so you can switch modes without changing your questions. A question always refers to a field by its backticked path, such as ``Does `message` request a refund?``.

The same choice is available wherever a list is involved, so nothing forces you into JSON:

| Field | Modes |
| --- | --- |
| **State** | Text, Fields Below, Using JSON |
| **Candidates** (Choice → Rank) | Fields Below, Using JSON |
| **Dimensions** (Score → Composite) | Fields Below, Using JSON |
| **Weights** (Score → Composite) | Equal, Fields Below, Using JSON |

Switching modes never changes what you are sending, only how you type it, so it is safe to move between them as a workflow grows.

### Give every question a stable ID

Each question's **ID** names its answer in the output. The ID is never sent to the model, so the
**Instructions** field must carry the complete question. Write it as if the ID did not exist.

### Structure your state

State can be plain text, or a JSON object when the input has several parts:

```json
{
  "ticket": { "message": "I was charged twice for order A-104." },
  "order": { "id": "A-104", "charges": [{ "amount_usd": 49 }, { "amount_usd": 49 }] },
  "refund_policy": "Duplicate charges are eligible for a refund."
}
```

Point a question at a specific field with a backticked path, for example
``Does `ticket.message` request a refund given `refund_policy`?``. Named fields keep the judgement
unambiguous and make the questions easier to review later.

### Use confidence to decide how far to trust an answer

Choice and Score answers include a `confidence` value between 0 and 1. Noul answers do not; a Noul
near 0.5 means yes and no are equally likely.

The node sets `lowConfidence` to `true` when confidence is below 0.8. That flag is a reporting aid,
not a decision: the answer is always returned unchanged. Thresholds belong in your workflow, where
you can set them per action. Showing the wrong value is recoverable; acting on a low-confidence
judgement may not be.

A common shape is to route low-confidence answers to a person and only act automatically above a
threshold that matches the stakes of the action.

### Output shape

| Resource | Output |
| --- | --- |
| Evaluation | One item per question, each with `id`, `value`, `choice`, `confidence`, `lowConfidence` and the raw `answer`. |
| Noul | One item per question, with `probability`, `boolean` and the `threshold` used. |
| Score | A single item with per-dimension `score`, `normalized`, `confidence` and `legend`, plus `combinedScore` for the Composite operation. |
| Choice | `Decide` returns the selected option with the full ranked list. `Rank` returns the candidates ordered by probability. |

Every item also carries `usage` (token counts), `model`, `requestId` and the raw API response.

### Cost and latency

One node run makes at most one API call per input item, regardless of how many questions it asks.
Use **Evaluation → Evaluate Many** when every item needs the same questions, since that packs all
items into a single call.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [TypeSafe API reference](https://docs.typesafe.ai/api)
- [TypeSafe primitives: Choice, Score, Noul](https://docs.typesafe.ai/primitives)
- [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- [TypeSafe patterns](https://docs.typesafe.ai/patterns)
