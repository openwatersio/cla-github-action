# Open Waters CLA setup

Open Waters records signatures in `.cla.json` on each participating repository's `main` branch. The agreement stays in that repository's `CLA.md`. The initial rollout covers `slackwater-ios` and `OpenWaters`.

## Signature writer

The organization-owned [Open Waters CLA App](https://github.com/organizations/openwatersio/settings/apps/open-waters-cla) has Single file write permission for `.cla.json` and mandatory Metadata read permission. It has no webhook, OAuth callback, Contents write permission, or workflow permission. Install it only on participating repositories.

Grant this App an Always allow bypass in any ruleset that would reject its signature commits. Preserve the other rules and bypass actors. The App's file permission limits what it can write even though the ruleset bypass is attached to its identity.

The organization variable `CLA_APP_CLIENT_ID` and encrypted secret `CLA_APP_PRIVATE_KEY` are restricted to the participating repositories. `actions/create-github-app-token` mints a token scoped to the current repository with `permission-single-file: write` and revokes it when the job ends. Private keys belong in encrypted secrets, never in this repository.

The CLA action receives that token as `PERSONAL_ACCESS_TOKEN`. Set `remote-organization-name` and `remote-repository-name` explicitly to the current repository's owner and name: these inputs select the separate storage token, even when the file is in the same repository. Set `path-to-signatures: .cla.json` and `branch: main`. The ordinary `GITHUB_TOKEN` handles PR comments and the `cla` commit status; it does not need Contents write permission or a ruleset bypass.

## Workflow behavior

Pin both actions to reviewed commit SHAs. The check uses two workflows and never runs on `pull_request_target`, which GitHub blocks by default in public repositories without an Actions event policy:

- `CLA trigger` (`.github/workflows/cla-trigger.yml`) runs on `pull_request` for opened, reopened, and synchronize events. It has no permissions or secrets and does nothing; its completion is the signal. Its job must not be named `cla`, because a check with that name would satisfy the required `cla` check, except on Dependabot's own runs: there it is named `cla` and passes, since Dependabot's pull requests need no signature and its runs may not get the App secret.
- `CLA` (`.github/workflows/cla.yml`) runs on `workflow_run` when `CLA trigger` completes, except for runs Dependabot triggered, and on human comments on pull requests so signing variations and `recheck` reach the action. Both events run the default branch's workflow with the App token. It sets `status-context: cla` and passes `github.event.workflow_run.head_sha` as `head-sha`.

The `CLA` workflow trusts nothing from the triggering run. It finds the open pull request whose head is `workflow_run.head_sha` through the API, so it needs no artifact and reads no PR number from untrusted code; when no open pull request has that head, the pull request has moved on and the run for the newer head checks it. The commits query confirms the head is still that SHA while it reads the authors, and the action reports an `error` status otherwise. A status belongs to a commit, not a pull request, so when several open pull requests share the head the action reports `error`. Close all but one, then push or comment `recheck` on the remaining one to clear it. Anyone who can open a pull request can cause this by copying another pull request's head. A signing comment updates the status on the pull request's current head directly. If the signatures file changes while a check runs, the check runs again after posting its result, up to three times, so a stale failure does not normally outlast the signing run's success. A `recheck` comment settles any that remain. Never check out or execute PR code in either workflow.

The result is a `cla` commit status created with `GITHUB_TOKEN`, so it comes from GitHub Actions, the source a ruleset's required `cla` check names. An unsigned result fails only the status; the `CLA` job itself stays green so the default branch's commit does not show a failure for every unsigned pull request. Errors, including a rejected signature write, set an `error` status and fail the job.

GitHub asks a maintainer to approve `pull_request` runs from some first-time contributors, and runs no `pull_request` workflow while a pull request has merge conflicts. The CLA comment and status follow that approval or the conflict's resolution; a `recheck` comment runs the check without either. Because a status belongs to the commit, a pull request that copies another's head shows that pull request's status until its own check runs, so the opener check applies only once it does. `pull_request` runs use the pull request's own workflow files, so a pull request can remove `cla-trigger.yml` or add a job named `cla` that passes. A required check sourced from GitHub Actions cannot tell that job from the real status. Review workflow changes in outside pull requests before approving their runs. Requiring `cla` from the CLA App instead closes this: give the App Commit statuses write permission, pass its token as `GITHUB_TOKEN` (it then also needs Pull requests write), and set the ruleset's required `cla` source to the App.

The signing phrase is `I have read the CLA Document and I hereby sign the CLA`. Preserve the bot allowlist and exempt the exact `noreply@anthropic.com` address used in Claude co-author trailers. Human contributors still need a recorded signature. Conversation locking is disabled.

Keep signature-only commits out of application build lanes. If two runs try to update the signature file concurrently, GitHub rejects the stale file SHA instead of overwriting data; a `recheck` comment retries against the current file. The upstream action can update its signed comment before persistence completes. The workflow result and `.cla.json` are authoritative: a rejected write fails the check even if the comment acknowledges signing.

## Verification

Confirm the App installation and each token expose only `.cla.json` for writing. Check that existing signature IDs and comment metadata survive, and verify a signature commit reaches `main` with the App's identity. Signing checks must fail visibly when storage rejects a write.

`workflow_run` and `issue_comment` run only workflows on the default branch, so the `CLA` workflow takes effect when it merges. Until then a workflow PR is checked by the default branch's current CLA workflow. Pull requests opened before the switch keep their old `cla` check run on their head; push a new commit to them to get the new status. Roll back the action pin and the workflows together.

## Upstream updates

The `Check upstream` workflow is scheduled daily at 10:17 UTC and supports manual runs. It verifies that the parent fork is `iainmcgin/cla-github-action` and compares both default branches (currently `master`). Commits already present in our history need no alert; missing upstream commits open an issue with the upstream tip and a comparison link.

GitHub Issues must be enabled. Each upstream tip gets at most one bot-created issue, including closed issues, so closing an alert acknowledges that tip. Later upstream tips get new issues. The workflow uses the ordinary Actions token with Contents read and Issues write permissions; it does not use the signature App or its private key. API errors fail the workflow visibly.

Alerts compare the full upstream history with this fork; cherry-picked or deliberately declined commits can appear again in later comparison ranges. Keep the bot's hidden marker in each issue body to preserve deduplication.

The schedule becomes available after the workflow reaches the default branch. Run `Check upstream` manually after merging and confirm the comparison result in Actions. GitHub [disables public-repository schedules after 60 days without repository activity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). If the fork has been idle, check the workflow's state in Actions and re-enable it before relying on scheduled alerts.
