import { describe, expect, it } from 'vitest';
import {
  isPaletteHrefInScope,
  isPaletteSearchSourceInScope,
  productFamilyFromPath,
  resolvePaletteProductScope,
} from './command-palette-scope';

describe('command palette product scope', () => {
  it('keeps WatheeqTech routes and excludes other suites and global exits', () => {
    const accessible = ['lex', 'cyber'];
    const active = resolvePaletteProductScope('/lex/contracts', '', accessible);

    expect(active).toBe('lex');
    expect(isPaletteHrefInScope('/lex/cases', active, accessible)).toBe(true);
    expect(isPaletteHrefInScope('/cyber/alerts', active, accessible)).toBe(false);
    expect(isPaletteHrefInScope('/dashboard', active, accessible)).toBe(false);
    expect(isPaletteHrefInScope('/notebooks', active, accessible)).toBe(false);
  });

  it('keeps a sticky product scope on shared routes', () => {
    const active = resolvePaletteProductScope('/files', 'lex', ['lex', 'cyber']);

    expect(active).toBe('lex');
    expect(isPaletteHrefInScope('/lex/contracts', active, ['lex', 'cyber'])).toBe(true);
    expect(isPaletteHrefInScope('/cyber/assets', active, ['lex', 'cyber'])).toBe(false);
  });

  it('scopes a single-product subscriber even on the all-suites hub', () => {
    const active = resolvePaletteProductScope('/dashboard', '', ['lex']);

    expect(active).toBe('lex');
    expect(isPaletteHrefInScope('/lex', active, ['lex'])).toBe(true);
    expect(isPaletteHrefInScope('/dashboard', active, ['lex'])).toBe(false);
  });

  it('allows only subscribed products from a multi-product hub', () => {
    const accessible = ['lex', 'cyber'];
    const active = resolvePaletteProductScope('/dashboard', '', accessible);

    expect(active).toBeNull();
    expect(isPaletteHrefInScope('/lex/contracts', active, accessible)).toBe(true);
    expect(isPaletteHrefInScope('/cyber/alerts', active, accessible)).toBe(true);
    expect(isPaletteHrefInScope('/data/pipelines', active, accessible)).toBe(false);
    expect(isPaletteHrefInScope('/admin/users', active, accessible)).toBe(true);
  });

  it('treats the DR console and Recover routes as one product family', () => {
    expect(productFamilyFromPath('/dr/readiness')).toBe('recover');
    const active = resolvePaletteProductScope('/dr', '', ['recover']);

    expect(isPaletteHrefInScope('/recover/it-dr/recover', active, ['recover'])).toBe(true);
    expect(isPaletteHrefInScope('/dr/integrations', active, ['recover'])).toBe(true);
  });

  it('filters live search sources before any cross-product query is configured', () => {
    const accessible = ['lex', 'cyber'];

    expect(isPaletteSearchSourceInScope('lex', 'lex', accessible)).toBe(true);
    expect(isPaletteSearchSourceInScope('cyber', 'lex', accessible)).toBe(false);
    expect(isPaletteSearchSourceInScope('platform', 'lex', accessible)).toBe(false);
    expect(isPaletteSearchSourceInScope('lex', null, accessible)).toBe(true);
    expect(isPaletteSearchSourceInScope('cyber', null, accessible)).toBe(true);
    expect(isPaletteSearchSourceInScope('data', null, accessible)).toBe(false);
    expect(isPaletteSearchSourceInScope('platform', null, accessible)).toBe(true);
  });
});
