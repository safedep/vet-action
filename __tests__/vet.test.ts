import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import * as core from '@actions/core'
import {
  stubGitHubActionsEnv,
  createTestVet,
  stubVetBinaryLifecycle,
  createMockCoreSummary,
  stubPullRequestContext
} from './helpers/mocks'
import {
  changedLockfileFile,
  compareCommitsResponse,
  getContentRawResponse,
  getLatestReleaseResponse,
  listCommentsResponse
} from './helpers/fixtures'

// Mock external dependencies. These declarations are hoisted by Vitest and must
// live in the test file (not in a helper).
vi.mock('@actions/core')
vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(),
  context: { payload: {} }
}))
vi.mock('node:fs')
vi.mock('@actions/exec')
vi.mock('@actions/tool-cache')
vi.mock('@actions/artifact')
vi.mock('../src/rpc')

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  stubGitHubActionsEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Vet.run event routing', () => {
  it('routes push events to runOnPush', async () => {
    const { vet } = createTestVet()
    stubVetBinaryLifecycle(vet)

    // @ts-expect-error - stubbing private method
    vet.runOnPush = vi.fn().mockResolvedValue('push.sarif')
    // @ts-expect-error - stubbing private method
    vet.runOnPullRequest = vi.fn().mockResolvedValue('pr.sarif')

    const result = await vet.run('push', '')

    expect(result).toBe('push.sarif')
    // @ts-expect-error - asserting on private method
    expect(vet.runOnPush).toHaveBeenCalled()
    // @ts-expect-error - asserting on private method
    expect(vet.runOnPullRequest).not.toHaveBeenCalled()
  })

  it('routes pull_request events to runOnPullRequest', async () => {
    const { vet } = createTestVet()
    stubVetBinaryLifecycle(vet)

    // @ts-expect-error - stubbing private method
    vet.runOnPullRequest = vi.fn().mockResolvedValue('pr.sarif')

    const result = await vet.run('pull_request', '')
    expect(result).toBe('pr.sarif')
  })

  it('routes pull_request_target events to runOnPullRequest', async () => {
    const { vet } = createTestVet()
    stubVetBinaryLifecycle(vet)

    // @ts-expect-error - stubbing private method
    vet.runOnPullRequest = vi.fn().mockResolvedValue('pr.sarif')

    const result = await vet.run('pull_request_target', '')
    expect(result).toBe('pr.sarif')
  })

  it('returns empty string for schedule events', async () => {
    const { vet } = createTestVet()
    stubVetBinaryLifecycle(vet)

    const result = await vet.run('schedule', '')
    expect(result).toBe('')
  })

  it('throws for unsupported event types', async () => {
    const { vet } = createTestVet()
    stubVetBinaryLifecycle(vet)

    await expect(vet.run('issue_comment', '')).rejects.toThrow(
      'Unsupported event type: issue_comment'
    )
  })

  it('sets community mode env when not in cloud mode', async () => {
    const { vet } = createTestVet({ cloudMode: false })
    stubVetBinaryLifecycle(vet)

    // @ts-expect-error - stubbing private method
    vet.runOnPush = vi.fn().mockResolvedValue('')

    await vet.run('push', '')
    expect(process.env.VET_COMMUNITY_MODE).toBe('true')
  })
})

