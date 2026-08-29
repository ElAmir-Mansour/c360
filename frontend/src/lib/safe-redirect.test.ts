import { describe, it, expect } from 'vitest';
import { safePostAuthRedirect, safeRedirect } from './safe-redirect';

describe('safeRedirect — accepts same-origin relative paths', () => {
  it('test_safeRedirect_simplePath: /dashboard passes through', () => {
    expect(safeRedirect('/dashboard')).toBe('/dashboard');
  });

  it('test_safeRedirect_pathWithQueryAndHash: /a/b?x=1#h passes through', () => {
    expect(safeRedirect('/a/b?x=1#h')).toBe('/a/b?x=1#h');
  });

  it('test_safeRedirect_rootPath: bare / passes through', () => {
    expect(safeRedirect('/')).toBe('/');
  });
});

describe('safeRedirect — rejects absolute / cross-origin targets', () => {
  it('test_safeRedirect_absoluteHttps: https://evil.com -> fallback', () => {
    expect(safeRedirect('https://evil.com')).toBe('/dashboard');
  });

  it('test_safeRedirect_protocolRelative: //evil.com -> fallback', () => {
    expect(safeRedirect('//evil.com')).toBe('/dashboard');
  });

  it('test_safeRedirect_protocolRelativeWithPath: //evil.com/path -> fallback', () => {
    expect(safeRedirect('//evil.com/path')).toBe('/dashboard');
  });
});

describe('safeRedirect — rejects backslash trickery', () => {
  it('test_safeRedirect_slashBackslash: /\\evil.com -> fallback', () => {
    expect(safeRedirect('/\\evil.com')).toBe('/dashboard');
  });

  it('test_safeRedirect_backslashSlash: \\/evil.com -> fallback', () => {
    expect(safeRedirect('\\/evil.com')).toBe('/dashboard');
  });

  it('test_safeRedirect_embeddedBackslash: /foo\\bar -> fallback', () => {
    expect(safeRedirect('/foo\\bar')).toBe('/dashboard');
  });
});

describe('safeRedirect — rejects scheme-bearing targets', () => {
  it('test_safeRedirect_javascript: javascript:alert(1) -> fallback', () => {
    expect(safeRedirect('javascript:alert(1)')).toBe('/dashboard');
  });

  it('test_safeRedirect_httpSingleSlash: http:/x -> fallback', () => {
    expect(safeRedirect('http:/x')).toBe('/dashboard');
  });

  it('test_safeRedirect_dataScheme: data:text/html,... -> fallback', () => {
    expect(safeRedirect('data:text/html,<script>1</script>')).toBe('/dashboard');
  });
});

describe('safeRedirect — rejects empty / nullish input', () => {
  it('test_safeRedirect_empty: empty string -> fallback', () => {
    expect(safeRedirect('')).toBe('/dashboard');
  });

  it('test_safeRedirect_null: null -> fallback', () => {
    expect(safeRedirect(null)).toBe('/dashboard');
  });

  it('test_safeRedirect_undefined: undefined -> fallback', () => {
    expect(safeRedirect(undefined)).toBe('/dashboard');
  });
});

describe('safeRedirect — rejects whitespace / control-char injection', () => {
  const SPACE = String.fromCharCode(0x20);
  const TAB = String.fromCharCode(0x09);
  const NEWLINE = String.fromCharCode(0x0a);
  const CARRIAGE_RETURN = String.fromCharCode(0x0d);
  const NULL_BYTE = String.fromCharCode(0x00);

  it('test_safeRedirect_leadingWhitespace: " /dashboard" -> fallback', () => {
    expect(safeRedirect(`${SPACE}/dashboard`)).toBe('/dashboard');
  });

  it('test_safeRedirect_tabInjection: "/foo<TAB>bar" -> fallback', () => {
    expect(safeRedirect(`/foo${TAB}bar`)).toBe('/dashboard');
  });

  it('test_safeRedirect_newlineSchemeBypass: "java<LF>script:..." -> fallback', () => {
    expect(safeRedirect(`java${NEWLINE}script:alert(1)`)).toBe('/dashboard');
  });

  it('test_safeRedirect_nullByte: "/foo<NUL>bar" -> fallback', () => {
    expect(safeRedirect(`/foo${NULL_BYTE}bar`)).toBe('/dashboard');
  });

  it('test_safeRedirect_carriageReturn: "/foo<CR>bar" -> fallback', () => {
    expect(safeRedirect(`/foo${CARRIAGE_RETURN}bar`)).toBe('/dashboard');
  });
});

describe('safeRedirect — custom fallback', () => {
  it('test_safeRedirect_customFallback: untrusted target uses provided fallback', () => {
    expect(safeRedirect('https://evil.com', '/login')).toBe('/login');
  });

  it('test_safeRedirect_customFallbackUnusedForValid: valid target ignores fallback', () => {
    expect(safeRedirect('/settings', '/login')).toBe('/settings');
  });
});

describe('safePostAuthRedirect — rejects auth entry points', () => {
  it('test_safePostAuthRedirect_login: /login falls back to dashboard', () => {
    expect(safePostAuthRedirect('/login')).toBe('/dashboard');
  });

  it('test_safePostAuthRedirect_loginWithQuery: /login?redirect=/login falls back', () => {
    expect(safePostAuthRedirect('/login?redirect=%2Flogin')).toBe('/dashboard');
  });

  it('test_safePostAuthRedirect_protectedPath: protected paths still pass through', () => {
    expect(safePostAuthRedirect('/cyber/cti')).toBe('/cyber/cti');
  });
});
