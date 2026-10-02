import { NextResponse } from 'next/server';

import { getSecret, secretMatches } from '@/lib/app-secrets';
import { sitePagesContext } from '@/lib/site-pages-context';
import { verifyMetaSignature } from '@/lib/meta-signature';
import { parseCommand } from '@/lib/whatsapp-commands';
import { siteConfig } from '@/config/site';
import { buildSections, slugFromRowId, type MenuProduct } from '@/lib/whatsapp-menu';
import { currencyForPhone, type PriceRow } from '@/lib/price-display';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '@/lib/supabase';
import { getLocalAiModel } from '@/lib/local-ai-model';
import { getProviderConfig } from '@/lib/ai-provider-config';
import { getGeminiModel } from '@/lib/gemini-model';
import { normalizeWhatsAppNumber } from '@/lib/site-accounts';
import {
  generateOtpCode,
  hashOtpCode,
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_DAILY_CAP,
} from '@/lib/whatsapp-otp';
import {
  hashDeletionToken,
  DELETION_WHATSAPP_EXPIRY_MINUTES,
  DELETION_WHATSAPP_RESEND_COOLDOWN_SECONDS,
} from '@/lib/account-deletion';
import { getConfigNumber, getConfigString } from '@/lib/app-config';

// KB lives on a ZFS-backed volume mounted at /app/kb-data (see
// infrastructure service-state convention) so it can be updated/grown
// without a git commit + rebuild. Falls back to the git-bundled copy if the
// mount isn't present (e.g. local dev, where no volume is mounted).
function loadKb(): string {
  try {
    return readFileSync('/app/kb-data/kb.md', 'utf-8');
  } catch {
    try {
      return readFileSync(path.join(process.cwd(), 'data', 'kb.md'), 'utf-8');
    } catch {
      return '';
    }
  }
}

/**
 * The KB is a SHARED asset, not this app's private copy: /app/kb-data/kb.md is
 * a mounted volume, outside the git bundle on purpose, so the same file backs
 * both this webhook and the gpu-box funnel, and so it can be updated
 * without a commit and rebuild.
 *
 * `const KB_CONTENT = loadKb()` at module scope defeated exactly that. The
 * process read the volume once at boot, so an edit to the shared file changed
 * nothing until someone restarted the container -- the redeploy the mount was
 * introduced to avoid.
 *
 * Re-read behind a short TTL instead. An edit lands within KB_TTL_MS for both
 * the local-GPU path and the Gemini fallback, since both embed the same string
 * in their prompt. The cost is one stat+read per TTL window, against a 5 KB
 * file on local disk.
 *
 * Deliberately NOT moved into Postgres: that would make this app the owner of
 * something two systems share, and force the other one to reach a database it
 * has no business needing.
 */
const KB_TTL_MS = 30_000;
let kbCache: { value: string; at: number } | null = null;

function kbContent(): string {
  const now = Date.now();
  if (kbCache && now - kbCache.at < KB_TTL_MS) return kbCache.value;
  const value = loadKb();
  kbCache = { value, at: now };
  return value;
}

// Production WhatsApp webhook — Node runtime (Vercel-friendly, unlike the
// Python FastAPI dev harness at site-os/api/index.py, which stays
// as the local test loop). Same Supabase tables back both.
//
// AI backend is pluggable: try local vLLM first (only reachable if exposed
// via a public URL — Vercel cannot reach a LAN IP directly, so LOCAL_AI_URL
// must point at a Tailscale Funnel path, not the raw 192.168.x.x address),
// fall back to Gemini if local is unreachable or errors.

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v25.0';

const LOCAL_AI_URL = process.env.LOCAL_AI_URL || ''; // e.g. https://gpu-box.your-tailnet.ts.net/v1
const LOCAL_AI_SECRET = process.env.LOCAL_AI_SECRET || ''; // bearer token for the nginx auth shim in front of vLLM (vLLM itself has no auth)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const ESCALATION_KEYWORDS = ['agent', 'human', 'complaint', 'refund', 'money', 'payment', 'charge', 'bank'];
const CONFIDENCE_THRESHOLD = 0.6;
const MAX_UNRESOLVED_TURNS = 3;
// Env is now only the FALLBACK -- the live value is admin-editable at
// /admin/settings (public.app_config, migration 028) so it isn't tied to one
// host's env store. Read per-request via selfNotifyNumber() below.
const SELF_NOTIFY_NUMBER_FALLBACK = process.env.WHATSAPP_SELF_NOTIFY_NUMBER || '';

async function selfNotifyNumber(): Promise<string> {
  return getConfigString('whatsapp_self_notify_number', SELF_NOTIFY_NUMBER_FALLBACK);
}

// TEMPORARY, testing-only: with no human/n8n handoff pipeline actually watching
// escalated conversations yet, an escalation would otherwise leave the bot
// silent forever. Auto-resolve back to auto mode after this many seconds so
// testing isn't blocked -- remove this once the real handoff pipeline exists
// and someone is actually monitoring SELF_NOTIFY_NUMBER.
const AUTO_RESET_ESCALATION_SECONDS = 30;

type AiResult = { reply: string; confidence: number; model: string };

// ── AI backend, pluggable ────────────────────────────────────────────────────

