# Changelog

## 0.1.1

- Renamed the package to the unscoped `n8n-nodes-judgment`, which is the name to install. The
  previous scoped publication could not be resolved from the registry.
- Replaced the placeholder icon with the scales-of-justice artwork.
- Publishing now runs from CI, so releases carry a provenance attestation.

## 0.1.0

- First release. Wraps the TypeSafe System One API behind a vendor-neutral Judgment node.
- Resources: **Evaluation** (Evaluate, Evaluate Many), **Choice** (Decide, Rank),
  **Score** (Rate, Composite), **Noul** (yes/no with a threshold).
- Each state can be supplied as text, named fields, or JSON.
- Every answer carries its confidence, and low-confidence answers are flagged so a workflow can
  route uncertain cases to a person or a reasoning model.
- No runtime dependencies: the node is built only against `n8n-workflow`, which n8n supplies.
