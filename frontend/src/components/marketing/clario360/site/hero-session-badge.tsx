'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API_ENDPOINTS } from '@/lib/constants';
import { serializeSessionOp } from '@/lib/session-refresh';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';

/* ============================================================
   HeroSessionBadge — the signed-in persona pill shown at the top
   of every marketing hero (home `.hero`, the shared <Hero>, and
   each interior `.page-hero`). It surfaces the logged-in user's
   NAME and primary ROLE, mirroring the app's sidebar user footer
   (first+last name, `roles[0].name`), and links back into the app.

   Anonymous visitors — the default marketing audience — render
   NOTHING, so the hero is byte-for-byte unchanged for them and
   there is no layout shift on the first (pre-probe) paint.
   ============================================================ */

interface HeroPersona {
  name: string;
  role: string;
  initials: string;
}

interface SessionUser {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  roles?: { name?: string }[];
}

/** Derive the displayable persona from a BFF session `user`, or null. */
function toPersona(user: SessionUser | null | undefined): HeroPersona | null {
  if (!user) return null;
  const first = user.first_name ?? '';
  const last = user.last_name ?? '';
  const name =
    (user.full_name?.trim() || `${first} ${last}`.trim() || user.email) ?? '';
  if (!name) return null;
  const role = user.roles?.[0]?.name?.trim() ?? '';
  const initials =
    `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() ||
    name.charAt(0).toUpperCase() ||
    'U';
  return { name, role, initials };
}

/* Module-level, promise-cached session probe. A page mounts exactly one hero,
   but caching keeps client-side navigation between hero pages from re-hitting
   the BFF, and de-dupes if the tree ever renders two badges at once. */
let sessionProbe: Promise<HeroPersona | null> | null = null;

function probeSession(): Promise<HeroPersona | null> {
  if (!sessionProbe) {
    // Relative BFF route — resolves to the Next.js origin, reads the httpOnly
    // access cookie, and 401s (→ null) for anonymous visitors.
    //
    // serializeSessionOp is load-bearing: when the access cookie is near
    // expiry this GET rotates the SINGLE-USE refresh cookie server-side, so an
    // unserialized probe from a marketing tab could race an app tab's token
    // renewal and trip backend replay detection (which revokes every session
    // for the user). The wrapper joins the same in-tab chain + cross-tab Web
    // Lock all other cookie-rotating calls use.
    sessionProbe = serializeSessionOp(() =>
      fetch(API_ENDPOINTS.BFF_SESSION, { credentials: 'include' }),
    )
      .then((res) => (res.ok ? (res.json() as Promise<{ user?: SessionUser }>) : null))
      .then((data) => toPersona(data?.user))
      .catch(() => null);
  }
  return sessionProbe;
}

export function HeroSessionBadge() {
  const { messages: m } = useMarketingLocale();
  const [persona, setPersona] = useState<HeroPersona | null>(null);

  useEffect(() => {
    let active = true;
    void probeSession().then((p) => {
      if (active) setPersona(p);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!persona) return null;

  const label = m.nav.signedInAs;
  const aria = persona.role
    ? `${label} ${persona.name}, ${persona.role}`
    : `${label} ${persona.name}`;

  return (
    <Link className="hero-session" href="/dashboard" aria-label={aria}>
      <span className="hero-session-avatar" aria-hidden="true">
        {persona.initials}
      </span>
      <span className="hero-session-text">
        <span className="hero-session-label">{label}</span>
        <span className="hero-session-id">
          <span className="hero-session-name">{persona.name}</span>
          {persona.role ? (
            <>
              <span className="hero-session-dot" aria-hidden="true">
                ·
              </span>
              <span className="hero-session-role">{persona.role}</span>
            </>
          ) : null}
        </span>
      </span>
      <MarketingIcon name="arrow" className="hero-session-arrow" />
    </Link>
  );
}