describe('Vet.addOrUpdatePullRequestComment', () => {
  it('creates a new comment when none exists', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.issues.listComments.mockResolvedValue(listCommentsResponse([]))

    const reportContent = 'Test Report'
    const marker = '<!-- test-marker -->'

    // @ts-expect-error - calling private method
    await vet.addOrUpdatePullRequestComment(reportContent, marker)

    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      repo: 'repo',
      owner: 'owner',
      issue_number: 123,
      body: `${reportContent}\n\n${marker}`
    })
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled()
  })

  it('updates an existing comment when found', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.issues.listComments.mockResolvedValue(
      listCommentsResponse([
        { id: 456, body: 'Old content <!-- test-marker -->' }
      ])
    )

    const reportContent = 'Updated Report'
    const marker = '<!-- test-marker -->'

    // @ts-expect-error - calling private method
    await vet.addOrUpdatePullRequestComment(reportContent, marker)

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      repo: 'repo',
      owner: 'owner',
      comment_id: 456,
      body: `${reportContent}\n\n${marker}`
    })
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })

  it('throws when listComments fails', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.issues.listComments.mockRejectedValue(new Error('API Error'))

    await expect(
      // @ts-expect-error - calling private method
      vet.addOrUpdatePullRequestComment('Test Report', '<!-- test-marker -->')
    ).rejects.toThrow('API Error')
  })

  it('falls back to the comments proxy when the comment write fails', async () => {
    const { vet, octokit, proxyClient } = createTestVet({
      enableGitHubCommentsProxy: true
    })
    octokit.rest.issues.listComments.mockResolvedValue(listCommentsResponse([]))
    octokit.rest.issues.createComment.mockRejectedValue(
      new Error('Resource not accessible by integration')
    )
    proxyClient.createPullRequestComment.mockResolvedValue({ commentId: '99' })

    // @ts-expect-error - calling private method
    await vet.addOrUpdatePullRequestComment('Report', '<!-- marker -->')

    expect(proxyClient.createPullRequestComment).toHaveBeenCalledWith(
      expect.objectContaining({
        prNumber: '123',
        repo: 'repo',
        owner: 'owner'
      })
    )
  })

  it('does not use the comments proxy when it is disabled', async () => {
    const { vet, octokit, proxyClient } = createTestVet({
      enableGitHubCommentsProxy: false
    })
    octokit.rest.issues.listComments.mockResolvedValue(listCommentsResponse([]))
    octokit.rest.issues.createComment.mockRejectedValue(new Error('readonly'))

    // @ts-expect-error - calling private method
    await vet.addOrUpdatePullRequestComment('Report', '<!-- marker -->')

    expect(proxyClient.createPullRequestComment).not.toHaveBeenCalled()
  })
})

describe('Vet.runOnPullRequest', () => {
  beforeEach(() => {
    stubPullRequestContext()
  })

  it('returns empty string when there are no changed files', async () => {
    const { vet } = createTestVet()
    stubVetBinaryLifecycle(vet)

    // @ts-expect-error - stubbing private method
    vet.pullRequestGetChangedFiles = vi.fn().mockResolvedValue([])

    const result = await vet.run('pull_request', '')
    expect(result).toBe('')
  })

  it('ignores changed files that are not supported lockfiles', async () => {
    const { vet } = createTestVet()
    stubVetBinaryLifecycle(vet)

    // @ts-expect-error - stubbing private method
    vet.pullRequestGetChangedFiles = vi
      .fn()
      .mockResolvedValue([changedLockfileFile('src/index.ts')])

    const result = await vet.run('pull_request', '')
    expect(result).toBe('')
  })

  it('continues gracefully when getting changed files throws', async () => {
    const { vet } = createTestVet()
    stubVetBinaryLifecycle(vet)

    // @ts-expect-error - stubbing private method
    vet.pullRequestGetChangedFiles = vi
      .fn()
      .mockRejectedValue(new Error('empty commit'))

    const result = await vet.run('pull_request', '')
    expect(result).toBe('')
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Unable to get changed files')
    )
  })

  it('scans a changed lockfile end to end and comments on the PR', async () => {
    const { vet, octokit } = createTestVet({ addStepSummary: false })
    stubVetBinaryLifecycle(vet)

    // The full pipeline reads/writes temp files and checks for reports; mock
    // the filesystem so every existence check passes and reports "exist".
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('# vet report')

    // Changed files come from the compare API; the base version of each file is
    // fetched via getContent to generate exceptions.
    octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue(
      compareCommitsResponse([changedLockfileFile('package-lock.json')])
    )
    octokit.rest.repos.getContent.mockResolvedValue(
      getContentRawResponse('{ "name": "base-lockfile" }')
    )
    octokit.rest.issues.listComments.mockResolvedValue(listCommentsResponse([]))
    octokit.rest.issues.createComment.mockResolvedValue({})

    const result = await vet.run('pull_request', '')

    // Returns the SARIF report path produced by the final scan.
    expect(result).toContain('vet-tmp-')

    // Base lockfile was checked out to build the exceptions list.
    expect(octokit.rest.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'package-lock.json', ref: 'main' })
    )

    // The final scan ran with PR-mode flags.
    // @ts-expect-error - asserting on the stubbed private method
    expect(vet.runVet).toHaveBeenCalledWith(
      expect.arrayContaining(['scan', '--report-sarif', '--filter-fail'])
    )

    // The report was posted as a PR comment.
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 123,
        body: expect.stringContaining('<!-- vet-report-pr-comment -->')
      })
    )
  })

  it('comments and then fails the run on a policy violation', async () => {
    const { vet, octokit } = createTestVet({ addStepSummary: false })

    // Make only the final PR scan (the one with --filter-fail) fail, as vet
    // does when a policy violation is detected. Other invocations succeed.
    stubVetBinaryLifecycle(vet, {
      runVetImpl: async (args: string[]) => {
        if (args.includes('--filter-fail')) {
          throw new Error('policy violation detected')
        }
        return 'Version: 1.2.3'
      }
    })

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('# vet report')

    octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue(
      compareCommitsResponse([changedLockfileFile('package-lock.json')])
    )
    octokit.rest.repos.getContent.mockResolvedValue(
      getContentRawResponse('{ "name": "base-lockfile" }')
    )
    octokit.rest.issues.listComments.mockResolvedValue(listCommentsResponse([]))
    octokit.rest.issues.createComment.mockResolvedValue({})

    await expect(vet.run('pull_request', '')).rejects.toThrow(
      'policy violation detected'
    )

    // The PR comment is still posted before the run is failed.
    expect(octokit.rest.issues.createComment).toHaveBeenCalled()
    expect(core.error).toHaveBeenCalledWith(
      expect.stringContaining('policy violation was detected')
    )
  })
})

