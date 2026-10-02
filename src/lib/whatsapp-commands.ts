/**
 * The inbound command vocabulary for the WhatsApp webhook.
 *
 * Previously the webhook tested `userText.trim().toUpperCase() === 'VERIFY'`
 * and the same for DELETE. That is not a command interface, it is a string
 * comparison, and it failed on everything a real person types: "Verify.",
 * "VERIFY please", a trailing emoji, an autocorrected full stop, a leading
 * "Hi ". Each miss fell through to the AI bot, which cheerfully answered a
 * question nobody asked -- observed live on 2026-09-17, where an inbound
 * VERIFY got a chatbot reply instead of a verification.
 *
 * There was also no STOP. Meta expects opt-out keywords to be honoured, and an
 * ignored STOP is the fastest route to blocks and reports, which is what
 * actually collapses a number's quality rating.
 *
 * Matching is deliberately conservative -- a command must BE the message, not
 * appear inside it. "Please stop sending me these" is a complaint for the bot
 * to handle; "STOP" is an opt-out. Allowing a keyword anywhere in free text
 * would opt people out mid-sentence.
 */

export type WhatsAppCommand =
  | 'VERIFY' | 'DELETE' | 'STOP' | 'START' | 'HELP'
  | 'MENU' | 'PRODUCTS' | 'SERVICES' | 'HUMAN' | 'ASK';

/**
 * Keyword -> command. Several spellings map to one command because people (and
 * Meta's own guidance) use them interchangeably.
 */
const KEYWORDS: Record<string, WhatsAppCommand> = {
  VERIFY: 'VERIFY',
  VERIFICATION: 'VERIFY',

  DELETE: 'DELETE',

  // Opt-out. STOP is the one Meta documents; the rest are what people type.
  STOP: 'STOP',
  UNSUBSCRIBE: 'STOP',
  CANCEL: 'STOP',
  END: 'STOP',
  QUIT: 'STOP',
  OPTOUT: 'STOP',

  // Opt back in.
  START: 'START',
  SUBSCRIBE: 'START',
  UNSTOP: 'START',
  RESUME: 'START',

  HELP: 'HELP',
  INFO: 'HELP',

  // Menu destinations. These double as the interactive reply IDs sent with a
  // list message, so a tapped row and a typed word resolve to the same command
  // and need no separate branch.
  MENU: 'MENU',
  OPTIONS: 'MENU',
  PRODUCTS: 'PRODUCTS',
  PRODUCT: 'PRODUCTS',
  SERVICES: 'SERVICES',
  SERVICE: 'SERVICES',
  HUMAN: 'HUMAN',
  AGENT: 'HUMAN',
  SUPPORT: 'HUMAN',

  // Free-form question, answered from the knowledge base. The assistant already
  // handles anything unrecognised, but nothing SAID so -- a menu with no "ask
  // me something" row reads as a closed set of five choices.
  ASK: 'ASK',
  QUESTION: 'ASK',
  OTHER: 'ASK',
};

/** Words that may pad a command without changing its intent. */
const FILLER = new Set(['PLEASE', 'PLS', 'HI', 'HELLO', 'HEY', 'MY', 'ME', 'NUMBER', 'NOW']);

/**
 * Normalise to bare uppercase words: strip punctuation, emoji and any
 * non-letter, then collapse whitespace. "Verify, please! 🙏" -> "VERIFY PLEASE".
 */
export function normalizeMessage(text: string): string {
  return (text || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the command a message expresses, or null if it is ordinary
 * conversation that belongs to the bot.
 *
 * A message qualifies only if, after dropping filler words, exactly one word
 * remains and it is a known keyword. So "VERIFY" and "Hi, verify please!"
 * both match, while "why did you stop replying" does not.
 */
export function parseCommand(text: string): WhatsAppCommand | null {
  const normalized = normalizeMessage(text);
  if (!normalized) return null;

  const words = normalized.split(' ');
  // A command is short by nature. Anything long is a sentence, not an
  // instruction, even if it contains a keyword.
  if (words.length > 4) return null;

  const meaningful = words.filter((w) => !FILLER.has(w));
  if (meaningful.length === 0) return null;

  if (meaningful.length === 1) return KEYWORDS[meaningful[0]] ?? null;

  // A keyword split by punctuation ("opt-out", "un subscribe") arrives as
  // separate words once non-letters are stripped. Rejoin and try once, so the
  // hyphen a person typed does not decide whether their opt-out is honoured.
  if (meaningful.length === 2) return KEYWORDS[meaningful.join('')] ?? null;

  return null;
}
