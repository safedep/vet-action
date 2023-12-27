import * as core from '@actions/core'
import fs from 'node:fs'
import path from 'path'

const exec = require('@actions/exec')
const tc = require('@actions/tool-cache')

interface VetConfig {
  apiKey?: string
  policy?: string
  cloudMode?: boolean
  pullRequestComment?: boolean
}

export class Vet {
  private vetBinaryPath: string

  constructor(private config: VetConfig) {
    this.vetBinaryPath = ''
  }

  // Run vet, generate SARIF report and return the path to the report
  async run(): Promise<string> {
    core.info('Running vet service')
    const vetBinaryUrl = await this.getLatestRelease()

    core.info(`Downloading vet binary from ${vetBinaryUrl}`)
    const vetBinaryPath = await this.downloadBinary(vetBinaryUrl)

    core.info(`Extracting vet binary from ${vetBinaryPath}`)
    const vetBinaryDir = await this.extractBinary(vetBinaryPath)

    const vetBinaryFile = path.join(vetBinaryDir, 'vet')
    core.info(`Running vet binary from ${vetBinaryFile}`)

    this.vetBinaryPath = vetBinaryFile

    const vetBinaryVersion = await this.getVetBinaryVersion()
    core.info(`vet binary version is ${vetBinaryVersion}`)

    const eventJson = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH as string, 'utf8')
    )

    const event = process.env.GITHUB_EVENT_NAME as string
    if (event === 'pull_request') {
      await this.runOnPullRequest()
    } else if (event === 'push') {
      await this.runOnPush()
    } else {
      throw new Error(`Unsupported event type: ${event}`)
    }

    return new Date().toTimeString()
  }

  async verifyVetBinary(): Promise<void> {
    if (!this.vetBinaryPath) {
      throw new Error('vet binary not found')
    }

    const vetBinaryVersion = await this.getVetBinaryVersion()
    core.info(`Vet binary version is ${vetBinaryVersion}`)
  }

  async getVetBinaryVersion(): Promise<string> {
    let output = ''
    const options = {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString()
        }
      },
      silent: true,
      ignoreReturnCode: true
    }

    await exec.exec(this.vetBinaryPath, ['--no-banner', 'version'], options)

    const match = output.match(/Version: ([0-9\.]+)/)
    if (!match || !match[1]) {
      throw new Error('Unable to determine vet binary version')
    }

    return match[1]
  }

  async getLatestRelease(): Promise<string> {
    // const apiUrl = 'https://api.github.com/repos/{owner}/{repo}/releases/latest'
    // const owner = 'safedep'
    // const repo = 'vet'

    // const response = await axios.get(
    //   apiUrl.replace('{owner}', owner).replace('{repo}', repo)
    // )
    // const latestRelease = response.data
    // const latestReleaseArtifact = latestRelease.assets.find(
    //   (asset: any) => asset.name === 'vet_Linux_x86_64.tar.gz'
    // )

    // if (!latestReleaseArtifact) {
    //   throw new Error('No usable artifact found for latest release')
    // }

    // return latestReleaseArtifact.browser_download_url

    return 'https://github.com/safedep/vet/releases/download/v1.5.0/vet_Linux_x86_64.tar.gz'
  }

  async runOnPush(): Promise<void> {}

  async runOnPullRequest(): Promise<void> {}

  async downloadBinary(url: string): Promise<string> {
    return tc.downloadTool(url)
  }

  async extractBinary(tgzPath: string): Promise<string> {
    return tc.extractTar(tgzPath)
  }
}
