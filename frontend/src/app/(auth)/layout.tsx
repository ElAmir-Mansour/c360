import type { Metadata } from 'next';
import Image from 'next/image';
import { getRequestLocaleAttributes } from '@/lib/i18n.server';
import { getMessages } from '@/lib/i18n/messages';
import { SkipToForm } from '@/components/auth/skip-to-form';
import { TrustStrip } from '@/components/auth/trust-strip';
import { LocaleQuickToggle } from '@/components/layout/locale-quick-toggle';
import { ThemeLocaleSwitcher } from '@/components/layout/theme-locale-switcher';
import { AuthRuntime } from '@/components/providers/auth-runtime';

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await getRequestLocaleAttributes();
  return { title: getMessages(lang).auth.metadataTitle };
}

function BrandLockup({
  productName,
  tagline,
}: {
  productName: string;
  tagline: string;
}) {
  return (
    <div className="min-w-0">
      <Image
        src="/auth/figma-login/clario360-lockup.svg"
        alt={productName}
        width={130}
        height={42}
        priority
        className="h-[42px] w-[130px] object-contain dark:brightness-0 dark:invert"
      />
      <p className="mt-2 hidden whitespace-nowrap text-[10px] uppercase tracking-[0.1em] text-muted-foreground sm:block">
        {tagline}
      </p>
    </div>
  );
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const localeAttributes = await getRequestLocaleAttributes();
  const messages = getMessages(localeAttributes.lang);
  const authMessages = messages.auth;
  const currentYear = new Date().getFullYear();
  const localizedYear =
    localeAttributes.lang === 'ar'
      ? new Intl.NumberFormat('ar-SA-u-nu-arab', { useGrouping: false }).format(currentYear)
      : String(currentYear);
  const localizedProductName =
    localeAttributes.lang === 'ar' ? 'كلاريو٣٦٠' : authMessages.productName;
  const compactTrustLabels = {
    ...authMessages.trust,
    nca: 'NCA ECC',
    sama: 'SAMA CSF',
    iso: 'ISO 27001',
    residency:
      localeAttributes.lang === 'ar' ? 'البيانات مستضافة في السعودية' : 'Data hosted in KSA',
  };

  return (
    <AuthRuntime hydrateOnMount={false}>
      <div
        dir="ltr"
        className="relative flex min-h-svh overflow-x-clip bg-background text-foreground"
      >
        <div dir={localeAttributes.dir} className="contents">
          <SkipToForm targetId="auth-form" label={authMessages.skipToForm} />
        </div>

        {/* The Figma composition keeps the orbit visual physically left in both
            locales; the form panel re-applies the locale direction internally. */}
        <div
          aria-hidden
          className="relative hidden min-h-[700px] flex-1 overflow-hidden bg-primary lg:block xl:flex-[0_0_62.0139%]"
        >
          <Image
            src="/auth/figma-login/orbit-hero.png"
            alt=""
            fill
            priority
            unoptimized
            sizes="(min-width: 1280px) 62vw, (min-width: 1024px) 56vw, 1px"
            className="object-cover"
          />
        </div>

        <section
          dir={localeAttributes.dir}
          className="relative z-10 flex min-h-svh w-full flex-col bg-background lg:min-h-[885px] lg:flex-[0_0_44%] xl:flex-[0_0_37.9861%]"
        >
          <header
            dir="ltr"
            className="mx-auto flex w-[calc(100%-40px)] max-w-[420px] shrink-0 items-start justify-between gap-3 pt-5 lg:absolute lg:inset-x-0 lg:top-8 lg:w-[calc(100%-48px)] lg:pt-0"
          >
            <BrandLockup
              productName={authMessages.productName}
              tagline={authMessages.eyebrow}
            />
            <div className="flex shrink-0 items-center gap-2">
              <LocaleQuickToggle />
              <ThemeLocaleSwitcher />
            </div>
          </header>

          <main className="mx-auto w-[calc(100%-40px)] max-w-[420px] flex-1 pb-10 pt-12 sm:pt-16 lg:absolute lg:inset-x-0 lg:top-[178px] lg:w-[calc(100%-48px)] lg:pb-0 lg:pt-0">
            <div id="auth-form" tabIndex={-1} className="w-full">
              {children}
            </div>
          </main>

          <footer className="mx-auto mt-auto w-[calc(100%-40px)] max-w-[401px] pb-6 text-center lg:absolute lg:inset-x-0 lg:bottom-[43px] lg:w-[calc(100%-48px)] lg:pb-0">
            <div dir="ltr">
              <TrustStrip
                compact
                labels={compactTrustLabels}
                className="flex-wrap justify-center gap-1.5 lg:flex-nowrap"
              />
            </div>
            <p className="mt-4 text-[12px] leading-[1.2] text-muted-foreground">
              &copy; {localizedYear} {localizedProductName} · {authMessages.footerRights}
            </p>
          </footer>
        </section>
      </div>
    </AuthRuntime>
  );
}
