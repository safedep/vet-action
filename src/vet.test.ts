import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import * as core from '@actions/core'
import { Vet } from './vet'
import { matchesPath } from './utils'

// Mock external dependencies
vi.mock('@actions/core')
vi.mock('@actions/github')
vi.mock('node:fs')
vi.mock('@actions/exec')
vi.mock('@actions/tool-cache')
vi.mock('@actions/artifact')
vi.mock('./rpc')

// Mock environment variables
const mockEnv = {
  GITHUB_TOKEN: 'mock-token',
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_REPOSITORY_OWNER: 'owner',
  GITHUB_BASE_REF: 'main',
  GITHUB_HEAD_REF: 'feature-branch',
  GITHUB_REF_NAME: 'feature-branch',
  RUNNER_TEMP: '/tmp'
}

describe('Vet', () => {
  let vet: Vet

  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks()

    // Setup environment variables
    for (const [key, value] of Object.entries(mockEnv)) {
      vi.stubEnv(key, value)
    }

    // Setup basic config
    const config = {
      cloudMode: false,
      pullRequestNumber: 123,
      pullRequestComment: true
    }

    vet = new Vet(config)
  })

  describe('addOrUpdatePullRequestComment', () => {
    const mockOctokit = {
      rest: {
        issues: {
          listComments: vi.fn(),
          createComment: vi.fn(),
          updateComment: vi.fn()
        }
      }
    }

    beforeEach(() => {
      // @ts-expect-error - Mocking private property
      vet.octokit = mockOctokit
    })

    it('should create a new comment when no existing comment is found', async () => {
      // Mock listComments response
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: []
      })

      const reportContent = 'Test Report'
      const marker = '<!-- test-marker -->'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (vet as any).addOrUpdatePullRequestComment(reportContent, marker)

      // Verify createComment was called with correct parameters
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        repo: 'repo',
        owner: 'owner',
        issue_number: 123,
        body: `${reportContent}\n\n${marker}`
      })

      // Verify updateComment was not called
      expect(mockOctokit.rest.issues.updateComment).not.toHaveBeenCalled()
    })

    it('should update existing comment when found', async () => {
      // Mock listComments response with existing comment
      const existingComment = {
        id: 456,
        body: 'Old content <!-- test-marker -->'
      }
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [existingComment]
      })

      const reportContent = 'Updated Report'
      const marker = '<!-- test-marker -->'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (vet as any).addOrUpdatePullRequestComment(reportContent, marker)

      // Verify updateComment was called with correct parameters
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith({
        repo: 'repo',
        owner: 'owner',
        comment_id: 456,
        body: `${reportContent}\n\n${marker}`
      })

      // Verify createComment was not called
      expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled()
    })

    it('should throw when listComments fails', async () => {
      // Mock API error
      mockOctokit.rest.issues.listComments.mockRejectedValue(
        new Error('API Error')
      )

      const reportContent = 'Test Report'
      const marker = '<!-- test-marker -->'

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (vet as any).addOrUpdatePullRequestComment(reportContent, marker)
      ).rejects.toThrow('API Error')
    })
  })

  describe('runOnPullRequest', () => {
    beforeEach(() => {
      // Mock vet.getLatestBinary
      // @ts-expect-error - Mocking private method
      vet.getLatestRelease = vi.fn().mockResolvedValue('1.2.3')

      // Mock vet.downloadBinary
      // @ts-expect-error - Mocking private method
      vet.downloadBinary = vi.fn().mockResolvedValue('Mock Binary Path')

      // Mock vet.extractBinary
      // @ts-expect-error - Mocking private method
      vet.extractBinary = vi.fn().mockResolvedValue('Mock Binary Path')

      // Mock vet.runVet
      // @ts-expect-error - Mocking private method
      vet.runVet = vi.fn().mockResolvedValue('Version: 1.2.3')
    })

    it('should handle no changed files in PR', async () => {
      // @ts-expect-error - Mocking private method
      vet.pullRequestGetChangedFiles = vi.fn().mockResolvedValue([])

      const result = await vet.run('pull_request', '')
      expect(result).toBe('')
    })

    it('should process changed lockfiles', async () => {
      // Mock changed files
      const changedFiles = [
        {
          sha: 'abc123',
          filename: 'package-lock.json',
          blob_url: 'url',
          raw_url: 'url',
          contents_url: 'url'
        }
      ]

      // @ts-expect-error - Mocking private methods
      vet.pullRequestGetChangedFiles = vi.fn().mockResolvedValue(changedFiles)

      const result = await vet.run('pull_request', '')
      expect(result).toBe('')
    })
  })

  describe('addStepSummary', () => {
    // Mock core.summary
    const mockSummary = {
      clear: vi.fn().mockReturnThis(),
      addRaw: vi.fn().mockReturnThis(),
      write: vi.fn().mockResolvedValue(undefined)
    }

    beforeEach(() => {
      // Reset all mocks
      vi.resetAllMocks()

      // Setup environment variables
      for (const [key, value] of Object.entries(mockEnv)) {
        vi.stubEnv(key, value)
      }

      // Setup core.summary mock
      vi.mocked(core.summary).clear = mockSummary.clear
      vi.mocked(core.summary).addRaw = mockSummary.addRaw
      vi.mocked(core.summary).write = mockSummary.write
    })

    it('should not add summary when addStepSummary is false', async () => {
      // Create a new Vet instance with addStepSummary set to false
      const vetInstance = new Vet({
        cloudMode: false,
        pullRequestNumber: 123,
        pullRequestComment: true,
        addStepSummary: false
      })

      // Call the private method directly
      // @ts-expect-error - Accessing private method
      await vetInstance.addStepSummary('/test/path.md')

      // Verify no interactions with mocks
      expect(fs.readFileSync).not.toHaveBeenCalled()
      expect(mockSummary.clear).not.toHaveBeenCalled()
      expect(mockSummary.addRaw).not.toHaveBeenCalled()
      expect(mockSummary.write).not.toHaveBeenCalled()
    })

    it('should add summary when addStepSummary is true', async () => {
      // Mock fs.readFileSync to return test content
      const mockContent = '# Test Report\n\nSome content'
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent)

      // Create a new Vet instance with addStepSummary set to true
      const vetInstance = new Vet({
        cloudMode: false,
        pullRequestNumber: 123,
        pullRequestComment: true,
        addStepSummary: true
      })

      // Call the private method directly
      // @ts-expect-error - Accessing private method
      await vetInstance.addStepSummary('/test/path.md')

      // Verify expected behavior
      expect(fs.readFileSync).toHaveBeenCalledWith('/test/path.md', {
        encoding: 'utf-8'
      })
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(String(mockContent.length))
      )
      expect(mockSummary.clear).toHaveBeenCalled()
      expect(mockSummary.addRaw).toHaveBeenCalledWith(mockContent, true)
      expect(mockSummary.write).toHaveBeenCalledWith({ overwrite: true })
    })

    it('should truncate summary when content exceeds limit', async () => {
      // Mock large content
      const stepSummaryLimit = 1024 * 1024 - 32
      const longContent = 'a'.repeat(stepSummaryLimit + 100)
      vi.mocked(fs.readFileSync).mockReturnValue(longContent)

      // Create a new Vet instance with addStepSummary set to true
      const vetInstance = new Vet({
        cloudMode: false,
        pullRequestNumber: 123,
        pullRequestComment: true,
        addStepSummary: true
      })

      // Call the private method directly
      // @ts-expect-error - Accessing private method
      await vetInstance.addStepSummary('/test/path.md')

      // Verify expected behavior
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Markdown summary is too large')
      )
      expect(mockSummary.addRaw).toHaveBeenCalledWith(
        longContent.slice(0, stepSummaryLimit),
        true
      )
    })

    it('should handle file read errors gracefully', async () => {
      // Mock file read error
      const error = new Error('File not found')
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw error
      })

      // Create a new Vet instance with addStepSummary set to true
      const vetInstance = new Vet({
        cloudMode: false,
        pullRequestNumber: 123,
        pullRequestComment: true,
        addStepSummary: true
      })

      // Call the private method directly
      // @ts-expect-error - Accessing private method
      await vetInstance.addStepSummary('/test/path.md')

      // Verify expected behavior
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining(
          'Unable to set markdown summary as output: File not found'
        )
      )
      expect(mockSummary.addRaw).not.toHaveBeenCalled()
    })
  })
})

describe('exluded files matching', () => {
  it('should match exact paths', () => {
    const filePath = 'src/utils.ts'
    const targetPath = 'src/utils.ts'
    expect(matchesPath(filePath, targetPath)).toBe(true)
  })

  it('should not match different paths', () => {
    const filePath = 'src/utils.ts'
    const targetPath = 'src/vet.ts'
    expect(matchesPath(filePath, targetPath)).toBe(false)
  })

  it('should match paths with trailing slashes', () => {
    const filePath = 'src/utils.ts/'
    const targetPath = 'src/utils.ts'
    expect(matchesPath(filePath, targetPath)).toBe(true)
  })
})
