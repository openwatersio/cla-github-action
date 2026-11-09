import * as core from '@actions/core'
import { context } from '@actions/github'
import { octokit } from './octokit'
import { setupClaCheck } from './setupClaCheck'
import { errorMessage } from './shared/errors'
import * as input from './shared/getInputs'

/**
 * Check a pull request from a base-repository event (`workflow_run` or
 * `issue_comment`) and report the result as a commit status on its head.
 *
 * With `head-sha` the pull request is the open one whose head is that commit,
 * looked up through the API so nothing from the triggering run is trusted.
 * Without it, the pull request is the one the comment was made on.
 */
export async function runWithStatus(statusContext: string): Promise<void> {
  const headSha = await loadPullRequest()
  if (!headSha) return

  let state: 'success' | 'failure' | 'error'
  let description: string
  try {
    const passed = await setupClaCheck(headSha)
    state = passed ? 'success' : 'failure'
    description = passed
      ? 'All contributors have signed the CLA'
      : 'Not all contributors have signed the CLA'
  } catch (error) {
    core.setFailed(errorMessage(error))
    state = 'error'
    description = 'The CLA check could not complete'
  }

  await octokit.rest.repos.createCommitStatus({
    owner: context.repo.owner,
    repo: context.repo.repo,
    sha: headSha,
    state,
    context: statusContext,
    description,
    ...(context.runId && {
      target_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
    })
  })
}

/**
 * Put the pull request into the event payload, where the rest of the action
 * reads it, and return its head SHA. Returns undefined when no open pull
 * request has the requested head, which means it has moved on and a newer run
 * will check it.
 */
async function loadPullRequest(): Promise<string | undefined> {
  const headSha = input.getHeadSha()
  let pr
  if (headSha) {
    const open = await octokit.paginate(octokit.rest.pulls.list, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      state: 'open',
      per_page: 100
    })
    // The oldest pull request wins when several share a head, so a later copy cannot take over the status.
    const matches = open
      .filter(p => p.head.sha === headSha)
      .sort((a, b) => a.number - b.number)
    pr = matches[0]
    if (!pr) {
      core.info(`No open pull request has head ${headSha}; nothing to check`)
      return undefined
    }
    if (matches.length > 1) {
      core.warning(
        `Pull requests ${matches.map(p => `#${p.number}`).join(', ')} share head ${headSha}; checking #${pr.number}`
      )
    }
  } else {
    if (!context.payload.issue?.pull_request) {
      core.info('This comment is not on a pull request; nothing to check')
      return undefined
    }
    pr = (
      await octokit.rest.pulls.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.issue.number
      })
    ).data
  }
  context.payload.pull_request = pr as NonNullable<
    typeof context.payload.pull_request
  >
  return pr.head.sha
}
