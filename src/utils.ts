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

export function matchesPath(filePath: string, targetPath: string): boolean {
  // Normalize and remove trailing slashes

  /* eslint-disable @typescript-eslint/explicit-function-return-type */
  /* eslint-disable no-useless-escape */
  const normalize = (p: string) => path.normalize(p).replace(/[\/\\]+$/, '')

  return normalize(filePath) === normalize(targetPath)
}
