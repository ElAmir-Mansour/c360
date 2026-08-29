import { describe, expect, it } from 'vitest';
import { resolveInboxView } from './support-view';

describe('resolveInboxView', () => {
  it.each(['incoming', 'sent', 'history'] as const)(
    'accepts the notification deep link %s for a support viewer',
    (view) => expect(resolveInboxView(view, true)).toBe(view),
  );

  it('falls back for malformed or unauthorized support views', () => {
    expect(resolveInboxView('unknown', true)).toBe('decisions');
    expect(resolveInboxView('incoming', false)).toBe('decisions');
    expect(resolveInboxView(null, true)).toBe('decisions');
  });
});

