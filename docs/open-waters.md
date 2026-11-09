# Open Waters CLA setup

Open Waters records signatures in `.cla.json` on each participating repository's `main` branch. The agreement stays in that repository's `CLA.md`. The initial rollout covers `slackwater-ios` and `OpenWaters`.

## Signature writer

The organization-owned [Open Waters CLA App](https://github.com/organizations/openwatersio/settings/apps/open-waters-cla) has Single file write permission for `.cla.json` and mandatory Metadata read permission. It has no webhook, OAuth callback, Contents write permission, or workflow permission. Install it only on participating repositories.

Grant this App an Always allow bypass in any ruleset that would reject its signature commits. Preserve the other rules and bypass actors. The App's file permission limits what it can write even though the ruleset bypass is attached to its identity.

The organization variable `CLA_APP_CLIENT_ID` and encrypted secret `CLA_APP_PRIVATE_KEY` are restricted to the participating repositories. `actions/create-github-app-token` mints a token scoped to the current repository with `permission-single-file: write` and revokes it when the job ends. Private keys belong in encrypted secrets, never in this repository.

The CLA action receives that token as `PERSONAL_ACCESS_TOKEN`. Set `remote-organization-name` and `remote-repository-name` explicitly to the current repository's owner and name: these inputs select the separate storage token, even when the file is in the same repository. Set `path-to-signatures: .cla.json` and `branch: main`. The ordinary `GITHUB_TOKEN` handles PR comments and the `cla` commit status; it does not need Contents write permission or a ruleset bypass.

## Workflow behavior

Pin both actions to reviewed commit SHAs. The check uses two workflows and never runs on `pull_request_target`, which GitHub blocks by default in public repositories without an Actions event policy:

- `CLA trigger` (`.github/workflows/cla-trigger.yml`) runs on `pull_request` for opened, reopened, and synchronize events. It has no permissions or secrets and does nothing; its completion is the signal. Its job must not be named `cla`, because a check with that name would satisfy the required `cla` check.
- `CLA` (`.github/workflows/cla.yml`) runs on `workflow_run` when `CLA trigger` completes, and on human comments on pull requests so signing variations and `recheck` reach the action. Both events run the default branch's workflow with the App token. It sets `status-context: cla` and passes `github.event.workflow_run.head_sha` as `head-sha`.

The `CLA` workflow trusts nothing from the triggering run. It finds the open pull request whose head is `workflow_run.head_sha` through the API, so it needs no artifact and reads no PR number from untrusted code; when no open pull request has that head, the pull request has moved on and the run for the newer head checks it. The commits query confirms the head is still that SHA while it reads the authors, and the action reports an `error` status otherwise. The result is a `cla` commit status on that head, created with `GITHUB_TOKEN` so it comes from GitHub Actions, which is the source a ruleset's required `cla` check names. A signing comment updates the status on the pull request's current head directly. Never check out or execute PR code in either workflow.

GitHub asks a maintainer to approve `pull_request` runs from some first-time contributors. The CLA comment and status follow that approval. A pull request can delete or change `cla-trigger.yml` in its own branch, which only stops its own check; a `recheck` comment still runs the default branch's workflow, and a ruleset that requires `cla` keeps such a pull request from merging.

The signing phrase is `I have read the CLA Document and I hereby sign the CLA`. Preserve the bot allowlist and exempt the exact `noreply@anthropic.com` address used in Claude co-author trailers. Human contributors still need a recorded signature. Conversation locking is disabled.

Keep signature-only commits out of application build lanes. If two runs try to update the signature file concurrently, GitHub rejects the stale file SHA instead of overwriting data; a `recheck` comment retries against the current file. The upstream action can update its signed comment before persistence completes. The workflow result and `.cla.json` are authoritative: a rejected write fails the check even if the comment acknowledges signing.

## Verification

Confirm the App installation and each token expose only `.cla.json` for writing. Check that existing signature IDs and comment metadata survive, and verify a signature commit reaches `main` with the App's identity. Signing checks must fail visibly when storage rejects a write.

`workflow_run` and `issue_comment` run only workflows on the default branch, so the `CLA` workflow takes effect when it merges. Until then a workflow PR is checked by the default branch's current CLA workflow.

## Upstream updates

The `Check upstream` workflow is scheduled daily at 10:17 UTC and supports manual runs. It verifies that the parent fork is `iainmcgin/cla-github-action` and compares both default branches (currently `master`). Commits already present in our history need no alert; missing upstream commits open an issue with the upstream tip and a comparison link.

GitHub Issues must be enabled. Each upstream tip gets at most one bot-created issue, including closed issues, so closing an alert acknowledges that tip. Later upstream tips get new issues. The workflow uses the ordinary Actions token with Contents read and Issues write permissions; it does not use the signature App or its private key. API errors fail the workflow visibly.

Alerts compare the full upstream history with this fork; cherry-picked or deliberately declined commits can appear again in later comparison ranges. Keep the bot's hidden marker in each issue body to preserve deduplication.

The schedule becomes available after the workflow reaches the default branch. Run `Check upstream` manually after merging and confirm the comparison result in Actions. GitHub [disables public-repository schedules after 60 days without repository activity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). If the fork has been idle, check the workflow's state in Actions and re-enable it before relying on scheduled alerts.
