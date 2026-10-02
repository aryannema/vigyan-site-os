'use server';

const MCP_URL = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/mcp`;
const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.MCP_SECRET_KEY}`,
};

async function callMcp(tool: string, args: Record<string, unknown>) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return JSON.parse(json.result?.content?.[0]?.text ?? '{}');
}

export async function updateSection(sectionId: string, contentData: unknown) {
  return callMcp('update_section_content', { section_id: sectionId, content_data: contentData });
}

export async function previewSection(sectionId: string, contentData: unknown) {
  return callMcp('preview_section_update', { section_id: sectionId, content_data: contentData });
}

export async function rollbackSection(sectionId: string, versionId: string) {
  return callMcp('rollback_section', { section_id: sectionId, version_id: versionId });
}
