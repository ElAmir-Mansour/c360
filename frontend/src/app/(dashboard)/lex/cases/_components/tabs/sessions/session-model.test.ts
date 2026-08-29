import { describe, expect, it } from 'vitest';
import type { CaseHearing } from '@/lib/lex/cases';
import { buildSessionMetadata, readSessionMeta } from './session-model';

describe('session metadata', () => {
  it('round-trips the Figma session fields while preserving unknown metadata', () => {
    const metadata = buildSessionMetadata(
      { integration_key: 'keep-me' },
      {
        session_type: 'pleading',
        session_number: 4,
        title: 'Expert Software Testimony Hearing',
        agenda: 'Hear the appointed expert testimony.',
        chamber: '5th Commercial Circuit',
        presiding_judge: 'Sheikh Sulaiman Al-Ghamdi',
        presiding_judge_title: 'Judicial Panel Head',
        attendee_names: ['Latifa Al-Sudairy'],
        status: 'upcoming',
        duration_minutes: 150,
        required_action: 'Prepare technical response',
        attendees: ['user-1'],
        required_documents: [],
        adjournment: null,
      },
    );
    const hearing = {
      id: 'hearing-1',
      case_id: 'case-1',
      hearing_date: '2024-05-06T10:00:00.000Z',
      notes: '',
      metadata,
      created_at: '2024-04-01T00:00:00.000Z',
      updated_at: '2024-04-01T00:00:00.000Z',
    } satisfies CaseHearing;

    expect(metadata.integration_key).toBe('keep-me');
    expect(readSessionMeta(hearing)).toMatchObject({
      session_number: 4,
      title: 'Expert Software Testimony Hearing',
      chamber: '5th Commercial Circuit',
      presiding_judge: 'Sheikh Sulaiman Al-Ghamdi',
      status: 'upcoming',
      duration_minutes: 150,
    });
  });
});
