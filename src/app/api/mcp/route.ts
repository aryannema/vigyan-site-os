import { secretMatches } from '@/lib/app-secrets';
import { NextResponse } from 'next/server';

import { checkFloor, maxDiscountBp } from '@/lib/margin';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import sanitizeHtml from 'sanitize-html';
import { ALLOWED_INLINE } from '@/lib/sanitize';
import { CONTENT_SCHEMAS } from '@/lib/content-schema';
import { BLOG_POST_SCHEMA, BLOG_CATEGORIES } from '@/lib/blog-schema';
import { JOB_SCHEMA, JOB_STATUSES } from '@/lib/careers-schema';
import { onBlogPostPublished } from '@/lib/blog-publish-hooks';
import { pingIndexNow } from '@/lib/indexnow';
import { revalidateFor } from '@/lib/content-revalidation';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_ID || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function sanitizePayload(obj: any): any {
  if (typeof obj === 'string') {
    // The shared sanitiser (src/lib/sanitize.ts), not a local copy — two
    // sanitisers drift, and the weaker one becomes the way in.
    return sanitizeHtml(obj, ALLOWED_INLINE);
  }
  if (Array.isArray(obj)) return obj.map(sanitizePayload);
  if (typeof obj === 'object' && obj !== null) {
    const sanitized: any = {};
    for (const key in obj) sanitized[key] = sanitizePayload(obj[key]);
    return sanitized;
  }
  return obj;
}

