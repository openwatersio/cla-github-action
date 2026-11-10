import * as core from '@actions/core'
import { context } from '@actions/github'
import { octokit } from './octokit'
import { getFileContent } from './persistence/persistence'
import { setupClaCheck } from './setupClaCheck'
import { errorMessage, errorStatus } from './shared/errors'
import * as input from './shared/getInputs'

type PullRequest = NonNullable<typeof context.payload.pull_request>
type State = 'success' | 'failure' | 'error'

/** A signature written mid-check can make one more pass necessary; this bounds the passes. */
const MAX_ATTEMPTS = 3

/**
 * Check a pull request from a base-repository event (`workflow_run` or
 * `issue_comment`) and report the result as a commit status on its head.
 *
 * With `head-sha` the pull request is the open one whose head is that commit,
 * looked up through the API so nothing from the triggering run is trusted.
 * Without it, the pull request is the one the comment was made on.
 */
export async function runWithStatus(statusContext: string): Promise<void> {
  let found
  try {
    found = await loadPullRequest()
  } catch (error) {
    // The requested head is known before the lookup, so a failed lookup can still report on it.
    const headSha = input.getHeadSha()
    if (headSha) {
      await postStatus(
        statusContext,
        headSha,
        'error',
        'The CLA check could not complete'
      ).catch(statusError =>
        core.warning(
          `Could not post the error status: ${errorMessage(statusError)}`
        )
      )
    }
    throw error
  }
  if (!found) return
  const { pr, sharing } = found
  const headSha: string = pr.head.sha

  // A status belongs to the commit, so every pull request with this head would share one result.
  if (sharing.length > 1) {
    const numbers = sharing.map(p => `#${p.number}`).join(', ')
    core.setFailed(
      `Open pull requests ${numbers} share head ${headSha}; close all but one to check the CLA`
    )
    await postStatus(
      statusContext,
      headSha,
      'error',
      'Several open pull requests share this commit; close all but one'
    )
    return
  }
  context.payload.pull_request = pr

  for (let attempt = 1; ; attempt++) {
    const signaturesBefore = await signaturesVersion()
    const state = await check(headSha)
    await postStatus(statusContext, headSha, state, describe(state))
    // Signatures are only ever added, so a result other than success can go
    // stale: a signing run that wrote after this check read the file may have
    // posted its success first, and a concurrent write rejects this run's own.
    // Check again against the newer file.
    const signaturesAfter = await signaturesVersion()
    // An unreadable version may hide a signature, so an unsigned result checks
    // again; an error has already failed closed and would only repeat.
    const unknown =
      signaturesBefore === undefined || signaturesAfter === undefined
    const settled =
      state === 'success' ||
      attempt === MAX_ATTEMPTS ||
      (unknown ? state === 'error' : signaturesAfter === signaturesBefore)
    if (settled) {
      // The status carries an unsigned result; failing the job too would mark
      // the default branch's commit red. Errors still fail the job.
      process.exitCode = state === 'error' ? core.ExitCode.Failure : 0
      return
    }
    core.info('The signatures file changed during the check; checking again')
  }
}

async function check(headSha: string): Promise<State> {
  try {
    return (await setupClaCheck(headSha)) ? 'success' : 'failure'
  } catch (error) {
    core.setFailed(errorMessage(error))
    return 'error'
  }
}

function describe(state: State): string {
  if (state === 'success') return 'All contributors have signed the CLA'
  if (state === 'failure') return 'Not all contributors have signed the CLA'
  return 'The CLA check could not complete'
}

async function postStatus(
  statusContext: string,
  sha: string,
  state: State,
  description: string
): Promise<void> {
  await octokit.rest.repos.createCommitStatus({
    owner: context.repo.owner,
    repo: context.repo.repo,
    sha,
    state,
    context: statusContext,
    description,
    ...(context.runId && {
      target_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
    })
  })
}

/** The signatures file's blob SHA, `missing` before it exists, or undefined when it cannot be read. */
async function signaturesVersion(): Promise<string | undefined> {
  try {
    return (await getFileContent())?.data?.sha
  } catch (error) {
    return errorStatus(error) === 404 ? 'missing' : undefined
  }
}

/**
 * Find the pull request to check and the open pull requests that share its
 * head. Returns undefined when there is nothing to check: no open pull request
 * has the requested head (it has moved on and a newer run will check it), or
 * the comment is not on an open pull request.
 */
async function loadPullRequest(): Promise<
  { pr: PullRequest; sharing: PullRequest[] } | undefined
> {
  const headSha = input.getHeadSha()
  if (headSha) {
    const sharing = await openPullRequestsWithHead(headSha)
    const pr = sharing[0]
    if (!pr) {
      core.info(`No open pull request has head ${headSha}; nothing to check`)
      return undefined
    }
    return { pr, sharing }
  }

  if (context.eventName !== 'issue_comment') {
    throw new Error(
      `head-sha is required with status-context on ${context.eventName} events`
    )
  }
  if (!context.payload.issue?.pull_request) {
    core.info('This comment is not on a pull request; nothing to check')
    return undefined
  }
  const pr = (
    await octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.issue.number
    })
  ).data as PullRequest
  if (pr.state !== 'open') {
    core.info(`Pull request #${pr.number} is ${pr.state}; nothing to check`)
    return undefined
  }
  return { pr, sharing: await openPullRequestsWithHead(pr.head.sha) }
}

async function openPullRequestsWithHead(sha: string): Promise<PullRequest[]> {
  const open = await octokit.paginate(octokit.rest.pulls.list, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    state: 'open',
    per_page: 100
  })
  return open.filter(p => p.head.sha === sha) as PullRequest[]
}
