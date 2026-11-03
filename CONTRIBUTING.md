# Contributing

Open Waters maintains this fork for its own repositories. Open pull requests against `openwatersio/cla-github-action:master`. For questions, use the [Open Waters contact page](https://openwaters.io/contact/). Report vulnerabilities through [SECURITY.md](SECURITY.md).

Use Node 24 and a full Git checkout. Run `npm ci --ignore-scripts`, `npm run lint`, `npm test -- --runInBand`, and `npm run build`. Commit source changes, dependency manifests, and generated `dist/` files together. Do not commit `lib/` or `node_modules/`. Dependency updates require a rebuilt bundle before they can pass CI.

`npm ci --ignore-scripts` leaves the optional Husky hook inactive. If you install it with plain `npm install`, the pre-commit hook runs `buildAndAdd`, which rebuilds and stages the entire working tree. Inspect the staged diff before committing.

Keep changes focused and add a regression test for runtime bug fixes. Preserve the Apache-2.0 license and upstream attribution. Contributions require a [Developer Certificate of Origin](https://developercertificate.org/) sign-off, following the upstream project's contribution requirement.
