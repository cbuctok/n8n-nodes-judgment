# Changelog

## 0.1.0

- First release. Wraps the TypeSafe System One API behind a vendor-neutral Judgment node.
- Resources: **Evaluation** (Evaluate, Evaluate Many), **Choice** (Decide, Rank),
  **Score** (Rate, Composite), **Noul** (yes/no with a threshold).
- Each state can be supplied as text, named fields, or JSON.
- Every answer carries its confidence, and low-confidence answers are flagged so a workflow can
  route uncertain cases to a person or a reasoning model.
- No runtime dependencies: the node is built only against `n8n-workflow`, which n8n supplies.
