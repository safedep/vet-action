import { createGrpcTransport } from '@connectrpc/connect-node'
import { createClient, type Interceptor } from '@connectrpc/connect'
import { GitHubCommentsProxyService } from '@buf/safedep_api.bufbuild_es/safedep/services/ghcp/v1/ghcp_pb'

const ghcpApiBaseUrl = 'https://ghcp-integrations.safedep.io'

const createTransport = (apiUrl: string) => {
  return createGrpcTransport({ baseUrl: apiUrl })
}

export const createGitHubCommentsProxyServiceClient = () => {
  const transport = createTransport(ghcpApiBaseUrl)
  return createClient(GitHubCommentsProxyService, transport)
}
