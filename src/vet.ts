import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { GitHub } from '@actions/github/lib/utils'
import { GitHubCommentsProxyService } from '@buf/safedep_api.bufbuild_es/safedep/services/ghcp/v1/ghcp_pb'
import { Client } from '@connectrpc/connect'
import fs from 'node:fs'
import path from 'path'
import { createGitHubCommentsProxyServiceClient } from './rpc'
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

// eslint-disable-next-line import/no-commonjs, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { DefaultArtifactClient } = require('@actions/artifact')

interface VetConfig {
  apiKey?: string
  tenant?: string
  policy?: string
  cloudMode?: boolean
  version?: string
  pullRequestNumber?: number
  pullRequestComment?: boolean
  exceptionFile?: string
  trustedRegistries?: string[]
  exclusionPatterns?: string[]
  timeout?: string
  uploadSarif?: boolean
  addStepSummary?: boolean
  enableGitHubCommentsProxy?: boolean
  paranoid?: boolean
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
  private commentsProxyClient: Client<typeof GitHubCommentsProxyService>

  constructor(private config: VetConfig) {
    this.vetBinaryPath = ''
    this.octokit = getOctokit(process.env.GITHUB_TOKEN as string)
    this.commentsProxyClient = createGitHubCommentsProxyServiceClient(
      process.env.GITHUB_TOKEN as string
    )
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

    if (!this.config.cloudMode) {
      core.info('Using community mode for API access')
      process.env.VET_COMMUNITY_MODE = 'true'
    } else {
      core.info('Using authenticated mode for API access')
    }

    let sarifReportPath = ''

    if (eventType === 'push') {
      sarifReportPath = await this.runOnPush()
    } else if (eventType === 'schedule') {
      this.runOnSchedule()
    } else if (
      eventType === 'pull_request' ||
      eventType === 'pull_request_target'
    ) {
      sarifReportPath = await this.runOnPullRequest()
    } else {
      throw new Error(`Unsupported event type: ${eventType}`)
    }

    return sarifReportPath
  }