describe('Vet.runOnPush', () => {
  it('runs a scan and returns the SARIF report path', async () => {
    // uploadSarif is disabled so the test does not reach the artifact client,
    // which is loaded via require() and therefore not interceptable by vi.mock
    // (see docs/testing.md). The scan behaviour is still fully exercised.
    const { vet } = createTestVet({
      uploadSarif: false,
      addStepSummary: false
    })
    stubVetBinaryLifecycle(vet)
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const result = await vet.run('push', '')

    expect(result).toContain('vet.sarif')
    // @ts-expect-error - asserting on the stubbed private method
    expect(vet.runVet).toHaveBeenCalledWith(
      expect.arrayContaining(['scan', '--report-sarif'])
    )
  })

  it('throws when the SARIF report is not produced', async () => {
    const { vet } = createTestVet({
      uploadSarif: false,
      addStepSummary: false
    })
    stubVetBinaryLifecycle(vet)
    vi.mocked(fs.existsSync).mockReturnValue(false)

    await expect(vet.run('push', '')).rejects.toThrow(
      'vet SARIF report file not found'
    )
  })
})

describe('Vet.getPolicyFileInfo', () => {
  it('prefers policy v2 over v1 and default', () => {
    const { vet } = createTestVet({ policyV2: 'v2.yml', policy: 'v1.yml' })
    // @ts-expect-error - calling private method
    expect(vet.getPolicyFileInfo()).toEqual({ path: 'v2.yml', version: 'v2' })
  })

  it('uses policy v1 when v2 is not set', () => {
    const { vet } = createTestVet({ policy: 'v1.yml' })
    // @ts-expect-error - calling private method
    expect(vet.getPolicyFileInfo()).toEqual({ path: 'v1.yml', version: 'v1' })
  })

  it('falls back to the bundled default policy (v1)', () => {
    const { vet } = createTestVet()
    // @ts-expect-error - calling private method
    const info = vet.getPolicyFileInfo()
    expect(info.version).toBe('v1')
    expect(info.path).toContain('policy.yml')
  })
})

describe('Vet.applyCloudConfig', () => {
  it('throws when the API key is missing', () => {
    const { vet } = createTestVet({ cloudMode: true, tenant: 't' })
    // @ts-expect-error - calling private method
    expect(() => vet.applyCloudConfig([])).toThrow(
      'API key is required for cloud mode'
    )
  })

  it('throws when the tenant is missing', () => {
    const { vet } = createTestVet({ cloudMode: true, apiKey: 'k' })
    // @ts-expect-error - calling private method
    expect(() => vet.applyCloudConfig([])).toThrow(
      'Tenant is required for cloud mode'
    )
  })

  it('sets cloud env vars and scan arguments', () => {
    const { vet } = createTestVet({
      cloudMode: true,
      apiKey: 'secret-key',
      tenant: 'acme',
      timeout: '120'
    })

    const args: string[] = []
    // @ts-expect-error - calling private method
    vet.applyCloudConfig(args)

    expect(process.env.VET_API_KEY).toBe('secret-key')
    expect(process.env.VET_CONTROL_TOWER_TENANT_ID).toBe('acme')
    expect(args).toContain('--report-sync')
    expect(args).toContain('--malware')
    expect(args).toContain('--malware-analysis-timeout')
    expect(args).toContain('120s')
  })

  it('adds paranoid malware flags when enabled', () => {
    const { vet } = createTestVet({
      cloudMode: true,
      apiKey: 'k',
      tenant: 't',
      paranoid: true
    })

    const args: string[] = []
    // @ts-expect-error - calling private method
    vet.applyCloudConfig(args)

    expect(args).toContain('--malware-trust-tool-result')
    expect(args).toContain('--malware-analysis-min-confidence')
    expect(args).toContain('MEDIUM')
  })
})

