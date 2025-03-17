import path from 'node:path'

export function getDefaultVetPolicyFilePath(): string {
  const currentFilePath = __filename
  const policyFilePath = path.join(path.dirname(currentFilePath), 'policy.yml')

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
    'uv.lock'
  ]
}

export function getTempFilePath(): string {
  const tempDir = process.env.RUNNER_TEMP as string
  return path.join(tempDir, `vet-tmp-${Math.random().toString(36)}`)
}

export function isGithubRunnerDebug(): boolean {
  return (process.env.RUNNER_DEBUG ?? 'false') !== 'false'
}
