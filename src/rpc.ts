import { createGrpcTransport } from '@connectrpc/connect-node'
import { Client, createClient, Transport } from '@connectrpc/connect'
import { GitHubCommentsProxyService } from '@buf/safedep_api.bufbuild_es/safedep/services/ghcp/v1/ghcp_pb'

const ghcpApiBaseUrl = 'https://ghcp-integrations.safedep.io'

function authenticationInterceptor(token: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (next: any) => async (req: any) => {
    req.header.set('authorization', `Bearer ${token}`)
    return await next(req)
  }
}

const createTransport = (apiUrl: string, token: string): Transport => {
  return createGrpcTransport({
    baseUrl: apiUrl,
    interceptors: [authenticationInterceptor(token)]
  })
}

export const createGitHubCommentsProxyServiceClient = (
  token: string
): Client<typeof GitHubCommentsProxyService> => {
  const transport = createTransport(ghcpApiBaseUrl, token)
  return createClient(GitHubCommentsProxyService, transport)
}
