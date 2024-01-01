import * as core from '@actions/core'
import { getOctokit } from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
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

interface PullRequestFile {
  sha: string
  filename: string
  blob_url: string
  raw_url: string
  contents_url: string
}

export class Vet {
  private vetBinaryPath: string
  private octokit: InstanceType<typeof GitHub>

  constructor(private config: VetConfig) {
    this.vetBinaryPath = ''
    this.octokit = getOctokit(process.env.GITHUB_TOKEN as string)
  }

  // Run vet, generate SARIF report and return the path to the report if
  // applicable. If the report is not applicable, return an empty string.
  async run(eventType: string, event: string): Promise<string> {
    core.info('Running vet service')
    const vetBinaryUrl = await this.getLatestRelease()

    core.info(`Downloading vet binary from ${vetBinaryUrl}`)
    const vetBinaryPath = await this.downloadBinary(vetBinaryUrl)

    core.info(`Extracting vet binary from ${vetBinaryPath}`)
    const vetBinaryDir = await this.extractBinary(vetBinaryPath)

    const vetBinaryFile = path.join(vetBinaryDir, 'vet')
    core.info(`Running vet binary from ${vetBinaryFile}`)

    this.vetBinaryPath = vetBinaryFile
    await this.verifyVetBinary()

    if (this.config.apiKey) {
      core.info('Using an API key')
      process.env.VET_API_KEY = this.config.apiKey
    } else {
      core.info('Using community mode for API access')
      process.env.VET_COMMUNITY_MODE = 'true'
    }

    if (eventType === 'push') {
      this.runOnPush()
    } else if (eventType === 'schedule') {
      this.runOnSchedule()
    } else if (eventType === 'pull_request') {
      this.runOnPullRequest()
    } else {
      throw new Error(`Unsupported event type: ${eventType}`)
    }

    return new Date().toTimeString()
  }

  private async runOnPush(): Promise<void> {
    core.info('Running on push event')
  }

  private async runOnPullRequest(): Promise<void> {
    core.info('Running on pull request event')

    // Find changed files
    const changedFiles = await this.pullRequestGetChangedFiles()
    core.info(`Found ${changedFiles.length} changed files`)

    // Filter by lockfiles
    const changedLockFiles = changedFiles.filter(file =>
      this.isSupportedLockfile(file.filename)
    )

    core.info(`Found ${changedLockFiles.length} supported lockfiles`)

    // Generate exceptions using original files
    // Run vet on changed files with exceptions
  }

  private async runOnSchedule(): Promise<void> {
    core.info('Running on schedule event')
  }

  private async verifyVetBinary(): Promise<void> {
    if (!this.vetBinaryPath) {
      throw new Error('vet binary not found')
    }

    const vetBinaryVersion = await this.getVetBinaryVersion()
    core.info(`vet binary version is ${vetBinaryVersion}`)
  }

  private async getVetBinaryVersion(): Promise<string> {
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

  private async getLatestRelease(): Promise<string> {
    return 'https://github.com/safedep/vet/releases/download/v1.5.5/vet_Linux_x86_64.tar.gz'
  }

  private async downloadBinary(url: string): Promise<string> {
    return tc.downloadTool(url)
  }

  private async extractBinary(tgzPath: string): Promise<string> {
    return tc.extractTar(tgzPath)
  }

  // Checkout the file from the given ref into a temporary file
  // and return the path to the temporary file
  private async pullRequestCheckoutFileByPath(
    ref: string,
    filePath: string
  ): Promise<string> {
    const response = await this.octokit.rest.repos.getContent({
      repo: this.repoName(),
      owner: this.ownerName(),
      path: filePath,
      ref
    })

    if (response.status !== 200) {
      throw new Error(
        `Unable to get file: ${filePath}@${ref}: ${response.status}`
      )
    }

    if (!response.data) {
      throw new Error('No file contents found in response')
    }

    const tempFile = this.tempFilePath()
    fs.writeFileSync(tempFile, response.data as any, { encoding: 'base64' })

    return tempFile
  }

  private async pullRequestGetChangedFiles(): Promise<PullRequestFile[]> {
    const response = await this.octokit.rest.repos.compareCommits({
      base: this.pullRequestBaseRef(),
      head: this.pullRequestHeadRef(),
      repo: this.repoName(),
      owner: this.ownerName()
    })

    if (response.status !== 200) {
      throw new Error(`Unable to get changed files: ${response.status}`)
    }

    if (response.data.status !== 'ahead') {
      throw new Error(`Head is not ahead of Base: ${response.data.status}`)
    }

    if (!response.data.files) {
      throw new Error('No files found in response')
    }

    return response.data.files.map(file => {
      return {
        sha: file.sha,
        filename: file.filename,
        blob_url: file.blob_url,
        raw_url: file.raw_url,
        contents_url: file.contents_url
      }
    })
  }

  private ownerName(): string {
    return process.env.GITHUB_REPOSITORY_OWNER as string
  }

  private repoName(): string {
    const repo = process.env.GITHUB_REPOSITORY as string
    return repo.split('/')[1]
  }

  private pullRequestBaseRef(): string {
    return process.env.GITHUB_BASE_REF as string
  }

  private pullRequestHeadRef(): string {
    return process.env.GITHUB_HEAD_REF as string
  }

  private tempFilePath(): string {
    const tempDir = process.env.RUNNER_TEMP as string
    return path.join(tempDir, `vet-tmp-${Math.random().toString(36)}`)
  }

  private isSupportedLockfile(filename: string): boolean {
    const baseFileName = path.basename(filename)
    return this.supportedLockfiles().includes(baseFileName)
  }

  private supportedLockfiles(): string[] {
    return [
      'Gemfile.lock',
      'package-lock.json',
      'yarn.lock',
      'Pipfile.lock',
      'poetry.lock',
      'go.mod',
      'pom.xml',
      'gradle.lockfile',
      'requirements.txt'
    ]
  }
}
