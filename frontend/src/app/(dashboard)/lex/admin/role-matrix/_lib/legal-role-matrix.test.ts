import { describe, expect, it } from 'vitest';
import {
  ROLE_ROSTER,
  VERB_AUTHORITY,
  dominantVerb,
  type MatrixVerb,
  type RoleCode,
} from './legal-role-matrix';
import {
  CANONICAL_ROLE_PERMS,
  CANONICAL_PERMS_BY_CODE,
  CODE_BY_SLUG,
  MATRIX_DOMAINS,
  TOTAL_CAPABILITY_ROWS,
  deriveDomainVerbs,
  diffRolePermissions,
  restrictedVerbs,
  roleCoverageCount,
} from './legal-role-permissions';

const ALL_CODES: RoleCode[] = [
  'REQ',
  'DM',
  'BUC',
  'CEO',
  'LD',
  'CSM',
  'KSM',
  'CSV',
  'KSV',
  'LO',
  'LA',
  'SSM',
  'AUD',
  'ADM',
];

/** Derive a role's verb cell on a domain straight from its canonical perms. */
function cellOf(code: RoleCode, prefix: string): MatrixVerb[] {
  return deriveDomainVerbs(CANONICAL_PERMS_BY_CODE[code] ?? [], prefix);
}

describe('Legal Role Matrix — roster structure', () => {
  it('defines exactly the 14 roster roles in column order', () => {
    expect(ROLE_ROSTER).toHaveLength(14);
    expect(ROLE_ROSTER.map((r) => r.code)).toEqual(ALL_CODES);
  });

  it('gives every role a unique backend-matching slug', () => {
    const slugs = ROLE_ROSTER.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(14);
    expect(ROLE_ROSTER.find((r) => r.code === 'REQ')?.slug).toBe('legal-requester');
    expect(ROLE_ROSTER.find((r) => r.code === 'AUD')?.slug).toBe('legal-auditor');
    expect(ROLE_ROSTER.find((r) => r.code === 'ADM')?.slug).toBe('legal-system-admin');
    expect(slugs.every((s) => /^legal-[a-z-]+$/.test(s))).toBe(true);
  });

  it('binds escalation recipients to the L1→L2→L3 chain (design §3.4)', () => {
    expect(ROLE_ROSTER.find((r) => r.code === 'CSV')?.escalationLevel).toBe('L1');
    expect(ROLE_ROSTER.find((r) => r.code === 'DM')?.escalationLevel).toBe('L2');
    expect(ROLE_ROSTER.find((r) => r.code === 'SSM')?.escalationLevel).toBe('L3');
  });
});

describe('Single source of truth — canonical perms align with the roster', () => {
  it('the canonical permission source covers exactly the 14 roster roles by slug', () => {
    const rosterSlugs = new Set(ROLE_ROSTER.map((r) => r.slug));
    const canonSlugs = new Set(CANONICAL_ROLE_PERMS.map((r) => r.slug));
    expect(canonSlugs).toEqual(rosterSlugs);
    // slug → code lookup is total and matches the roster.
    for (const r of ROLE_ROSTER) {
      expect(CODE_BY_SLUG[r.slug]).toBe(r.code);
    }
  });

  it('every canonical permission key is a recognised lex key', () => {
    for (const role of CANONICAL_ROLE_PERMS) {
      for (const perm of role.permissions) {
        expect(perm.startsWith('lex:'), `${role.slug}/${perm}`).toBe(true);
      }
    }
  });

  it('exposes the v2 restricted verbs only where the design grants them', () => {
    // case:assign — LD + CSM only.
    expect(cellOf('LD', 'lex:case')).toContain('E');
    expect(restrictedVerbs(CANONICAL_PERMS_BY_CODE.LD, 'lex:case')).toContain('assign');
    expect(restrictedVerbs(CANONICAL_PERMS_BY_CODE.CSM, 'lex:case')).toContain('assign');
    expect(restrictedVerbs(CANONICAL_PERMS_BY_CODE.CSV, 'lex:case')).not.toContain('assign');
    expect(restrictedVerbs(CANONICAL_PERMS_BY_CODE.LO, 'lex:case')).not.toContain('assign');
    // contract:distribute — LD + KSM + KSV only.
    expect(restrictedVerbs(CANONICAL_PERMS_BY_CODE.KSM, 'lex:contract')).toContain('distribute');
    expect(restrictedVerbs(CANONICAL_PERMS_BY_CODE.KSV, 'lex:contract')).toContain('distribute');
    expect(restrictedVerbs(CANONICAL_PERMS_BY_CODE.LA, 'lex:contract')).not.toContain('distribute');
  });
});

