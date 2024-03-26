import * as core from '@actions/core'
import fs from 'node:fs'
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

    const eventName = process.env.GITHUB_EVENT_NAME as string
    const eventJson = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH as string, 'utf8')
    )

    core.debug(`Running vet with policy: ${policy} cloudMode: ${cloudMode}`)

    const vet = new Vet({
      apiKey,
      policy,
      cloudMode,
      pullRequestComment: true
    })

    const reportPath = await vet.run(eventName, eventJson)
    core.setOutput('report', reportPath)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
