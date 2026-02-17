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

    const policyV2: string = core.getInput('policy-v2', {
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

    const timeout: string = core.getInput('timeout', {
      required: false
    })

    const uploadSarif: boolean = core.getBooleanInput('upload-sarif', {
      required: false
    })

    const addStepSummary: boolean = core.getBooleanInput('add-step-summary', {
      required: false
    })

    const exclusionPatterns: string = core.getInput('exclude', {
      required: false,
      trimWhitespace: true
    })

    const enableGitHubCommentsProxy: boolean = core.getBooleanInput(
      'enable-comments-proxy',
      {
        required: false
      }
    )

    const paranoid: boolean = core.getBooleanInput('paranoid', {
      required: false
    })

    const eventName = process.env.GITHUB_EVENT_NAME as string
    const eventJson = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH as string, 'utf8')
    )

    core.debug(
      // log which policy file is used, policyV2 takes priority in logging then v1
      `Running vet with policy: ${policyV2.length !== 0 ? policyV2 : policy.length !== 0 ? policy : '<default policy v1>'}  cloudMode: ${cloudMode} version: ${version.length === 0 ? '<latest>' : version}`
    )

    const vet = new Vet({
      apiKey: cloudKey,
      tenant: cloudTenant,
      policy,
      policyV2,
      version,
      cloudMode,
      timeout,
      pullRequestNumber: context.payload.pull_request?.number,
      pullRequestComment: true,
      exceptionFile,
      uploadSarif,
      addStepSummary,
      enableGitHubCommentsProxy,
      paranoid,
      exclusionPatterns: exclusionPatterns
        .split(/,|\n/)
        .map(r => r.trim())
        .filter(r => r.length > 0),
      trustedRegistries: trustedRegistries
        .split(/,|\n/)
        .map(r => r.trim())
        .filter(r => r.length > 0)
    })

    const reportPath = await vet.run(eventName, eventJson)
    core.setOutput('report', reportPath)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
