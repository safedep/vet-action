/**
 * Sample data factories for GitHub API responses and event payloads used in
 * tests. Keeping these in one place means a test only describes the data that
 * matters to it and inherits sensible defaults for the rest.
 */

export interface PullRequestFileFixture {
  sha: string
  filename: string
  blob_url: string
  raw_url: string
  contents_url: string
}

/**
 * A changed file entry as returned (after mapping) by
 * `Vet.pullRequestGetChangedFiles`.
 */
export function changedLockfileFile(
  filename: string,
  overrides: Partial<PullRequestFileFixture> = {}
): PullRequestFileFixture {
  return {
    sha: 'abc123',
    filename,
    blob_url: `https://github.com/owner/repo/blob/main/${filename}`,
    raw_url: `https://github.com/owner/repo/raw/main/${filename}`,
    contents_url: `https://api.github.com/repos/owner/repo/contents/${filename}`,
    ...overrides
  }
}

/**
 * Shape of `octokit.rest.repos.compareCommitsWithBasehead` responses used by
 * `Vet.pullRequestGetChangedFiles`.
 */
export function compareCommitsResponse(
  files: PullRequestFileFixture[],
  status: 'ahead' | 'behind' | 'diverged' | 'identical' = 'ahead',
  httpStatus = 200
): {
  status: number
  data: { status: string; files: PullRequestFileFixture[] }
} {
  return {
    status: httpStatus,
    data: {
      status,
      files
    }
  }
}

/**
 * Shape of a raw `octokit.rest.repos.getContent` response used by
 * `Vet.pullRequestCheckoutFileByPath` (mediaType format: 'raw').
 */
export function getContentRawResponse(
  content: string,
  httpStatus = 200
): { status: number; data: string } {
  return {
    status: httpStatus,
    data: content
  }
}

export interface CommentFixture {
  id: number
  body: string
}

/**
 * Shape of `octokit.rest.issues.listComments` responses.
 */
export function listCommentsResponse(comments: CommentFixture[]): {
  data: CommentFixture[]
} {
  return { data: comments }
}

/**
 * Shape of `octokit.rest.repos.getLatestRelease` responses.
 */
export function getLatestReleaseResponse(tagName: string): {
  data: { tag_name: string }
} {
  return { data: { tag_name: tagName } }
}

/**
 * A minimal `pull_request` event payload (the JSON GitHub writes to
 * GITHUB_EVENT_PATH) for the same-repository case.
 */
export const samplePullRequestPayload = {
  number: 123,
  head: {
    ref: 'feature-branch',
    repo: { full_name: 'owner/repo' }
  }
}

/**
 * A `pull_request` event payload originating from a forked repository.
 */
export const sampleForkedPullRequestPayload = {
  number: 123,
  head: {
    ref: 'feature-branch',
    repo: { full_name: 'contributor/repo' }
  }
}

/**
 * Stringified event JSON as read from GITHUB_EVENT_PATH for a push event.
 */
export const samplePushEventJson = JSON.stringify({
  ref: 'refs/heads/main',
  repository: { full_name: 'owner/repo' }
})

/**
 * Stringified event JSON as read from GITHUB_EVENT_PATH for a pull_request
 * event.
 */
export const samplePullRequestEventJson = JSON.stringify({
  pull_request: samplePullRequestPayload
})
