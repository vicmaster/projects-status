import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'projects-status',
  component: 'Pane',
  requestId: 'projects-status',
  props: {
    title: 'Projects',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const run = (stdout: string) => ({
  value: {
    exitCode: 0,
    stdout,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

test('scans any parent folder of repos and lists each with its status', async ($, on) => {
  on('command.register', () => ({ value: { command: 'projects-status' } }))
  on('clock.now', () => ({ value: 1761703600000 }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({
    value: [
      { name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      { name: 'package-lock.json', kind: 'file', size: 9, mtimeMs: 0, isLink: false },
    ],
  }))
  // The parent itself is not a repo; its child folders are.
  on('fs.exists', (_, e) => ({ value: e.path !== '/work/code/.git' }))
  on('process.run', (_, e) =>
    e.argv.includes('status')
      ? run('# branch.head main\n# branch.ab +2 -0\n1 .M N... 100644 100644 100644 abc abc app.rb\n')
      : run('1761700000\tAdd request parser\n'),
  )

  await $.session.start({
    cwd: '/work/code',
    surface: 'terminal',
    isInteractive: true,
  })
  for (let i = 0; i < 100; i++) await Promise.resolve()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /alpha/ }))?.text).toBe('alpha')
  expect((await ui.find({ type: 'Text', text: /✚/ }))?.text).toBe('✚1')
  expect((await ui.find({ type: 'Text', text: /↑/ }))?.text).toBe('↑2')
  expect((await ui.find({ type: 'Text', text: /parser/ }))?.text).toBe('Add request parser')
  // main/master is noise: the branch shows only when it is something else.
  expect(!(await ui.find({ type: 'Text', text: /main/ }))).toBe(true)
  await ui.unmount()
})

test('does nothing inside a repo or a folder without repos', async ($, on) => {
  let isOpened = false
  on('ui.open', () => {
    isOpened = true

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // A session inside a git repo: the cwd itself has a .git.
  on('fs.exists', (_, e) => ({ value: e.path === '/work/somerepo/.git' }))
  on('fs.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/work/somerepo', surface: 'terminal', isInteractive: true })
  expect(isOpened).toBe(false)

  // A folder with no git children either.
  await $.session.start({ cwd: '/work/empty', surface: 'terminal', isInteractive: true })
  expect(isOpened).toBe(false)
})
