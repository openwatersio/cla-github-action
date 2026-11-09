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
    expect(failed).toHaveBeenCalled()
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