const TOOLS = [
  {
    name: 'list_pages',
    description: 'List all manageable pages and their respective section IDs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_section_schema',
    description: 'Retrieve the JSON Schema and description for a specific section.',
    inputSchema: {
      type: 'object',
      properties: {
        section_id: { type: 'string', description: 'The unique ID for the section.' },
      },
      required: ['section_id'],
    },
  },
  {
    name: 'get_section_content',
    description: 'Retrieve the current content for a specific section.',
    inputSchema: {
      type: 'object',
      properties: { section_id: { type: 'string' } },
      required: ['section_id'],
    },
  },
  {
    name: 'update_section_content',
    description: 'Validate and update the content for a specific section. Creates a history record before overwriting.',
    inputSchema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        content_data: { type: 'object', description: 'The new content payload matching the section schema.' },
      },
      required: ['section_id', 'content_data'],
    },
  },
  {
    name: 'preview_section_update',
    description: 'Dry-run for updating a section. Validates input and shows what would be saved without writing to DB.',
    inputSchema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        content_data: { type: 'object' },
      },
      required: ['section_id', 'content_data'],
    },
  },
  {
    name: 'get_section_history',
    description: 'Retrieve the last N versions of a section content.',
    inputSchema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        limit: { type: 'number', default: 5 },
      },
      required: ['section_id'],
    },
  },
  {
    name: 'rollback_section',
    description: 'Restore a previous version of a section from history.',
    inputSchema: {
      type: 'object',
      properties: {
        section_id: { type: 'string' },
        version_id: { type: 'string', description: 'The UUID of the version to restore.' },
      },
      required: ['section_id', 'version_id'],
    },
  },
  {
    name: 'create_blog_post',
    description: 'Create a new blog post with full metadata and content blocks.',
    inputSchema: BLOG_POST_SCHEMA,
  },
  {
    name: 'update_blog_post',
    description: 'Update an existing blog post. Supports partial updates.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        ...BLOG_POST_SCHEMA.properties,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'delete_blog_post',
    description: 'Permanently delete a blog post.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    },
  },
  {
    name: 'list_blog_posts',
    description: 'List blog posts with filtering and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'published', 'all'], default: 'published' },
        category: { type: 'string', enum: BLOG_CATEGORIES },
        limit: { type: 'number', default: 10, maximum: 50 },
        offset: { type: 'number', default: 0 },
      },
    },
  },
  {
    name: 'get_blog_post',
    description: 'Retrieve a full blog post by ID or slug.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string' },
      },
      anyOf: [{ required: ['id'] }, { required: ['slug'] }],
    },
  },
  {
    name: 'get_blog_categories',
    description: 'List allowed categories with their post counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_job',
    description: 'Create a new career opening (job posting) with JD, employment type, pay, location, etc.',
    inputSchema: JOB_SCHEMA,
  },
  {
    name: 'update_job',
    description: 'Update an existing career opening. Supports partial updates.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        ...JOB_SCHEMA.properties,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'delete_job',
    description: 'Permanently delete a career opening.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    },
  },
  {
    name: 'list_jobs',
    description: 'List career openings with optional status filter and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'open', 'closed', 'all'], default: 'open' },
        limit: { type: 'number', default: 20, maximum: 100 },
        offset: { type: 'number', default: 0 },
      },
    },
  },
  {
    name: 'get_job',
    description: 'Retrieve a full career opening by ID or slug.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string' },
      },
      anyOf: [{ required: ['id'] }, { required: ['slug'] }],
    },
  },
  {
    name: 'create_short_link',
    description:
      'Create a UTM-tagged short link (/go/<slug> -> target_url + utm_* params, appended at redirect time). ' +
      'Use list_short_links first to find an existing utm_campaign for a target_url (e.g. a blog post) so every ' +
      'platform share of the same content rolls up under one campaign name instead of fragmenting.',
    inputSchema: {
      type: 'object',
      required: ['slug', 'target_url'],
      properties: {
        slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        target_url: { type: 'string', format: 'uri' },
        utm_source: { type: 'string' },
        utm_medium: { type: 'string' },
        utm_campaign: { type: 'string' },
        utm_term: { type: 'string' },
        utm_content: { type: 'string' },
        platform: { type: 'string' },
        offer_type: {
          type: 'string',
          enum: ['free', 'lead_magnet', 'paid'],
          default: 'free',
          description:
            'Reporting label only, no ad-spend/payment flow behind it. "paid" = target is something sold via the existing products/checkout flow.',
        },
        status: { type: 'string', enum: ['draft', 'active', 'archived'], default: 'active' },
      },
    },
  },
  {
    name: 'list_short_links',
    description:
      'List short links, optionally filtered by target_url or utm_campaign — use to check whether a link ' +
      'already exists for a given target before creating a duplicate, and to look up its campaign name.',
    inputSchema: {
      type: 'object',
      properties: {
        target_url: { type: 'string' },
        utm_campaign: { type: 'string' },
        limit: { type: 'number', default: 20, maximum: 100 },
      },
    },
  },
  {
    name: 'get_site_settings',
    description:
      'Read all admin-editable site settings in one call: feature flags (public.feature_flags), ' +
      'operational + WhatsApp config (public.app_config), and footer social links (public.social_links). ' +
      'These are the same values shown at /admin/settings. Use this before set_* to see current state and exact keys.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_feature_flag',
    description:
      'Turn a site-wide feature flag on or off (public.feature_flags). Takes effect on the next request -- ' +
      'no redeploy. Call get_site_settings first for valid keys.',
    inputSchema: {
      type: 'object',
      required: ['key', 'enabled'],
      properties: {
        key: { type: 'string', description: 'e.g. whatsapp_live' },
        enabled: { type: 'boolean' },
      },
    },
  },
  {
    name: 'set_app_config',
    description:
      'Update an operational config value (public.app_config): OTP timings, rate limits, grace-period days, ' +
      'or the WhatsApp display/self-notify numbers and Graph API version. Numbers and strings both accepted -- ' +
      'pass whatever type the existing value uses (see get_site_settings). Never holds secrets; tokens stay in env.',
    inputSchema: {
      type: 'object',
      required: ['key', 'value'],
      properties: {
        key: { type: 'string', description: 'e.g. whatsapp_display_number, whatsapp_otp_expiry_minutes' },
        value: { type: ['string', 'number'], description: 'New value. Type must match the existing value.' },
      },
    },
  },
  {
    name: 'list_products',
    description:
      'List the sellable catalogue (public.products): title, slug, price, currency, status. ' +
      'Price is returned in BOTH paise (the stored value) and rupees (for reading). ' +
      'Call this before upsert_product or set_product_price to get exact slugs.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'active', 'archived'] },
      },
    },
  },
  {
    name: 'upsert_product',
    description:
      'Create or update a product by slug (public.products). Use this to add something to the ' +
      'catalogue, change its copy, or publish it by setting status to active.\n\n' +
      'SCOPE RULE (Razorpay account condition): a product may be our SaaS subscription, a one-off ' +
      'purchase, or our own service. It must NEVER be lead generation, a lead list, a lead-gen ' +
      'campaign, a "growth"/customer-acquisition package, or anything priced per lead. Refuse such ' +
      'a request and say why.',
    inputSchema: {
      type: 'object',
      required: ['slug', 'title'],
      properties: {
        slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: ['saas', 'one-off', 'service', 'blueprint'] },
        price_rupees: {
          type: 'number',
          description: 'Price in rupees; converted to paise for storage. 0 (the default) means "Request a quote" and shows no Buy button.',
        },
        currency: { type: 'string', default: 'INR' },
        status: { type: 'string', enum: ['draft', 'active', 'archived'], default: 'draft' },
        external_link: { type: 'string' },
      },
    },
  },
  {
    name: 'set_product_price',
    description:
      'Set just the price of an existing product, in rupees (stored as paise). Separate from ' +
      'upsert_product so a pricing change cannot accidentally rewrite the copy. Setting 0 removes ' +
      'the Buy button and reverts the offering to "Request a quote".',
    inputSchema: {
      type: 'object',
      required: ['slug', 'price_rupees'],
      properties: {
        slug: { type: 'string' },
        price_rupees: { type: 'number', minimum: 0 },
        currency: { type: 'string' },
      },
    },
  },
  {
    name: 'set_social_link',
    description:
      'Update a footer social link URL and/or its visibility (public.social_links). ' +
      'Platforms: linkedin, youtube, x, instagram, facebook, telegram.',
    inputSchema: {
      type: 'object',
      required: ['platform'],
      properties: {
        platform: { type: 'string', enum: ['linkedin', 'youtube', 'x', 'instagram', 'facebook', 'telegram'] },
        url: { type: 'string', format: 'uri' },
        enabled: { type: 'boolean' },
      },
    },
  },
];

