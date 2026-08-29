import { describe, expect, it } from 'vitest';
import {
  translateWatheeqTechVisibleText,
  WATHEEQTECH_TRANSLATION_MEMORY_VERSION,
  WATHEEQTECH_VISIBLE_TEXT_TRANSLATIONS,
} from '../watheeqtech-visible-text-v22.generated';

describe('WatheeqTech v22 translation memory', () => {
  it('loads the translated Word inventory as a non-empty generated catalog', () => {
    expect(WATHEEQTECH_TRANSLATION_MEMORY_VERSION).toBe('v22');
    expect(Object.keys(WATHEEQTECH_VISIBLE_TEXT_TRANSLATIONS).length).toBeGreaterThan(3000);
  });

  it('keeps all source and translated values non-empty after normalization', () => {
    for (const [source, translation] of Object.entries(WATHEEQTECH_VISIBLE_TEXT_TRANSLATIONS)) {
      expect(source.trim(), `empty source for ${translation}`).not.toBe('');
      expect(translation.trim(), `empty translation for ${source}`).not.toBe('');
    }
  });

  it('does not contain normalized duplicate source strings', () => {
    const normalizedSources = new Set<string>();

    for (const source of Object.keys(WATHEEQTECH_VISIBLE_TEXT_TRANSLATIONS)) {
      const normalized = source.replace(/\s+/g, ' ').trim();
      expect(normalizedSources.has(normalized), `duplicate normalized source: ${normalized}`).toBe(false);
      normalizedSources.add(normalized);
    }
  });

  it('contains reviewed high-value WatheeqTech translations from the v22 document', () => {
    expect(translateWatheeqTechVisibleText('Workflow Policies')).toBe('سياسات سير العمل');
    expect(translateWatheeqTechVisibleText('Litigation Cases')).toBe('قضايا التقاضي');
    expect(translateWatheeqTechVisibleText('New Request')).toBe('طلب جديد');
    expect(translateWatheeqTechVisibleText('Search or jump to')).toBe('ابحث أو انتقل إلى');
    expect(translateWatheeqTechVisibleText('WatheeqTech')).toBe('WatheeqTech');
  });
});
