'use client';

/**
 * New-integration page — the catalog-driven onboarding entry point.
 *
 * No kind selected: render the {@link CatalogGallery} (Feature 8) so operators
 * browse connectors by maturity / KSA tags / self-serve instead of a bare
 * dropdown. Picking a card sets `?kind=` and swaps in the {@link SetupWizard}
 * (Feature 1), a Prerequisites → Credentials → Test → Enable → First-sync
 * stepper. The wizard creates the endpoint at the Credentials step and, on
 * finish, routes to its detail page.
 *
 * `?kind=` is the source of truth for the selected kind so the choice survives a
 * refresh / deep link (the old card-grid already linked here that way).
 */
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/common/page-header';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import {
  INTEGRATION_KINDS,
  type IntegrationKind,
} from '@/lib/lex/integrations';
import { useIntegrationLabels } from '../_lib/use-integration-labels';
import { kindMeta } from '../_lib/integration-kinds';
import { CatalogGallery } from '../_components/catalog-gallery';
import { SetupWizard } from '../_components/setup-wizard';
import { KindBanner } from '../_components/kind-banner';
import { CustomConnectorBuilder } from '../_components/custom-connector-builder';

const LIST_ROUTE = '/lex/admin/integrations';
const NEW_ROUTE = `${LIST_ROUTE}/new`;

export default function NewIntegrationPage() {
  const router = useRouter();
  const search = useSearchParams();
  const t = useIntegrationLabels();
  const { locale, direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('lex:write');

  const rawKind = search?.get('kind') ?? '';
  const kind = (INTEGRATION_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as IntegrationKind)
    : null;

  function pickKind(next: IntegrationKind) {
    router.push(`${NEW_ROUTE}?kind=${next}`);
  }

  // No (valid) kind selected: render the catalog gallery.
  if (!kind) {
    return (
      <PermissionRedirect permission="lex:read">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            eyebrow={t.breadcrumb}
            title={t.catalogTitle}
            description={t.catalogSubtitle}
            actions={
              <Button asChild variant="outline">
                <Link href={LIST_ROUTE}>{t.backToList}</Link>
              </Button>
            }
          />
          <CatalogGallery onPick={pickKind} />
        </div>
      </PermissionRedirect>
    );
  }

  const meta = kindMeta(kind);

  return (
    <PermissionRedirect permission="lex:read">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          eyebrow={t.breadcrumb}
          title={`${t.newIntegration} · ${resolveLocalized(meta.name, locale)}`}
          description={resolveLocalized(meta.blurb, locale)}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => router.push(NEW_ROUTE)}>
                {t.wizardChangeKind}
              </Button>
              <Button asChild variant="ghost">
                <Link href={LIST_ROUTE}>{t.backToList}</Link>
              </Button>
            </div>
          }
        />

        <KindBanner kind={kind} />

        <LexCreationGuidance workflow="integration" />

        {!canWrite ? (
          <div className="rounded-xl border border-warning-300 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:bg-warning-800/20 dark:text-warning-300">
            {t.readOnlyNote}
          </div>
        ) : null}

        {/* #18: the `custom` kind uses the no-code REST builder instead of the
            schema-driven setup wizard. */}
        {kind === 'custom' ? (
          <CustomConnectorBuilder
            readOnly={!canWrite}
            onFinish={(id) => router.push(`${LIST_ROUTE}/${id}`)}
          />
        ) : (
          <SetupWizard
            kind={kind}
            readOnly={!canWrite}
            onFinish={(id) => router.push(`${LIST_ROUTE}/${id}`)}
            onChangeKind={() => router.push(NEW_ROUTE)}
          />
        )}
      </div>
    </PermissionRedirect>
  );
}
