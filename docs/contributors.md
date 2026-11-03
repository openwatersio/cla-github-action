# Contributing to the Open Waters fork

Use Node 24 and a full Git checkout. Install dependencies with `npm ci --ignore-scripts`, then run `npm run lint`, `npm test -- --runInBand`, and `npm run build`.

Commit source changes, dependency manifests, and the generated `dist/` files together. Do not commit `lib/` or `node_modules/`. Dependency update PRs require a rebuilt bundle too. CI verifies that tracked and newly generated files under `dist/` match the committed action.

Open a pull request against `openwatersio/cla-github-action:master`. Preserve the upstream Apache-2.0 license and attribution.
