import { getOctokit } from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
import path from 'path'

// Github specific adapters should go here

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class GithubAdapter {
  private octokit: InstanceType<typeof GitHub>

  constructor() {
    this.octokit = getOctokit(process.env.GITHUB_TOKEN as string)
  }
}

export function getTempFilePath(): string {
  const tempDir = process.env.RUNNER_TEMP as string
  return path.join(tempDir, `vet-tmp-${Math.random().toString(36)}`)
}

export function isGithubRunnerDebug(): boolean {
  return (process.env.RUNNER_DEBUG ?? 'false') !== 'false'
}
