import { Committer } from './interfaces'

import * as input from './shared/getInputs'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isAllowListed(value: string): boolean {
  const allowListPatterns = input.getAllowListItem().split(',')
  return allowListPatterns.some(rawPattern => {
    const pattern = rawPattern.trim()
    if (pattern.includes('*')) {
      const regex = escapeRegExp(pattern).split('\\*').join('.*')
      return new RegExp(`^${regex}$`).test(value)
    }
    return pattern === value
  })
}

export function checkAllowList(committers: Committer[]): Committer[] {
  const seenIds = new Set<number>()
  return committers.filter(committer => {
    // An exempt alias must not hide a non-exempt email for the same account.
    if (
      !committer ||
      isAllowListed(committer.name) ||
      (committer.email && isAllowListed(committer.email))
    )
      return false
    if (!committer.id) return true
    if (seenIds.has(committer.id)) return false
    seenIds.add(committer.id)
    return true
  })
}
