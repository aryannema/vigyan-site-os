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
  return json.result?.content?.[0]?.text;
}

/** Build a JOB_SCHEMA-clean payload from the form, omitting empty/optional fields. */
function buildJobArgs(formData: FormData): Record<string, unknown> {
  const str = (k: string) => {
    const v = (formData.get(k) as string | null)?.trim();
    return v ? v : undefined;
  };
  const num = (k: string) => {
    const v = (formData.get(k) as string | null)?.trim();
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const lines = (k: string) => {
    const v = (formData.get(k) as string | null) ?? '';
    const arr = v.split('\n').map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  };

  const args: Record<string, unknown> = {
    title: str('title'),
    slug: str('slug'),
    employment_type: str('employment_type'),
    // Sanitised downstream: every careers write here goes through callMcp(),
    // and create_job/update_job run sanitizePayload() before touching the
    // database. Do NOT add a second sanitiser at this layer -- it would allow
    // tags MCP then strips, so the form would silently lose formatting an
    // author was shown as accepted.
    description: str('description'),
    status: str('status') || 'open',
  };

  const optional: Record<string, unknown> = {
    department: str('department'),
    location: str('location'),
    workplace_type: str('workplace_type'),
    salary_min: num('salary_min'),
    salary_max: num('salary_max'),
    salary_currency: str('salary_currency'),
    salary_period: str('salary_period'),
    responsibilities: lines('responsibilities'),
    requirements: lines('requirements'),
    apply_url: str('apply_url'),
    apply_email: str('apply_email'),
    valid_through: str('valid_through'),
  };
  for (const [k, v] of Object.entries(optional)) {
    if (v !== undefined) args[k] = v;
  }
  return args;
}

export async function createJob(formData: FormData) {
  return callMcp('create_job', buildJobArgs(formData));
}

export async function updateJob(id: string, formData: FormData) {
  return callMcp('update_job', { id, ...buildJobArgs(formData) });
}

export async function deleteJob(id: string) {
  return callMcp('delete_job', { id });
}
