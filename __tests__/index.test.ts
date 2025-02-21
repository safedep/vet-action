/**
 * Unit tests for the action's entrypoint, src/index.ts
 */

import { describe, it, expect, vi } from 'vitest'
import * as main from '../src/main'

// Mock the action's entrypoint
const runMock = vi.spyOn(main, 'run').mockImplementation()

describe('index', () => {
  it('calls run when imported', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await import('../src/index')

    expect(runMock).toHaveBeenCalled()
  })
})
