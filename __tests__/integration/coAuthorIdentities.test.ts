import * as core from '@actions/core'
import { installFakeGitHub, FakeGitHub } from '../testHelpers/fakeGithub'
import { resetEnv, setDefaultInputs, setInput } from '../testHelpers/env'
import { reloadOctokit, setContext } from '../testHelpers/context'

async function runAction() {
  reloadOctokit()
  for (const path of Object.keys(require.cache)) {
    if (path.includes('/src/')) delete require.cache[path]
  }
  await (require('../../src/main') as typeof import('../../src/main')).run()
}

describe('GitHub-resolved co-author identities', () => {
  let fake: FakeGitHub
  let failed: jest.SpyInstance
  const alice = { name: 'alice', id: 1001 }
  const bob = { name: 'bob', id: 2002 }

  beforeEach(() => {
    setDefaultInputs({ 'path-to-signatures': '.cla.json' })
    fake = installFakeGitHub()
    failed = jest.spyOn(core, 'setFailed').mockImplementation(() => {})
    setContext({
      payload: {
        action: 'opened',
        pull_request: { user: { login: 'alice', id: 1001 } }
      }
    })
  })
  afterEach(async () => {
    await fake.close()
    resetEnv()
    jest.restoreAllMocks()
  })

  it.each([
    '2002+bob@users.noreply.github.com',
    'bob@users.noreply.github.com',
    'bob@example.com'
  ])('recognizes an existing signature for %s', async email => {
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [
        {
          author: { login: 'alice', id: 1001 },
          coAuthors: [{ login: 'bob', id: 2002, email }],
          message: `Fix\n\nCo-authored-by: Bob <${email}>`
        }
      ]
    })
    repo.setFile('.cla.json', { signedContributors: [alice, bob] })
    await runAction()
    expect(failed).not.toHaveBeenCalled()
    expect(repo.listComments(42)[0]!.body).toMatch(
      /all contributors have signed/i
    )
  })

  it('records a legacy-address co-author under the resolved numeric ID using the same-repo storage token', async () => {
    setInput('remote-organization-name', 'acme')
    setInput('remote-repository-name', 'widgets')
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [
        {
          author: { login: 'alice', id: 1001 },
          coAuthors: [
            { login: 'bob', id: 2002, email: 'bob@users.noreply.github.com' }
          ],
          message: 'Fix\n\nCo-authored-by: Bob <bob@users.noreply.github.com>'
        }
      ]
    })
    repo.setFile('.cla.json', { signedContributors: [alice] })
    repo.addComment(42, {
      body: '**CLA Assistant Lite bot**: please sign',
      user: { login: 'github-actions[bot]', id: 41898282 }
    })
    repo.addComment(42, {
      body: 'I have read the CLA Document and I hereby sign the CLA',
      user: { login: 'bob', id: 2002 }
    })
    repo.addWorkflow('cla-check', [])
    setContext({
      eventName: 'issue_comment',
      actor: 'bob',
      payload: { action: 'created', issue: { number: 42, pull_request: {} } }
    })
    await runAction()
    expect(failed).not.toHaveBeenCalled()
    expect(
      (
        repo.getFile('.cla.json') as {
          signedContributors: Array<{ id: number }>
        }
      ).signedContributors.map(item => item.id)
    ).toEqual([1001, 2002])
  })

  it('does not trust a numeric identity supplied in a trailer over GitHub identity resolution', async () => {
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [
        {
          author: { login: 'alice', id: 1001 },
          coAuthors: [
            {
              login: 'bob',
              id: 2002,
              email: '999+bob@users.noreply.github.com'
            }
          ],
          message:
            'Fix\n\nCo-authored-by: Bob <999+bob@users.noreply.github.com>'
        }
      ]
    })
    repo.setFile('.cla.json', {
      signedContributors: [alice, { name: 'someone-else', id: 999 }]
    })
    await runAction()
    expect(failed).toHaveBeenCalled()
    expect(repo.listComments(42)[0]!.body).toContain(':x: @bob')
  })

  it('exempts a Claude co-author even when GitHub resolves its email to an account', async () => {
    setInput('allowlist', '*[bot],noreply@anthropic.com')
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [
        {
          author: { login: 'alice', id: 1001 },
          coAuthors: [
            { login: 'claude', id: 81847, email: 'noreply@anthropic.com' }
          ],
          message: 'Fix\n\nCo-authored-by: Claude <noreply@anthropic.com>'
        }
      ]
    })
    repo.setFile('.cla.json', { signedContributors: [alice] })
    await runAction()
    expect(failed).not.toHaveBeenCalled()
  })

  it('requires the authenticated opener to sign even if their co-author email is exempt', async () => {
    setInput('allowlist', '*[bot],noreply@anthropic.com')
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [
        {
          author: { login: 'alice', id: 1001 },
          coAuthors: [
            { login: 'claude', id: 81847, email: 'noreply@anthropic.com' }
          ]
        }
      ]
    })
    repo.setFile('.cla.json', { signedContributors: [alice] })
    setContext({
      payload: {
        action: 'opened',
        pull_request: { user: { login: 'claude', id: 81847 } }
      }
    })
    await runAction()
    expect(failed).toHaveBeenCalled()
    expect(repo.listComments(42)[0]!.body).toContain(':x: @claude')
  })

  it('keeps the authorship guard and output for an allowlisted bot opener', async () => {
    const output = jest.spyOn(core, 'setOutput').mockImplementation(() => {})
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [{ author: { login: 'bob', id: 2002 } }]
    })
    repo.setFile('.cla.json', { signedContributors: [bob] })
    setContext({
      payload: {
        action: 'opened',
        pull_request: {
          user: { login: 'github-actions[bot]', id: 41898282, type: 'Bot' }
        }
      }
    })
    await runAction()
    expect(failed).toHaveBeenCalledWith(
      expect.stringContaining('not recorded as an author')
    )
    expect(output).toHaveBeenCalledWith('opener_not_in_commits', true)
    expect(repo.listComments(42)[0]!.body).not.toContain(
      ':x: @github-actions[bot]'
    )
  })

  it('keeps the authorship guard for an allowlisted human opener', async () => {
    setInput('allowlist', 'alice')
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [{ author: { login: 'bob', id: 2002 } }]
    })
    repo.setFile('.cla.json', { signedContributors: [bob] })
    await runAction()
    expect(failed).toHaveBeenCalledWith(
      expect.stringContaining('not recorded as an author')
    )
  })

  it('checks exactly 100 authors without rejecting a complete page', async () => {
    const coAuthors = Array.from({ length: 99 }, (_, i) => ({
      login: `person${i}`,
      id: 3000 + i
    }))
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [{ author: { login: 'alice', id: 1001 }, coAuthors }]
    })
    repo.setFile('.cla.json', {
      signedContributors: [
        alice,
        ...coAuthors.map(item => ({ name: item.login, id: item.id }))
      ]
    })
    await runAction()
    expect(failed).not.toHaveBeenCalled()
  })

  it('shows one pending signature for the same account using multiple email addresses', async () => {
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [
        {
          author: { login: 'alice', id: 1001, email: 'alice@work.example' },
          coAuthors: [
            {
              login: 'alice',
              id: 1001,
              email: '1001+alice@users.noreply.github.com'
            },
            { login: 'bob', id: 2002 }
          ]
        }
      ]
    })
    repo.setFile('.cla.json', { signedContributors: [bob] })
    await runAction()
    expect(failed).toHaveBeenCalled()
    expect(repo.listComments(42)[0]!.body.match(/:x: @alice/g)).toHaveLength(1)
  })

  it('fails closed when GitHub redacts an author entry', async () => {
    fake.injectFailure({
      method: 'POST',
      pathPattern: /graphql/,
      status: 200,
      times: 1,
      body: JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              commits: {
                totalCount: 1,
                edges: [
                  {
                    node: {
                      commit: {
                        authors: {
                          nodes: [null],
                          pageInfo: { hasNextPage: false }
                        }
                      }
                    }
                  }
                ],
                pageInfo: { endCursor: null, hasNextPage: false }
              }
            }
          }
        }
      })
    })
    await runAction()
    expect(failed).toHaveBeenCalledWith(
      expect.stringContaining('unreadable commit author')
    )
  })

  it('fails closed when GitHub has more authors than the checked page', async () => {
    const coAuthors = Array.from({ length: 100 }, (_, i) => ({
      login: `person${i}`,
      id: 3000 + i,
      email: `${3000 + i}+person${i}@users.noreply.github.com`
    }))
    const repo = fake.repo('acme', 'widgets')
    repo.addPullRequest({
      number: 42,
      head: { sha: 'head', ref: 'feature' },
      commits: [
        {
          author: { login: 'alice', id: 1001 },
          coAuthors,
          message: `Fix\n\n${coAuthors.map(item => `Co-authored-by: ${item.login} <${item.email}>`).join('\n')}`
        }
      ]
    })
    repo.setFile('.cla.json', {
      signedContributors: [
        alice,
        ...coAuthors.map(item => ({ name: item.login, id: item.id }))
      ]
    })
    await runAction()
    expect(failed).toHaveBeenCalledWith(
      expect.stringContaining('more than 100 authors')
    )
  })
})
