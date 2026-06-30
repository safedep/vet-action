/**
 * Unit tests for the action's main entrypoint, src/main.ts
 *
 * `run()` reads inputs via @actions/core, the event payload from
 * GITHUB_EVENT_PATH and delegates to the Vet class. Here we mock Vet so the
 * action's input parsing and wiring can be verified without running a scan.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import * as core from '@actions/core'
import { Vet } from '../src/vet'
import * as main from '../src/main'
import { samplePullRequestEventJson } from './helpers/fixtures'

vi.mock('@actions/core')
vi.mock('@actions/github', () => ({
  context: { payload: { pull_request: { number: 42 } } }
}))
vi.mock('node:fs')

// Replace Vet with a mock that records constructor args and exposes a stubbed
// run(). vi.hoisted lets the factory reference the run spy.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }))
vi.mock('../src/vet', () => ({
  Vet: vi.fn(() => ({ run: runMock }))
}))

const VetMock = vi.mocked(Vet)

const stringInputs: Record<string, string> = {
  policy: 'policy.yml',
  'policy-v2': '',
  'cloud-key': 'secret-key',
  'cloud-tenant': 'acme',
  version: 'v1.2.3',
  'exception-file': 'exceptions.yml',
  'trusted-registries': 'https://a.example.com, https://b.example.com',
  timeout: '300',
  exclude: 'docs/**, **/test/**\nvendor/**'
}

const booleanInputs: Record<string, boolean> = {
  cloud: true,
  'upload-sarif': true,
  'add-step-summary': false,
  'enable-comments-proxy': true,
  paranoid: false
}

describe('run', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllEnvs()

    // vi.resetAllMocks() clears the Vet factory implementation; re-arm it so
    // `new Vet()` returns an object exposing the stubbed run().
    VetMock.mockImplementation(() => ({ run: runMock }) as unknown as Vet)

    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request')
    vi.stubEnv('GITHUB_EVENT_PATH', '/github/event.json')

    vi.mocked(core.getInput).mockImplementation(
      name => stringInputs[name] ?? ''
    )
    vi.mocked(core.getBooleanInput).mockImplementation(
      name => booleanInputs[name] ?? false
    )
    vi.mocked(fs.readFileSync).mockReturnValue(samplePullRequestEventJson)
    runMock.mockResolvedValue('report.sarif')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('constructs Vet with the parsed inputs', async () => {
    await main.run()

    expect(VetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: 'policy.yml',
        apiKey: 'secret-key',
        tenant: 'acme',
        version: 'v1.2.3',
        cloudMode: true,
        timeout: '300',
        exceptionFile: 'exceptions.yml',
        uploadSarif: true,
        addStepSummary: false,
        enableGitHubCommentsProxy: true,
        paranoid: false,
        pullRequestNumber: 42,
        pullRequestComment: true
      })
    )
  })

  it('splits exclude and trusted-registries on commas and newlines', async () => {
    await main.run()

    expect(VetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        exclusionPatterns: ['docs/**', '**/test/**', 'vendor/**'],
        trustedRegistries: ['https://a.example.com', 'https://b.example.com']
      })
    )
  })

  it('reads the event payload from GITHUB_EVENT_PATH and runs the action', async () => {
    await main.run()

    expect(fs.readFileSync).toHaveBeenCalledWith('/github/event.json', 'utf8')
    expect(runMock).toHaveBeenCalledWith(
      'pull_request',
      JSON.parse(samplePullRequestEventJson)
    )
  })

  it('sets the report output on success', async () => {
    await main.run()

    expect(core.setOutput).toHaveBeenCalledWith('report', 'report.sarif')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('fails the action when run throws', async () => {
    runMock.mockRejectedValue(new Error('scan failed'))

    await main.run()

    expect(core.setFailed).toHaveBeenCalledWith('scan failed')
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('fails the action when the event payload cannot be read', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    await main.run()

    expect(core.setFailed).toHaveBeenCalledWith('ENOENT')
  })
})
