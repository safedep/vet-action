/**
 * Reusable mocks for testing vet-action.
 *
 * These helpers centralize the GitHub Actions environment, GitHub API (Octokit)
 * and vet binary lifecycle mocks that every test needs. They cover the
 * repetitive *setup*, not the module mock declarations: `vi.mock('<module>')`
 * calls are hoisted per file by Vitest and must stay in the test file itself.
 *
 * A test file that uses these helpers is expected to declare (at minimum):
 *
 *   vi.mock('@actions/core')
 *   vi.mock('@actions/github', () => ({
 *     getOctokit: vi.fn(),
 *     context: { payload: {} }
 *   }))
 *   vi.mock('node:fs')
 *   vi.mock('@actions/exec')
 *   vi.mock('@actions/tool-cache')
 *   vi.mock('@actions/artifact')
 *   vi.mock('../src/rpc')
 *
 * See docs/testing.md for the full walkthrough.
 */
import { vi } from 'vitest'
import * as core from '@actions/core'
import { context } from '@actions/github'
import { Vet } from '../../src/vet'

type VetConfigArg = ConstructorParameters<typeof Vet>[0]

/**
 * The standard GitHub Actions environment for a hosted runner. Override
 * individual values per test via `stubGitHubActionsEnv`.
 */
export const defaultActionsEnv: Record<string, string> = {
  GITHUB_TOKEN: 'mock-token',
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_REPOSITORY_OWNER: 'owner',
  GITHUB_BASE_REF: 'main',
  GITHUB_HEAD_REF: 'feature-branch',
  GITHUB_REF_NAME: 'feature-branch',
  RUNNER_TEMP: '/tmp'
}

/**
 * Stub the GitHub Actions runner environment using `vi.stubEnv`. Pass overrides
 * to change or add variables for a specific test. Returns the resolved env map.
 *
 * Remember to enable `vi.unstubAllEnvs()` (or `unstubEnvs: true` in the Vitest
 * config) between tests so stubs don't leak.
 */
export function stubGitHubActionsEnv(
  overrides: Record<string, string> = {}
): Record<string, string> {
  const env = { ...defaultActionsEnv, ...overrides }
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value)
  }
  return env
}

export interface MockOctokit {
  rest: {
    issues: {
      listComments: ReturnType<typeof vi.fn>
      createComment: ReturnType<typeof vi.fn>
      updateComment: ReturnType<typeof vi.fn>
    }
    repos: {
      getLatestRelease: ReturnType<typeof vi.fn>
      compareCommitsWithBasehead: ReturnType<typeof vi.fn>
      getContent: ReturnType<typeof vi.fn>
    }
  }
}

/**
 * Build a mock Octokit with every REST endpoint the action calls stubbed as a
 * `vi.fn()`. Configure behaviour per test on the returned object, e.g.
 *
 *   octokit.rest.repos.getContent.mockResolvedValue(getContentRawResponse('...'))
 */
export function createMockOctokit(): MockOctokit {
  return {
    rest: {
      issues: {
        listComments: vi.fn(),
        createComment: vi.fn(),
        updateComment: vi.fn()
      },
      repos: {
        getLatestRelease: vi.fn(),
        compareCommitsWithBasehead: vi.fn(),
        getContent: vi.fn()
      }
    }
  }
}

export interface MockCommentsProxyClient {
  createPullRequestComment: ReturnType<typeof vi.fn>
}

/**
 * Build a mock GitHub Comments Proxy client used for the forked-PR comment
 * fallback path (see Vet.addOrUpdatePullRequestCommentWithGitHubCommentsProxy).
 */
export function createMockCommentsProxyClient(): MockCommentsProxyClient {
  return {
    createPullRequestComment: vi.fn()
  }
}

export interface TestVetDeps {
  octokit?: MockOctokit
  proxyClient?: MockCommentsProxyClient
}

export interface TestVet {
  vet: Vet
  octokit: MockOctokit
  proxyClient: MockCommentsProxyClient
}

/**
 * Construct a `Vet` instance wired up for testing. Octokit and the comments
 * proxy client (both private fields populated in the constructor) are replaced
 * with mocks so no real network client is created. Pass partial config to
 * override the sensible defaults.
 */
export function createTestVet(
  config: Partial<VetConfigArg> = {},
  deps: TestVetDeps = {}
): TestVet {
  const octokit = deps.octokit ?? createMockOctokit()
  const proxyClient = deps.proxyClient ?? createMockCommentsProxyClient()

  const vet = new Vet({
    cloudMode: false,
    pullRequestNumber: 123,
    pullRequestComment: true,
    ...config
  })

  // @ts-expect-error - injecting mock octokit into private field
  vet.octokit = octokit
  // @ts-expect-error - injecting mock comments proxy client into private field
  vet.commentsProxyClient = proxyClient

  return { vet, octokit, proxyClient }
}

export interface VetBinaryLifecycleOptions {
  version?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runVetImpl?: (...args: any[]) => Promise<string>
}

/**
 * Stub the vet binary lifecycle (release lookup, download, extraction and
 * execution) so `Vet.run()` can be driven end to end without touching the
 * network or filesystem. By default `runVet` returns a parseable version banner
 * so `verifyVetBinary` succeeds.
 */
export function stubVetBinaryLifecycle(
  vet: Vet,
  options: VetBinaryLifecycleOptions = {}
): void {
  const version = options.version ?? '1.2.3'

  // @ts-expect-error - stubbing private method
  vet.getLatestRelease = vi
    .fn()
    .mockResolvedValue('https://example.com/vet.tar.gz')
  // @ts-expect-error - stubbing private method
  vet.downloadBinary = vi.fn().mockResolvedValue('/mock/vet.tar.gz')
  // @ts-expect-error - stubbing private method
  vet.extractBinary = vi.fn().mockResolvedValue('/mock/bin')
  // @ts-expect-error - stubbing private method
  vet.runVet = options.runVetImpl
    ? vi.fn(options.runVetImpl)
    : vi.fn().mockResolvedValue(`Version: ${version}`)
}

export interface MockCoreSummary {
  clear: ReturnType<typeof vi.fn>
  addRaw: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
}

/**
 * Wire a chainable mock onto `core.summary` (requires `vi.mock('@actions/core')`
 * in the test file) and return it for assertions.
 */
export function createMockCoreSummary(): MockCoreSummary {
  const summary: MockCoreSummary = {
    clear: vi.fn().mockReturnThis(),
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined)
  }

  // core.summary's methods have precise signatures (returning Summary); treat
  // the target as a generic record so the chainable vi.fn() mocks assign cleanly.
  const mockedSummary = core.summary as unknown as Record<string, unknown>
  mockedSummary.clear = summary.clear
  mockedSummary.addRaw = summary.addRaw
  mockedSummary.write = summary.write

  return summary
}

/**
 * Set `context.payload.pull_request` so the forked-PR detection in
 * `Vet.pullRequestHeadRef()` can be exercised. Requires the test file to mock
 * `@actions/github` with a writable `context` object, e.g.
 * `vi.mock('@actions/github', () => ({ getOctokit: vi.fn(), context: { payload: {} } }))`.
 */
export function stubPullRequestContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pullRequest: Record<string, any> = {}
): Record<string, unknown> {
  const pr = {
    number: 123,
    head: {
      ref: 'feature-branch',
      repo: { full_name: 'owner/repo' }
    },
    ...pullRequest
  }

  context.payload = { pull_request: pr }
  return pr
}
