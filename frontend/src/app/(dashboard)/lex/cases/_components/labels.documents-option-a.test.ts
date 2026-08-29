import { describe, expect, it } from 'vitest';

import { resolveCaseLabels } from './labels';

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStrings);
}

describe('case Documents terminology', () => {
  it('uses the approved Documents wording in English and Arabic', () => {
    const en = resolveCaseLabels('en').documents;
    const ar = resolveCaseLabels('ar').documents;

    expect(en.repository).toBe('In Documents');
    expect(en.health.repository).toBe('In Documents');
    expect(en.health.reuseRepository).toBe('Link an existing document');
    expect(en.checklist.repositoryLink).toBe('Linked to Documents');
    expect(en.openRepository).toBe('Open in Documents');

    expect(ar.repository).toBe('في المستندات');
    expect(ar.health.repository).toBe('في المستندات');
    expect(ar.health.reuseRepository).toBe('ربط وثيقة موجودة');
    expect(ar.checklist.repositoryLink).toBe('مرتبطة بالمستندات');
    expect(ar.openRepository).toBe('فتح في المستندات');
  });

  it('removes repository terminology from every static case Documents label', () => {
    const en = resolveCaseLabels('en').documents;
    const ar = resolveCaseLabels('ar').documents;

    expect(collectStrings(en).join(' ')).not.toMatch(/\brepositor(?:y|ies)\b/i);
    expect(collectStrings(ar).join(' ')).not.toMatch(/مستودع|المستودع/);
    expect(en.captionText.repositoryRecord('active')).toBe('Documents record (active)');
    expect(ar.captionText.repositoryRecord('نشط')).toBe('سجل في المستندات (نشط)');
  });
});
