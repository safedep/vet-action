import { createGrpcTransport } from '@connectrpc/connect-node'
import { Client, createClient, Transport } from '@connectrpc/connect'
import { GitHubCommentsProxyService } from '@buf/safedep_api.bufbuild_es/safedep/services/ghcp/v1/ghcp_pb'

const ghcpApiBaseUrl = 'https://ghcp-integrations.safedep.io'

const createTransport = (apiUrl: string): Transport => {
  return createGrpcTransport({ baseUrl: apiUrl })
}

export const createGitHubCommentsProxyServiceClient = (): Client<
  typeof GitHubCommentsProxyService
> => {
  const transport = createTransport(ghcpApiBaseUrl)
  return createClient(GitHubCommentsProxyService, transport)
}