describe('dominantVerb — authority ranking', () => {
  it('returns the highest-authority verb in a combined cell', () => {
    expect(dominantVerb(['A', 'E'])).toBe('E');
    expect(dominantVerb(['V', 'P'])).toBe('P');
    expect(dominantVerb(['P', 'C'])).toBe('P');
    expect(dominantVerb(['V'])).toBe('V');
    expect(dominantVerb(['M'])).toBe('M');
  });

  it('returns null for a no-access cell', () => {
    expect(dominantVerb([])).toBeNull();
  });

  it('only emits the six recognised verb codes from any derivation', () => {
    const valid = new Set<MatrixVerb>(VERB_AUTHORITY);
    for (const code of ALL_CODES) {
      for (const domain of MATRIX_DOMAINS) {
        for (const verb of cellOf(code, domain.prefix)) {
          expect(valid.has(verb), `${code}/${domain.id}=${verb}`).toBe(true);
        }
      }
    }
  });
});

describe('Legal Role Matrix — SoD invariants DERIVED from the enforced perms', () => {
  it('Auditor is strictly view/read-only across the whole matrix (CAP-155/181)', () => {
    for (const domain of MATRIX_DOMAINS) {
      for (const verb of cellOf('AUD', domain.prefix)) {
        expect(verb, `AUD has non-view verb on ${domain.id}`).toBe('V');
      }
    }
    expect(roleCoverageCount('AUD')).toBeGreaterThan(10);
  });

  it('Requester cannot approve, close or manage any domain (initiator ≠ approver)', () => {
    for (const domain of MATRIX_DOMAINS) {
      const cell = cellOf('REQ', domain.prefix);
      expect(cell).not.toContain('P');
      expect(cell).not.toContain('C');
      expect(cell).not.toContain('M');
    }
  });

  it('System Administrator configures (M) but holds no case/contract approve/close', () => {
    expect(cellOf('ADM', 'lex:catalog')).toContain('M');
    expect(cellOf('ADM', 'lex:sla')).toContain('M');
    for (const domain of MATRIX_DOMAINS) {
      const cell = cellOf('ADM', domain.prefix);
      expect(cell, `${domain.id}`).not.toContain('P');
      expect(cell, `${domain.id}`).not.toContain('C');
    }
  });

  it('Legal Officer drafts (add/edit) cases but cannot approve, close or assign', () => {
    expect(cellOf('LO', 'lex:case')).toEqual(expect.arrayContaining(['A', 'E']));
    expect(cellOf('LO', 'lex:investigation')).toEqual(expect.arrayContaining(['A', 'E']));
    expect(cellOf('LO', 'lex:consultation')).toEqual(['V']);
    for (const d of ['lex:case', 'lex:investigation', 'lex:settlement']) {
      expect(cellOf('LO', d)).not.toContain('P');
      expect(cellOf('LO', d)).not.toContain('C');
    }
    expect(restrictedVerbs(CANONICAL_PERMS_BY_CODE.LO, 'lex:case')).toHaveLength(0);
  });

  it('Cases & Investigations Sec. Mgr can assign, approve and close (the SoD counterpart)', () => {
    expect(cellOf('CSM', 'lex:case')).toEqual(expect.arrayContaining(['P', 'C']));
    expect(restrictedVerbs(CANONICAL_PERMS_BY_CODE.CSM, 'lex:case')).toContain('assign');
    expect(cellOf('CSM', 'lex:settlement')).toEqual(expect.arrayContaining(['P', 'C']));
    expect(cellOf('CSM', 'lex:investigation')).toContain('P');
  });

  it('Contracts final sign-off is the section manager, not the advisor (CAP-120)', () => {
    expect(cellOf('KSM', 'lex:contract')).toContain('P');
    expect(cellOf('LA', 'lex:contract')).not.toContain('P');
    expect(cellOf('LA', 'lex:contract')).toEqual(expect.arrayContaining(['A', 'E']));
  });

  it('Consultation responder (LA) is not the approver (responder ≠ approver)', () => {
    expect(cellOf('LA', 'lex:consultation')).toEqual(expect.arrayContaining(['A', 'E']));
    expect(cellOf('LA', 'lex:consultation')).not.toContain('P');
    expect(cellOf('LD', 'lex:consultation')).toContain('P');
    expect(cellOf('CSM', 'lex:case')).toContain('P');
  });

  it('business-tier roles only approve requests — never case/contract/consultation', () => {
    for (const code of ['DM', 'BUC', 'CEO'] as RoleCode[]) {
      expect(cellOf(code, 'lex:request')).toContain('P');
      expect(cellOf(code, 'lex:case')).not.toContain('P');
      expect(cellOf(code, 'lex:contract')).not.toContain('P');
      expect(cellOf(code, 'lex:consultation')).not.toContain('P');
    }
  });

  it('configuration "Manage" rights are confined to Legal Director and Administrator', () => {
    for (const code of ALL_CODES) {
      for (const domain of MATRIX_DOMAINS) {
        if (cellOf(code, domain.prefix).includes('M')) {
          expect(['LD', 'ADM'], `${code}/${domain.id} holds M`).toContain(code);
        }
      }
    }
  });

  it('no role resolves an audit WRITE verb — audit is read-only everywhere', () => {
    for (const code of ALL_CODES) {
      const cell = cellOf(code, 'lex:audit');
      for (const verb of cell) {
        expect(verb, `${code} has non-view on audit`).toBe('V');
      }
    }
  });

  it('coverage counters stay within bounds', () => {
    for (const code of ALL_CODES) {
      const n = roleCoverageCount(code);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(TOTAL_CAPABILITY_ROWS);
    }
    expect(roleCoverageCount('REQ')).toBeGreaterThan(0);
    expect(roleCoverageCount('LD')).toBe(TOTAL_CAPABILITY_ROWS);
  });
});