// ── Tool -> (resource_key, action) mapping ──────────────────────────────────────
// Same resource_key vocabulary as action_audit_log's COMMENT ON TABLE tags (003)
// so mcp_audit_log and action_audit_log union cleanly in admin_unified_audit_log
// (012). Read-only tools map to no resource_key/action (not governed writes).
const TOOL_RESOURCE_MAP: Record<string, { resource_key: string; action: string }> = {
  update_section_content: { resource_key: 'cms', action: 'edit' },
  rollback_section: { resource_key: 'cms', action: 'edit' },
  create_blog_post: { resource_key: 'blog', action: 'create' },
  update_blog_post: { resource_key: 'blog', action: 'edit' },
  delete_blog_post: { resource_key: 'blog', action: 'delete' },
  create_job: { resource_key: 'careers', action: 'create' },
  update_job: { resource_key: 'careers', action: 'edit' },
  delete_job: { resource_key: 'careers', action: 'delete' },
  create_short_link: { resource_key: 'links', action: 'create' },
};

function targetIdFromArgs(args: any): string | null {
  return args?.id || args?.section_id || args?.slug || null;
}

async function logAudit(
  tool: string,
  args: any,
  success: boolean,
  callerIdentity: string,
  request: Request,
  error?: string
) {
  try {
    const mapping = TOOL_RESOURCE_MAP[tool];
    await supabaseAdmin.from('mcp_audit_log').insert({
      tool_name: tool,
      arguments: args,
      success,
      error_message: error,
      changed_by: callerIdentity,
      caller_identity: callerIdentity,
      resource_key: mapping?.resource_key ?? null,
      action: mapping?.action ?? null,
      target_id: mapping ? targetIdFromArgs(args) : null,
      after_data: mapping ? args : null,
      public_ip: getPublicIp(request),
      local_ip: sanitizeCallerLabel(request.headers.get(LOCAL_IP_HEADER)),
    });
  } catch (err) {
    console.error('[MCP Audit Log Failure]', err);
  }
}

// ── Caller identity ──────────────────────────────────────────────────────────────
// MCP_SECRET_KEY is a single shared secret, so authentication alone can't say
// WHICH automation made a given call. A caller identifies itself by sending
// X-Caller-Label — REQUIRED, not optional: a bearer-key request with no label
// is rejected outright (fail closed), not logged under a generic identity. This
// is a deliberate policy choice (2026-08-15): every governed write must be
// attributable to a specific caller, or it doesn't happen.
//
// This is a CLAIM, not an authentication: the bearer token proves only that the
// caller holds the shared key, and anyone holding it can send any label. It
// narrows "which of our agents did this" for cooperating callers; it is not
// evidence against an uncooperative one. This is the same distinction
// action_audit_log draws between `actor` and `actor_claim` (008).
//
// Bounded and character-restricted because the value is caller-controlled and
// is rendered back to operators from the audit log.
const CALLER_LABEL_HEADER = 'x-caller-label';
const LOCAL_IP_HEADER = 'x-caller-local-ip';
const MAX_CALLER_LABEL_LENGTH = 64;

function sanitizeCallerLabel(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, MAX_CALLER_LABEL_LENGTH);
  return cleaned || null;
}

// X-Forwarded-For is set by Coolify's Traefik proxy, not the caller -- this is
// an observed fact, not a claim, unlike caller label/local IP above.
function getPublicIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (!xff) return null;
  return xff.split(',')[0].trim() || null;
}

// ── Auth helper ────────────────────────────────────────────────────────────────
// Returns the caller identity string, or null if the request is not authorized.
// Two paths:
//   1. Bearer MCP_SECRET_KEY + required X-Caller-Label — automation/AI agents.
//      Fails closed (returns null) if the label is missing, even though the
//      bearer token itself is valid -- see "Caller identity" note above.
//   2. Valid Supabase session cookie with editor or admin role — human team
async function resolveCallerIdentity(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('authorization');

  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (await secretMatches('MCP_SECRET_KEY', bearer)) {
    const label = sanitizeCallerLabel(request.headers.get(CALLER_LABEL_HEADER));
    if (!label) return null;
    return `mcp-api-key:${label}`;
  }

  // Try session cookie
  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll() {},
    },
  });

  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return null;

  const { data: roleRecord } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (!roleRecord || !['editor', 'admin'].includes(roleRecord.role)) {
    return null;
  }

  return user.email || user.id;
}


/**
 * The pricing floor, for the MCP write paths.
 *
 * The admin UI enforces this inside its transaction. MCP writes through
 * supabaseAdmin and would otherwise walk straight past it -- an automation
 * caller could list a product at a price the admin form refuses, which is
 * exactly the kind of gap a second write path creates.
 */
