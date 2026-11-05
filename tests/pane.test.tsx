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

test('lists child repos and grouped grandchild repos from one mixed folder', async ($, on) => {
  on('command.register', () => ({ value: { command: 'projects-status' } }))
  on('clock.now', () => ({ value: 1761703600000 }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // A mixed parent: "alpha" is a repo itself, "rails" only groups repos.
  on('fs.list', (_, e) => ({
    value:
      e.path === '/work/code'
        ? [
            { name: 'alpha', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
            { name: 'rails', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
            { name: 'package-lock.json', kind: 'file', size: 9, mtimeMs: 0, isLink: false },
          ]
        : e.path === '/work/code/rails'
          ? [{ name: 'blog', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
          : [],
  }))
  on('fs.exists', (_, e) => ({
    value: e.path === '/work/code/alpha/.git' || e.path === '/work/code/rails/blog/.git',
  }))
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
  expect((await ui.find({ type: 'Text', text: /blog/ }))?.text).toBe('rails/blog')
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
