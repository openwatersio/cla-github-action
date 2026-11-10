import * as core from '@actions/core'
import { installFakeGitHub, FakeGitHub } from '../testHelpers/fakeGithub'
import { resetEnv, setDefaultInputs } from '../testHelpers/env'
import { reloadOctokit, setContext } from '../testHelpers/context'

async function runAction() {
  reloadOctokit()
  for (const path of Object.keys(require.cache)) {
    if (path.includes('/src/')) delete require.cache[path]
  }
  const { run } = require('../../src/main') as typeof import('../../src/main')
  await run()
}

const alice = { login: 'alice', id: 1001 }
const signPhrase = 'I have read the CLA Document and I hereby sign the CLA'

describe('status mode', () => {
  let fake: FakeGitHub
  let failed: jest.SpyInstance
  const repo = () => fake.repo('acme', 'widgets')

  beforeEach(() => {
    setDefaultInputs({
      'path-to-signatures': 'signatures/cla.json',
      allowlist: '*[bot]',
      'status-context': 'cla'
    })
    fake = installFakeGitHub()
    failed = jest.spyOn(core, 'setFailed').mockImplementation(() => {})
    jest.spyOn(core, 'info').mockImplementation(() => {})
    repo().setFile('signatures/cla.json', { signedContributors: [] })
    repo().addPullRequest({
      number: 7,
      head: { sha: 'headsha', ref: 'feature/cla' },
      user: alice,
      commits: [{ author: alice }]
    })
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    process.exitCode = undefined
    await fake.close()
    resetEnv()
  })

  function workflowRun(headSha: string) {
    setDefaultInputs({
      'path-to-signatures': 'signatures/cla.json',
      allowlist: '*[bot]',
      'status-context': 'cla',
      'head-sha': headSha
    })
    setContext({
      issueNumber: 0,
      eventName: 'workflow_run',
      payload: {
        action: 'completed',
        workflow_run: { head_sha: headSha },
        repository: { id: repo().state.id }
      }
    })
  }

  it('finds the pull request by head SHA, comments, and sets a failing status', async () => {
    workflowRun('headsha')
    await runAction()

    expect(repo().listComments(7)).toHaveLength(1)
    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'failure', context: 'cla' }
    ])
    // The status carries the failure; the job itself ends successfully.
    expect(process.exitCode).toBe(0)
  })

  it('sets a passing status when everyone has signed', async () => {
    repo().setFile('signatures/cla.json', {
      signedContributors: [{ name: 'alice', id: 1001 }]
    })
    workflowRun('headsha')
    await runAction()

    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'success', context: 'cla' }
    ])
    expect(failed).not.toHaveBeenCalled()
  })

  it('checks the PR opener, whom the workflow_run payload does not name', async () => {
    repo().setFile('signatures/cla.json', {
      signedContributors: [{ name: 'alice', id: 1001 }]
    })
    repo().addPullRequest({
      number: 8,
      head: { sha: 'othersha', ref: 'feature/other' },
      user: { login: 'mallory', id: 666 },
      commits: [{ author: alice }]
    })
    workflowRun('othersha')
    await runAction()

    expect(repo().state.statuses).toEqual([
      { sha: 'othersha', state: 'failure', context: 'cla' }
    ])
  })

  it('does nothing when no open pull request has the head SHA', async () => {
    workflowRun('stalesha')
    await runAction()

    expect(repo().listComments(7)).toHaveLength(0)
    expect(repo().state.statuses).toEqual([])
    expect(failed).not.toHaveBeenCalled()
  })

  it('reports an error when several open pull requests share the head', async () => {
    repo().setFile('signatures/cla.json', {
      signedContributors: [{ name: 'alice', id: 1001 }]
    })
    repo().addPullRequest({
      number: 9,
      head: { sha: 'headsha', ref: 'copy' },
      user: { login: 'mallory', id: 666 },
      commits: [{ author: alice }]
    })
    workflowRun('headsha')
    await runAction()

    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'error', context: 'cla' }
    ])
    expect(repo().listComments(7)).toHaveLength(0)
  })

  it('reports an error from a comment when another open pull request shares the head', async () => {
    repo().setFile('signatures/cla.json', {
      signedContributors: [{ name: 'alice', id: 1001 }]
    })
    repo().addPullRequest({
      number: 9,
      head: { sha: 'headsha', ref: 'copy' },
      user: { login: 'mallory', id: 666 },
      commits: [{ author: alice }]
    })
    setContext({
      issueNumber: 7,
      eventName: 'issue_comment',
      payload: {
        action: 'created',
        issue: { number: 7, pull_request: {} },
        comment: { body: 'recheck', user: alice },
        repository: { id: repo().state.id }
      }
    })
    await runAction()

    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'error', context: 'cla' }
    ])
  })

  it('checks again when a signature lands during the check, so a stale failure is not last', async () => {
    // The file already holds alice's signature, but the first two reads see the older, empty file.
    repo().setFile('signatures/cla.json', {
      signedContributors: [{ name: 'alice', id: 1001 }]
    })
    fake.injectFailure({
      method: 'GET',
      pathPattern: /\/contents\//,
      status: 200,
      body: JSON.stringify({
        sha: 'oldfile',
        content: Buffer.from('{"signedContributors":[]}').toString('base64'),
        encoding: 'base64'
      }),
      headers: { 'content-type': 'application/json' },
      times: 2
    })
    workflowRun('headsha')
    await runAction()

    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'failure', context: 'cla' },
      { sha: 'headsha', state: 'success', context: 'cla' }
    ])
    expect(process.exitCode).toBe(0)
  })

  it('reports a rejected signature write as an error and fails the job', async () => {
    repo().addComment(7, {
      body: 'something **CLA Assistant Lite bot** says',
      user: { login: 'github-actions[bot]', id: 41898282 }
    })
    repo().addComment(7, { body: signPhrase, user: alice })
    fake.injectFailure({
      method: 'PUT',
      pathPattern: /\/contents\//,
      status: 403,
      times: 5
    })
    setContext({
      issueNumber: 7,
      eventName: 'issue_comment',
      payload: {
        action: 'created',
        issue: { number: 7, pull_request: {} },
        comment: { body: signPhrase, user: alice },
        repository: { id: repo().state.id }
      }
    })
    await runAction()

    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'error', context: 'cla' }
    ])
    expect(String(failed.mock.calls[0]?.[0])).toMatch(
      /Could not update the JSON file/
    )
    expect(process.exitCode).toBe(1)
  })

  it('reports an error on the requested head when the pull request lookup fails', async () => {
    fake.injectFailure({
      method: 'GET',
      pathPattern: /\/pulls$/,
      status: 403,
      times: 5
    })
    workflowRun('headsha')
    await runAction()

    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'error', context: 'cla' }
    ])
    expect(failed).toHaveBeenCalled()
  })

  it('checks again when the signatures file version cannot be read', async () => {
    repo().setFile('signatures/cla.json', {
      signedContributors: [{ name: 'alice', id: 1001 }]
    })
    // Both version reads around the first check fail, and that check reads the older, empty file.
    fake.injectFailure({
      method: 'GET',
      pathPattern: /\/contents\//,
      status: 403,
      times: 1
    })
    fake.injectFailure({
      method: 'GET',
      pathPattern: /\/contents\//,
      status: 200,
      body: JSON.stringify({
        sha: 'oldfile',
        content: Buffer.from('{"signedContributors":[]}').toString('base64'),
        encoding: 'base64'
      }),
      headers: { 'content-type': 'application/json' },
      times: 1
    })
    fake.injectFailure({
      method: 'GET',
      pathPattern: /\/contents\//,
      status: 403,
      times: 1
    })
    workflowRun('headsha')
    await runAction()

    expect(repo().state.statuses.map(s => s.state)).toEqual([
      'failure',
      'success'
    ])
  })

  it('stops after one pass when the signatures file cannot be read at all', async () => {
    fake.injectFailure({
      method: 'GET',
      pathPattern: /\/contents\//,
      status: 403,
      times: 100
    })
    workflowRun('headsha')
    await runAction()

    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'error', context: 'cla' }
    ])
  })

  it('reports an unsigned failure after creating a missing signatures file', async () => {
    repo().state.files.delete('signatures/cla.json')
    workflowRun('headsha')
    await runAction()

    expect(repo().state.statuses.map(s => s.state)).toEqual([
      'error',
      'failure'
    ])
    expect(repo().getFile('signatures/cla.json')).toEqual({
      signedContributors: []
    })
  })

  it('fails without head-sha outside comment events', async () => {
    setContext({
      issueNumber: 7,
      eventName: 'pull_request_target',
      payload: { action: 'opened', pull_request: { number: 7 } }
    })
    await runAction()

    expect(String(failed.mock.calls[0]?.[0])).toMatch(/head-sha is required/)
    expect(repo().state.statuses).toEqual([])
  })

  it('rejects head-sha without status-context', async () => {
    setDefaultInputs({ 'status-context': '', 'head-sha': 'headsha' })
    setContext({ eventName: 'workflow_run', payload: {} })
    await runAction()

    expect(String(failed.mock.calls[0]?.[0])).toMatch(
      /head-sha requires status-context/
    )
  })

  it('ignores comments on closed pull requests', async () => {
    repo().state.pulls.get(7)!.state = 'closed'
    setContext({
      issueNumber: 7,
      eventName: 'issue_comment',
      payload: {
        action: 'created',
        issue: { number: 7, pull_request: {} },
        comment: { body: 'recheck', user: alice },
        repository: { id: repo().state.id }
      }
    })
    await runAction()

    expect(repo().state.statuses).toEqual([])
  })

  it('ignores closed pull requests with the head SHA', async () => {
    repo().state.pulls.get(7)!.state = 'closed'
    workflowRun('headsha')
    await runAction()

    expect(repo().state.statuses).toEqual([])
  })

  it('reports an error rather than a result when the head moves mid-check', async () => {
    workflowRun('headsha')
    fake.injectFailure({
      method: 'POST',
      pathPattern: /^\/graphql$/,
      status: 200,
      body: JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              headRefOid: 'newsha',
              commits: {
                totalCount: 0,
                edges: [],
                pageInfo: { endCursor: null, hasNextPage: false }
              }
            }
          }
        }
      }),
      headers: { 'content-type': 'application/json' },
      times: 1
    })
    await runAction()

    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'error', context: 'cla' }
    ])
    expect(String(failed.mock.calls[0]?.[0])).toMatch(/head moved/)
  })

  it('signing by comment records the signature and sets a passing status without a rerun', async () => {
    repo().addComment(7, {
      body: 'something **CLA Assistant Lite bot** says',
      user: { login: 'github-actions[bot]', id: 41898282 }
    })
    repo().addComment(7, {
      body: signPhrase,
      user: alice
    })
    repo().addWorkflow('cla-check', [{ id: 777, conclusion: 'failure' }])
    setContext({
      issueNumber: 7,
      eventName: 'issue_comment',
      payload: {
        action: 'created',
        issue: { number: 7, pull_request: {} },
        comment: { body: signPhrase, user: alice },
        repository: { id: repo().state.id }
      }
    })
    await runAction()

    const file = repo().getFile('signatures/cla.json') as any
    expect(file.signedContributors.map((c: any) => c.id)).toEqual([1001])
    expect(repo().state.statuses).toEqual([
      { sha: 'headsha', state: 'success', context: 'cla' }
    ])
    expect(fake.recordedRerunRequests).toEqual([])
  })

  it('ignores comments on issues', async () => {
    setContext({
      issueNumber: 3,
      eventName: 'issue_comment',
      payload: {
        action: 'created',
        issue: { number: 3 },
        comment: { body: signPhrase, user: alice },
        repository: { id: repo().state.id }
      }
    })
    await runAction()

    expect(repo().state.statuses).toEqual([])
    expect(repo().getFile('signatures/cla.json')).toEqual({
      signedContributors: []
    })
  })
})