async function assertPriceClearsFloor(pricePaise: number, discountBp?: number | null): Promise<void> {
  if (pricePaise <= 0) return;   // 0 is "request a quote", not a sale

  const { data } = await supabaseAdmin
    .from('app_config')
    .select('key, value')
    .like('key', 'pricing_%');
  const cfg = new Map((data ?? []).map((r) => [r.key, Number(r.value)]));

  const policy = {
    minNetPaise: cfg.get('pricing_min_net_paise') ?? 0,
    minNetBp: cfg.get('pricing_min_net_bp') ?? 0,
    gstRateBp: 1800,
    gatewayFeeBp: cfg.get('pricing_gateway_fee_bp') ?? 200,
    gatewayFeeGstBp: cfg.get('pricing_gateway_fee_gst_bp') ?? 1800,
    hostingPerSalePaise: cfg.get('pricing_hosting_per_sale_paise') ?? 0,
  };

  const check = checkFloor(pricePaise, policy);
  if (!check.ok) {
    throw new Error(
      `Refused: ${check.reason} The minimum workable price is ₹${(check.suggestedPricePaise / 100).toFixed(2)}.`,
    );
  }

  if (discountBp) {
    const discounted = pricePaise - Math.round((pricePaise * discountBp) / 10000);
    const after = checkFloor(discounted, policy);
    if (!after.ok) {
      throw new Error(
        `Refused: at ${discountBp / 100}% off this keeps only ₹${(after.netPaise / 100).toFixed(2)}. Most this price can carry is ${(maxDiscountBp(pricePaise, policy) / 100).toFixed(1)}%.`,
      );
    }
  }
}

// ── MCP protocol layer (Streamable HTTP, stateless) ─────────────────────────
// Real MCP clients (Claude Code, Codex, OpenCode, Antigravity, n8n's MCP Client)
// open with `initialize`, then send `MCP-Protocol-Version` on every request and
// expect tool failures as `isError` results with HTTP 200. Direct JSON-RPC callers
// (existing n8n HTTP workflows, scripts) send no such header and keep the exact
// responses they had before. No sessions and no server-pushed stream: the spec
// allows a server to answer GET with 405, and stateless servers need no session id.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'site-mcp', title: 'Site MCP', version: '2.0.0' };

function isMcpClient(request: Request, method?: string): boolean {
  return method === 'initialize' || Boolean(request.headers.get('mcp-protocol-version'));
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="site-mcp"' } },
  );
}

export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}

