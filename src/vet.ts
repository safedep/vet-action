import * as core from '@actions/core'
import { getOctokit } from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
import fs from 'node:fs'
import path from 'path'
import {
  getDefaultVetPolicyFilePath,
  getTempFilePath,
  isGithubRunnerDebug,
  supportedLockfiles
} from './utils'

// eslint-disable-next-line import/no-commonjs, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const exec = require('@actions/exec')

// eslint-disable-next-line import/no-commonjs, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const tc = require('@actions/tool-cache')

interface VetConfig {
  apiKey?: string
  policy?: string
  cloudMode?: boolean
  version?: string
  pullRequestNumber?: number
  pullRequestComment?: boolean
  exceptionFile?: string
  trustedRegistries?: string[]
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async run(eventType: string, _event: string): Promise<string> {
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

    let sarifReportPath = ''

    if (eventType === 'push') {
      sarifReportPath = await this.runOnPush()
    } else if (eventType === 'schedule') {
      this.runOnSchedule()
    } else if (eventType === 'pull_request') {
      sarifReportPath = await this.runOnPullRequest()
    } else {
      throw new Error(`Unsupported event type: ${eventType}`)
    }

    return sarifReportPath
  }

  private async runOnPush(): Promise<string> {
    core.info('Running on push event')

    const vetSarifReportPath = getTempFilePath()
    const policyFilePath = this.getPolicyFilePath()

    core.info(`Using policy from path: ${policyFilePath}`)

    const vetFinalScanArgs = [
      'scan',
      '--report-sarif',
      vetSarifReportPath,
      '--filter-suite',
      policyFilePath
    ]

    if (this.config.trustedRegistries) {
      core.info(
        `Using trusted registries: ${this.config.trustedRegistries.join(',')}`
      )

      for (const registry of this.config.trustedRegistries) {
        vetFinalScanArgs.push('--trusted-registry', registry)
      }
    }

    await this.runVet(vetFinalScanArgs)

    if (!fs.existsSync(vetSarifReportPath)) {
      throw new Error(
        `vet markdown report file not found at ${vetSarifReportPath}`
      )
    }

    return vetSarifReportPath
  }

  private async runOnPullRequest(): Promise<string> {
    core.info('Running on pull request event')

    // Find changed files
    const changedFiles = await this.pullRequestGetChangedFiles()
    core.info(`Found ${changedFiles.length} changed file(s)`)

    // Filter by lockfiles that we support
    const changedLockFiles = changedFiles.filter(file =>
      this.isSupportedLockfile(file.filename)
    )

    if (changedLockFiles.length === 0) {
      core.info('No change in OSS components detected in PR')
      return ''
    }

    core.info(`Found ${changedLockFiles.length} supported manifest(s)`)

    // Run vet on each lockfile's baseRef to generate JSON data
    // This data is required for generating exceptions file for ignoring
    // all existing packages so that we only scan new packages
    const jsonDumpDir = path.join(
      process.env.RUNNER_TEMP as string,
      'vet-exceptions-json-dump'
    )
    for (const file of changedLockFiles) {
      let tempFile: string
      try {
        tempFile = await this.pullRequestCheckoutFileByPath(
          this.pullRequestBaseRef(),
          file.filename
        )

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        core.warning(`Unable to checkout file: ${error.message}`)
        continue
      }

      const lockfileName = path.basename(file.filename)

      core.info(
        `Running vet on ${file.filename} as ${lockfileName} for generating exceptions list`
      )

      const vetArgs = [
        'scan',
        '--lockfiles',
        tempFile,
        '--lockfile-as',
        lockfileName,
        '--json-dump-dir',
        jsonDumpDir,
        '--enrich=false'
      ]

      core.info(`Running vet with command line: ${vetArgs}`)
      await this.runVet(vetArgs)
    }

    // Generate exceptions for changed lockfiles
    const exceptionsFileName = path.join(
      process.env.RUNNER_TEMP as string,
      'vet-exceptions.yml'
    )

    await this.runVet([
      'query',
      '--from',
      jsonDumpDir,
      '--exceptions-filter',
      'true',
      '--exceptions-generate',
      exceptionsFileName
    ])

    core.info(
      `Generated exceptions for ${changedLockFiles.length} manifest(s) from baseRef to ${exceptionsFileName}`
    )

    // Run vet to scan changed packages only
    const vetMarkdownReportPath = getTempFilePath()
    const vetSarifReportPath = getTempFilePath()
    const policyFilePath = this.getPolicyFilePath()

    core.info(`Using default policy from path: ${policyFilePath}`)

    const vetFinalScanArgs = [
      'scan',
      ...changedLockFiles.map(file => ['--lockfiles', file.filename]).flat(3),
      '--exceptions',
      exceptionsFileName,
      '--report-markdown-summary',
      vetMarkdownReportPath,
      '--report-sarif',
      vetSarifReportPath,
      '--filter-suite',
      policyFilePath,
      '--filter-fail'
    ]

    // Check if exceptionsFile is provided
    if (this.config.exceptionFile) {
      core.info(`Using exceptions file: ${this.config.exceptionFile}`)
      vetFinalScanArgs.push('--exceptions-extra', this.config.exceptionFile)
    }

    if (this.config.trustedRegistries) {
      core.info(
        `Using trusted registries: ${this.config.trustedRegistries.join(',')}`
      )

      for (const registry of this.config.trustedRegistries) {
        vetFinalScanArgs.push('--trusted-registry', registry)
      }
    }

    core.info(
      `Running vet to generate final report at ${vetMarkdownReportPath}`
    )

    // Hold the final run exception till we complete the steps
    // Throw (fail) if vet failed during final run. This is expected
    // when vet detects a policy violation.
    let finalRunException = null
    try {
      await this.runVet(vetFinalScanArgs)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      finalRunException = ex
    }

    if (!fs.existsSync(vetMarkdownReportPath)) {
      throw new Error(
        `vet markdown report file not found at ${vetMarkdownReportPath}`
      )
    }

    core.info(`Generated vet markdown report at ${vetMarkdownReportPath}`)

    if (this.config.pullRequestComment) {
      const reportContent = fs.readFileSync(vetMarkdownReportPath, {
        encoding: 'utf-8'
      })

      const comments = await this.octokit.rest.issues.listComments({
        repo: this.repoName(),
        owner: this.ownerName(),
        issue_number: this.config.pullRequestNumber as number,
        per_page: 100
      })

      const marker = `<!-- vet-report-pr-comment -->`
      const existingComment = comments.data.find(
        comment => comment.body?.includes(marker) // eslint-disable-line prettier/prettier
      )

      const comment = `${reportContent}\n\n${marker}`

      core.info('Adding vet report as a comment in the PR')

      if (existingComment) {
        await this.octokit.rest.issues.updateComment({
          repo: this.repoName(),
          owner: this.ownerName(),
          comment_id: existingComment.id,
          body: comment
        })
      } else {
        await this.octokit.rest.issues.createComment({
          repo: this.repoName(),
          owner: this.ownerName(),
          issue_number: this.config.pullRequestNumber as number,
          body: comment
        })
      }
    }

    // Throw the exception if vet scan failed
    if (finalRunException) {
      core.error(`One or more policy violation was detected!`)
      throw finalRunException
    }

    return vetSarifReportPath
  }

