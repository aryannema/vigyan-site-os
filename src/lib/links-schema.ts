// UTM-tagged short links -- admin CRUD-able, also created via the MCP
// create_short_link tool for n8n/Postiz automation. Migration
// 017_utm_link_shortener.sql.

import { siteConfig } from '@/config/site';

export const LINK_STATUSES = ['draft', 'active', 'archived'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

// Reporting classification only -- no ad-spend/payment flow behind it. See
// migration 017's column comment.
export const LINK_OFFER_TYPES = ['free', 'lead_magnet', 'paid'] as const;
export type LinkOfferType = (typeof LINK_OFFER_TYPES)[number];

export interface ShortLink {
  id: string;
  slug: string;
  target_url: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  platform: string | null;
  offer_type: LinkOfferType;
  status: LinkStatus;
  created_at: string;
  updated_at: string;
}

export interface ShortLinkWithClicks extends ShortLink {
  click_count: number;
  last_clicked_at: string | null;
}

export function shortLinkUrl(slug: string): string {
  return `${siteConfig.url}/go/${slug}`;
}
