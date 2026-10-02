import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app-secrets', () => ({
  secretMatches: async (_name: string, v: string | null) => v === 'test-key',
  getSecret: async () => null,
}));
vi.mock('@/lib/supabase', () => {
  const chain: any = { insert: async () => ({ error: null }), select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
  return { supabaseAdmin: { from: () => chain } };
});
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], get: () => undefined }) }));

const { POST, GET } = await import('./route');

const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-key', 'x-caller-label': 'vitest', ...headers },
      body: JSON.stringify(body),
    }),
  );
const MCP = { 'mcp-protocol-version': '2025-06-18' };

beforeEach(() => vi.clearAllMocks());

describe('site MCP — protocol layer', () => {
  it('rejects a missing token with 401 + WWW-Authenticate', async () => {
    const res = await POST(new Request('http://localhost/api/mcp', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/);
  });

  it('answers initialize with capabilities and the negotiated version', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.protocolVersion).toBe('2025-03-26');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe('site-mcp');
  });

  it('falls back to its newest version for an unknown one', async () => {
    const body = await (await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json();
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('accepts notifications/initialized with 202 and no body', async () => {
    const res = await call({ jsonrpc: '2.0', method: 'notifications/initialized' }, MCP);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('answers ping', async () => {
    expect((await (await call({ jsonrpc: '2.0', id: 2, method: 'ping' }, MCP)).json()).result).toEqual({});
  });

  it('lists tools with input schemas', async () => {
    const body = await (await call({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, MCP)).json();
    expect(body.result.tools.length).toBeGreaterThanOrEqual(27);
    for (const t of body.result.tools) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.inputSchema?.type).toBe('object');
    }
  });

  it('runs a tool and returns MCP content', async () => {
    const body = await (await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_pages', arguments: {} } }, MCP)).json();
    expect(body.result.content[0].type).toBe('text');
  });

  it('MCP clients: a failing tool is an isError result with HTTP 200', async () => {
    const res = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_section_schema', arguments: { section_id: 'nope' } } }, MCP);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/Unknown section/);
  });

  it('MCP clients: an unknown tool is a -32602 protocol error with HTTP 200', async () => {
    const res = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } }, MCP);
    expect(res.status).toBe(200);
    expect((await res.json()).error.code).toBe(-32602);
  });

  it('legacy callers (no MCP-Protocol-Version) keep the old 400/404 behaviour', async () => {
    const fail = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_section_schema', arguments: { section_id: 'nope' } } });
    expect(fail.status).toBe(400);
    expect((await fail.json()).error.message).toMatch(/Unknown section/);
    const unknown = await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } });
    expect(unknown.status).toBe(404);
  });

  it('GET is 405 (no server-pushed stream)', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
