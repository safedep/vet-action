# Testing

This document describes how `vet-action` is tested and how to write new tests.
The action is mostly glue between GitHub Actions, the GitHub API and the `vet`
binary, so the bulk of testing is about **mocking those boundaries** and
asserting on the business logic in between.

## Running the tests

The project uses [Vitest](https://vitest.dev/). The configuration lives in
[`vitest.config.ts`](../vitest.config.ts).

```bash
# Watch mode (re-runs on change)
npm test

# Single run (used in CI)
npm run ci-test

# Single run with a coverage report
npm run coverage
```

Coverage is collected with the `v8` provider and is scoped to `./src/**`.

## Test layout

```
__tests__/
├── helpers/
│   ├── mocks.ts        # reusable GitHub Actions / API / vet binary mocks
│   └── fixtures.ts     # sample API responses and event payloads
├── vet.test.ts         # Vet class (the core business logic)
├── utils.test.ts       # pure helpers in src/utils.ts
├── rpc.test.ts         # GitHub Comments Proxy client wiring
├── main.test.ts        # action entrypoint / input parsing
└── index.test.ts       # bootstraps run()
```

All tests live under `__tests__/`. The source under test stays in `src/`. Note
that `__tests__/` is excluded from ESLint (see
[`.eslintrc.yml`](../.github/linters/.eslintrc.yml)), which keeps the test setup
free to use `any` and `@ts-expect-error` where mocking requires it.

## Mocking GitHub Actions and the GitHub API

Almost everything the action does touches a side effect: reading inputs
(`@actions/core`), the GitHub API (`@actions/github` / Octokit), the workflow
context, the runner environment, the filesystem and the `vet` binary. The
helpers in [`__tests__/helpers/mocks.ts`](../__tests__/helpers/mocks.ts)
centralize this setup so a test only needs to describe the behaviour it cares
about.

### `vi.mock` is hoisted — declare it in the test file

Vitest hoists `vi.mock('<module>')` calls to the top of the file, **before**
imports. Because of that, the module mock _declarations_ cannot live in a helper
— they must be in each test file. The helpers cover the repetitive _setup_ that
runs inside `beforeEach`/`it`, not the declarations.

A typical `vet.test.ts` header looks like this:

```ts
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
```

`@actions/github` is given an explicit factory with a **writable** `context`
object so tests can set `context.payload.pull_request` (see
`stubPullRequestContext`).

### Helper reference

| Helper                               | Purpose                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `stubGitHubActionsEnv(overrides?)`   | `vi.stubEnv` for the standard `GITHUB_*` / `RUNNER_TEMP` runner variables.                        |
| `createMockOctokit()`                | Octokit with every REST endpoint the action calls stubbed as `vi.fn()`.                           |
| `createMockCommentsProxyClient()`    | Mock GitHub Comments Proxy client (forked-PR comment fallback).                                   |
| `createTestVet(config?, deps?)`      | Builds a `Vet`, injects the mock Octokit + proxy client, returns `{ vet, octokit, proxyClient }`. |
| `stubVetBinaryLifecycle(vet, opts?)` | Stubs release lookup, download, extraction and `runVet` so `run()` works without a binary.        |
| `createMockCoreSummary()`            | Wires a chainable mock onto `core.summary` and returns it.                                        |
| `stubPullRequestContext(pr?)`        | Sets `context.payload.pull_request` for forked-PR detection.                                      |

### Example: a new PR-handling test

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  stubGitHubActionsEnv,
  createTestVet,
  stubPullRequestContext
} from './helpers/mocks'
import { changedLockfileFile, compareCommitsResponse } from './helpers/fixtures'

vi.mock('@actions/core')
vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(),
  context: { payload: {} }
}))
vi.mock('node:fs')
vi.mock('../src/rpc')

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  stubGitHubActionsEnv()
})

it('lists the changed files for a PR', async () => {
  stubPullRequestContext()
  const { vet, octokit } = createTestVet()
  octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue(
    compareCommitsResponse([changedLockfileFile('package-lock.json')])
  )

  // @ts-expect-error - exercising a private method
  const files = await vet.pullRequestGetChangedFiles()
  expect(files[0].filename).toBe('package-lock.json')
})
```

Because `Vet` creates its Octokit and proxy client in the constructor, they are
private fields. `createTestVet` injects the mocks (using `@ts-expect-error`) and
returns them so you can configure responses and assert on calls. Private methods
are called/stubbed the same way — `// @ts-expect-error` plus the call.

## Fixtures

[`__tests__/helpers/fixtures.ts`](../__tests__/helpers/fixtures.ts) provides
factory functions that return the shapes of the GitHub API responses and event
payloads the action consumes:

- `changedLockfileFile(name, overrides?)`
- `compareCommitsResponse(files, status?, httpStatus?)`
- `getContentRawResponse(content, httpStatus?)`
- `listCommentsResponse(comments)`
- `getLatestReleaseResponse(tag)`
- `samplePullRequestPayload`, `sampleForkedPullRequestPayload`
- `samplePushEventJson`, `samplePullRequestEventJson`

Prefer adding a factory here over hand-building response objects inline, so the
shape lives in one place.

## Gotcha: `require()` is not intercepted by `vi.mock`

`src/vet.ts` loads a few packages via CommonJS `require()` rather than `import`:

```ts
const exec = require('@actions/exec')
const tc = require('@actions/tool-cache')
const { DefaultArtifactClient } = require('@actions/artifact')
```

Vitest's `vi.mock` intercepts ES module `import`s, **not** `require()` — a
`require('@actions/artifact')` returns the real module even with
`vi.mock('@actions/artifact')` in place. Tests therefore avoid exercising these
modules directly and instead **stub the `Vet` methods that wrap them**:
`stubVetBinaryLifecycle` replaces `getLatestRelease`, `downloadBinary`,
`extractBinary` and `runVet`, and the SARIF artifact upload branch in
`runOnPush` is avoided by setting `uploadSarif: false`. Keep this in mind when
adding coverage for any code path that goes through a `require()`d module.

## Conventions

- Reset mock state in `beforeEach` with `vi.resetAllMocks()`, then re-stub the
  environment with `stubGitHubActionsEnv()`. `resetAllMocks()` also clears mock
  _implementations_, so re-arm any factory mock (e.g. a mocked class) inside
  `beforeEach`.
- Use `vi.unstubAllEnvs()` between tests so `vi.stubEnv` values do not leak.
- Test private methods via `// @ts-expect-error` and a direct call — this is an
  accepted pattern in this codebase for unit-testing internals.
- Build response data with the fixture factories rather than inline literals.