  private async runOnSchedule(): Promise<string> {
    core.info('Scheduled run is not supported at this time')
    return ''
  }

  private async verifyVetBinary(): Promise<void> {
    if (!this.vetBinaryPath) {
      throw new Error('vet binary not found')
    }

    const vetBinaryVersion = await this.getVetBinaryVersion()
    core.info(`vet binary version is ${vetBinaryVersion}`)
  }

  private async getVetBinaryVersion(): Promise<string> {
    const output = await this.runVet(['version'], true, true)

    const match = output.match(/Version: ([0-9.]+)/)
    if (!match || !match[1]) {
      throw new Error('Unable to determine vet binary version')
    }

    return match[1]
  }

  private async runVet(
    args: string[],
    silent = false,
    ignoreReturnCode = false,
    matchOutput = false,
    matchOutputRegex = ''
  ): Promise<string> {
    if (isGithubRunnerDebug()) {
      silent = false
    }

    let output = ''
    const options = {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString()
        }
      },
      silent,
      ignoreReturnCode
    }

    const defaultArgs = ['--no-banner']
    const finalArgs = [...new Set(defaultArgs.concat(args))]

    await exec.exec(this.vetBinaryPath, finalArgs, options)

    if (matchOutput) {
      const match = output.match(matchOutputRegex)
      if (!match || !match[1]) {
        throw new Error(`Output does not match for ${matchOutputRegex}`)
      }
    }

    return output
  }

  private async getLatestRelease(): Promise<string> {
    let versionToUse = this.config.version ?? ''
    if (versionToUse.length === 0) {
      versionToUse = 'v1.6.0'
    }

    return `https://github.com/safedep/vet/releases/download/${versionToUse}/vet_Linux_x86_64.tar.gz`
  }

  private async downloadBinary(url: string): Promise<string> {
    return tc.downloadTool(url)
  }

  private async extractBinary(tgzPath: string): Promise<string> {
    return tc.extractTar(tgzPath)
  }

  private async pullRequestCheckoutFileByPath(
    ref: string,
    filePath: string
  ): Promise<string> {
    core.info(`Checking out file: ${filePath}@${ref}`)

    const response = await this.octokit.rest.repos.getContent({
      mediaType: {
        format: 'raw'
      },
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

    // We are using the 'raw' media type, so the response data is
    // the file content itself.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = Buffer.from(response.data as any).toString('utf-8')

    core.debug(`File content: ${content}`)

    const tempFile = getTempFilePath()
    fs.writeFileSync(tempFile, content, { encoding: 'utf-8' })

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

  private isSupportedLockfile(filename: string): boolean {
    const baseFileName = path.basename(filename)
    return supportedLockfiles().includes(baseFileName)
  }

  private getPolicyFilePath(): string {
    if (this.config.policy) {
      return this.config.policy
    }

    return getDefaultVetPolicyFilePath()
  }
}
