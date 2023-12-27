import * as core from '@actions/core'
import { Vet } from './vet'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const apiKey: string = core.getInput('api-key', {
      required: false,
      trimWhitespace: true
    })
    const policy: string = core.getInput('policy', {
      required: false,
      trimWhitespace: true
    })
    const cloudMode: boolean = core.getBooleanInput('cloud', {
      required: false
    })

    core.debug(`Running vet with policy: ${policy} cloudMode: ${cloudMode}`)

    const vet = new Vet({ apiKey, policy, cloudMode })
    const report = await vet.run()

    core.setOutput('report', report)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
