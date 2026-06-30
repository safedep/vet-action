import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getDefaultVetPolicyFilePath,
  supportedLockfiles,
  getTempFilePath,
  isGithubRunnerDebug,
  isFilePathMatches,
  VetPolicyVersion
} from '../src/utils'

describe('getDefaultVetPolicyFilePath', () => {
  it('resolves policy.yml next to the bundled code', () => {
    expect(getDefaultVetPolicyFilePath()).toMatch(/policy\.yml$/)
  })
})

describe('supportedLockfiles', () => {
  it('includes the well known ecosystem lockfiles', () => {
    const lockfiles = supportedLockfiles()
    expect(lockfiles).toContain('package-lock.json')
    expect(lockfiles).toContain('go.mod')
    expect(lockfiles).toContain('Cargo.lock')
    expect(lockfiles).toContain('requirements.txt')
  })
})

describe('getTempFilePath', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns a unique path under RUNNER_TEMP', () => {
    vi.stubEnv('RUNNER_TEMP', '/tmp/runner')

    const first = getTempFilePath()
    const second = getTempFilePath()

    expect(first).toContain('vet-tmp-')
    // Use a separator-agnostic check so the assertion holds on Windows too.
    expect(first).toContain('runner')
    expect(first).not.toBe(second)
  })
})

describe('isGithubRunnerDebug', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is false when RUNNER_DEBUG is unset', () => {
    expect(isGithubRunnerDebug()).toBe(false)
  })

  it('is true when RUNNER_DEBUG is set to a truthy value', () => {
    vi.stubEnv('RUNNER_DEBUG', '1')
    expect(isGithubRunnerDebug()).toBe(true)
  })

  it('is false when RUNNER_DEBUG is explicitly "false"', () => {
    vi.stubEnv('RUNNER_DEBUG', 'false')
    expect(isGithubRunnerDebug()).toBe(false)
  })
})

describe('isFilePathMatches', () => {
  it('matches exact paths', () => {
    expect(isFilePathMatches('src/utils.ts', 'src/utils.ts')).toBe(true)
  })

  it('matches glob paths', () => {
    expect(
      isFilePathMatches(
        'src/migrations/001_initial.json',
        '**/migrations/*.json'
      )
    ).toBe(true)
  })

  it('does not match different paths', () => {
    expect(isFilePathMatches('src/utils.ts', 'src/vet.ts')).toBe(false)
  })

  it('matches paths with trailing slashes', () => {
    expect(isFilePathMatches('src/utils.ts/', 'src/utils.ts')).toBe(true)
  })
})

describe('VetPolicyVersion', () => {
  it('exposes v1 and v2 string values', () => {
    expect(VetPolicyVersion.V1).toBe('v1')
    expect(VetPolicyVersion.V2).toBe('v2')
  })
})
