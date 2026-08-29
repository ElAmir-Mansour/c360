import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('Watheeq landing palette contract', () => {
  const theme = read(
    'src/app/(dashboard)/lex/_styles/lex-landing-theme.module.css',
  );
  const generatedTokens = read('src/styles/tokens/tokens.css');

  it.each([
    ['primary', 'var(--wt-teal-700)'],
    ['dark-teal', 'var(--wt-teal-900)'],
    ['accent', 'var(--wt-lime-500)'],
    ['spring-teal', 'rgb(var(--ds-clario-spring-teal))'],
    ['canvas', 'var(--wt-canvas)'],
    ['tint', 'var(--wt-teal-300)'],
    ['border', 'var(--wt-teal-300)'],
    ['ink', 'var(--wt-teal-900)'],
    ['muted', 'rgb(var(--ds-clario-muted))'],
  ])('maps --lex-landing-%s to %s', (token, value) => {
    expect(theme).toContain(`--lex-landing-${token}: ${value};`);
  });

  it.each([
    ['teal-900', '#06352F'],
    ['teal-700', '#005E5E'],
    ['teal-600', '#06352F'],
    ['teal-300', '#D1D8D5'],
    ['lime-500', '#ABB705'],
    ['nav-active', '#ABB705'],
    ['canvas', '#FDFFF6'],
    ['critical', '#A5332D'],
    ['ok', '#438866'],
    ['service-contracts-dot', '#005E5E'],
    ['service-investigation-dot', '#3D88E2'],
    ['domain-blue', '#CFE5FA'],
    ['domain-grey', '#F5F5F5'],
    ['radius-card', '1rem'],
    ['radius-kpi-card', '0.875rem'],
    ['card-border-width', '1px'],
    ['elevation', 'none'],
    ['font-size-kpi', '3rem'],
    ['line-height-kpi', '3.25rem'],
    ['font-size-label', '0.8125rem'],
    ['line-height-label', '1.125rem'],
    ['letter-spacing-label', '0.06em'],
    ['font-size-panel-title', '1.375rem'],
    ['line-height-panel-title', '1.75rem'],
    ['font-size-body', '0.875rem'],
    ['line-height-body', '1.25rem'],
    ['font-size-caption', '0.75rem'],
    ['line-height-caption', '1.0625rem'],
    ['font-size-heading', '2.125rem'],
    ['line-height-heading', '2.625rem'],
  ])('generates --wt-%s as %s', (token, value) => {
    expect(generatedTokens).toContain(`--wt-${token}: ${value};`);
  });

  it('does not create WLS aliases for existing canonical DS brand tokens', () => {
    expect(generatedTokens).not.toContain('--wt-spring-teal:');
    expect(generatedTokens).not.toContain('--wt-muted:');
    expect(theme).toContain(
      '--lex-landing-muted-readable: rgb(var(--ds-clario-muted));',
    );
  });

  it.each([
    ['dark/ink', '172.3404 79.6610% 11.5686%'],
    ['spring teal', '180.3871 85.6354% 35.4902%'],
    ['muted', '160 5.2632% 44.7059%'],
    ['light neutral', '154.2857 8.2353% 83.3333%'],
  ])('includes the exact %s HSL triplet', (_name, triplet) => {
    expect(theme).toContain(triplet);
  });

  it('scopes the generated palette to the /lex landing', () => {
    const page = read('src/app/(dashboard)/lex/page.tsx');
    const hero = read(
      'src/app/(dashboard)/lex/_components/command-hero.tsx',
    );

    expect(page).toContain("from './_styles/lex-landing-theme.module.css'");
    expect(page).toContain('data-lex-landing-theme="watheeq"');
    expect(hero).toContain('bg-brand-accent');
    expect(hero).not.toContain('var(--ds-primary-950)');
  });
});
