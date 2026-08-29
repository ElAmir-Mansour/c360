'use client';

/**
 * KindBanner — light per-kind contextual notes on the detail/new page.
 *
 *   - gov-gated kinds (najiz / nafath_verify / esign): onboarding banner noting
 *     the Saudi government / TSP prerequisite before going live.
 *   - sso: a discovery hint (point at the IdP issuer; OIDC discovery / SAML
 *     metadata is fetched from it).
 *   - archiving: in-kingdom WORM note.
 *
 * Purely informational; no actions. All copy bilingual via the labels module +
 * the per-kind metadata blurb.
 */
import { resolveLocalized } from '@/lib/i18n/localized';
import { Info, Landmark, Lock, Server } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import type { IntegrationKind } from '@/lib/lex/integrations';
import { useIntegrationLabels } from '../_lib/use-integration-labels';
import { kindMeta, isGovGated } from '../_lib/integration-kinds';

interface KindBannerProps {
  kind: IntegrationKind;
}

const SSO_HINT = {
  ar: 'وجِّه التكامل إلى مُصدِّر مزوّد الهوية (issuer)؛ يُجلب اكتشاف OIDC أو بيانات SAML الوصفية منه تلقائيًا.',
  en: 'Point this at your IdP issuer; OIDC discovery / SAML metadata is fetched from it automatically.',
};

const ARCHIVING_HINT = {
  ar: 'تُكتب السجلات بنمط WORM (للقراءة فقط بعد الكتابة) داخل المملكة للامتثال لمتطلبات السيادة على البيانات.',
  en: 'Records are written WORM (write-once) and kept in-kingdom to satisfy data-sovereignty requirements.',
};

export function KindBanner({ kind }: KindBannerProps) {
  const t = useIntegrationLabels();
  const { locale } = useLocaleOrDefault();
  const meta = kindMeta(kind);

  const banners: { icon: typeof Info; tone: string; title: string; body: string }[] = [];

  if (isGovGated(kind)) {
    banners.push({
      icon: Landmark,
      tone: 'border-warning-300 bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
      title: t.govGatedBadge,
      body: t.govGatedHint,
    });
  }
  if (kind === 'sso') {
    banners.push({
      icon: Lock,
      tone: 'border-brand-accent-300 bg-brand-accent-50 text-brand-accent-900 dark:bg-brand-accent-900/20 dark:text-brand-accent-200',
      title: resolveLocalized(meta.name, locale),
      body: resolveLocalized(SSO_HINT, locale),
    });
  }
  if (kind === 'archiving') {
    banners.push({
      icon: Server,
      tone: 'border-brand-teal-300 bg-brand-teal-50 text-brand-teal-800 dark:bg-brand-teal-900/20 dark:text-brand-teal-200',
      title: resolveLocalized(meta.name, locale),
      body: resolveLocalized(ARCHIVING_HINT, locale),
    });
  }

  if (banners.length === 0) return null;

  return (
    <div className="space-y-3">
      {banners.map((b, i) => {
        const Icon = b.icon;
        return (
          <div
            key={i}
            className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', b.tone)}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="space-y-0.5">
              <p className="font-semibold">{b.title}</p>
              <p className="text-body-sm leading-6 opacity-90">{b.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
