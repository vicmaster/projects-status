export type ProjectStatus = {
  name: string
  branch: string
  ahead: number
  behind: number
  dirty: number
  lastCommitAt: number
  subject: string
  error?: string
}

export type Snapshot = {
  scannedAt: number
  isScanning: boolean
  projects: ProjectStatus[]
}

declare module 'claude-code' {
  interface PluginState {
    'projects-status': { snapshot: Shaped<Snapshot> }
  }
}
