module.exports = async function checkUpstream({ github, context, core }) {
  const { data: fork } = await github.rest.repos.get(context.repo)
  const upstream = fork.parent
  if (upstream?.full_name !== 'iainmcgin/cla-github-action') {
    throw new Error(
      'Expected iainmcgin/cla-github-action as the fork parent; verify the fork relationship before changing the monitor.'
    )
  }
  const { data: comparison } =
    await github.rest.repos.compareCommitsWithBasehead({
      owner: upstream.owner.login,
      repo: upstream.name,
      basehead: `${upstream.default_branch}...${context.repo.owner}:${fork.default_branch}`
    })

  if (['ahead', 'identical'].includes(comparison.status)) {
    core.info('The fork contains all upstream commits.')
    return
  }
  if (!['behind', 'diverged'].includes(comparison.status)) {
    throw new Error(`Unexpected comparison status: ${comparison.status}`)
  }

  const head = comparison.base_commit.sha
  const marker = `<!-- upstream-monitor:${upstream.full_name}@${head} -->`
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...context.repo,
    creator: 'github-actions[bot]',
    state: 'all',
    per_page: 100
  })
  if (
    issues.some(
      issue =>
        !issue.pull_request &&
        issue.user?.login === 'github-actions[bot]' &&
        issue.body?.includes(marker)
    )
  ) {
    core.info(`Upstream commit ${head} already has a tracking issue.`)
    return
  }

  const { data: issue } = await github.rest.issues.create({
    ...context.repo,
    title: `Review upstream CLA action changes (${head.slice(0, 7)})`,
    body: [
      `\`${upstream.full_name}:${upstream.default_branch}\` has ${comparison.behind_by} commit(s) missing from this fork's \`${fork.default_branch}\` history.`,
      `Upstream tip: [${head}](https://github.com/${upstream.full_name}/commit/${head}).`,
      `[Compare changes](https://github.com/${context.repo.owner}/${context.repo.repo}/compare/${fork.default_branch}...${upstream.owner.login}:${head}).`,
      'Review and bring in applicable changes. Record adopted changes in `CHANGELOG.md`, rebuild `dist/` when runtime code or dependencies change, and update pinned consumers after validation.',
      'Closing this issue acknowledges this upstream tip. A later tip gets its own issue.',
      marker
    ].join('\n\n')
  })
  core.info(`Opened ${issue.html_url}`)
}
