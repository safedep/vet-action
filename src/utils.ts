import path from 'node:path'

// eslint-disable-next-line no-shadow
export enum VetPolicyVersion {
  V1 = 'v1',
  V2 = 'v2'
}

export function getDefaultVetPolicyV2FilePath(): string {
  const currentFilePath = __filename
  const policyFilePath = path.join(
    path.dirname(currentFilePath),
    'policy-v2.yml'
  )

  return policyFilePath
}

export function supportedLockfiles(): string[] {
  return [
    'Gemfile.lock',
    'package-lock.json',
    'yarn.lock',
    'Pipfile.lock',
    'poetry.lock',
    'go.mod',
    'pom.xml',
    'gradle.lockfile',
    'requirements.txt',
    'pnpm-lock.yaml',
    'uv.lock',
    'Cargo.lock'
  ]
}

export function getTempFilePath(): string {
  const tempDir = process.env.RUNNER_TEMP as string
  return path.join(tempDir, `vet-tmp-${Math.random().toString(36)}`)
}

export function isGithubRunnerDebug(): boolean {
  return (process.env.RUNNER_DEBUG ?? 'false') !== 'false'
}

export function isFilePathMatches(filePath: string, pattern: string): boolean {
  return path.matchesGlob(filePath, pattern)
}
