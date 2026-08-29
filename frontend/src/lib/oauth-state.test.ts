import { describe, it, expect } from 'vitest';
import { buildOAuthState, withOAuthState } from './oauth-state';

const STATE = 'abc123+/=';
const ENCODED_STATE = encodeURIComponent(STATE);

describe('withOAuthState — appends state when the URL lacks one', () => {
  it('test_withOAuthState_noQuery: appends ?state= to a bare URL', () => {
    expect(withOAuthState('https://idp.example.com/authorize', STATE)).toBe(
      `https://idp.example.com/authorize?state=${ENCODED_STATE}`,
    );
  });

  it('test_withOAuthState_existingQuery: appends &state= after existing params', () => {
    expect(
      withOAuthState('https://idp.example.com/authorize?client_id=abc&scope=openid', STATE),
    ).toBe(`https://idp.example.com/authorize?client_id=abc&scope=openid&state=${ENCODED_STATE}`);
  });

  it('test_withOAuthState_encodesState: state value is URL-encoded', () => {
    const url = withOAuthState('https://idp.example.com/authorize', 'a b&c=d');
    expect(url).toBe('https://idp.example.com/authorize?state=a%20b%26c%3Dd');
  });

  it('test_withOAuthState_relativeUrl: relative authorize paths still get state', () => {
    expect(withOAuthState('/api/v1/auth/sso/okta/login', STATE)).toBe(
      `/api/v1/auth/sso/okta/login?state=${ENCODED_STATE}`,
    );
  });

  it('test_withOAuthState_relativeUrlWithQuery: relative path with query gets &state=', () => {
    expect(withOAuthState('/api/v1/auth/sso/okta/login?tenant_id=t1', STATE)).toBe(
      `/api/v1/auth/sso/okta/login?tenant_id=t1&state=${ENCODED_STATE}`,
    );
  });
});

describe('withOAuthState — leaves URLs that already carry state UNCHANGED', () => {
  it('test_withOAuthState_serverState: server-persisted state is preserved verbatim', () => {
    const url =
      'https://idp.example.com/authorize?client_id=abc&state=server-persisted-state&scope=openid';
    expect(withOAuthState(url, STATE)).toBe(url);
  });

  it('test_withOAuthState_stateOnlyParam: state as the sole param is preserved', () => {
    const url = 'https://idp.example.com/authorize?state=srv';
    expect(withOAuthState(url, STATE)).toBe(url);
  });

  it('test_withOAuthState_relativeWithState: relative URL with state is preserved', () => {
    const url = '/api/v1/auth/sso/okta/login?state=srv';
    expect(withOAuthState(url, STATE)).toBe(url);
  });

  it('test_withOAuthState_emptyStateValue: an empty state= param still counts as present', () => {
    // The server explicitly minted the param; clobbering or duplicating it is
    // not this helper's call — the URL passes through untouched.
    const url = 'https://idp.example.com/authorize?client_id=abc&state=';
    expect(withOAuthState(url, STATE)).toBe(url);
  });
});

describe('withOAuthState — near-miss params must NOT suppress appending', () => {
  it('test_withOAuthState_relayState: RelayState is not state', () => {
    const url = 'https://idp.example.com/saml?RelayState=xyz';
    expect(withOAuthState(url, STATE)).toBe(`${url}&state=${ENCODED_STATE}`);
  });

  it('test_withOAuthState_stateSuffixParam: app_state is not state', () => {
    const url = 'https://idp.example.com/authorize?app_state=xyz';
    expect(withOAuthState(url, STATE)).toBe(`${url}&state=${ENCODED_STATE}`);
  });
});

describe('buildOAuthState — payload shape', () => {
  it('test_buildOAuthState_sanitizesRedirect: hostile redirect falls back to /dashboard', () => {
    const decoded = JSON.parse(atob(buildOAuthState('okta', 'https://evil.example.com')));
    expect(decoded.provider).toBe('okta');
    expect(decoded.redirect_to).toBe('/dashboard');
  });

  it('test_buildOAuthState_keepsRelativeRedirect: same-origin path survives', () => {
    const decoded = JSON.parse(atob(buildOAuthState('okta', '/lex/cases/42')));
    expect(decoded.redirect_to).toBe('/lex/cases/42');
  });
});