// Neither local vLLM's nor Gemini's basic chat API emits a real confidence
// score. Rather than guess at refusals with a hardcoded keyword list (brittle,
// English-only, easy to miss a phrasing), the model is taught via few-shot
// examples to self-report its own confidence as structured JSON. This is the
// model's own judgment, not a rule we impose after the fact.
// Built per answer, not at module load: a module-level constant froze the KB
// at server start, so KB edits never reached the bot until a redeploy.
async function systemPrompt(): Promise<string> {
  const pages = await sitePagesContext();
  return `You are YourSite Agent -- you work on WhatsApp for YourSite, texting
with people the way a sharp, friendly person on the team would, not like a corporate script. Be
warm, be human, keep the conversation going -- react to what they actually said, ask a natural
follow-up when it fits, use their language (English or Hindi), and match their energy. Casual
message in, casual reply out; a real business question gets a real, complete answer.

Two different jobs, don't blur them:

1. SMALL TALK / GREETINGS ("hi", "how are you", "what's up") -- just talk like a person. You don't
   need the knowledge base for this and you're never unsure how to say hello. Confidence should be
   high (0.9+) for ordinary friendly exchange.

2. COMPANY / BUSINESS QUESTIONS (what we do, services, industries, how we're different, track
   record, contact) -- answer properly and specifically from the knowledge base below, not with a
   vague one-liner. If they ask "what do you do", don't just say "AI stuff" -- actually tell them,
   in plain conversational language, pulling the real specifics from the KB (which service area
   fits what they described, industries we've done it in, what makes it different). Never invent
   facts that aren't in the KB -- pricing especially. If the KB doesn't cover what they're asking,
   say so honestly and offer to have the team follow up.

Always respond with ONLY a JSON object, no other text: {"reply": "...", "confidence": 0.0-1.0}

"confidence" is your honest judgment of how well your reply actually serves the person -- high for
natural conversation and anything the knowledge base genuinely covers, low when you're guessing,
when the question needs information not in the knowledge base (pricing, billing, refunds,
account-specific details), or when a person should really answer instead of you.

--- KNOWLEDGE BASE ---
${kbContent()}
---
${pages ? `\n--- LIVE ON THE WEBSITE ---\n${pages}\n---\n` : ''}
The examples below are only to show the required JSON shape and how to judge confidence on the
harder cases -- for ordinary conversation, use your own judgment, you don't need an example for
every kind of message.

User: What is your pricing for a cost-audit engagement?
{"reply": "I don't have exact pricing to share here -- it really depends on scope. Tell me a bit about your setup and I'll get someone from the team to follow up with real numbers.", "confidence": 0.3}

User: I was charged twice this month, can you refund me?
{"reply": "I can't process billing or refunds myself -- flagging this for a person on the team to sort out right away.", "confidence": 0.1}

User: Can I speak to a real person?
{"reply": "Of course -- connecting you with someone from the team now.", "confidence": 0.1}`;
}

function parseAiJson(raw: string): { reply: string; confidence: number } | null {
  try {
    // Models sometimes wrap JSON in \`\`\`json fences despite instructions -- strip if present.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.reply !== 'string' || typeof parsed.confidence !== 'number') return null;
    return { reply: parsed.reply, confidence: Math.max(0, Math.min(1, parsed.confidence)) };
  } catch {
    return null; // model didn't follow the format -- treat as a failed call, not a guess
  }
}