export async function POST(request: Request) {
  try {
    const callerIdentity = await resolveCallerIdentity(request);
    if (!callerIdentity) return unauthorized();

    const body = await request.json();
    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== '2.0') {
      return NextResponse.json({ error: 'Invalid JSON-RPC version' }, { status: 400 });
    }

    const mcp = isMcpClient(request, method);

    // Notifications carry no id and get no body (JSON-RPC 2.0 + Streamable HTTP).
    if (id === undefined && typeof method === 'string' && method.startsWith('notifications/')) {
      return new NextResponse(null, { status: 202 });
    }

    if (method === 'initialize') {
      const asked = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0];
      return NextResponse.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Tools for this website: page sections, blog posts, jobs, short links, products and prices, ' +
            'site settings and feature flags. Every call is audited under the authenticated caller.',
        },
      });
    }

    if (method === 'ping') {
      return NextResponse.json({ jsonrpc: '2.0', id, result: {} });
    }

    if (method === 'tools/list') {
      return NextResponse.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      let result: any = null;
      let error: any = null;

      try {
        switch (name) {
          case 'list_pages': {
            const pages: Record<string, string[]> = {};
            Object.keys(CONTENT_SCHEMAS).forEach(sid => {
              const page = sid.split('-')[0];
              if (!pages[page]) pages[page] = [];
              pages[page].push(sid);
            });
            result = { type: 'text', text: JSON.stringify(pages, null, 2) };
            break;
          }

          case 'get_section_schema': {
            if (!CONTENT_SCHEMAS[args.section_id]) {
              throw new Error(`Unknown section: ${args.section_id}`);
            }
            result = { type: 'text', text: JSON.stringify(CONTENT_SCHEMAS[args.section_id], null, 2) };
            break;
          }

          case 'get_section_content': {
            const { data: content } = await supabaseAdmin
              .from('site_content')
              .select('*')
              .eq('section_id', args.section_id)
              .single();
            result = {
              type: 'text',
              text: JSON.stringify(
                content?.content_data || { message: 'No content found in DB, using fallbacks.' },
                null, 2
              ),
            };
            break;
          }

          case 'preview_section_update':
          case 'update_section_content': {
            const schemaDef = CONTENT_SCHEMAS[args.section_id];
            if (!schemaDef) throw new Error(`Unknown section: ${args.section_id}`);

            const validate = ajv.compile(schemaDef.schema);
            const sanitizedData = sanitizePayload(args.content_data);
            const valid = validate(sanitizedData);

            if (!valid) {
              error = {
                code: -32602,
                message: `Validation failed for '${args.section_id}'`,
                data: validate.errors,
              };
              break;
            }

            if (name === 'preview_section_update') {
              result = {
                type: 'text',
                text: `Preview Success: Validated payload for ${args.section_id}:\n${JSON.stringify(sanitizedData, null, 2)}`,
              };
            } else {
              const { data: current } = await supabaseAdmin
                .from('site_content')
                .select('content_data')
                .eq('section_id', args.section_id)
                .single();

              if (current) {
                await supabaseAdmin.from('content_history').insert({
                  section_id: args.section_id,
                  content_data: current.content_data,
                  changed_by: callerIdentity,
                });
              }

              const { error: upsertError } = await supabaseAdmin.from('site_content').upsert({
                section_id: args.section_id,
                content_data: sanitizedData,
                updated_at: new Date().toISOString(),
              });

              if (upsertError) throw upsertError;
              // site_content drives page copy AND per-page SEO metadata
              // (lib/page-seo.ts), so an edit here can change a <title> on a
              // page that does not obviously belong to this section.
              revalidateFor({ kind: 'section' });
              result = { type: 'text', text: `Successfully updated ${args.section_id}` };
            }
            break;
          }

          case 'get_section_history': {
            const { data: history } = await supabaseAdmin
              .from('content_history')
              .select('*')
              .eq('section_id', args.section_id)
              .order('created_at', { ascending: false })
              .limit(args.limit || 5);
            result = { type: 'text', text: JSON.stringify(history, null, 2) };
            break;
          }

          case 'rollback_section': {
            const { data: version } = await supabaseAdmin
              .from('content_history')
              .select('content_data')
              .eq('id', args.version_id)
              .single();

            if (!version) throw new Error('Version not found');

            const { data: beforeRollback } = await supabaseAdmin
              .from('site_content')
              .select('content_data')
              .eq('section_id', args.section_id)
              .single();

            if (beforeRollback) {
              await supabaseAdmin.from('content_history').insert({
                section_id: args.section_id,
                content_data: beforeRollback.content_data,
                changed_by: `${callerIdentity}:rollback-archive`,
              });
            }

            await supabaseAdmin.from('site_content').upsert({
              section_id: args.section_id,
              content_data: version.content_data,
              updated_at: new Date().toISOString(),
            });

            result = {
              type: 'text',
              text: `Successfully rolled back ${args.section_id} to version ${args.version_id}`,
            };
            break;
          }

          case 'create_blog_post': {
            const validate = ajv.compile(BLOG_POST_SCHEMA);
            const sanitizedData = sanitizePayload(args);
            const valid = validate(sanitizedData);

            if (!valid) {
              error = { code: -32602, message: 'Validation failed', data: validate.errors };
              break;
            }

            const { data: existing } = await supabaseAdmin
              .from('posts')
              .select('id')
              .eq('slug', sanitizedData.slug)
              .single();

            if (existing) throw new Error(`Slug "${sanitizedData.slug}" is already in use.`);

            const payload = {
              ...sanitizedData,
              published_at:
                sanitizedData.published_at ||
                (sanitizedData.status === 'published' ? new Date().toISOString() : null),
              created_at: new Date().toISOString(),
            };

            const { data, error: insertError } = await supabaseAdmin
              .from('posts')
              .insert([payload])
              .select()
              .single();

            if (insertError) throw insertError;
            if (data.status === 'published') void onBlogPostPublished(data);
            // Refresh our own caches regardless of status: a draft still
            // changes nothing public, but a published post that is not
            // revalidated is exactly the stale-response bug that made
            // blog/[slug] force-dynamic in the first place.
            if (data.status === 'published') revalidateFor({ kind: 'blog_post', slug: data.slug });
            result = {
              type: 'text',
              text: `Successfully created blog post "${data.title}" with ID ${data.id}`,
            };
            break;
          }

          case 'update_blog_post': {
            const { id: postId, ...updateData } = args;
            const sanitizedData = sanitizePayload(updateData);

            const { data: current, error: fetchError } = await supabaseAdmin
              .from('posts')
              .select('*')
              .eq('id', postId)
              .single();

            if (fetchError || !current) throw new Error('Post not found');

            if (sanitizedData.slug && sanitizedData.slug !== current.slug) {
              const { data: existing } = await supabaseAdmin
                .from('posts')
                .select('id')
                .eq('slug', sanitizedData.slug)
                .single();
              if (existing) throw new Error(`Slug "${sanitizedData.slug}" is already in use.`);
            }

            const payload = {
              ...sanitizedData,
              published_at:
                sanitizedData.status === 'published' && current.status !== 'published'
                  ? new Date().toISOString()
                  : current.published_at,
            };

            const { data, error: updateError } = await supabaseAdmin
              .from('posts')
              .update(payload)
              .eq('id', postId)
              .select()
              .single();

            if (updateError) throw updateError;
            if (data.status === 'published' && current.status !== 'published') {
              void onBlogPostPublished(data);
            }
            revalidateFor({ kind: 'blog_post', slug: data.slug });
            // A renamed post leaves its old URL cached and still serving. It
            // now 404s, so refresh it too or the stale 200 outlives the post.
            if (current.slug && current.slug !== data.slug) {
              revalidateFor({ kind: 'blog_post', slug: current.slug, deleted: true });
            }
            result = { type: 'text', text: `Successfully updated blog post "${data.title}"` };
            break;
          }

          case 'delete_blog_post': {
            // Read the slug BEFORE deleting. Without it there is no way to
            // revalidate the post's own URL, and the deleted page keeps
            // serving a cached 200 until the cache expires on its own.
            const { data: doomed } = await supabaseAdmin
              .from('posts')
              .select('slug')
              .eq('id', args.id)
              .single();

            const { error: deleteError } = await supabaseAdmin
              .from('posts')
              .delete()
              .eq('id', args.id);

            if (deleteError) throw deleteError;
            revalidateFor({ kind: 'blog_post', slug: doomed?.slug, deleted: true });
            result = { type: 'text', text: `Successfully deleted blog post ${args.id}` };
            break;
          }

          case 'list_blog_posts': {
            let query = supabaseAdmin
              .from('posts')
              .select('id, title, slug, category, seo_description, status, published_at, created_at');

            if (args.status && args.status !== 'all') query = query.eq('status', args.status);
            if (args.category) query = query.eq('category', args.category);

            const { data, error: listError } = await query
              .order('created_at', { ascending: false })
              .range(args.offset || 0, (args.offset || 0) + (args.limit || 10) - 1);

            if (listError) throw listError;
            result = { type: 'text', text: JSON.stringify(data, null, 2) };
            break;
          }

          case 'get_blog_post': {
            let query = supabaseAdmin.from('posts').select('*');
            if (args.id) query = query.eq('id', args.id);
            else query = query.eq('slug', args.slug);

            const { data, error: getError } = await query.single();
            if (getError) throw getError;
            result = { type: 'text', text: JSON.stringify(data, null, 2) };
            break;
          }

          case 'get_blog_categories': {
            const { data, error: countError } = await supabaseAdmin
              .from('posts')
              .select('category');

            if (countError) throw countError;

            const counts = BLOG_CATEGORIES.reduce((acc: any, cat) => {
              acc[cat] = data.filter(p => p.category === cat).length;
              return acc;
            }, {});

            result = { type: 'text', text: JSON.stringify(counts, null, 2) };
            break;
          }

          case 'create_job': {
            const validate = ajv.compile(JOB_SCHEMA);
            const sanitizedData = sanitizePayload(args);
            const valid = validate(sanitizedData);

            if (!valid) {
              error = { code: -32602, message: 'Validation failed', data: validate.errors };
              break;
            }

            const { data: existing } = await supabaseAdmin
              .from('job_openings')
              .select('id')
              .eq('slug', sanitizedData.slug)
              .single();

            if (existing) throw new Error(`Slug "${sanitizedData.slug}" is already in use.`);

            const payload = {
              ...sanitizedData,
              posted_at:
                sanitizedData.posted_at ||
                (sanitizedData.status !== 'draft' ? new Date().toISOString() : null),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            const { data, error: insertError } = await supabaseAdmin
              .from('job_openings')
              .insert([payload])
              .select()
              .single();

            if (insertError) throw insertError;
            if (data.status === 'open') void pingIndexNow([`/careers/${data.slug}`, '/careers']);
            if (data.status === 'open') revalidateFor({ kind: 'job', slug: data.slug });
            result = { type: 'text', text: `Successfully created job "${data.title}" with ID ${data.id}` };
            break;
          }

          case 'update_job': {
            const { id: jobId, ...updateData } = args;
            const sanitizedData = sanitizePayload(updateData);

            const { data: current, error: fetchError } = await supabaseAdmin
              .from('job_openings')
              .select('*')
              .eq('id', jobId)
              .single();

            if (fetchError || !current) throw new Error('Job not found');

            if (sanitizedData.slug && sanitizedData.slug !== current.slug) {
              const { data: existing } = await supabaseAdmin
                .from('job_openings')
                .select('id')
                .eq('slug', sanitizedData.slug)
                .single();
              if (existing) throw new Error(`Slug "${sanitizedData.slug}" is already in use.`);
            }

            const becomingOpen = sanitizedData.status === 'open' && current.status !== 'open';
            const payload = {
              ...sanitizedData,
              posted_at: becomingOpen && !current.posted_at ? new Date().toISOString() : current.posted_at,
              updated_at: new Date().toISOString(),
            };

            const { data, error: updateError } = await supabaseAdmin
              .from('job_openings')
              .update(payload)
              .eq('id', jobId)
              .select()
              .single();

            if (updateError) throw updateError;
            if (data.status === 'open') void pingIndexNow([`/careers/${data.slug}`, '/careers']);
            revalidateFor({ kind: 'job', slug: data.slug });
            if (current.slug && current.slug !== data.slug) {
              revalidateFor({ kind: 'job', slug: current.slug, deleted: true });
            }
            result = { type: 'text', text: `Successfully updated job "${data.title}"` };
            break;
          }

          case 'delete_job': {
            // Same reason as delete_blog_post: the slug is gone after the
            // delete, and without it the role's page stays cached.
            const { data: doomedJob } = await supabaseAdmin
              .from('job_openings')
              .select('slug')
              .eq('id', args.id)
              .single();

            const { error: deleteError } = await supabaseAdmin
              .from('job_openings')
              .delete()
              .eq('id', args.id);

            if (deleteError) throw deleteError;
            revalidateFor({ kind: 'job', slug: doomedJob?.slug, deleted: true });
            result = { type: 'text', text: `Successfully deleted job ${args.id}` };
            break;
          }

          case 'list_jobs': {
            let query = supabaseAdmin
              .from('job_openings')
              .select('id, title, slug, department, location, employment_type, workplace_type, status, posted_at, created_at');

            if (args.status && args.status !== 'all' && JOB_STATUSES.includes(args.status)) {
              query = query.eq('status', args.status);
            }

            const { data, error: listError } = await query
              .order('created_at', { ascending: false })
              .range(args.offset || 0, (args.offset || 0) + (args.limit || 20) - 1);

            if (listError) throw listError;
            result = { type: 'text', text: JSON.stringify(data, null, 2) };
            break;
          }

          case 'get_job': {
            let query = supabaseAdmin.from('job_openings').select('*');
            if (args.id) query = query.eq('id', args.id);
            else query = query.eq('slug', args.slug);

            const { data, error: getError } = await query.single();
            if (getError) throw getError;
            result = { type: 'text', text: JSON.stringify(data, null, 2) };
            break;
          }

          case 'create_short_link': {
            const slugValue: string = args.slug;
            const targetUrl: string = args.target_url;
            if (!slugValue || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugValue)) {
              throw new Error('slug is required and may contain only lowercase letters, numbers and single hyphens.');
            }
            if (!targetUrl) throw new Error('target_url is required.');
            try {
              // eslint-disable-next-line no-new
              new URL(targetUrl);
            } catch {
              throw new Error('target_url must be a valid absolute URL.');
            }

            const { data: existingSlug } = await supabaseAdmin
              .from('link_shortener')
              .select('id')
              .eq('slug', slugValue)
              .maybeSingle();
            if (existingSlug) throw new Error(`Slug "${slugValue}" is already in use.`);

            const payload = {
              slug: slugValue,
              target_url: targetUrl,
              utm_source: args.utm_source ?? null,
              utm_medium: args.utm_medium ?? null,
              utm_campaign: args.utm_campaign ?? null,
              utm_term: args.utm_term ?? null,
              utm_content: args.utm_content ?? null,
              platform: args.platform ?? null,
              offer_type: args.offer_type ?? 'free',
              status: args.status ?? 'active',
            };

            const { data, error: insertError } = await supabaseAdmin
              .from('link_shortener')
              .insert([payload])
              .select()
              .single();

            if (insertError) throw insertError;
            result = {
              type: 'text',
              text: `Successfully created short link /go/${data.slug} -> ${data.target_url} (id ${data.id})`,
            };
            break;
          }

          case 'list_short_links': {
            let query = supabaseAdmin
              .from('link_shortener')
              .select('id, slug, target_url, utm_source, utm_medium, utm_campaign, platform, offer_type, status, created_at');

            if (args.target_url) query = query.eq('target_url', args.target_url);
            if (args.utm_campaign) query = query.eq('utm_campaign', args.utm_campaign);

            const { data, error: listError } = await query
              .order('created_at', { ascending: false })
              .limit(args.limit || 20);

            if (listError) throw listError;
            result = { type: 'text', text: JSON.stringify(data, null, 2) };
            break;
          }

          case 'get_site_settings': {
            const [flagsRes, configRes, socialRes] = await Promise.all([
              supabaseAdmin.from('feature_flags').select('key, enabled').order('key'),
              supabaseAdmin.from('app_config').select('key, value, description').order('key'),
              supabaseAdmin.from('social_links').select('platform, url, enabled').order('platform'),
            ]);
            if (flagsRes.error) throw flagsRes.error;
            if (configRes.error) throw configRes.error;
            if (socialRes.error) throw socialRes.error;
            result = {
              type: 'text',
              text: JSON.stringify(
                { feature_flags: flagsRes.data, app_config: configRes.data, social_links: socialRes.data },
                null,
                2,
              ),
            };
            break;
          }

          case 'set_feature_flag': {
            if (!args.key) throw new Error('key is required.');
            if (typeof args.enabled !== 'boolean') throw new Error('enabled must be a boolean.');
            const { data, error: flagErr } = await supabaseAdmin
              .from('feature_flags')
              .update({ enabled: args.enabled, updated_at: new Date().toISOString() })
              .eq('key', args.key)
              .select('key, enabled')
              .maybeSingle();
            if (flagErr) throw flagErr;
            if (!data) throw new Error(`Unknown feature flag: ${args.key}`);
            result = { type: 'text', text: JSON.stringify(data, null, 2) };
            break;
          }

          case 'set_app_config': {
            if (!args.key) throw new Error('key is required.');
            if (args.value === undefined || args.value === null) throw new Error('value is required.');
            const { data: existingCfg } = await supabaseAdmin
              .from('app_config')
              .select('key, value')
              .eq('key', args.key)
              .maybeSingle();
            if (!existingCfg) throw new Error(`Unknown config key: ${args.key}`);
            // Guard against silently changing a value's JSON type (a number key
            // becoming a string breaks getConfigNumber's Number() parse).
            const existingType = typeof existingCfg.value;
            const incomingType = typeof args.value;
            if (existingType !== incomingType) {
              throw new Error(
                `Type mismatch for ${args.key}: existing value is a ${existingType}, got a ${incomingType}.`,
              );
            }
            const { data, error: cfgErr } = await supabaseAdmin
              .from('app_config')
              .update({ value: args.value, updated_at: new Date().toISOString() })
              .eq('key', args.key)
              .select('key, value')
              .maybeSingle();
            if (cfgErr) throw cfgErr;
            result = { type: 'text', text: JSON.stringify(data, null, 2) };
            break;
          }

          case 'list_products': {
            let q = supabaseAdmin
              .from('products')
              .select('slug, title, description, category, price_paise, currency, status, external_link')
              .order('created_at', { ascending: false });
            if (args.status) q = q.eq('status', args.status);
            const { data, error: listErr } = await q;
            if (listErr) throw listErr;
            result = {
              type: 'text',
              text: JSON.stringify(
                (data ?? []).map((p) => ({
                  ...p,
                  price_rupees: (p.price_paise ?? 0) / 100,
                })),
                null,
                2,
              ),
            };
            break;
          }

          case 'upsert_product': {
            if (!args.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug)) {
              throw new Error('slug is required: lowercase letters, numbers and single hyphens only.');
            }
            if (!args.title) throw new Error('title is required.');

            // Razorpay scope guard. The account's one standing condition is
            // that we do not sell lead generation, so refuse it here rather
            // than relying on whoever calls this remembering the rule.
            const haystack = `${args.title} ${args.description ?? ''} ${args.category ?? ''}`.toLowerCase();
            const banned = ['lead generation', 'lead-gen', 'lead gen', 'lead list', 'leads package', 'per lead'];
            const hit = banned.find((b) => haystack.includes(b));
            if (hit) {
              throw new Error(
                `Refused: "${hit}" looks like a lead-generation offering. The Razorpay account may not be used to sell lead generation, lead lists or anything priced per lead.`,
              );
            }

            const row: Record<string, unknown> = {
              slug: args.slug,
              title: args.title,
              updated_at: new Date().toISOString(),
            };
            if (args.description !== undefined) row.description = args.description;
            if (args.category !== undefined) row.category = args.category;
            if (args.price_rupees !== undefined) {
              row.price_paise = Math.round(Number(args.price_rupees) * 100);
            }
            if (args.currency !== undefined) row.currency = args.currency;
            if (args.status !== undefined) row.status = args.status;
            if (args.external_link !== undefined) row.external_link = args.external_link;

            const { data, error: upErr } = await supabaseAdmin
              .from('products')
              .upsert(row, { onConflict: 'slug' })
              .select('slug, title, price_paise, currency, status')
              .maybeSingle();
            if (upErr) throw upErr;
            result = {
              type: 'text',
              text: JSON.stringify({ ...data, price_rupees: (data?.price_paise ?? 0) / 100 }, null, 2),
            };
            break;
          }

          case 'set_product_price': {
            if (!args.slug) throw new Error('slug is required.');
            const rupees = Number(args.price_rupees);
            if (!Number.isFinite(rupees) || rupees < 0) {
              throw new Error('price_rupees must be a number of 0 or more.');
            }
            await assertPriceClearsFloor(Math.round(rupees * 100));

            const patch: Record<string, unknown> = {
              price_paise: Math.round(rupees * 100),
              updated_at: new Date().toISOString(),
            };
            if (args.currency) patch.currency = args.currency;

            const { data, error: priceErr } = await supabaseAdmin
              .from('products')
              .update(patch)
              .eq('slug', args.slug)
              .select('slug, title, price_paise, currency, status')
              .maybeSingle();
            if (priceErr) throw priceErr;
            if (!data) throw new Error(`No product with slug: ${args.slug}`);
            result = {
              type: 'text',
              text: JSON.stringify({ ...data, price_rupees: (data.price_paise ?? 0) / 100 }, null, 2),
            };
            break;
          }

          case 'set_social_link': {
            if (!args.platform) throw new Error('platform is required.');
            if (args.url === undefined && args.enabled === undefined) {
              throw new Error('Provide url and/or enabled.');
            }
            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (args.url !== undefined) patch.url = args.url;
            if (args.enabled !== undefined) patch.enabled = args.enabled;
            const { data, error: socErr } = await supabaseAdmin
              .from('social_links')
              .update(patch)
              .eq('platform', args.platform)
              .select('platform, url, enabled')
              .maybeSingle();
            if (socErr) throw socErr;
            if (!data) throw new Error(`Unknown platform: ${args.platform}`);
            result = { type: 'text', text: JSON.stringify(data, null, 2) };
            break;
          }

          default:
            error = { code: -32601, message: 'Tool not found' };
        }
      } catch (err: any) {
        error = { code: -32603, message: err.message || 'Internal error' };
      }

      await logAudit(name, args, !error, callerIdentity, request, error?.message);

      if (error) {
        if (mcp) {
          // Unknown tool is a protocol error; a tool that ran and failed is a result.
          if (error.code === -32601) {
            return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
          }
          return NextResponse.json({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: error.message }], isError: true },
          });
        }
        return NextResponse.json(
          { jsonrpc: '2.0', id, error },
          { status: error.code === -32601 ? 404 : 400 }
        );
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        id,
        result: { content: [result] },
      });
    }

    return NextResponse.json(
      { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } },
      { status: mcp ? 200 : 404 }
    );
  } catch (error) {
    console.error('MCP API Error:', error);
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32700, message: 'Internal failure' } },
      { status: 500 }
    );
  }
}
