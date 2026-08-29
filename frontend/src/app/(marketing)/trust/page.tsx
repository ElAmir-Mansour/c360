import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Globe, Landmark, Lock, ShieldCheck } from 'lucide-react';

import { TRUST_BADGES } from '@/components/auth/trust-strip';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { createMarketingMetadata } from '@/lib/marketing/metadata';
import {
  getMarketingDirection,
  getMarketingMessages,
} from '@/lib/marketing/messages';

export const metadata: Metadata = createMarketingMetadata({
  title: 'Clario360 — Trust & Compliance',
  description:
    'Clario360 compliance certifications and data-residency commitments: NCA ECC, SAMA CSF, ISO 27001, and KSA-hosted data.',
  path: '/trust',
});

// Standalone light landing (capability #19) that does NOT use the marketing
// shell. It still honours the persisted marketing-locale cookie: the locale is
// resolved server-side so `dir`/`lang` and all copy SSR in the right language
// with no flash. Icons come from TRUST_BADGES (positional); all prose is
// localised via `m.trust`.
export default async function TrustPage() {
  const locale = await getMarketingLocale();
  const dir = getMarketingDirection(locale);
  const t = getMarketingMessages(locale).trust;
  const isRtl = dir === 'rtl';
  // Back arrow is directional: it points toward the start edge, which flips in RTL.
  const BackArrow = isRtl ? ArrowRight : ArrowLeft;

  return (
    <div
      className="auth-clario relative min-h-screen overflow-hidden bg-background"
      dir={dir}
      lang={locale}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(0,51,161,0.10),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(29,91,255,0.08),_transparent_32%)]" />

      <div className="relative w-full px-4 py-12 sm:px-6 sm:py-16">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <BackArrow className="h-3.5 w-3.5" />
          {t.back}
        </Link>

        <header className="mt-6 space-y-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-0.5 text-[10px] font-medium text-primary${
              isRtl ? '' : ' uppercase tracking-caps-xwide'
            }`}
          >
            <ShieldCheck className="h-3 w-3" />
            {t.eyebrow}
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-[2.25rem]">
            {t.title}
          </h1>
          <p className="max-w-2xl text-sm leading-7 text-foreground/65">
            {t.lede}
          </p>
        </header>

        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {t.badges.map((badge, i) => {
            const Icon = TRUST_BADGES[i]?.icon ?? ShieldCheck;
            return (
              <li
                key={badge.label}
                className="rounded-xl border border-primary/12 bg-card p-4 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.10)]"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {badge.label}
                    </p>
                    <p className="text-[13px] leading-6 text-foreground/60">
                      {badge.desc}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 flex flex-wrap items-center gap-2 text-[11px] text-foreground/50">
          <span className="inline-flex items-center gap-1.5">
            <Landmark className="h-3.5 w-3.5 text-primary/70" />
            {t.chips.regulator}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-primary/70" />
            {t.chips.encrypted}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-primary/70" />
            {t.chips.hosting}
          </span>
        </div>
      </div>
    </div>
  );
}
