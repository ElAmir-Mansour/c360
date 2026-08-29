import { describe, expect, it } from 'vitest';
import { orgEntityOptions } from './org-entity-picker';
import type { OrgEntity } from '@/lib/lex/admin';

const entities: OrgEntity[] = [
  {
    id: 'entity-2',
    tenant_id: 'tenant',
    entity_type: 'department',
    code: 'LEGAL',
    name: { en: 'Legal Affairs', ar: 'الشؤون القانونية' },
    path: [],
    active: true,
    metadata: {},
    created_at: '',
    updated_at: '',
  },
  {
    id: 'entity-1',
    tenant_id: 'tenant',
    entity_type: 'section',
    code: 'ARCHIVE',
    name: { en: 'Archived', ar: 'مؤرشف' },
    path: [],
    active: false,
    metadata: {},
    created_at: '',
    updated_at: '',
  },
];

describe('orgEntityOptions', () => {
  it('shows only active entities and keeps UUIDs behind readable labels', () => {
    expect(orgEntityOptions(entities, 'legal', 'en')).toEqual([
      expect.objectContaining({
        value: 'entity-2',
        label: 'Legal Affairs',
        triggerLabel: 'Legal Affairs — LEGAL',
      }),
    ]);
  });

  it('searches Arabic names and resolves Arabic labels', () => {
    expect(orgEntityOptions(entities, 'القانونية', 'ar')[0]).toEqual(
      expect.objectContaining({ value: 'entity-2', label: 'الشؤون القانونية' }),
    );
  });
});
