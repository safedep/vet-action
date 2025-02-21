/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import { describe, it, expect, beforeEach, vi, SpyInstance } from 'vitest'
import * as core from '@actions/core'
import * as main from '../src/main'

// Mock the action's main function
const runMock = vi.spyOn(main, 'run')

// Other utilities
const timeRegex = /^\d{2}:\d{2}:\d{2}/

// Mock the GitHub Actions core library
let debugMock: SpyInstance
let errorMock: SpyInstance
let getInputMock: SpyInstance
let setFailedMock: SpyInstance
let setOutputMock: SpyInstance

describe('action', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    debugMock = vi.spyOn(core, 'debug').mockImplementation()
    errorMock = vi.spyOn(core, 'error').mockImplementation()
    getInputMock = vi.spyOn(core, 'getInput').mockImplementation()
    setFailedMock = vi.spyOn(core, 'setFailed').mockImplementation()
    setOutputMock = vi.spyOn(core, 'setOutput').mockImplementation()
  })

  it('sets the output when the action succeeds', async () => {
    await main.run()

    expect(runMock).toHaveReturned()
    expect(errorMock).not.toHaveBeenCalled()
  })
})
