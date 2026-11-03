const checkUpstream = require('../../.github/scripts/check-upstream.cjs')

describe('upstream monitor', () => {
  const context = { repo: { owner: 'openwatersio', repo: 'cla-github-action' } }
  const core = { info: jest.fn() }
  const github = {
    rest: {
      repos: { get: jest.fn(), compareCommitsWithBasehead: jest.fn() },
      issues: { listForRepo: jest.fn(), create: jest.fn() }
    },
    paginate: jest.fn()
  }
  const head = 'a'.repeat(40)
  const marker = `<!-- upstream-monitor:iainmcgin/cla-github-action@${head} -->`

  beforeEach(() => {
    jest.resetAllMocks()
    github.rest.repos.get.mockResolvedValue({
      data: {
        default_branch: 'master',
        parent: {
          owner: { login: 'iainmcgin' },
          name: 'cla-github-action',
          full_name: 'iainmcgin/cla-github-action',
          default_branch: 'master'
        }
      }
    })
    github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
      data: { status: 'diverged', behind_by: 2, base_commit: { sha: head } }
    })
    github.paginate.mockResolvedValue([])
    github.rest.issues.create.mockResolvedValue({
      data: { html_url: 'issue-url' }
    })
  })

  it.each([undefined, { full_name: 'cla-assistant/github-action' }])(
    'fails clearly instead of watching a missing or different parent: %s',
    async parent => {
      github.rest.repos.get.mockResolvedValue({
        data: { default_branch: 'master', parent }
      })
      await expect(checkUpstream({ github, context, core })).rejects.toThrow(
        'Expected iainmcgin/cla-github-action as the fork parent'
      )
      expect(
        github.rest.repos.compareCommitsWithBasehead
      ).not.toHaveBeenCalled()
      expect(github.rest.issues.create).not.toHaveBeenCalled()
    }
  )

  it.each(['ahead', 'identical'])(
    'does not open an issue when the fork is %s',
    async status => {
      github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
        data: { status, behind_by: 0, base_commit: { sha: head } }
      })
      await checkUpstream({ github, context, core })
      expect(github.rest.issues.create).not.toHaveBeenCalled()
      expect(github.paginate).not.toHaveBeenCalled()
    }
  )

  it.each(['behind', 'diverged'])(
    'opens an issue when the fork has %s history',
    async status => {
      github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
        data: { status, behind_by: 2, base_commit: { sha: head } }
      })
      await checkUpstream({ github, context, core })
      expect(github.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith(
        {
          owner: 'iainmcgin',
          repo: 'cla-github-action',
          basehead: 'master...openwatersio:master'
        }
      )
      expect(github.rest.issues.create).toHaveBeenCalledWith({
        ...context.repo,
        title: expect.stringContaining(head.slice(0, 7)),
        body: expect.stringContaining(marker)
      })
      expect(github.rest.issues.create.mock.calls[0][0].body).toContain(
        `/compare/master...iainmcgin:${head}`
      )
    }
  )

  it.each(['open', 'closed'])(
    'does not duplicate an %s issue for the same upstream tip',
    async state => {
      github.paginate.mockResolvedValue([
        { state, body: marker, user: { login: 'github-actions[bot]' } }
      ])
      await checkUpstream({ github, context, core })
      expect(github.paginate).toHaveBeenCalledWith(
        github.rest.issues.listForRepo,
        {
          ...context.repo,
          creator: 'github-actions[bot]',
          state: 'all',
          per_page: 100
        }
      )
      expect(github.rest.issues.create).not.toHaveBeenCalled()
    }
  )

  it('opens a new issue for a new tip even after an older alert was closed', async () => {
    github.paginate.mockResolvedValue([
      {
        state: 'closed',
        body: marker.replace(head, 'b'.repeat(40)),
        user: { login: 'github-actions[bot]' }
      }
    ])
    await checkUpstream({ github, context, core })
    expect(github.rest.issues.create).toHaveBeenCalledTimes(1)
  })

  it('does not let human issues or pull requests suppress an alert', async () => {
    github.paginate.mockResolvedValue([
      { body: marker, user: { login: 'mallory' } },
      { body: marker, user: { login: 'github-actions[bot]' }, pull_request: {} }
    ])
    await checkUpstream({ github, context, core })
    expect(github.rest.issues.create).toHaveBeenCalledTimes(1)
  })

  it('fails visibly on comparison errors without inventing an upstream alert', async () => {
    github.rest.repos.compareCommitsWithBasehead.mockRejectedValue(
      new Error('API unavailable')
    )
    await expect(checkUpstream({ github, context, core })).rejects.toThrow(
      'API unavailable'
    )
    expect(github.rest.issues.create).not.toHaveBeenCalled()
  })
})
