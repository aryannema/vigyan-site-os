import sanitizeHtml from 'sanitize-html';

/**
 * The one HTML sanitiser.
 *
 * Every path that stores HTML which will later be rendered with
 * dangerouslySetInnerHTML must go through this. The MCP route had its own copy
 * and the admin forms had none, so the same field was sanitised when written by
 * an automation caller and not when written through the admin UI — two write
 * paths, one of them unguarded, which is exactly the gap having two paths
 * creates.
 *
 * Sanitising on WRITE as well as trusting the renderer: if a value is ever
 * rendered somewhere new, it is already safe rather than depending on that
 * place remembering.
 */

/** Rich text an author writes: job descriptions, long-form copy. */
export const ALLOWED_RICH = {
  allowedTags: [
    'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'h2', 'h3', 'h4', 'a', 'hr',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
  },
  // http/https/mailto only. This is what blocks javascript: and data: URLs,
  // which are the usual way an <a> becomes script execution.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  // Any link that survives cannot reach back into our page.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
} satisfies sanitizeHtml.IOptions;

/** Short strings where formatting is a bonus, not the point. */
export const ALLOWED_INLINE = {
  allowedTags: ['b', 'i', 'em', 'strong', 'code'],
  allowedAttributes: {},
  allowedSchemes: ['http', 'https', 'mailto'],
} satisfies sanitizeHtml.IOptions;

export function sanitizeRich(html: string | null | undefined): string | null {
  if (html == null) return null;
  return sanitizeHtml(html, ALLOWED_RICH);
}

export function sanitizeInline(text: string | null | undefined): string | null {
  if (text == null) return null;
  return sanitizeHtml(text, ALLOWED_INLINE);
}

/** Strips every tag. For anything rendered as plain text. */
export function stripHtml(text: string | null | undefined): string | null {
  if (text == null) return null;
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
}
