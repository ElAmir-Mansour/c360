import { describe, expect, it } from 'vitest';
import { requestTrackerNodes } from './submission-success';

describe('requestTrackerNodes', () => {
  it('shows approval as current for a newly submitted approval request', () => {
    expect(requestTrackerNodes('pending_requester_approval')).toEqual([
      { key: 'submitted', state: 'done' },
      { key: 'approval', state: 'current' },
      { key: 'routing', state: 'upcoming' },
      { key: 'review', state: 'upcoming' },
    ]);
  });

  it('shows legal review as current after routing', () => {
    expect(requestTrackerNodes('routed')).toEqual([
      { key: 'submitted', state: 'done' },
      { key: 'approval', state: 'done' },
      { key: 'routing', state: 'done' },
      { key: 'review', state: 'current' },
    ]);
  });

  it('marks the lifecycle complete after delivery', () => {
    expect(requestTrackerNodes('delivered').every((node) => node.state === 'done')).toBe(true);
  });
});
