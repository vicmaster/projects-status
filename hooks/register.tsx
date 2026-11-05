import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ProjectStatus, Snapshot } from '../types'

const PANE = 'projects-status'
const SCAN_EVERY_MS = 5 * 60 * 1000
const BATCH = 8

// The session's directory when it is a parent of git repos (not one itself);
// set by session.start, which runs again on every reload.
let root: string | null = null

const empty: Snapshot = { scannedAt: 0, isScanning: false, projects: [] }
const snapshot = atom({ plugin: 'projects-status', key: 'snapshot' } as const, empty, {
  shape: 'snapshot-1',
})

const git = async ($: EngineInterface, dir: string, args: string[]) => {
  const { exitCode, stdout } = await $.process.run(['git', '-C', dir, ...args], {
    timeoutMs: 15000,
  })

  return exitCode === 0 ? stdout : null
}

const isCandidate = (entry: { kind: string; name: string }) =>
  entry.kind === 'dir' && !entry.name.startsWith('.') && entry.name !== 'node_modules'

// Repos among the children, and among the grandchildren of children that are
// not repos themselves (a grouping folder like "rails" or "clientX"), named
// "group/repo". Both depths work at once, so flat and grouped structures mix.
const findRepos = async ($: EngineInterface, dir: string) => {
  const entries = await $.fs.list(dir)
  const repos: string[] = []
  for (const entry of entries) {
    if (!isCandidate(entry)) continue
    if (await $.fs.exists(`${dir}/${entry.name}/.git`)) {
      repos.push(entry.name)
      continue
    }

    const children = await $.fs.list(`${dir}/${entry.name}`).catch(() => [])
    for (const child of children) {
      if (!isCandidate(child)) continue
      if (await $.fs.exists(`${dir}/${entry.name}/${child.name}/.git`)) {
        repos.push(`${entry.name}/${child.name}`)
      }
    }
  }

  return repos
}

const statusOf = async ($: EngineInterface, parent: string, name: string): Promise<ProjectStatus> => {
  const dir = `${parent}/${name}`
  const none = { name, branch: '?', ahead: 0, behind: 0, dirty: 0, lastCommitAt: 0, subject: '' }
  const status = await git($, dir, ['status', '--porcelain=v2', '--branch']).catch(() => null)
  if (status === null) return { ...none, error: 'git status failed' }

  let branch = '?'
  let ahead = 0
  let behind = 0
  let dirty = 0
  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length)
    else if (line.startsWith('# branch.ab ')) {
      const counts = line.match(/\+(\d+) -(\d+)/)
      if (counts) {
        ahead = Number(counts[1])
        behind = Number(counts[2])
      }
    } else if (line !== '' && !line.startsWith('#')) dirty += 1
  }

  const log = await git($, dir, ['log', '-1', '--format=%ct\t%s']).catch(() => null)
  const [epoch, ...subjectParts] = (log ?? '').trim().split('\t')
  const lastCommitAt = epoch && /^\d+$/.test(epoch) ? Number(epoch) * 1000 : 0

  return { name, branch, ahead, behind, dirty, lastCommitAt, subject: subjectParts.join('\t') }
}

const scan = async ($: EngineInterface) => {
  if (root === null) return
  const parent = root
  const current = await read($, snapshot)
  if (current.isScanning) return
  await update($, snapshot, s => ({ ...s, isScanning: true }))

  try {
    const repos = await findRepos($, parent)

    const projects: ProjectStatus[] = []
    for (let i = 0; i < repos.length; i += BATCH) {
      const part = await Promise.all(
        repos.slice(i, i + BATCH).map(name => statusOf($, parent, name)),
      )
      projects.push(...part)
    }
    projects.sort((a, b) => b.lastCommitAt - a.lastCommitAt)

    const now = await $.clock.now()
    await update($, snapshot, () => ({ scannedAt: now, isScanning: false, projects }))
  } catch {
    await update($, snapshot, s => ({ ...s, isScanning: false }))
  }
}

