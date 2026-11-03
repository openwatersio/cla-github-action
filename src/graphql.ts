import { octokit } from './octokit'
import { context } from '@actions/github'
import { Committer } from './interfaces'
import { errorMessage } from './shared/errors'

interface GraphQLUser {
  id?: string
  databaseId?: number
  login?: string
}
interface GraphQLActor {
  email?: string
  name?: string
  login?: string
  databaseId?: number
  user?: GraphQLUser | null
}
interface GraphQLCommit {
  authors: {
    nodes: Array<GraphQLActor | null>
    pageInfo: { hasNextPage: boolean }
  }
}
interface GraphQLEdge {
  node: { commit: GraphQLCommit }
  cursor: string
}
interface GraphQLResponse {
  repository: {
    pullRequest: {
      commits: {
        totalCount: number
        edges: GraphQLEdge[]
        pageInfo: { endCursor: string | null; hasNextPage: boolean }
      }
    }
  }
}

const GITHUB_ACTIONS_BOT_ID = 41898282
const COMMITS_QUERY = `
query($owner:String! $name:String! $number:Int! $cursor:String){
    repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
            commits(first: 100, after: $cursor) {
                totalCount
                edges {
                    node {
                        commit {
                            authors(first: 100) {
                                nodes {
                                    email
                                    name
                                    user { databaseId login }
                                }
                                pageInfo { hasNextPage }
                            }
                        }
                    }
                    cursor
                }
                pageInfo { endCursor hasNextPage }
            }
        }
    }
}`

export default async function getCommitters(): Promise<Committer[]> {
  try {
    const seenKeys = new Set<string>()
    const committers: Committer[] = []

    function addCommitter(c: Committer): void {
      const key = `${c.id}:${c.email ?? ''}:${c.name}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        committers.push(c)
      }
    }

    let cursor: string | null = null
    let hasNextPage = true

    while (hasNextPage) {
      const response = (await octokit.graphql(COMMITS_QUERY, {
        owner: context.repo.owner,
        name: context.repo.repo,
        number: context.issue.number,
        cursor
      })) as GraphQLResponse

      const page = response.repository.pullRequest.commits
      for (const edge of page.edges) {
        const commit = edge.node.commit
        // shortcut: fail closed above 100 authors per commit; paginate if larger commits are needed.
        if (commit.authors.pageInfo.hasNextPage) {
          throw new Error(
            'Commit has more than 100 authors; split it before CLA validation'
          )
        }
        // GitHub resolves account IDs for primary authors and co-authors, including legacy and verified emails.
        for (const actor of commit.authors.nodes) {
          if (!actor)
            throw new Error('GitHub returned an unreadable commit author')
          const user = actor.user
          addCommitter({
            name: user?.login || actor.name || actor.email || '',
            id: user?.databaseId || 0,
            pullRequestNo: context.issue.number,
            email: actor.email
          })
        }
      }
      cursor = page.pageInfo.endCursor
      hasNextPage = page.pageInfo.hasNextPage
    }

    return committers.filter(c => c.id !== GITHUB_ACTIONS_BOT_ID)
  } catch (e) {
    throw new Error(
      `graphql call to get the committers details failed: ${errorMessage(e)}`
    )
  }
}