describe('Vet.applyScanExclusions', () => {
  it('appends an --exclude flag per pattern', () => {
    const { vet } = createTestVet({
      exclusionPatterns: ['**/test/**', 'docs/*']
    })

    const args: string[] = []
    // @ts-expect-error - calling private method
    vet.applyScanExclusions(args)

    expect(args).toEqual(['--exclude', '**/test/**', '--exclude', 'docs/*'])
  })

  it('adds nothing when there are no exclusion patterns', () => {
    const { vet } = createTestVet()
    const args: string[] = []
    // @ts-expect-error - calling private method
    vet.applyScanExclusions(args)
    expect(args).toEqual([])
  })
})

describe('Vet.isSupportedLockfile', () => {
  it('matches supported lockfiles regardless of directory', () => {
    const { vet } = createTestVet()
    // @ts-expect-error - calling private method
    expect(vet.isSupportedLockfile('frontend/package-lock.json')).toBe(true)
    // @ts-expect-error - calling private method
    expect(vet.isSupportedLockfile('go.mod')).toBe(true)
  })

  it('rejects unsupported files', () => {
    const { vet } = createTestVet()
    // @ts-expect-error - calling private method
    expect(vet.isSupportedLockfile('src/index.ts')).toBe(false)
  })
})

describe('Vet version resolution', () => {
  it('uses the configured version to build the download URL', async () => {
    const { vet } = createTestVet({ version: 'v9.9.9' })
    // @ts-expect-error - calling private method
    const url = await vet.getLatestRelease()
    expect(url).toContain('v9.9.9')
  })

  it('resolves the latest release via the GitHub API', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.repos.getLatestRelease.mockResolvedValue(
      getLatestReleaseResponse('v2.0.0')
    )

    // @ts-expect-error - calling private method
    const url = await vet.getLatestRelease()
    expect(url).toContain('v2.0.0')
  })

  it('falls back to a default version when the API errors', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.repos.getLatestRelease.mockRejectedValue(
      new Error('rate limited')
    )

    // @ts-expect-error - calling private method
    const url = await vet.getLatestRelease()
    expect(url).toContain('v1.9.2')
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Unable to get latest release')
    )
  })

  it('parses the version from the vet binary banner', async () => {
    const { vet } = createTestVet()
    // @ts-expect-error - stubbing private method
    vet.runVet = vi.fn().mockResolvedValue('vet\nVersion: 1.7.3\n')

    // @ts-expect-error - calling private method
    expect(await vet.getVetBinaryVersion()).toBe('1.7.3')
  })

  it('throws when the version banner cannot be parsed', async () => {
    const { vet } = createTestVet()
    // @ts-expect-error - stubbing private method
    vet.runVet = vi.fn().mockResolvedValue('no version here')

    // @ts-expect-error - calling private method
    await expect(vet.getVetBinaryVersion()).rejects.toThrow(
      'Unable to determine vet binary version'
    )
  })
})

describe('Vet.pullRequestGetChangedFiles', () => {
  beforeEach(() => {
    stubPullRequestContext()
  })

  it('maps the compare API response into changed files', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue(
      compareCommitsResponse([changedLockfileFile('package-lock.json')])
    )

    // @ts-expect-error - calling private method
    const files = await vet.pullRequestGetChangedFiles()

    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('package-lock.json')
    expect(octokit.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        basehead: 'main...feature-branch'
      })
    )
  })

  it('throws when the compare API returns a non-200 status', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue(
      compareCommitsResponse([], 'ahead', 404)
    )

    await expect(
      // @ts-expect-error - calling private method
      vet.pullRequestGetChangedFiles()
    ).rejects.toThrow('Unable to get changed files: 404')
  })

  it('throws when the response has no files', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
      status: 200,
      data: { status: 'ahead' }
    })

    await expect(
      // @ts-expect-error - calling private method
      vet.pullRequestGetChangedFiles()
    ).rejects.toThrow('No files found in response')
  })
})

