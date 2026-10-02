import { describe, it, expect } from 'vitest';
import { parseCommand, normalizeMessage } from './whatsapp-commands';

describe('parseCommand', () => {
  it('matches what the old === comparison matched', () => {
    expect(parseCommand('VERIFY')).toBe('VERIFY');
    expect(parseCommand('DELETE')).toBe('DELETE');
  });

  it('matches what the old comparison SILENTLY MISSED', () => {
    // Every one of these fell through to the AI bot before.
    for (const t of ['Verify', 'verify.', 'VERIFY!', ' verify ', 'Verify please',
                     'Hi verify', 'verify my number', 'VERIFY 🙏']) {
      expect(parseCommand(t), t).toBe('VERIFY');
    }
  });

  it('honours opt-out in the spellings people actually use', () => {
    for (const t of ['STOP', 'stop', 'Stop.', 'UNSUBSCRIBE', 'cancel', 'quit', 'End', 'opt-out']) {
      expect(parseCommand(t), t).toBe('STOP');
    }
  });

  it('opts back in', () => {
    for (const t of ['START', 'subscribe', 'Resume', 'UNSTOP']) {
      expect(parseCommand(t), t).toBe('START');
    }
  });

  it('does NOT fire on a keyword buried in a sentence', () => {
    // The important negative case: opting someone out mid-complaint, or
    // swallowing a real support question, would both be worse than useless.
    for (const t of [
      'why did you stop replying to me',
      'please delete my old order and send a new one',
      'I want to verify something about my invoice amount',
      'can you help me understand the pricing',
      'stop by the office tomorrow and verify',
    ]) {
      expect(parseCommand(t), t).toBeNull();
    }
  });

  it('returns null for ordinary conversation', () => {
    for (const t of ['hello', 'what do you sell?', 'thanks!', '', '   ', '👍']) {
      expect(parseCommand(t)).toBeNull();
    }
  });

  it('normalizes punctuation and emoji away', () => {
    expect(normalizeMessage('Verify, please! 🙏')).toBe('VERIFY PLEASE');
    expect(normalizeMessage('  STOP.  ')).toBe('STOP');
  });
});
