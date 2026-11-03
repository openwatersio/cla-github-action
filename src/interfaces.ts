/**
 * A committer of a pull request, derived from the GitHub GraphQL API.
 * The minimal identity used for allow-list checks and signature lookup.
 */
export interface Committer {
  name: string
  id: number
  pullRequestNo?: number | undefined
  /** Retained for email exemptions and unlinked-author guidance. */
  email?: string | undefined
}

/**
 * A PR comment that matches the configured "sign phrase". Carries the
 * commenter identity (same shape as Committer) plus the comment metadata
 * needed to persist it. Field types line up with Signature so a
 * SigningComment is directly assignable to Signature.
 */
export interface SigningComment extends Committer {
  comment_id?: number | undefined
  body?: string | undefined
  created_at?: string | undefined
  repoId?: number | undefined
}

export interface CommitterMap {
  signed: Committer[]
  notSigned: Committer[]
  unknown: Committer[]
  /**
   * Populated when the PR opener is not listed as an author or co-author of
   * any commit in the PR. The bot comment renders a CAUTION block naming the
   * opener and the actual commit authors so maintainers can see the
   * mismatch at a glance.
   */
  openerMismatch?:
    | {
        opener: string
        commitAuthors: string[]
        hardFail: boolean
      }
    | undefined
}

export interface ReactedCommitterMap {
  newSigned: SigningComment[]
  onlyCommitters?: Committer[] | undefined
  allSignedFlag: boolean
}

/** Shape of a single record in the signatures JSON file. */
export interface Signature {
  name: string
  id: number
  comment_id?: number | undefined
  created_at?: string | undefined
  repoId?: number | undefined
  pullRequestNo?: number | undefined
}

/** Shape of the signatures JSON file on disk. */
export interface ClaFileContent {
  signedContributors: Signature[]
}

export interface ClafileContentAndSha {
  claFileContent: ClaFileContent
  sha: string
}