describe('diffRolePermissions — runtime drift detection', () => {
  it('returns null when the live set matches the canonical set', () => {
    expect(
      diffRolePermissions('LO', 'legal-officer', [...CANONICAL_PERMS_BY_CODE.LO]),
    ).toBeNull();
  });

  it('ignores the coarse lex:read / lex:write fallbacks', () => {
    const withoutCoarse = CANONICAL_PERMS_BY_CODE.LO.filter(
      (p) => p !== 'lex:read' && p !== 'lex:write',
    );
    expect(diffRolePermissions('LO', 'legal-officer', withoutCoarse)).toBeNull();
  });

  it('flags an escalated key the live role holds but the canonical source does not', () => {
    const escalated = [...CANONICAL_PERMS_BY_CODE.LO, 'lex:case:approve'];
    const drift = diffRolePermissions('LO', 'legal-officer', escalated);
    expect(drift).not.toBeNull();
    expect(drift?.extra).toContain('lex:case:approve');
  });

  it('flags a missing key (live role under-granted vs the model)', () => {
    const reduced = CANONICAL_PERMS_BY_CODE.CSM.filter((p) => p !== 'lex:case:approve');
    const drift = diffRolePermissions('CSM', 'legal-cases-manager', reduced);
    expect(drift?.missing).toContain('lex:case:approve');
  });

  it('treats a wildcard role as covering everything (no drift)', () => {
    expect(diffRolePermissions('ADM', 'legal-system-admin', ['*'])).toBeNull();
  });
});
