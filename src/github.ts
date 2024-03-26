import { getOctokit } from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'

// Github specific adapters should go here

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class GithubAdapter {
  private octokit: InstanceType<typeof GitHub>

  constructor() {
    this.octokit = getOctokit(process.env.GITHUB_TOKEN as string)
  }
}