describe('Vet.pullRequestCheckoutFileByPath', () => {
  it('writes the raw file content to a temp file', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.repos.getContent.mockResolvedValue(
      getContentRawResponse('lockfile-contents')
    )

    // @ts-expect-error - calling private method
    const tempFile = await vet.pullRequestCheckoutFileByPath(
      'main',
      'package-lock.json'
    )

    expect(tempFile).toBeTruthy()
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      tempFile,
      'lockfile-contents',
      { encoding: 'utf-8' }
    )
  })

  it('throws when getContent returns a non-200 status', async () => {
    const { vet, octokit } = createTestVet()
    octokit.rest.repos.getContent.mockResolvedValue(
      getContentRawResponse('', 404)
    )

    await expect(
      // @ts-expect-error - calling private method
      vet.pullRequestCheckoutFileByPath('main', 'package-lock.json')
    ).rejects.toThrow('Unable to get file')
  })
})

describe('Vet.pullRequestHeadRef', () => {
  it('returns the head ref for a same-repository PR', () => {
    const { vet } = createTestVet()
    stubPullRequestContext({ head: { repo: { full_name: 'owner/repo' } } })

    // @ts-expect-error - calling private method
    expect(vet.pullRequestHeadRef()).toBe('feature-branch')
  })

  it('returns an owner-prefixed ref for a forked PR', () => {
    const { vet } = createTestVet()
    stubPullRequestContext({
      head: {
        ref: 'patch-1',
        repo: { full_name: 'contributor/repo' }
      }
    })

    // @ts-expect-error - calling private method
    expect(vet.pullRequestHeadRef()).toBe('contributor:patch-1')
  })
})

describe('Vet.addStepSummary', () => {
  let summary: ReturnType<typeof createMockCoreSummary>

  beforeEach(() => {
    summary = createMockCoreSummary()
  })

  it('does nothing when addStepSummary is false', async () => {
    const { vet } = createTestVet({ addStepSummary: false })

    // @ts-expect-error - calling private method
    await vet.addStepSummary('/test/path.md')

    expect(fs.readFileSync).not.toHaveBeenCalled()
    expect(summary.clear).not.toHaveBeenCalled()
    expect(summary.addRaw).not.toHaveBeenCalled()
    expect(summary.write).not.toHaveBeenCalled()
  })

  it('writes the report content as the step summary', async () => {
    const mockContent = '# Test Report\n\nSome content'
    vi.mocked(fs.readFileSync).mockReturnValue(mockContent)

    const { vet } = createTestVet({ addStepSummary: true })

    // @ts-expect-error - calling private method
    await vet.addStepSummary('/test/path.md')

    expect(fs.readFileSync).toHaveBeenCalledWith('/test/path.md', {
      encoding: 'utf-8'
    })
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining(String(mockContent.length))
    )
    expect(summary.clear).toHaveBeenCalled()
    expect(summary.addRaw).toHaveBeenCalledWith(mockContent, true)
    expect(summary.write).toHaveBeenCalledWith({ overwrite: true })
  })

  it('truncates content that exceeds the step summary limit', async () => {
    const stepSummaryLimit = 1024 * 1024 - 32
    const longContent = 'a'.repeat(stepSummaryLimit + 100)
    vi.mocked(fs.readFileSync).mockReturnValue(longContent)

    const { vet } = createTestVet({ addStepSummary: true })

    // @ts-expect-error - calling private method
    await vet.addStepSummary('/test/path.md')

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Markdown summary is too large')
    )
    expect(summary.addRaw).toHaveBeenCalledWith(
      longContent.slice(0, stepSummaryLimit),
      true
    )
  })

  it('handles file read errors gracefully', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('File not found')
    })

    const { vet } = createTestVet({ addStepSummary: true })

    // @ts-expect-error - calling private method
    await vet.addStepSummary('/test/path.md')

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'Unable to set markdown summary as output: File not found'
      )
    )
    expect(summary.addRaw).not.toHaveBeenCalled()
  })
})