async function tryLocalAi(userMessage: string): Promise<AiResult | null> {
  if (!LOCAL_AI_URL) return null;
  const model = await getLocalAiModel(LOCAL_AI_URL, LOCAL_AI_SECRET);
  if (!model) {
    console.error('[WhatsApp AI] local vLLM: no model discovered (unreachable or /v1/models empty) — failing over to Gemini');
    return null; // vLLM unreachable or /v1/models empty -- fail over to cloud, don't guess
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${LOCAL_AI_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(LOCAL_AI_SECRET ? { Authorization: `Bearer ${LOCAL_AI_SECRET}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: await systemPrompt() },
          { role: 'user', content: userMessage },
        ],
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[WhatsApp AI] local vLLM (${model}): HTTP ${res.status} ${await res.text().catch(() => '')} — failing over to Gemini`);
      return null;
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      console.error('[WhatsApp AI] local vLLM: empty response content — failing over to Gemini');
      return null;
    }
    const parsed = parseAiJson(raw);
    if (!parsed) {
      console.error(`[WhatsApp AI] local vLLM (${model}): reply did not parse as JSON — failing over to Gemini. Raw: ${truncate(raw, 200)}`);
      return null; // model didn't follow the JSON format -- fail over, don't send raw text
    }
    return { reply: parsed.reply, confidence: parsed.confidence, model };
  } catch (err) {
    console.error(`[WhatsApp AI] local vLLM (${model}): ${err instanceof Error ? err.message : String(err)} — failing over to Gemini`);
    return null; // unreachable/timeout — fall through to cloud
  }
}

async function tryGemini(userMessage: string): Promise<AiResult | null> {
  // Prefer the admin-configurable key (ai_provider_config, capability
  // 'whatsapp_chat', same table + admin screen the blog editor's AI-assist
  // uses — see src/lib/ai-provider-config.ts). Only 'gemini' is implemented
  // here; if an admin picks a different provider for this capability, or no
  // key is set yet, fall back to the GEMINI_API_KEY env var so behavior never
  // regresses silently just because the DB row exists but isn't fully set up.
  const dbConfig = await getProviderConfig('whatsapp_chat').catch((err) => {
    console.error(`[WhatsApp AI] Gemini: failed to read ai_provider_config: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  const usesDbKey = dbConfig?.provider === 'gemini' && !!dbConfig.api_key;
  const apiKey = usesDbKey ? dbConfig!.api_key! : GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[WhatsApp AI] Gemini: no API key available (neither ai_provider_config nor GEMINI_API_KEY env var is set) — bot has no working reply path');
    return null;
  }
  // An explicit admin-set model (dbConfig.model) always wins -- that's a
  // deliberate override. Otherwise ask Google what this key can actually call
  // right now (getGeminiModel) instead of trusting a hardcoded name that can
  // go stale the moment a dated model is retired -- 'gemini-flash-latest' only
  // survives as the last-resort fallback if that live lookup itself fails.
  const model =
    (usesDbKey && dbConfig?.model) || (await getGeminiModel(apiKey)) || 'gemini-flash-latest';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${await systemPrompt()}\n\nUser: ${userMessage}` }] }],
        }),
      }
    );
    if (!res.ok) {
      console.error(`[WhatsApp AI] Gemini (${model}, key source: ${usesDbKey ? 'admin console' : 'GEMINI_API_KEY env'}): HTTP ${res.status} ${await res.text().catch(() => '')}`);
      return null;
    }
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      console.error(`[WhatsApp AI] Gemini (${model}): empty response — possible safety block. Full response: ${truncate(JSON.stringify(data), 500)}`);
      return null;
    }
    const parsed = parseAiJson(raw);
    if (!parsed) {
      console.error(`[WhatsApp AI] Gemini (${model}): reply did not parse as JSON. Raw: ${truncate(raw, 200)}`);
      return null;
    }
    return { reply: parsed.reply, confidence: parsed.confidence, model };
  } catch (err) {
    console.error(`[WhatsApp AI] Gemini (${model}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function generateReply(userMessage: string): Promise<AiResult> {
  // Admin-controllable via /admin/ai-settings ('WhatsApp bot' card) --
  // ai_provider_config.local_ai_enabled, not a code-level flag, so an
  // operator can flip it without a redeploy (getProviderConfig()'s 60s
  // cache means it takes effect within a minute). Defaults to attempting
  // local AI if the row/column read fails, matching tryLocalAi()'s own
  // fail-open-to-cloud design elsewhere in this file.
  const config = await getProviderConfig('whatsapp_chat').catch(() => null);
  const localAiEnabled = config?.local_ai_enabled ?? true;
  const local = localAiEnabled ? await tryLocalAi(userMessage) : null;
  if (local) return local;
  const cloud = await tryGemini(userMessage);
  if (cloud) return cloud;
  console.error('[WhatsApp AI] Both local AI and Gemini failed — sending the generic apology fallback. See preceding log lines for the actual failure reasons.');
  return {
    reply: "Sorry, I'm having trouble reaching our AI service right now.",
    confidence: 0,
    model: 'none',
  };
}

// ── WhatsApp send ─────────────────────────────────────────────────────────────

async function sendWhatsAppMessage(to: string, body: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${(await getSecret('WHATSAPP_TOKEN')) ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      }
    );
    const data = await res.json();
    const id = data.messages?.[0]?.id ?? null;
    if (!id) {
      // Meta's rejection reason was previously discarded here, so a refused
      // send looked identical to a successful one from our side. Log it.
      console.error(
        `[WhatsApp] send to ${to} returned no message id (HTTP ${res.status}):`,
        JSON.stringify(data?.error ?? data),
      );
    }
    return id;
  } catch (err) {
    console.error('[WhatsApp] send failed:', err);
    return null;
  }
}

/**
 * An interactive LIST menu.
 *
 * Interactive messages are ordinary session messages: inside the 24h window a
 * customer opened, they need NO approved template, exactly like a text reply.
 * A list carries up to 10 rows (buttons would cap at 3), which is why this is a
 * list -- Products, Services, verification, a human, and the opt-out do not fit
 * in three.
 *
 * Each row's `id` is a command word, so a tapped row and a typed word both land
 * in parseCommand() and resolve identically. No separate branch for taps.
 */
async function sendWhatsAppMenu(to: string, bodyText: string): Promise<string | null> {
  // Rows come from the products TABLE, not hardcoded copy: adding a product in
  // the admin puts it in the WhatsApp menu with no deploy and no second list to
  // keep in step. Account rows (verify, human, STOP, DELETE) are always present
  // regardless of what the catalogue does -- see buildSections().
  // Only what the operator has enabled. A row for something switched off is a
  // dead end the customer discovers by tapping it. (STOP is never gated -- see
  // accountRows().)
  let toggles = { ask: true, verify: true, human: true, delete: true };
  try {
    const { data: flags } = await supabaseAdmin
      .from('feature_flags')
      .select('key, enabled')
      .in('key', ['wa_menu_ask', 'wa_menu_verify', 'wa_menu_human', 'wa_menu_delete']);
    const on = new Map((flags ?? []).map((f) => [f.key as string, Boolean(f.enabled)]));
    toggles = {
      ask: on.get('wa_menu_ask') ?? true,
      verify: on.get('wa_menu_verify') ?? true,
      human: on.get('wa_menu_human') ?? true,
      delete: on.get('wa_menu_delete') ?? true,
    };
  } catch {
    // Flags unreadable: show the full menu rather than a mutilated one. Every
    // row still leads somewhere real, and STOP is present either way.
  }

  let products: MenuProduct[] = [];
  try {
    // JOINED, not two queries: a product's row text is built from its price
    // rows (cheapest in the buyer's currency, plus any annual saving), so
    // fetching them separately would mean N+1 round trips on a hot path.
    const { data } = await supabaseAdmin
      .from('products')
      .select(
        'slug, title, product_type, ' +
        'prices:product_prices(id, nickname, price_model, amount_minor, currency, ' +
        'billing_period, interval_count, unit, min_units, sort_order, is_default, status)',
      )
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    // Cast through unknown: supabase-js cannot infer the shape of an embedded
    // select, so its generated type here is GenericStringError[].
    type Joined = Omit<MenuProduct, 'prices'> & { prices: (PriceRow & { status: string })[] | null };
    products = ((data ?? []) as unknown as Joined[]).map((p) => ({
      ...p,
      // Archived prices must not price a live product.
      prices: (p.prices ?? []).filter((pr) => pr.status === 'active'),
    }));
  } catch {
    // A catalogue read failure must not cost the customer their opt-out. The
    // account rows still send.
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      // Meta expects the opt-out to be discoverable, not buried in a policy.
      footer: { text: 'Reply STOP at any time to opt out.' },
      // Indian numbers priced in INR, everyone else in USD. An export is
      // zero-rated, so a foreign sale at the same nominal figure keeps more.
      action: { button: 'Choose', sections: buildSections(products, toggles, currencyForPhone(to)) },
    },
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${(await getSecret('WHATSAPP_TOKEN')) ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    const data = await res.json();
    const id = data.messages?.[0]?.id ?? null;
    if (!id) {
      console.error(`[WhatsApp] menu to ${to} rejected (HTTP ${res.status}):`, JSON.stringify(data?.error ?? data));
    }
    return id;
  } catch (err) {
    console.error('[WhatsApp] menu send failed:', err);
    return null;
  }
}

// ── Escalation ────────────────────────────────────────────────────────────────

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function keywordEscalation(text: string): string | null {
  const lower = text.toLowerCase();
  const hit = ESCALATION_KEYWORDS.find((k) => lower.includes(k));
  return hit ? `keyword:${hit}` : null;
}

// ── WhatsApp number verification (template-free, see docs/OPS.md §13.4) ───────
//
// Triggered by the customer's own inbound "VERIFY" text, which opens a free
// 24h session window -- lets us reply with a plain `type: "text"` OTP code
// instead of an approved AUTHENTICATION template (this WABA doesn't have the
// 2,000-message volume tier that gate requires). The complete-profile form
// writes `site_accounts.whatsapp_number` (unverified) BEFORE showing the
// wa.me tap-to-verify link -- that pending row is what this looks up.
//
// Returns true if this inbound message was a verification attempt (handled,
// caller should stop -- do not fall through to the AI bot/escalation logic).
// Returns false for any other "VERIFY"-adjacent text with no matching pending
// row, so a coincidental "verify" from an ordinary customer isn't swallowed.
async function handleWhatsAppVerification(rawPhoneNumber: string): Promise<boolean> {
  const phoneNumber = normalizeWhatsAppNumber(rawPhoneNumber);

  const { data: account, error: accountError } = await supabaseAdmin
    .from('site_accounts')
    .select('user_id')
    .eq('whatsapp_number', phoneNumber)
    .is('whatsapp_verified_at', null)
    .maybeSingle();
  if (accountError) {
    console.error('[WhatsApp Verify] Failed to look up pending site_accounts row:', accountError);
    return false;
  }
  if (!account) return false;

  const [expiryMinutes, resendCooldownSeconds, dailyCap] = await Promise.all([
    getConfigNumber('whatsapp_otp_expiry_minutes', OTP_EXPIRY_MINUTES),
    getConfigNumber('whatsapp_otp_resend_cooldown_seconds', OTP_RESEND_COOLDOWN_SECONDS),
    getConfigNumber('whatsapp_otp_daily_cap', OTP_DAILY_CAP),
  ]);

  const cooldownCutoff = new Date(Date.now() - resendCooldownSeconds * 1000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from('whatsapp_otp_challenges')
    .select('id')
    .eq('user_id', account.user_id)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .gte('created_at', cooldownCutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) {
    await sendWhatsAppMessage(
      rawPhoneNumber,
      `You already have a verification code on the way — check your recent messages, or wait a moment before requesting another.`
    );
    return true;
  }

  const dailyCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await supabaseAdmin
    .from('whatsapp_otp_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', account.user_id)
    .gte('created_at', dailyCutoff);
  if ((dailyCount ?? 0) >= dailyCap) {
    await sendWhatsAppMessage(
      rawPhoneNumber,
      `You've reached today's limit for verification codes. Please try again tomorrow, or contact us if you need help sooner.`
    );
    return true;
  }

  const code = generateOtpCode();
  const { error: insertError } = await supabaseAdmin.from('whatsapp_otp_challenges').insert({
    user_id: account.user_id,
    phone_number: phoneNumber,
    code_hash: hashOtpCode(code),
    expires_at: new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString(),
  });
  if (insertError) {
    console.error('[WhatsApp Verify] Failed to store OTP challenge:', insertError);
    await sendWhatsAppMessage(rawPhoneNumber, `Something went wrong generating your code — please try again in a moment.`);
    return true;
  }

  const replyText = `Your YourSite verification code is ${code}. Enter it on the website to finish verifying this number. It expires in ${expiryMinutes} minutes.`;
  const waId = await sendWhatsAppMessage(rawPhoneNumber, replyText);
  await supabaseAdmin.from('whatsapp_messages').insert({
    phone_number: phoneNumber,
    direction: 'outbound',
    body: replyText,
    wa_message_id: waId,
  });
  return true;
}

// ── Account deletion request (unauthenticated, dual-channel-verified) ─────────
//
// Mirrors handleWhatsAppVerification() above: customer-initiated "DELETE"
// opens the free 24h session so we can reply with a plain-text code instead
// of a template. The pending row (created by POST /api/account-deletion/
// request after the person submits BOTH an email and phone that match one
// site_accounts record) is looked up by phone only -- no site_accounts
// lookup here, since account_deletion_requests already carries the resolved
// user_id from request-creation time. Deletion only executes once this
// WhatsApp code AND the separate emailed link are both confirmed -- see
// api/account-deletion/verify-whatsapp/route.ts, which does the actual
// executeAccountDeletion() call once both are true.
async function handleAccountDeletionRequest(rawPhoneNumber: string): Promise<boolean> {
  const phoneNumber = normalizeWhatsAppNumber(rawPhoneNumber);

  const { data: pending, error: fetchError } = await supabaseAdmin
    .from('account_deletion_requests')
    .select('id')
    .eq('requested_phone', phoneNumber)
    .is('whatsapp_verified_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fetchError) {
    console.error('[Account Deletion] Failed to look up pending request:', fetchError);
    return false;
  }
  if (!pending) return false;

  const [resendCooldownSeconds, expiryMinutes] = await Promise.all([
    getConfigNumber('deletion_whatsapp_resend_cooldown_seconds', DELETION_WHATSAPP_RESEND_COOLDOWN_SECONDS),
    getConfigNumber('deletion_whatsapp_expiry_minutes', DELETION_WHATSAPP_EXPIRY_MINUTES),
  ]);

  const cooldownCutoff = new Date(Date.now() - resendCooldownSeconds * 1000).toISOString();
  const { data: recentCodeRow } = await supabaseAdmin
    .from('account_deletion_requests')
    .select('whatsapp_code_expires_at, created_at')
    .eq('id', pending.id)
    .gt('whatsapp_code_expires_at', new Date().toISOString())
    .maybeSingle();
  if (recentCodeRow && recentCodeRow.created_at >= cooldownCutoff) {
    await sendWhatsAppMessage(
      rawPhoneNumber,
      `You already have a deletion confirmation code on the way — check your recent messages, or wait a moment before requesting another.`
    );
    return true;
  }

  const code = generateOtpCode();
  const { error: updateError } = await supabaseAdmin
    .from('account_deletion_requests')
    .update({
      whatsapp_code_hash: hashDeletionToken(code),
      whatsapp_code_expires_at: new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString(),
    })
    .eq('id', pending.id);
  if (updateError) {
    console.error('[Account Deletion] Failed to store WhatsApp code:', updateError);
    await sendWhatsAppMessage(rawPhoneNumber, `Something went wrong generating your code — please try again in a moment.`);
    return true;
  }

  const replyText = `Your YourSite account deletion confirmation code is ${code}. This only completes deletion once you've also confirmed the link we emailed you. It expires in ${expiryMinutes} minutes. If you didn't request this, ignore this message.`;
  const waId = await sendWhatsAppMessage(rawPhoneNumber, replyText);
  await supabaseAdmin.from('whatsapp_messages').insert({
    phone_number: phoneNumber,
    direction: 'outbound',
    body: replyText,
    wa_message_id: waId,
  });
  return true;
}

// ── GET — Meta verification handshake ────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (
    searchParams.get('hub.mode') === 'subscribe' &&
    (await secretMatches('WHATSAPP_VERIFY_TOKEN', searchParams.get('hub.verify_token')))
  ) {
    return new NextResponse(searchParams.get('hub.challenge'), { status: 200 });
  }
  return new NextResponse('Verification token mismatch', { status: 403 });
}

// ── POST — inbound message ───────────────────────────────────────────────────

// Template review results. When an AUTHENTICATION template is approved and no
// OTP template is configured yet, adopt it so codes start going out without a
// manual settings step; a rejection or pause of the configured one clears it,
// returning the profile form to the "VERIFY" fallback. Only acted on when the
// Meta signature verified -- this writes configuration.
async function handleTemplateStatus(value: Record<string, unknown> | undefined, signed: boolean) {
  const event = String(value?.event ?? '');
  const name = String(value?.message_template_name ?? '');
  const language = String(value?.message_template_language ?? '');
  const category = value?.message_template_category ? String(value.message_template_category) : '';
  console.log(`[whatsapp] template ${name} (${language}, ${category || 'category n/a'}): ${event}`);
  if (!signed || !name) return;

  const { data: current } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'whatsapp_otp_template')
    .maybeSingle();
  const configured = typeof current?.value === 'string' ? current.value : '';
  const isAuth = category ? category === 'AUTHENTICATION' : /otp|auth|verif|code/i.test(name);

  if (event === 'APPROVED' && isAuth && !configured) {
    await supabaseAdmin.from('app_config').update({ value: name }).eq('key', 'whatsapp_otp_template');
    if (language) {
      await supabaseAdmin.from('app_config').update({ value: language }).eq('key', 'whatsapp_otp_template_language');
    }
    console.log(`[whatsapp] adopted ${name} as the OTP template`);
  } else if (['REJECTED', 'DISABLED', 'PAUSED'].includes(event) && configured === name) {
    await supabaseAdmin.from('app_config').update({ value: '' }).eq('key', 'whatsapp_otp_template');
    console.error(`[whatsapp] OTP template ${name} is ${event}; falling back to the VERIFY flow`);
  }
}

export async function POST(request: Request) {
  try {
    // The RAW body, read before any parsing. Meta signs the exact bytes it
    // sent; parsing to JSON and re-serialising changes key order and
    // whitespace, so the recomputed HMAC would never match.
    const rawBody = await request.text();

    const appSecret = await getSecret('META_APP_SECRET');
    const signature = verifyMetaSignature(
      rawBody,
      request.headers.get('x-hub-signature-256'),
      appSecret,
    );

    if (!signature.ok) {
      if (signature.reason === 'not_configured') {
        // Distinguished from a forgery on purpose: this is OUR gap, not an
        // attack. It fails OPEN so an unsigned-but-genuine delivery is not
        // dropped while the secret is being set up -- but it is logged loudly,
        // because every request reaching here is currently unverifiable.
        console.error(
          '[whatsapp] META_APP_SECRET is not set — this webhook cannot tell a real ' +
            'Meta delivery from a forged one. Set it at /admin/settings/secrets.',
        );
      } else {
        // A signature was expected and did not match. Refuse. 403 rather than
        // 401: this is not an authentication we can retry, it is a request that
        // did not come from Meta.
        console.error(`[whatsapp] refused a webhook: signature ${signature.reason}`);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }
    }

    const payload = JSON.parse(rawBody);
    const change = payload?.entry?.[0]?.changes?.[0];
    const value = change?.value;

    if (change?.field === 'message_template_status_update') {
      await handleTemplateStatus(value, signature.ok);
      return NextResponse.json({ status: 'ok' });
    }

    // Delivery statuses. These were previously acked and thrown away, which is
    // why an undelivered message was invisible from our side: the send call
    // returns 200 with a message id even for a message Meta will silently drop
    // (e.g. a business-initiated message with no approved template and no open
    // 24h window). The REASON only ever arrives here, as a `failed` status
    // carrying an error code and title. Log it, and record it against the
    // outbound row so /admin/whatsapp can show what actually happened.
    const statuses = value?.statuses;
    if (Array.isArray(statuses) && statuses.length > 0) {
      for (const st of statuses) {
        const err = st?.errors?.[0];
        if (st?.status === 'failed' || err) {
          console.error(
            `[WhatsApp] message ${st?.id} to ${st?.recipient_id} FAILED:`,
            JSON.stringify({ code: err?.code, title: err?.title, details: err?.error_data?.details }),
          );
        } else {
          console.log(`[WhatsApp] message ${st?.id} to ${st?.recipient_id} -> ${st?.status}`);
        }
      }
      return NextResponse.json({ status: 'ok', statuses: statuses.length });
    }

    const message = value?.messages?.[0];
    if (!message) return NextResponse.json({ status: 'ok' });

    // A tapped menu row arrives as type 'interactive', NOT 'text'. The old
    // guard bailed on anything non-text, so every button press was silently
    // acknowledged and dropped -- a menu would have looked completely dead.
    // Row ids are command words, so the id feeds parseCommand() unchanged.
    let incomingText: string | null = null;
    if (message.type === 'text') {
      incomingText = message.text?.body ?? null;
    } else if (message.type === 'interactive') {
      const reply = message.interactive?.list_reply ?? message.interactive?.button_reply;
      incomingText = reply?.id ?? reply?.title ?? null;
    }
    if (!incomingText) {
      return NextResponse.json({ status: 'ok' }); // image, audio, sticker — nothing to answer
    }

    const phoneNumber: string = message.from;
    const userText: string = incomingText;
    const now = new Date().toISOString();

    // 1. Load or create conversation state
    const { data: existing, error: selectError } = await supabaseAdmin
      .from('whatsapp_conversations')
      .select('*')
      .eq('phone_number', phoneNumber)
      .maybeSingle();
    if (selectError) {
      console.error('[WhatsApp Webhook] Failed to load conversation:', selectError);
      return NextResponse.json({ status: 'error' }, { status: 200 });
    }

    let conversation = existing;
    let isFirstContact = false;
    if (!conversation) {
      const { data: created, error: insertError } = await supabaseAdmin
        .from('whatsapp_conversations')
        .insert({ phone_number: phoneNumber, mode: 'auto', last_inbound_at: now })
        .select()
        .single();
      if (insertError || !created) {
        console.error('[WhatsApp Webhook] Failed to create conversation:', insertError);
        return NextResponse.json({ status: 'error' }, { status: 200 });
      }
      conversation = created;
      isFirstContact = true;
    }

    // 2. Always log the inbound message
    await supabaseAdmin.from('whatsapp_messages').insert({
      phone_number: phoneNumber,
      direction: 'inbound',
      body: userText,
    });

    // ── 2.5 Command layer ────────────────────────────────────────────────
    // Every inbound message is first offered to the command parser. This used
    // to be `userText.trim().toUpperCase() === 'VERIFY'`, which is a string
    // comparison rather than a command interface: "Verify.", "VERIFY please"
    // and a trailing emoji all missed and fell through to the AI bot, which
    // answered a question the customer never asked. parseCommand() normalises
    // punctuation and filler, and refuses to fire on a keyword buried in a
    // sentence -- see src/lib/whatsapp-commands.ts.
    // A tapped PRODUCT row carries `P:<slug>`, which is not a command word.
    // Resolved here, before parseCommand(), so a tap answers with that product
    // rather than falling through to the AI bot.
    const tappedSlug = slugFromRowId(userText);
    if (tappedSlug) {
      const { data: prod } = await supabaseAdmin
        .from('products')
        .select('slug, title, price_paise, is_lead_magnet')
        .eq('slug', tappedSlug)
        .eq('status', 'active')
        .maybeSingle();

      const reply = prod
        ? `${prod.title} — ${siteConfig.url}/products/${prod.slug}\n\nReply MENU for other options.`
        : "That one isn't available any more. Reply MENU to see what is.";
      const sentId = await sendWhatsAppMessage(phoneNumber, reply);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: reply, wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', product: tappedSlug, found: Boolean(prod) });
    }

    const command = parseCommand(userText);

    // STOP is answered before anything else, including before an open
    // escalation. Ignoring an opt-out is what earns blocks and reports, and
    // blocks and reports are what collapse a number's quality rating.
    if (command === 'STOP') {
      await supabaseAdmin
        .from('whatsapp_conversations')
        .update({ opted_out_at: now, updated_at: now })
        .eq('phone_number', phoneNumber);
      const reply =
        "You're opted out — we won't message you on WhatsApp again. " +
        'Reply START any time to opt back in.';
      const sentId = await sendWhatsAppMessage(phoneNumber, reply);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: reply, wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', command: 'STOP' });
    }

    if (command === 'START') {
      await supabaseAdmin
        .from('whatsapp_conversations')
        .update({ opted_out_at: null, updated_at: now })
        .eq('phone_number', phoneNumber);
      const reply = "You're opted back in. Reply STOP at any time to stop.";
      const sentId = await sendWhatsAppMessage(phoneNumber, reply);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: reply, wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', command: 'START' });
    }

    // Past this point we may reply, so honour an existing opt-out. The inbound
    // message is still logged above -- we record what they said, we just don't
    // talk back. An explicit command is the one exception: someone who opted
    // out can still verify or delete if they deliberately ask to.
    if (conversation.opted_out_at && !command) {
      return NextResponse.json({ status: 'ok', suppressed: 'opted_out' });
    }

    // MENU and its destinations. All plain session messages -- no template.
    if (command === 'MENU') {
      const sentId = await sendWhatsAppMenu(phoneNumber, 'What would you like to do?');
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: '[menu]', wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', command: 'MENU' });
    }

    if (command === 'PRODUCTS' || command === 'SERVICES') {
      const reply =
        command === 'PRODUCTS'
          ? `Our products: ${siteConfig.url}/templates — blueprints, guides and tools. Reply MENU for other options.`
          : `Our services: ${siteConfig.url}/services Reply MENU for other options.`;
      const sentId = await sendWhatsAppMessage(phoneNumber, reply);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: reply, wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', command });
    }

    if (command === 'HUMAN') {
      await supabaseAdmin
        .from('whatsapp_conversations')
        .update({ mode: 'human', escalated_at: now, escalation_reason: 'customer_requested', updated_at: now })
        .eq('phone_number', phoneNumber);
      const reply = "Thanks — a person from our team will pick this up and reply here.";
      const sentId = await sendWhatsAppMessage(phoneNumber, reply);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: reply, wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', command: 'HUMAN' });
    }

    if (command === 'ASK') {
      const reply =
        "Go ahead — ask away. Type your question and I'll answer from what we know " +
        'about our products, services and how we work. Reply MENU any time for options.';
      const sentId = await sendWhatsAppMessage(phoneNumber, reply);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: reply, wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', command: 'ASK' });
    }

    if (command === 'HELP') {
      const reply =
        'YourSite on WhatsApp — reply MENU for options, VERIFY to confirm your number, ' +
        'DELETE to request account deletion, or STOP to opt out at any time. ' +
        'Anything else and our assistant will help.';
      const sentId = await sendWhatsAppMessage(phoneNumber, reply);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: reply, wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', command: 'HELP' });
    }

    // Number verification — must run BEFORE any AI/escalation logic so an
    // attempt is never treated as a support conversation.
    if (command === 'VERIFY') {
      const handled = await handleWhatsAppVerification(phoneNumber);
      if (handled) {
        return NextResponse.json({ status: 'ok', verification: true });
      }
      // No pending row matched. A VERIFY only ever comes from our own
      // wa.me?text=VERIFY link, so this is almost always someone who typed one
      // number on the site then tapped the link on a phone registered to
      // another. Say so: they are inside the 24h window they just opened, so a
      // plain text reply needs no template, and the AI bot would answer a
      // question they didn't ask.
      const reply =
        `We couldn't match ${phoneNumber} to a pending verification. ` +
        `Please enter THIS number on the website — it has to be the same one ` +
        `you're messaging from — then tap the verify link again.`;
      const sentId = await sendWhatsAppMessage(phoneNumber, reply);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber,
        direction: 'outbound',
        body: reply,
        wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', verification: false, reason: 'no_pending_row' });
    }

    // Account deletion — separate unauthenticated dual-channel-verified flow,
    // see handleAccountDeletionRequest()'s header comment.
    if (command === 'DELETE') {
      const handled = await handleAccountDeletionRequest(phoneNumber);
      if (handled) {
        return NextResponse.json({ status: 'ok', deletion_request: true });
      }
      // No pending request matched this number. Previously this fell through to
      // the AI bot, so someone exercising a DATA DELETION RIGHT got a chatbot
      // answer to a question they never asked. Deletion is dual-channel
      // verified by design -- it cannot be started from WhatsApp alone -- so
      // say where to start it rather than silently doing nothing.
      const reply =
        'To delete your account and data, start the request at ' +
        `${siteConfig.url}/data-deletion/request — we then confirm it by email ` +
        'and here on WhatsApp before anything is erased.';
      const sentId = await sendWhatsAppMessage(phoneNumber, reply);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: reply, wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', deletion_request: false, reason: 'no_pending_request' });
    }

    // First contact, and not a command. Answer with the menu rather than the AI
    // bot: it orients them, and its footer states the opt-out at the only
    // moment they are guaranteed to read a message from us. Sending that notice
    // on EVERY message would be the spam it is meant to prevent, so it is said
    // once, here, and again whenever they ask for the menu.
    if (isFirstContact) {
      const sentId = await sendWhatsAppMenu(
        phoneNumber,
        "Hi — you're through to YourSite. What would you like to do?",
      );
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber, direction: 'outbound', body: '[menu]', wa_message_id: sentId,
      });
      return NextResponse.json({ status: 'ok', first_contact: true });
    }

    // 3. If already escalated to human — stay silent, just notify, don't generate.
    // TEMPORARY: auto-resolve back to auto mode once AUTO_RESET_ESCALATION_SECONDS
    // has passed since escalation, since nothing is actually watching/resolving
    // these yet (see constant comment above). Falls through to normal handling
    // below once reset, rather than staying silent indefinitely.
    if (conversation.mode === 'human') {
      const escalatedAtMs = conversation.escalated_at ? new Date(conversation.escalated_at).getTime() : 0;
      const secondsSinceEscalation = (Date.now() - escalatedAtMs) / 1000;

      if (secondsSinceEscalation < AUTO_RESET_ESCALATION_SECONDS) {
        await supabaseAdmin
          .from('whatsapp_conversations')
          .update({ last_inbound_at: now })
          .eq('phone_number', phoneNumber);
        const notify = await selfNotifyNumber();
        if (notify) {
          await sendWhatsAppMessage(
            notify,
            `[YourSite bot] ${phoneNumber} (escalated, bot silent): "${truncate(userText)}"`
          );
        }
        return NextResponse.json({ status: 'ok' });
      }

      const { data: resetConversation } = await supabaseAdmin
        .from('whatsapp_conversations')
        .update({ mode: 'auto', unresolved_turns: 0, escalation_reason: null, escalated_at: null })
        .eq('phone_number', phoneNumber)
        .select()
        .single();
      if (resetConversation) conversation = resetConversation;
    }

    // 4. Auto mode — check escalation triggers BEFORE generating
    let escalationReason = keywordEscalation(userText);

    let ai: AiResult | null = null;
    if (!escalationReason) {
      ai = await generateReply(userText);
      if (ai.confidence < CONFIDENCE_THRESHOLD) {
        escalationReason = `low_confidence:${ai.confidence}`;
      }
    }

    // unresolvedTurns tracks a CONSECUTIVE streak of unhelpful turns, not a
    // lifetime message count -- a successfully-answered turn resets it to 0,
    // so ordinary back-and-forth conversation never silently trips this and
    // gets handed to a human just for having gone on for a few messages.
    // (A single low-confidence or keyword hit above already escalates that
    // turn immediately -- this counter is kept for visibility/audit, not as
    // a second independent trigger.)
    const unresolvedTurns = escalationReason ? (conversation.unresolved_turns ?? 0) + 1 : 0;

    if (escalationReason) {
      await supabaseAdmin
        .from('whatsapp_conversations')
        .update({
          mode: 'human',
          escalated_at: now,
          escalation_reason: escalationReason,
          last_inbound_at: now,
          unresolved_turns: unresolvedTurns,
        })
        .eq('phone_number', phoneNumber);

      const handoffText = 'Thanks for your message — a person from our team will respond shortly.';
      const waId = await sendWhatsAppMessage(phoneNumber, handoffText);
      await supabaseAdmin.from('whatsapp_messages').insert({
        phone_number: phoneNumber,
        direction: 'outbound',
        body: handoffText,
        escalated: true,
        escalation_reason: escalationReason,
        wa_message_id: waId,
      });

      const notify = await selfNotifyNumber();
      if (notify) {
        await sendWhatsAppMessage(
          notify,
          `[YourSite bot] Escalated: ${phoneNumber} (${escalationReason}): "${truncate(userText)}"`
        );
      }
      return NextResponse.json({ status: 'ok', escalated: true, reason: escalationReason });
    }

    // 5. No escalation — send the AI reply
    const reply = ai!.reply;
    const waId = await sendWhatsAppMessage(phoneNumber, reply);
    await supabaseAdmin.from('whatsapp_messages').insert({
      phone_number: phoneNumber,
      direction: 'outbound',
      body: reply,
      model: ai!.model,
      confidence: ai!.confidence,
      wa_message_id: waId,
    });
    await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ last_inbound_at: now, unresolved_turns: unresolvedTurns })
      .eq('phone_number', phoneNumber);

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[WhatsApp Webhook] Error:', error);
    // Always 200 — Meta retries aggressively on non-2xx
    return NextResponse.json({ status: 'error' }, { status: 200 });
  }
}
