import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_QUICK_NAV,
  activeKnowledgeQuickNavHref,
  isKnowledgeQuickNavPath,
} from './knowledge-quick-nav';

describe('Knowledge Hub compact navigation', () => {
  it('covers the four collection pages from the compact Figma layouts', () => {
    expect(KNOWLEDGE_QUICK_NAV.map((item) => item.id)).toEqual([
      'clauses',
      'playbooks',
      'policies',
      'learning',
    ]);
    expect(KNOWLEDGE_QUICK_NAV.map((item) => item.href)).toEqual([
      '/lex/clause-library',
      '/lex/playbooks',
      '/lex/policies',
      '/lex/learning-centre',
    ]);

    for (const item of KNOWLEDGE_QUICK_NAV) {
      expect(item.labelEn.trim()).not.toBe('');
      expect(item.labelAr.trim()).not.toBe('');
      expect(item.permission).toBeDefined();
    }
  });

  it('keeps a collection active on its nested routes', () => {
    expect(activeKnowledgeQuickNavHref('/lex/playbooks/portfolio')).toBe(
      '/lex/playbooks',
    );
    expect(activeKnowledgeQuickNavHref('/lex/policies')).toBe('/lex/policies');
    expect(isKnowledgeQuickNavPath('/lex/learning-centre')).toBe(true);
  });

  it('does not replace the suite navigator on unrelated Lex pages', () => {
    expect(activeKnowledgeQuickNavHref('/lex/contracts')).toBeUndefined();
    expect(isKnowledgeQuickNavPath('/lex/knowledge-hub')).toBe(false);
    expect(isKnowledgeQuickNavPath('/dashboard')).toBe(false);
  });
});
