import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Vet } from './vet'

// Mock external dependencies
vi.mock('@actions/core')
vi.mock('@actions/github')
vi.mock('node:fs')
vi.mock('@actions/exec')
vi.mock('@actions/tool-cache')
vi.mock('@actions/artifact')

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
    vi.clearAllMocks()

    // Setup environment variables
    process.env = { ...mockEnv }

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
})
