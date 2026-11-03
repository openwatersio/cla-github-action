import { resetEnv, setInput } from '../testHelpers/env'
import { checkAllowList } from '../../src/checkAllowList'
import { Committer } from '../../src/interfaces'

function committer(name: string, email?: string): Committer {
  return { name, id: 0, pullRequestNo: 1, ...(email ? { email } : {}) }
}

describe('checkAllowList', () => {
  afterEach(resetEnv)

  it('does not exempt human identities through a wildcard substring', () => {
    setInput('allowlist', 'bot*,*[bot]')
    expect(
      checkAllowList([
        { name: 'robotdev', id: 1001 },
        { name: 'jane', id: 2002, email: 'x[bot]@evil.example' }
      ]).map(item => item.id)
    ).toEqual([1001, 2002])
  })

  it('requires one signature per account after applying email exemptions', () => {
    setInput('allowlist', '')
    expect(
      checkAllowList([
        { name: 'alice', id: 1001, email: 'alice@work.example' },
        {
          name: 'alice',
          id: 1001,
          email: '1001+alice@users.noreply.github.com'
        }
      ]).map(item => item.id)
    ).toEqual([1001])
  })

  it.each([false, true])(
    'keeps a non-exempt identity even when another email for the account is exempt: reversed=%s',
    reverse => {
      setInput('allowlist', 'robot@example.com')
      const records = [
        { name: 'alice', id: 1001, email: 'robot@example.com' },
        { name: 'alice', id: 1001, email: 'alice@work.example' }
      ]
      expect(
        checkAllowList(reverse ? records.reverse() : records).map(
          item => item.email
        )
      ).toEqual(['alice@work.example'])
    }
  )

  it('does not merge different unlinked authors under ID zero', () => {
    setInput('allowlist', '')
    expect(
      checkAllowList([
        committer('Alice', 'alice@example.com'),
        committer('Bob', 'bob@example.com')
      ]).map(item => item.name)
    ).toEqual(['Alice', 'Bob'])
  })

  it('filters out committers whose login matches an exact allow-list entry', () => {
    setInput('allowlist', 'alice,bob')
    const result = checkAllowList([committer('alice'), committer('carol')])
    expect(result.map(c => c.name)).toEqual(['carol'])
  })

  it('filters out committers matching a glob pattern', () => {
    setInput('allowlist', '*[bot]')
    const result = checkAllowList([
      committer('dependabot[bot]'),
      committer('renovate[bot]'),
      committer('alice')
    ])
    expect(result.map(c => c.name)).toEqual(['alice'])
  })

  it('supports a prefix glob', () => {
    setInput('allowlist', 'acme-*')
    const result = checkAllowList([
      committer('acme-bot'),
      committer('acme-svc'),
      committer('widgets-bot')
    ])
    expect(result.map(c => c.name)).toEqual(['widgets-bot'])
  })

  it('treats regex metacharacters in patterns as literal', () => {
    setInput('allowlist', 'user.name+tag')
    expect(
      checkAllowList([
        committer('user.name+tag'),
        committer('userXnameYtag')
      ]).map(c => c.name)
    ).toEqual(['userXnameYtag'])
  })

  it('trims whitespace around comma-separated entries', () => {
    setInput('allowlist', ' alice , bob ')
    expect(
      checkAllowList([
        committer('alice'),
        committer('bob'),
        committer('carol')
      ]).map(c => c.name)
    ).toEqual(['carol'])
  })

  it('returns an empty list when every committer is allow-listed', () => {
    setInput('allowlist', 'alice,bob')
    expect(checkAllowList([committer('alice'), committer('bob')])).toEqual([])
  })

  it('returns the full list when the allow-list does not match anyone', () => {
    setInput('allowlist', 'zack')
    const committers = [committer('alice'), committer('bob')]
    expect(checkAllowList(committers)).toEqual(committers)
  })

  it('skips null/undefined committers', () => {
    setInput('allowlist', '')
    const result = checkAllowList([
      committer('alice'),
      null as unknown as Committer,
      undefined as unknown as Committer
    ])
    expect(result.map(c => c.name)).toEqual(['alice'])
  })

  it('with an empty allow-list input still filters out committers matching the literal empty pattern only if login is exactly empty', () => {
    setInput('allowlist', '')
    expect(
      checkAllowList([committer(''), committer('alice')]).map(c => c.name)
    ).toEqual(['alice'])
  })

  it('filters out committers whose email matches an exact allow-list entry', () => {
    setInput('allowlist', 'noreply@anthropic.com')
    const result = checkAllowList([
      committer('Claude Opus 4.7', 'noreply@anthropic.com'),
      committer('alice', 'alice@example.com')
    ])
    expect(result.map(c => c.name)).toEqual(['alice'])
  })

  it('filters out committers whose email matches a glob entry', () => {
    setInput('allowlist', '*@anthropic.com')
    const result = checkAllowList([
      committer('Claude Opus 4.7', 'noreply@anthropic.com'),
      committer('Claude Sonnet', 'assistant@anthropic.com'),
      committer('alice', 'alice@example.com')
    ])
    expect(result.map(c => c.name)).toEqual(['alice'])
  })

  it('still filters by name when only the name matches the allow-list', () => {
    setInput('allowlist', 'iainmcgin')
    const result = checkAllowList([
      committer('iainmcgin', 'iain@example.com'),
      committer('alice', 'alice@example.com')
    ])
    expect(result.map(c => c.name)).toEqual(['alice'])
  })

  it('does not match committers without an email against an email allow-list entry', () => {
    setInput('allowlist', 'noreply@anthropic.com')
    const result = checkAllowList([
      committer('alice'),
      committer('bob', 'bob@example.com')
    ])
    expect(result.map(c => c.name)).toEqual(['alice', 'bob'])
  })
})
