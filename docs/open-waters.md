# Open Waters CLA setup

Open Waters records signatures in `.cla.json` on each participating repository's `main` branch. The agreement stays in that repository's `CLA.md`. The initial rollout covers `slackwater-ios` and `OpenWaters`.

## Signature writer

The organization-owned [Open Waters CLA App](https://github.com/organizations/openwatersio/settings/apps/open-waters-cla) has Single file write permission for `.cla.json` and mandatory Metadata read permission. It has no webhook, OAuth callback, Contents write permission, or workflow permission. Install it only on participating repositories.

Grant this App an Always allow bypass in any ruleset that would reject its signature commits. Preserve the other rules and bypass actors. The App's file permission limits what it can write even though the ruleset bypass is attached to its identity.

The organization variable `CLA_APP_CLIENT_ID` and encrypted secret `CLA_APP_PRIVATE_KEY` are restricted to the participating repositories. `actions/create-github-app-token` mints a token scoped to the current repository with `permission-single-file: write` and revokes it when the job ends. Private keys belong in encrypted secrets, never in this repository.

The CLA action receives that token as `PERSONAL_ACCESS_TOKEN`. Set `remote-organization-name` and `remote-repository-name` explicitly to the current repository's owner and name: these inputs select the separate storage token, even when the file is in the same repository. Set `path-to-signatures: .cla.json` and `branch: main`. The ordinary `GITHUB_TOKEN` handles PR comments and workflow reruns; it does not need Contents write permission or a ruleset bypass.

## Workflow behavior

Pin both actions to reviewed commit SHAs. Run on `pull_request_target` for opened, reopened, and synchronize events, and on human comments on pull requests so signing variations and `recheck` reach the action. Never check out or execute PR code in this privileged workflow.

The signing phrase is `I have read the CLA Document and I hereby sign the CLA`. Preserve the bot allowlist and exempt the exact `noreply@anthropic.com` address used in Claude co-author trailers. Human contributors still need a recorded signature. Conversation locking is disabled.

Keep signature-only commits out of application build lanes. If two runs try to update the signature file concurrently, GitHub rejects the stale file SHA instead of overwriting data; a `recheck` comment retries against the current file. The upstream action can update its signed comment before persistence completes. The workflow result and `.cla.json` are authoritative: a rejected write fails the check even if the comment acknowledges signing.

## Verification

Confirm the App installation and each token expose only `.cla.json` for writing. Check that existing signature IDs and comment metadata survive, and verify a signature commit reaches `main` with the App's identity. Signing checks must fail visibly when storage rejects a write.

The repository-specific workflow changes require a PR merge before `pull_request_target` and `issue_comment` use them. A workflow PR runs the current default-branch CLA workflow until it merges.
