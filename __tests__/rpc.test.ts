import { describe, it, expect, vi, beforeEach } from 'vitest'

interface MockTransportRequest {
  header: Map<string, string>
}

type MockInterceptor = (
  next: (req: MockTransportRequest) => Promise<unknown>
) => (req: MockTransportRequest) => Promise<unknown>

interface MockTransportOptions {
  baseUrl: string
  interceptors: MockInterceptor[]
}

// Capture the connect transport/client factories so we can inspect how the rpc
// module wires them up (base URL, interceptors). The transport factory is given
// a typed parameter so `.mock.calls` is well-typed when we assert on it.
const { createGrpcTransport, createClient } = vi.hoisted(() => ({
  createGrpcTransport: vi.fn((_options: MockTransportOptions) => ({
    kind: 'transport'
  })),
  createClient: vi.fn(() => ({ kind: 'client' }))
}))

vi.mock('@connectrpc/connect-node', () => ({ createGrpcTransport }))
vi.mock('@connectrpc/connect', () => ({ createClient }))
vi.mock(
  '@buf/safedep_api.bufbuild_es/safedep/services/ghcp/v1/ghcp_pb',
  () => ({ GitHubCommentsProxyService: { typeName: 'ghcp.v1' } })
)

import { createGitHubCommentsProxyServiceClient } from '../src/rpc'

describe('createGitHubCommentsProxyServiceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a client against the GHCP base URL', () => {
    const client = createGitHubCommentsProxyServiceClient('my-token')

    expect(client).toEqual({ kind: 'client' })
    expect(createGrpcTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://ghcp-integrations.safedep.io'
      })
    )
    expect(createClient).toHaveBeenCalledWith(
      { typeName: 'ghcp.v1' },
      { kind: 'transport' }
    )
  })

  it('registers an interceptor that sets the bearer auth header', async () => {
    createGitHubCommentsProxyServiceClient('my-token')

    const transportOptions = createGrpcTransport.mock.calls[0][0]
    expect(transportOptions.interceptors).toHaveLength(1)

    const interceptor = transportOptions.interceptors[0]
    const next = vi.fn().mockResolvedValue('ok')
    const req = { header: new Map<string, string>() }

    const result = await interceptor(next)(req)

    expect(req.header.get('authorization')).toBe('Bearer my-token')
    expect(next).toHaveBeenCalledWith(req)
    expect(result).toBe('ok')
  })
})