  private async runOnPush(): Promise<string> {
    core.info('Running on push event')

    const vetSarifReportDir = getTempFilePath()
    const vetSarifReportPath = path.join(vetSarifReportDir, 'vet.sarif')
    const vetMarkdownSummaryReportPath = getTempFilePath()
    const policyFilePath = this.getPolicyFilePath()

    if (!fs.existsSync(vetSarifReportDir)) {
      fs.mkdirSync(vetSarifReportDir, { recursive: true })
    }

    core.info(`Using policy from path: ${policyFilePath}`)

    const vetFinalScanArgs = [
      'scan',
      '-s',
      '--report-sarif',
      vetSarifReportPath,
      '--report-markdown-summary',
      vetMarkdownSummaryReportPath,
      '--filter-suite',
      policyFilePath
    ]

    if (this.config.cloudMode) {
      this.applyCloudConfig(vetFinalScanArgs)
    }

    if (
      this.config.trustedRegistries &&
      this.config.trustedRegistries.length > 0
    ) {
      core.info(
        `Using trusted registries: ${this.config.trustedRegistries.join(',')}`
      )

      for (const registry of this.config.trustedRegistries) {
        vetFinalScanArgs.push('--trusted-registry', registry)
      }
    }

    this.applyScanExclusions(vetFinalScanArgs, '')

    await this.runVet(vetFinalScanArgs)

    if (!fs.existsSync(vetSarifReportPath)) {
      throw new Error(
        `vet SARIF report file not found at ${vetSarifReportPath}`
      )
    }

    if (!fs.existsSync(vetMarkdownSummaryReportPath)) {
      throw new Error(
        `vet markdown summary report file not found at ${vetMarkdownSummaryReportPath}`
      )
    }

    // Upload SARIF report if allowed by the configuration
    if (this.config.uploadSarif) {
      const artifactClient = new DefaultArtifactClient()
      const artifactName = 'vet-sarif-report'
      const artifactPath = vetSarifReportPath

      core.info(
        `Uploading SARIF report as artifact with name: ${artifactName} from: ${artifactPath}`
      )

      try {
        await artifactClient.uploadArtifact(
          artifactName,
          [artifactPath],
          vetSarifReportDir,
          {
            continueOnError: true
          }
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        core.warning(
          `Unable to upload SARIF report as artifact: ${error.message}`
        )
      }
    }

    // Add step summary if allowed by the configuration
    await this.addStepSummary(vetMarkdownSummaryReportPath)

    return vetSarifReportPath
  }

  private async runOnPullRequest(): Promise<string> {
    core.info('Running on pull request event')

    // Find changed files. There are cases where this may throw an error
    // because GitHub SDK seem to have inconsistency on what is `throw` vs `return
    // We know of the empty commit case where an exception is thrown.
    // https://github.com/safedep/vet-action/issues/90
    let changedFiles: PullRequestFile[] = []
    try {
      changedFiles = await this.pullRequestGetChangedFiles()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      core.warning(`Unable to get changed files: ${error.message}`)
    }

    core.info(`Found ${changedFiles.length} changed file(s)`)

    const changedLockFiles = changedFiles.filter(
      file =>
        // Filter by lockfiles that we support
        this.isSupportedLockfile(file.filename) &&
        // If the file is not found in head (current) branch then it
        // means the PR removed the file. We can ignore this file.
        fs.existsSync(file.filename)
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

    // Create the directory if it does not exist
    if (!fs.existsSync(jsonDumpDir)) {
      fs.mkdirSync(jsonDumpDir, { recursive: true })
    }

    for (const file of changedLockFiles) {
      let tempFile: string
      try {
        tempFile = await this.pullRequestCheckoutFileByPath(
          this.pullRequestBaseRef(),
          file.filename
        )

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        // This is not a fatal failure because base branch may not have the
        // file when a new file is added in the PR.
        core.warning(`Unable to checkout file: ${error.message}`)
        continue
      }

      const lockfileName = path.basename(file.filename)

      core.info(
        `Running vet on ${file.filename} as ${lockfileName} for generating exceptions list`
      )

      const vetArgs = [
        'scan',
        '-s',
        '--lockfiles',
        tempFile,
        '--lockfile-as',
        lockfileName,
        '--json-dump-dir',
        jsonDumpDir,
        '--enrich=false'
      ]

      // We must not touch lockfiles that are explicitly excluded from scan
      // even during the time of generating exceptions
      this.applyScanExclusions(vetArgs, tempFile)

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

    // When no exceptions are generated, the file is not created
    // so we touch the file to avoid vet failure
    if (!fs.existsSync(exceptionsFileName)) {
      fs.writeFileSync(exceptionsFileName, '', { encoding: 'utf-8' })
    }

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
      '-s',
      ...changedLockFiles.map(file => ['--lockfiles', file.filename]).flat(3),
      '--exceptions',
      exceptionsFileName,
      '--report-markdown-summary',
      vetMarkdownReportPath,
      '--report-sarif',
      vetSarifReportPath,
      '--filter-suite',
      policyFilePath,
      '--filter-fail',
      '--fail-fast'
    ]

    // Check if exceptionsFile is provided
    if (this.config.exceptionFile) {
      core.info(`Using exceptions file: ${this.config.exceptionFile}`)
      vetFinalScanArgs.push('--exceptions-extra', this.config.exceptionFile)
    }

    if (this.config.cloudMode) {
      this.applyCloudConfig(vetFinalScanArgs)
    }

    if (
      this.config.trustedRegistries &&
      this.config.trustedRegistries.length > 0
    ) {
      core.info(
        `Using trusted registries: ${this.config.trustedRegistries.join(',')}`
      )

      for (const registry of this.config.trustedRegistries) {
        vetFinalScanArgs.push('--trusted-registry', registry)
      }
    }

    this.applyScanExclusions(vetFinalScanArgs, '')

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

      const marker = `<!-- vet-report-pr-comment -->`
      await this.addOrUpdatePullRequestComment(reportContent, marker)
    }

    // Add step summary if allowed by the configuration
    await this.addStepSummary(vetMarkdownReportPath)

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

  private async getLatestVetBinaryVersion(): Promise<string> {
    const latest = await this.octokit.rest.repos.getLatestRelease({
      owner: 'safedep',
      repo: 'vet'
    })

    return latest.data.tag_name
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

    // We must not use Set here because args may repeat.
    // For example --trusted-registry, --lockfiles etc.
    const finalArgs = defaultArgs.concat(args)

    core.debug(
      `Running vet from: '${this.vetBinaryPath}' with command line: '${finalArgs}'`
    )

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
      try {
        versionToUse = await this.getLatestVetBinaryVersion()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        core.warning(`Unable to get latest release: ${error.message}`)

        versionToUse = 'v1.9.2'
        core.warning(`Falling back to default version: ${versionToUse}`)
      }
    }

    // TODO: We need to handle other platforms as well

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
    const comparison = `${this.pullRequestBaseRef()}...${this.pullRequestHeadRef()}`
    core.info(`Pull request comparing: ${comparison}`)

    const response = await this.octokit.rest.repos.compareCommitsWithBasehead({
      owner: this.ownerName(),
      repo: this.repoName(),
      basehead: comparison
    })

    if (response.status !== 200) {
      throw new Error(`Unable to get changed files: ${response.status}`)
    }

    // This is a valid case and happen frequently during development.
    // We should not expect that head is always ahead of base. The side effect
    // of this choice is, we may end up raising an issue that already exists
    // in the base branch due to divergence. This is acceptable because even
    // GitHub PR diff viewer shows the same in case of divergence.
    if (response.data.status !== 'ahead') {
      core.info(`Head is not ahead of Base: ${response.data.status}`)
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
    const fullName = context.payload.pull_request?.head?.repo
      ?.full_name as string

    if ((process.env.GITHUB_REPOSITORY as string) === fullName) {
      return process.env.GITHUB_HEAD_REF as string
    }

    const remoteOwner = fullName.split('/')[0]
    const remoteBranch = context.payload.pull_request?.head?.ref as string

    return `${remoteOwner}:${remoteBranch}`
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
  // tempFile is optional. It is used to exclude the temporary files created while checkout
  private applyScanExclusions(args: string[], tempFile: string): void {
    if (
      this.config.exclusionPatterns &&
      this.config.exclusionPatterns.length > 0
    ) {
      core.info(
        `Using exclusion patterns: ${this.config.exclusionPatterns.join(',')}`
      )
      for (const pattern of this.config.exclusionPatterns) {
        args.push('--exclude', pattern)
      }
    }

    if (tempFile !== '') {
      args.push('--exclude', tempFile)
    }
  }

  private applyCloudConfig(args: string[]): void {
    if (!this.config.apiKey) {
      throw new Error('API key is required for cloud mode')
    }

    if (!this.config.tenant) {
      throw new Error('Tenant is required for cloud mode')
    }

    core.info('Using cloud mode')
    process.env.VET_API_KEY = this.config.apiKey

    core.info(`Using tenant: ${this.config.tenant}`)
    process.env.VET_CONTROL_TOWER_TENANT_ID = this.config.tenant

    args.push('--report-sync')
    args.push('--report-sync-project', process.env.GITHUB_REPOSITORY as string)

    args.push(
      '--report-sync-project-version',
      process.env.GITHUB_REF_NAME as string
    )

    core.info(
      `Activating malicious package analysis with timeout: ${this.config.timeout}`
    )
    args.push('--malware')
    args.push('--malware-analysis-timeout', `${this.config.timeout}s`)

    if (this.config.paranoid) {
      args.push('--malware-trust-tool-result')
      args.push('--malware-analysis-min-confidence', 'MEDIUM')
    }
  }

  private async addOrUpdatePullRequestComment(
    reportContent: string,
    marker: string
  ): Promise<void> {
    core.info('Adding vet report as a comment in the PR')

    const comments = await this.octokit.rest.issues.listComments({
      repo: this.repoName(),
      owner: this.ownerName(),
      issue_number: this.config.pullRequestNumber as number,
      per_page: 100
    })

    const existingComment = comments.data.find(comment =>
      comment.body?.includes(marker)
    )

    const comment = `${reportContent}\n\n${marker}`

    // This is a write operation. The default GH token is readonly
    // when PR is from a forked repo.
    try {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      core.warning(`Unable to add a comment to the PR: ${ex.message}`)

      try {
        if (this.config.enableGitHubCommentsProxy) {
          core.info('Using GitHub Comments Proxy to add a comment to the PR')

          await this.addOrUpdatePullRequestCommentWithGitHubCommentsProxy(
            comment,
            marker,
            existingComment ? true : false,
            this.config.pullRequestNumber as number
          )
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (iex: any) {
        core.warning(
          `Unable to add a comment to the PR with GitHub Comments Proxy: ${iex.message}`
        )
      }
    }
  }

  private async addOrUpdatePullRequestCommentWithGitHubCommentsProxy(
    comment: string,
    marker: string,
    existingComment: boolean,
    prNumber: number
  ): Promise<void> {
    const response = await this.commentsProxyClient.createPullRequestComment({
      body: comment,
      tag: existingComment ? marker : '',
      prNumber: prNumber.toString(),
      repo: this.repoName(),
      owner: this.ownerName()
    })

    core.info(`Created or updated comment with id: ${response.commentId}`)
  }

  private async addStepSummary(markdownReportPath: string): Promise<void> {
    if (!this.config.addStepSummary) {
      return
    }

    try {
      let markdownSummary = fs.readFileSync(markdownReportPath, {
        encoding: 'utf-8'
      })

      core.info(
        `Setting markdown summary as output, content length: ${markdownSummary.length}`
      )

      // Step summary has limits
      // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions#step-isolation-and-limits
      const stepSummaryLimit = 1024 * 1024 - 32
      if (markdownSummary.length > stepSummaryLimit) {
        core.warning(
          `Markdown summary is too large: ${markdownSummary.length}, truncating to ${stepSummaryLimit}`
        )

        markdownSummary = markdownSummary.slice(0, stepSummaryLimit)
      }

      // https://github.com/actions/toolkit/blob/main/packages/core/README.md
      core.summary.clear()
      core.summary.addRaw(markdownSummary, true)
      core.summary.write({ overwrite: true })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      core.warning(`Unable to set markdown summary as output: ${error.message}`)
    }
  }
}
