import * as core from '@actions/core'
import { context } from '@actions/github'
import fs from 'node:fs'
import { Vet } from './vet'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const policy: string = core.getInput('policy', {
      required: false,
      trimWhitespace: true
    })

    const cloudMode: boolean = core.getBooleanInput('cloud', {
      required: false
    })

    const cloudKey: string = core.getInput('cloud-key', {
      required: false,
      trimWhitespace: true
    })

    const cloudTenant: string = core.getInput('cloud-tenant', {
      required: false,
      trimWhitespace: true
    })

    const version: string = core.getInput('version', {
      required: false,
      trimWhitespace: true
    })

    const exceptionFile: string = core.getInput('exception-file', {
      required: false,
      trimWhitespace: true
    })

    const trustedRegistries: string = core.getInput('trusted-registries', {
      required: false,
      trimWhitespace: true
    })

    const eventName = process.env.GITHUB_EVENT_NAME as string
    const eventJson = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH as string, 'utf8')
    )

    core.debug(
      `Running vet with policy: ${
        policy.length === 0 ? '<default>' : policy
      } cloudMode: ${cloudMode} version: ${
        version.length === 0 ? '<latest>' : version
      }`
    )

    const vet = new Vet({
      apiKey: cloudKey,
      tenant: cloudTenant,
      policy,
      version,
      cloudMode,
      pullRequestNumber: context.payload.pull_request?.number,
      pullRequestComment: true,
      exceptionFile,
      trustedRegistries: trustedRegistries
        .split(',')
        .map(r => r.trim())
        .filter(r => r.length > 0)
    })

    const reportPath = await vet.run(eventName, eventJson)
    core.setOutput('report', reportPath)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