const ago = (deltaMs: number) => {
  if (deltaMs < 0) deltaMs = 0
  const minutes = Math.floor(deltaMs / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`

  return `${Math.floor(days / 30)}mo`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = null
    const isRepoItself = await $.fs.exists(`${e.cwd}/.git`).catch(() => false)
    if (isRepoItself) return next(e)

    const repos = await findRepos($, e.cwd).catch(() => [])
    if (repos.length === 0) return next(e)

    root = e.cwd
    await $.command.register({
      name: 'projects-status',
      description: 'Rescan and show the git status of every project in this folder',
    })
    void $.ui.open({ id: PANE, title: 'Projects' })
    void scan($)
    $.clock.every(SCAN_EVERY_MS, () => scan($))

    return next(e)
  })

  on('command.run', { command: 'projects-status' }, async $ => {
    if (root === null) {
      return { text: 'This session is not in a folder of git repos; nothing to show.' }
    }
    await $.ui.open({ id: PANE, title: 'Projects' })
    void scan($)

    return { text: 'Projects pane opened; rescanning.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const now = await $.clock.now()
    const isTerminal = e.surface === 'terminal'
    const rows = isTerminal
      ? snap.projects.slice(0, Math.max(1, (e.viewport?.rows ?? 24) - 4))
      : snap.projects
    const dirtyCount = snap.projects.filter(project => project.dirty > 0).length
    const scannedAgo = ago(now - snap.scannedAt)

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between" alignItems="center" marginBottom={1} gap={1}>
          <Text dimColor size="caption">
            {snap.scannedAt === 0
              ? 'Not scanned yet'
              : `${snap.projects.length} repos · ${dirtyCount} with changes · ` +
                (scannedAgo === 'now' ? 'updated just now' : `updated ${scannedAgo} ago`)}
          </Text>
          <Button onPress={() => void scan($)}>
            {snap.isScanning ? 'Scanning…' : 'Refresh'}
          </Button>
        </Box>
        {snap.projects.length === 0 && (
          <Text dimColor>{snap.isScanning ? 'Scanning ~/Projects…' : 'No git repos found.'}</Text>
        )}
        {rows.map(project => {
          const isStale =
            project.lastCommitAt === 0 || now - project.lastCommitAt > 30 * 24 * 3600 * 1000
          const isOddBranch = project.branch !== 'main' && project.branch !== 'master'
          const slash = project.name.indexOf('/')
          const group = slash > 0 ? project.name.slice(0, slash + 1) : null
          const shortName = slash > 0 ? project.name.slice(slash + 1) : project.name

          return (
            <Box key={project.name} gap={1} alignItems="center">
              <Text
                color={project.dirty > 0 ? 'yellow' : isStale ? undefined : 'green'}
                dimColor={isStale && project.dirty === 0}
              >
                ●
              </Text>
              <Box width={22} flexShrink={0}>
                <Text weight="medium" dimColor={isStale} wrap="truncate">
                  {group !== null && (
                    <Text weight="regular" dimColor>
                      {group}
                    </Text>
                  )}
                  {shortName}
                </Text>
              </Box>
              {(isOddBranch || project.dirty > 0 || project.ahead > 0 || project.behind > 0) && (
                <Box flexShrink={0} gap={1}>
                  {isOddBranch && (
                    <Text dimColor italic wrap="truncate">
                      {project.branch}
                    </Text>
                  )}
                  {project.dirty > 0 && <Text color="yellow">✚{project.dirty}</Text>}
                  {project.ahead > 0 && <Text color="cyan">↑{project.ahead}</Text>}
                  {project.behind > 0 && <Text color="magenta">↓{project.behind}</Text>}
                </Box>
              )}
              <Box flexGrow={1} flexShrink={1}>
                {project.error !== undefined ? (
                  <Text color="red" wrap="truncate">
                    {project.error}
                  </Text>
                ) : (
                  <Text dimColor wrap="truncate">
                    {project.subject}
                  </Text>
                )}
              </Box>
              <Box flexShrink={0}>
                <Text dimColor size="caption" tabular>
                  {project.lastCommitAt > 0 ? ago(now - project.lastCommitAt) : '—'}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
