/* ============================================================
   CLARIO360 MARKETING — bilingual copy (EN / MSA Arabic).

   Framework-agnostic (no react / no next/headers) so it can be
   imported by the client locale provider, server pages, and the
   home component alike. The marketing surface defaults to EN/LTR
   and opts into Arabic/RTL only when toggled (persisted cookie).
   ============================================================ */

export const MARKETING_LOCALES = ['en', 'ar'] as const;
export type MarketingLocale = (typeof MARKETING_LOCALES)[number];
export type MarketingDirection = 'ltr' | 'rtl';

/** Marketing site keeps its OWN preference cookie, decoupled from the
 *  app-wide `clario360_locale` so the landing can stay English while the
 *  authenticated app is Arabic-first (and vice-versa). */
export const MARKETING_LOCALE_COOKIE = 'clario360_marketing_locale';
/** One year, in seconds. */
export const MARKETING_LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

/** Default marketing locale — EN/LTR unless the visitor toggles. */
export const DEFAULT_MARKETING_LOCALE: MarketingLocale = 'en';

const MARKETING_DIRECTIONS: Record<MarketingLocale, MarketingDirection> = {
  en: 'ltr',
  ar: 'rtl',
};

export function getMarketingDirection(locale: MarketingLocale): MarketingDirection {
  return MARKETING_DIRECTIONS[locale];
}

export function isMarketingLocale(value: unknown): value is MarketingLocale {
  return (
    typeof value === 'string' &&
    (MARKETING_LOCALES as readonly string[]).includes(value)
  );
}

/** Normalise any candidate (cookie value, `?lang=`, etc.) to a supported
 *  marketing locale, or `null` when it is not one we serve. */
export function normalizeMarketingLocale(
  candidate: string | null | undefined,
): MarketingLocale | null {
  const normalized = candidate?.trim().toLowerCase();
  if (!normalized) return null;
  if (isMarketingLocale(normalized)) return normalized;
  const [language] = normalized.split('-');
  return isMarketingLocale(language) ? language : null;
}

/** Serialise the preference cookie for `document.cookie` (client switching).
 *  Not httpOnly — this is a UI preference the client must read and write. */
export function serializeMarketingLocaleCookie(locale: MarketingLocale): string {
  return `${MARKETING_LOCALE_COOKIE}=${locale}; path=/; max-age=${MARKETING_LOCALE_MAX_AGE}; samesite=lax`;
}

/** Read the marketing locale from a raw `document.cookie` string (client). */
export function readMarketingLocaleFromCookie(
  cookieString: string | null | undefined,
): MarketingLocale | null {
  if (!cookieString) return null;
  const match = cookieString
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${MARKETING_LOCALE_COOKIE}=`));
  if (!match) return null;
  return normalizeMarketingLocale(match.slice(MARKETING_LOCALE_COOKIE.length + 1));
}

/* ------------------------------------------------------------
   Message shape.

   The shell (nav + footer), the HOME page, and the SHARED interior
   chrome (`chrome` + `notFound` below) are fully bilingual through
   this map. Each interior page's BODY copy lives in its OWN typed
   namespace (`platform`, `solutions`, …). Those namespaces START
   EMPTY on purpose — they are filled by the per-page agents.

   HOW A PAGE AGENT ADDS COPY (all in THIS file, one namespace each):
     1. Add the keys your page needs to the matching `Marketing<Page>Messages`
        interface just below (replace the empty body).
     2. Fill `EN.<namespace>` with the English copy.
     3. Fill `AR.<namespace>` with professional MSA (فصحى) copy.
   `tsc` keeps the interface and BOTH locale objects in lockstep, so a
   key that is missing on either side fails the typecheck.

   Reuse the shared chrome — `m.chrome.breadcrumbHome`, `m.chrome.cta`,
   `m.chrome.bus`, and `m.notFound` — instead of re-keying it per page.
   ------------------------------------------------------------ */

/* Interior page BODY namespaces — intentionally empty typed slots.
   A page agent REPLACES the empty body of its interface with concrete
   keys, then fills EN + AR below. */
export interface MarketingPlatformMessages {
  /** Trailing breadcrumb crumb ("Platform"). */
  breadcrumb: string;
  hero: {
    eyebrow: string;
    title: string;
    lede: string;
    ctaDeepDive: string;
    ctaDeployment: string;
  };
  context: {
    eyebrow: string;
    title: string;
    lede: string;
    /** Four system-context rows (icons owned by the component). */
    rows: string[];
    /** Architecture-card prose labels. Product tokens stay Latin. */
    cardTop: string;
    cardAi: string;
    cardFoundation: string;
    /** Plural "apps" word for the suite tiles (count prepended). */
    appsWord: string;
  };
  engines: {
    eyebrow: string;
    title: string;
    lede: string;
  };
  master: {
    eyebrow: string;
    title: string;
    /** Six layers, top→bottom. Colours owned by the component; product/
     *  engine tokens inside a detail line stay Latin. */
    layers: { name: string; detail: string }[];
  };
  tenancy: {
    eyebrow: string;
    title: string;
    lede: string;
    points: string[];
    specs: { value: string; label: string }[];
  };
  /** Closing CTA-band override for this page. */
  cta: { title: string; sub: string };
}
export interface MarketingPlatformEngineMessages {
  /** Trailing breadcrumb crumb linking back to /platform. */
  breadcrumbPlatform: string;
  /** "Platform core" pill in the hero. */
  badge: string;
  /** Counter line template — `{n}` `{total}` `{tag}` interpolated. */
  engineCounter: string;
  /** Localised engine detail `tag` per engine id. EN stays empty so the
   *  page falls back to the DATA-owned tag; AR overrides all twelve. */
  tags: Record<string, string>;
  ctaRequestDemo: string;
  ctaAllEngines: string;
  whatItDoes: string;
  consumedBy: string;
  capabilities: string;
  /** "Inside the {name}" — `{name}` (Latin engine name) interpolated. */
  insideTitle: string;
  otherEyebrow: string;
  otherTitle: string;
  otherLede: string;
  cta: { title: string; sub: string };
}
export interface MarketingSolutionsMessages {
  /** Trailing breadcrumb crumb ("Solutions"). */
  breadcrumb: string;
  hero: { eyebrow: string; title: string; lede: string };
  /** Six role personas (icons owned by the component). */
  personas: { title: string; desc: string; uses: string[] }[];
  compare: {
    eyebrow: string;
    title: string;
    head: { capability: string; clario: string; other: string };
    /** Six rows: [capability, Clario column, point-tools column]. */
    rows: [string, string, string][];
  };
}
export interface MarketingSovereigntyMessages {
  /** Trailing breadcrumb crumb (leading "Home" reuses chrome.breadcrumbHome). */
  breadcrumb: string;
  hero: { eyebrow: string; title: string; lede: string };
  deploy: {
    eyebrow: string;
    title: string;
    lede: string;
    /** Three deployment cards (SaaS · on-prem · air-gapped); icons stay in the
     *  component, indexed positionally against this list. */
    cards: { tag: string; name: string; body: string; points: string[] }[];
  };
  compliance: {
    eyebrow: string;
    title: string;
    lede: string;
    /** Framework tiles. `title` holds regulator/standard acronyms kept as-is in
     *  both locales; only `desc` is localised. Icons live in the component. */
    frameworks: { title: string; desc: string }[];
  };
  security: {
    eyebrow: string;
    title: string;
    items: { title: string; desc: string }[];
    guarantee: { tag: string; title: string; body: string; badges: string[] };
  };
  cta: { title: string; sub: string };
}
export interface MarketingResourcesMessages {}
export interface MarketingPricingMessages {
  /** Breadcrumb leaf label for /pricing. */
  breadcrumb: string;
  eyebrow: string;
  title: string;
  lede: string;
  /** "Most chosen" ribbon on the featured tier. */
  ribbon: string;
  /** Pricing tiers — SAME ORDER as the structural TIER_META (Trial · Suite ·
   *  Platform · Sovereign). The figures were reconciled upstream; this is copy. */
  tiers: {
    name: string;
    desc: string;
    price: string;
    note: string;
    /** Secondary muted line under the price (user cohort · deployment). */
    sub?: string;
    feats: string[];
    cta: string;
  }[];
  /** Footnote under the tier grid. */
  tiersNote: string;
  configuratorHead: { eyebrow: string; title: string; lede: string };
  /** "Build your platform" configurator widget copy. Suite card labels stay
   *  brand names; only the sub-labels + chrome are localised. */
  configurator: {
    cards: {
      datastream: string;
      business: string;
      clariosec: string;
      clarioinsight: string;
    };
    selectedLabel: string;
    noSuites: string;
    applicationsLabel: string;
    appsWord: string;
    platformCoreLabel: string;
    platformCoreValue: string;
    suggestedTierLabel: string;
    tierNone: string;
    tierNames: { suite: string; platform: string; sovereign: string };
    deploymentLabel: string;
    deployAriaLabel: string;
    deployOptions: { saas: string; onprem: string; airgap: string };
    cta: string;
  };
  faqHead: { eyebrow: string; title: string };
  faq: { q: string; a: string }[];
  /** Closing CtaBand override. */
  cta: { title: string; sub: string };
}
export interface MarketingAboutMessages {
  breadcrumb: string;
  heroEyebrow: string;
  heroTitle: string;
  heroLede: string;
  thesisEyebrow: string;
  thesisTitle: string;
  thesisP1: string;
  thesisP2: string;
  /** Four one-word convictions with a short definition each. */
  specs: { term: string; def: string }[];
  roadmapEyebrow: string;
  roadmapTitle: string;
  roadmapLede: string;
  /** Roadmap rows — `phase` is a literal date tag (H1 · 2026 …) kept as-is in
   *  both locales; `name`/`body` are localised. Product/brand names stay. */
  roadmap: { phase: string; name: string; body: string }[];
  /** Closing CtaBand override. */
  cta: { title: string; sub: string };
}
export interface MarketingCompareMessages {
  hero: { breadcrumb: string; eyebrow: string; title: string; lede: string };
  comparison: {
    eyebrow: string;
    title: string;
    lede: string;
    headDimension: string;
    headClario: string;
    headOther: string;
    rows: { label: string; clario: string; other: string }[];
    footnote: string;
  };
  economics: { eyebrow: string; title: string; lede: string };
  reasons: {
    eyebrow: string;
    title: string;
    /** Three supporting principles; icons stay in the component, indexed
     *  positionally against this list. */
    items: { title: string; body: string }[];
  };
  cta: { title: string; sub: string };
}
export interface MarketingContactMessages {
  breadcrumb: string;
  heroEyebrow: string;
  heroTitle: string;
  heroLede: string;
  /** Four contact-reason cards. */
  info: { title: string; copy: string }[];
  /** "We speak Arabic" callout — `flourish` is the OPPOSITE script to the
   *  active locale (Arabic accent while reading EN, Latin accent while AR). */
  arabicCallout: { flourish: string; body: string };
  /** Lead form — labels, placeholders, options, submit + status strings. */
  form: {
    title: string;
    subtitle: string;
    nameLabel: string;
    namePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    orgLabel: string;
    orgPlaceholder: string;
    roleLabel: string;
    rolePlaceholder: string;
    interestLabel: string;
    interestOptions: string[];
    deploymentLabel: string;
    deploymentOptions: string[];
    messageLabel: string;
    messagePlaceholder: string;
    submit: string;
    submitting: string;
    consent: string;
    successDefault: string;
    /** `{id}` interpolated with the returned reference. */
    successWithRef: string;
    errorDefault: string;
  };
}
export interface MarketingSuiteMessages {}
export interface MarketingSuiteAppMessages {}
export interface MarketingTrustMessages {
  back: string;
  eyebrow: string;
  title: string;
  lede: string;
  /** Trust badges in the SAME order as TRUST_BADGES; icons come from there.
   *  Acronym labels (NCA ECC …) stay as-is; residency label + all descs are
   *  localised. */
  badges: { label: string; desc: string }[];
  chips: { regulator: string; encrypted: string; hosting: string };
}

export interface MarketingMessages {
  /** Reading direction for this locale. */
  dir: MarketingDirection;
  /** Directional "learn-more" arrow glyph (flips for RTL). */
  arrow: string;
  nav: {
    products: string;
    platform: string;
    solutions: string;
    sovereignty: string;
    resources: string;
    pricing: string;
    about: string;
    signIn: string;
    /** Hero persona pill (HeroSessionBadge) lead-in — "Signed in as {name}". */
    signedInAs: string;
    requestDemo: string;
    /** Products mega-menu head. */
    productsMegaTitle: string;
    productsMegaSub: string;
    platformArchitecture: string;
    /** Platform mega-menu head. */
    platformCoreEngines: string;
    architecture: string;
    /** Accessibility / chrome. */
    skipToContent: string;
    primaryNav: string;
    openMenu: string;
    closeMenu: string;
    siteMenu: string;
    /** Suite word appended to a suite name in the mobile drawer. */
    suiteWord: string;
    /** Language switcher. */
    language: string;
    switchToEnglish: string;
    switchToArabic: string;
  };
  footer: {
    tagline: string;
    /** Bilingual flourish shown UNDER the tagline (the opposite script). */
    flourish: string;
    overview: string;
    colPlatform: string;
    colCompany: string;
    architecture: string;
    platformCore: string;
    deployment: string;
    compliance: string;
    solutions: string;
    whyClario: string;
    about: string;
    resources: string;
    pricing: string;
    contact: string;
    requestDemo: string;
    security: string;
    privacy: string;
    terms: string;
    copyright: string;
    /** Compliance badges (product acronyms kept as-is). */
    badges: string[];
  };
  home: {
    heroBadgeLabel: string;
    heroBadgeText: string;
    /** Bilingual accent line above the H1 (opposite script). */
    heroFlourish: string;
    heroTitleLine1: string;
    heroTitleLine2: string;
    heroTitleAccent: string;
    heroLede: string;
    ctaRequestDemo: string;
    ctaExplorePlatform: string;
    /** Hero trust counters — numerals localised (Arabic-Indic for `ar`). */
    trust: { value: string; label: string }[];
    stripLabel: string;
    principlesEyebrow: string;
    principlesTitle: string;
    principlesLede: string;
    suitesEyebrow: string;
    suitesTitle: string;
    suitesLede: string;
    /** Dark metric band — the value markup lives in home.tsx; only the
     *  descriptive labels are localised here. */
    statLabels: string[];
    deployEyebrow: string;
    deployTitle: string;
    deployLede: string;
    /* ---- P2 conversion + P3 structure additions (all localised) ----
       Numerals in the templated strings below are interpolated from the
       DATA (suites.ts / engines.ts) at render time via {ga} {total}
       {roadmap} {engines} {suites} tokens — a single source of truth. */
    coverageLine: string;
    archTopLabel: string;
    archBusLabel: string;
    archCaption: string;
    proof: {
      eyebrow: string;
      title: string;
      lede: string;
      complianceLabel: string;
      badgeNote: string;
      dateTag: string;
      partnersLabel: string;
      partnerSlot: string;
      badges: { name: string; note: string }[];
    };
    problem: {
      eyebrow: string;
      title: string;
      lede: string;
      items: { title: string; body: string }[];
    };
    how: {
      eyebrow: string;
      title: string;
      lede: string;
      steps: { title: string; body: string }[];
    };
    suiteOutcomeLabel: string;
    suiteOutcomes: Record<'ds' | 'bp' | 'sec' | 'insight', string>;
    midCta: { title: string; sub: string };
    sovereignty: {
      eyebrow: string;
      title: string;
      lede: string;
      points: string[];
      pillars: { title: string; body: string }[];
    };
    security: {
      eyebrow: string;
      title: string;
      lede: string;
      items: { title: string; body: string }[];
    };
    roi: { eyebrow: string; title: string; lede: string };
    pricingPreview: {
      eyebrow: string;
      title: string;
      lede: string;
      tiers: { name: string; price: string; note: string; blurb: string }[];
      cta: string;
      configure: string;
    };
    faq: {
      eyebrow: string;
      title: string;
      items: { q: string; a: string }[];
    };
  };
  /* ---- Shared interior chrome (translated here, reused by every page) ---- */
  chrome: {
    /** Leading crumb on every interior breadcrumb trail. */
    breadcrumbHome: string;
    /** Closing CTA band (shared › CtaBand) shown near the foot of most pages.
     *  `title`/`sub` are DEFAULTS — a page may override them per-instance. */
    cta: {
      title: string;
      sub: string;
      requestDemo: string;
      exploreArchitecture: string;
    };
    /** Cross-suite event-bus diagram (shared › BusDiagram). Node and event
     *  names are product/technical identifiers and stay as-is; only the prose
     *  is localised here. */
    bus: {
      eyebrow: string;
      title: string;
      lede: string;
      spineLabel: string;
      spineSub: string;
      footnote: string;
    };
  };
  /** Shared 404 body (site › NotFoundSite). `code` is the HTTP status, kept literal. */
  notFound: {
    code: string;
    title: string;
    lede: string;
    backHome: string;
    explorePlatform: string;
  };
  /* ---- Interior page BODY copy — typed slots OWNED by the page agents.
     Each interface starts EMPTY; see the "HOW A PAGE AGENT ADDS COPY" note above. ---- */
  platform: MarketingPlatformMessages;
  platformEngine: MarketingPlatformEngineMessages;
  solutions: MarketingSolutionsMessages;
  sovereignty: MarketingSovereigntyMessages;
  resources: MarketingResourcesMessages;
  pricing: MarketingPricingMessages;
  about: MarketingAboutMessages;
  compare: MarketingCompareMessages;
  contact: MarketingContactMessages;
  suite: MarketingSuiteMessages;
  suiteApp: MarketingSuiteAppMessages;
  trust: MarketingTrustMessages;
}

const EN: MarketingMessages = {
  dir: 'ltr',
  arrow: '→',
  nav: {
    products: 'Products',
    platform: 'Platform',
    solutions: 'Solutions',
    sovereignty: 'Sovereignty',
    resources: 'Resources',
    pricing: 'Pricing',
    about: 'About',
    signIn: 'Sign in',
    signedInAs: 'Signed in as',
    requestDemo: 'Request a demo',
    productsMegaTitle: 'The Clario360 platform',
    productsMegaSub: 'Four suites · one platform core · one login',
    platformArchitecture: 'Platform architecture',
    platformCoreEngines: 'Platform core · 12 engines',
    architecture: 'Architecture',
    skipToContent: 'Skip to content',
    primaryNav: 'Primary',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    siteMenu: 'Site menu',
    suiteWord: 'Suite',
    language: 'Language',
    switchToEnglish: 'Switch to English',
    switchToArabic: 'التبديل إلى العربية',
  },
  footer: {
    tagline:
      'The sovereign enterprise platform. Four suites, one platform core, one login — built Arabic-first and ready to deploy SaaS, on-prem, or fully air-gapped.',
    flourish: 'المنصة السيادية للمؤسسات',
    overview: 'Overview',
    colPlatform: 'Platform',
    colCompany: 'Company',
    architecture: 'Architecture',
    platformCore: 'Platform core',
    deployment: 'Deployment',
    compliance: 'Compliance',
    solutions: 'Solutions',
    whyClario: 'Why Clario360',
    about: 'About',
    resources: 'Resources',
    pricing: 'Pricing',
    contact: 'Contact',
    requestDemo: 'Request a demo',
    security: 'Security',
    privacy: 'Privacy',
    terms: 'Terms',
    copyright: '© 2026 Clario360',
    badges: ['NCA-ready', 'SAMA CSF', 'PDPL', 'ISO 27001', 'Arabic-first'],
  },
  home: {
    heroBadgeLabel: 'Sovereign',
    heroBadgeText: 'Deploys SaaS · on-prem · fully air-gapped',
    heroFlourish: 'منصة سيادية للمؤسسات · باللغة العربية أولاً',
    heroTitleLine1: 'One platform.',
    heroTitleLine2: 'Four suites.',
    heroTitleAccent: 'Sovereign by design.',
    heroLede:
      'Clario360 unifies data resilience and corporate operations on a single configurable core — one login, one audit, Arabic-first. Built once as shared services, so every application inherits the platform instead of rebuilding it.',
    ctaRequestDemo: 'Request a demo',
    ctaExplorePlatform: 'Explore the platform',
    trust: [
      { value: '4', label: 'Product suites' },
      { value: '15', label: 'Applications' },
      { value: '12', label: 'Shared core engines' },
      { value: '3', label: 'Deployment worlds' },
    ],
    stripLabel: 'Architected for the institutions that demand sovereignty',
    principlesEyebrow: 'Foundations',
    principlesTitle: 'Six principles every part of the platform obeys',
    principlesLede:
      'These are not slogans — they are architectural constraints. Each one removes a category of cost, lock-in, or duplication before it can take root.',
    suitesEyebrow: 'The product',
    suitesTitle: 'Four suites, built on one core',
    suitesLede:
      'Each suite is a family of applications that share the platform — so capability compounds across resilience, operations, security and analytics, and you never pay to build the same thing twice.',
    statLabels: [
      'Recovery time objective with boot-ordered failover',
      'Change-data-capture lag SLO across ClarioSync',
      'Cost per terabyte vs global cloud warehouses',
      'In-Kingdom data residency, air-gap capable',
    ],
    deployEyebrow: 'Sovereign by design',
    deployTitle: 'Three deployment worlds, one codebase',
    deployLede:
      'No cloud-only dependencies anywhere in the stack. The same components run as managed SaaS, inside your data centre, or in a fully disconnected environment.',
    coverageLine:
      '{ga} of {total} applications are generally available today — {roadmap} more on the 2026–27 roadmap.',
    archTopLabel: 'Clario360 · one platform',
    archBusLabel: 'EVENT BUS · ordered · per-tenant · replayable',
    archCaption:
      '{total} applications · {ga} GA today · {roadmap} on the 2026–27 roadmap · {engines} shared engines',
    proof: {
      eyebrow: 'Trusted foundations',
      title: "Built for the Kingdom's regulatory bar",
      lede: 'Clario360 maps to the frameworks Saudi institutions are audited against — and deploys where your data is required to stay.',
      complianceLabel: 'Regulatory alignment',
      badgeNote:
        'Framework packs ship in-platform. Alignment reviewed 2026 — evidence available under NDA. Marks denote alignment, not certification.',
      dateTag: 'Aligned 2026',
      partnersLabel: 'Deployment slots for institutions across the Kingdom',
      partnerSlot: 'Your institution',
      badges: [
        { name: 'NCA ECC', note: 'Essential Cybersecurity Controls' },
        { name: 'SAMA CSF', note: 'Cyber Security Framework' },
        { name: 'PDPL', note: 'Personal Data Protection Law' },
        { name: 'ISO 27001', note: 'Information security management' },
        { name: 'Najiz', note: 'Ministry of Justice integration' },
        { name: 'ZATCA', note: 'E-invoicing (Fatoora)' },
      ],
    },
    problem: {
      eyebrow: 'The problem',
      title: "Point tools don't add up to a platform",
      lede: "Most institutions run a dozen disconnected products. The cost isn't the licences — it's everything that has to be rebuilt around them.",
      items: [
        {
          title: 'Tool sprawl',
          body: 'A dozen point products, each with its own login, data model, and audit trail to reconcile.',
        },
        {
          title: 'The integration tax',
          body: 'Every new tool means brittle point-to-point integrations to build — and maintain forever.',
        },
        {
          title: 'Data leaves the Kingdom',
          body: 'SaaS-only vendors move regulated data offshore, outside NCA and PDPL control.',
        },
        {
          title: 'No single source of truth',
          body: 'No unified identity, audit or reporting across the stack — so diligence stays manual.',
        },
      ],
    },
    how: {
      eyebrow: 'How it works',
      title: 'One core. Adopt at your pace.',
      lede: 'Everything runs on shared services, so you start small and compound — without re-platforming.',
      steps: [
        {
          title: 'Choose your suites',
          body: 'Begin with one suite or the whole platform. The full core ships with any of them.',
        },
        {
          title: 'Deploy your way',
          body: 'Managed SaaS in-Kingdom, in your own data centre, or fully air-gapped — one codebase.',
        },
        {
          title: "Configure, don't code",
          body: 'Workflows, forms, integrations and automation are admin-configured, not redeployed.',
        },
        {
          title: 'Compound across suites',
          body: 'Apps share identity, audit and the event bus, so every addition makes the rest stronger.',
        },
      ],
    },
    suiteOutcomeLabel: 'Outcome',
    suiteOutcomes: {
      ds: 'Recover in minutes and move data across environments without downtime.',
      bp: 'Run legal, governance and delivery on one auditable operations core.',
      sec: 'See exposure, posture and behaviour in one security programme — not four consoles.',
      insight: 'Turn in-Kingdom data into governed dashboards leaders actually trust.',
    },
    midCta: {
      title: 'Ready to see it on your own data?',
      sub: 'A guided demo on a sovereign deployment — mapped to your frameworks and workflows.',
    },
    sovereignty: {
      eyebrow: 'Sovereign by design',
      title: 'Your data never has to leave the Kingdom',
      lede: "Sovereignty isn't a deployment option bolted on at the end — it's the constraint every component is built to. No cloud-only dependencies, anywhere in the stack.",
      points: [
        'In-Kingdom data residency by default',
        'Air-gapped and classified-environment ready',
        'Bring-your-own-key (BYOK) — you hold the root of trust',
        'Full audit trail inside your own tenant',
        'Static binaries — no external calls required to run',
      ],
      pillars: [
        {
          title: 'In-Kingdom residency',
          body: 'Regulated data stays on infrastructure you approve, under NCA and PDPL control.',
        },
        {
          title: 'Air-gapped capable',
          body: 'A static-binary core deploys into fully disconnected, classified environments.',
        },
        {
          title: 'BYOK encryption',
          body: 'Customer-held keys and key-ceremony support keep the root of trust in your hands.',
        },
      ],
    },
    security: {
      eyebrow: 'Security & compliance',
      title: 'Compliance is built in, not bolted on',
      lede: 'The controls auditors ask for are platform features — shared once, inherited by every application.',
      items: [
        {
          title: 'Framework packs',
          body: 'NCA ECC, SAMA CSF, PDPL and ISO 27001 mappings ship in-platform and stay current.',
        },
        {
          title: 'One audit trail',
          body: 'Every action across every suite writes to a single, tamper-evident audit log.',
        },
        {
          title: 'Identity & access',
          body: 'Shared IAM with SSO, RBAC and separation-of-duties enforced at the gateway.',
        },
        {
          title: 'Encryption & keys',
          body: 'Data encrypted in transit and at rest, with BYOK and customer-managed key options.',
        },
      ],
    },
    roi: {
      eyebrow: 'The economics',
      title: 'One platform, not a stack of point tools',
      lede: "Model the difference between licensing and integrating a dozen products versus running one core. Illustrative — we'll build a costed model for your environment.",
    },
    pricingPreview: {
      eyebrow: 'Pricing',
      title: 'Licensed by suite, priced for the institution',
      lede: 'Flat and predictable — by suite and deployment model, never per seat. Every configuration includes the full platform core.',
      tiers: [
        {
          name: 'Trial',
          price: 'Free',
          note: '14 days · SaaS',
          blurb: 'Self-serve selected products on the shared trial plan.',
        },
        {
          name: 'Suite',
          price: 'Tailored',
          note: 'Per suite · annual',
          blurb: 'One suite and its full application family on the complete core.',
        },
        {
          name: 'Platform',
          price: 'Tailored',
          note: 'All suites · annual',
          blurb: 'All four suites, every application, cross-suite event flows.',
        },
        {
          name: 'Sovereign',
          price: 'Bespoke',
          note: 'Air-gapped / classified',
          blurb: 'Dedicated sovereign infrastructure with bespoke assurance.',
        },
      ],
      cta: 'See full pricing',
      configure: 'Build your platform',
    },
    faq: {
      eyebrow: 'Questions',
      title: 'Common questions',
      items: [
        {
          q: 'What exactly is Clario360?',
          a: 'One sovereign enterprise platform: four product suites and a shared core of platform engines, under one login and one audit trail — built Arabic-first.',
        },
        {
          q: 'How many applications are available today?',
          a: '{ga} of {total} applications are generally available now; the remaining {roadmap} are on the 2026–27 roadmap. Every plan includes the full platform core of {engines} shared engines.',
        },
        {
          q: 'Is it really sovereign and air-gapped?',
          a: 'Yes. The core is a set of static binaries with no cloud-only dependencies, so the identical components run as managed SaaS, on-premise, or in a fully disconnected environment.',
        },
        {
          q: 'Where does our data live?',
          a: 'In-Kingdom by default, on infrastructure you approve. Bring-your-own-key encryption keeps the root of trust in your hands.',
        },
        {
          q: 'Can we start with one suite?',
          a: 'Yes — most institutions begin with one suite and add others later. The full platform core comes with any of them.',
        },
        {
          q: 'How is it priced?',
          a: 'By suite and deployment model, not per seat — flat and predictable, with no consumption surprises. Air-gapped deployments are scoped with you directly.',
        },
      ],
    },
  },
  chrome: {
    breadcrumbHome: 'Home',
    cta: {
      title: 'See Clario360 on your own data',
      sub: 'A guided demo on a sovereign deployment — mapped to your frameworks, your workflows, and your Arabic-first requirements.',
      requestDemo: 'Request a demo',
      exploreArchitecture: 'Explore the architecture',
    },
    bus: {
      eyebrow: 'The signature · Cross-suite flows',
      title: 'The bus is the boundary',
      lede: "Every application publishes facts as domain events. No service calls another service's database; no synchronous cross-suite chains exist. This single rule is why suites can ship, scale and fail independently.",
      spineLabel: 'Event Bus',
      spineSub: 'Ordered · partitioned per tenant · schema registry · replayable',
      footnote: 'Events carry facts, not commands. The bus absorbs what coupling would otherwise break.',
    },
  },
  notFound: {
    code: '404',
    title: "This route isn't on the map",
    lede: "The page you're looking for doesn't exist — but the platform does. Head back to the hub or explore a suite.",
    backHome: 'Back to home',
    explorePlatform: 'Explore the platform',
  },
  // Interior page bodies — filled by the per-page agents (see the note above).
  platform: {
    breadcrumb: 'Platform',
    hero: {
      eyebrow: 'Platform architecture',
      title: 'Built once. Inherited everywhere.',
      lede: 'Clario360 is platform-first: a configurable core of shared engines, behind one gateway, with one identity and one audit trail. Applications consume these services — they never re-implement them. That is the whole economic argument, expressed in architecture.',
      ctaDeepDive: 'Request a technical deep-dive',
      ctaDeployment: 'Deployment & sovereignty',
    },
    context: {
      eyebrow: 'System context',
      title: 'Clario360 in its world',
      lede: 'One platform serves every enterprise role and connects to the systems a Kingdom institution actually runs.',
      rows: [
        'Enterprise users, IT & data teams, risk/legal/PMO, executives and board',
        'Customer identity — Active Directory / Entra, single sign-on',
        'Government platforms — Najiz, ZATCA and sector regulators',
        'Regulators — NCA, SAMA, PDPL alignment built in',
      ],
      cardTop: 'One login · one audit · Arabic-first',
      cardAi: 'AI Services · copilots & detection',
      cardFoundation: 'Data · events · sovereign infrastructure',
      appsWord: 'apps',
    },
    engines: {
      eyebrow: 'The platform core',
      title: 'Twelve engines every application consumes',
      lede: 'Configured by administrators, not redeployed by engineers. Build a workflow, a form, an integration or an automation once — every suite can use it. Select any engine for detail.',
    },
    master: {
      eyebrow: 'Master view',
      title: 'The target architecture, top to bottom',
      layers: [
        {
          name: 'Experience',
          detail: 'Web · React (RTL/LTR) · Mobile · Partner & Public APIs · Admin Studio',
        },
        {
          name: 'Gateway',
          detail: 'API Gateway · authN/Z · rate limits · routing · versioning · Go',
        },
        {
          name: 'Suites',
          detail: 'DataStream (Go) · Business+ (NestJS) · ClarioSec · ClarioInsight',
        },
        {
          name: 'Platform Core',
          detail: 'Workflow · Forms · Automation · Integration · IAM · Files · Notify · Licensing · AI',
        },
        {
          name: 'Event Bus',
          detail: 'Ordered · partitioned per tenant · schema registry · replayable',
        },
        {
          name: 'Foundation',
          detail: 'Data · sovereign object storage · observability · audit',
        },
      ],
    },
    tenancy: {
      eyebrow: 'Tenancy & isolation',
      title: 'Multi-tenant, with hard boundaries',
      lede: 'Every tenant is isolated at the data and event layer. The bus is partitioned per tenant; no application reads across tenant boundaries, and no service reaches into another service’s database.',
      points: [
        'Per-tenant event partitions with a shared schema registry',
        'Branding, frameworks and entitlements configured per tenant',
        'Identity federated to each customer’s own IdP',
        'Audit trail scoped, immutable and exportable per tenant',
      ],
      specs: [
        { value: '1', label: 'Login across the whole platform' },
        { value: '1', label: 'Audit trail, immutable' },
        { value: 'N', label: 'Tenants, fully isolated' },
        { value: '0', label: 'Cross-database calls, by rule' },
      ],
    },
    cta: {
      title: 'Walk the architecture with our team',
      sub: 'From C4 context down to the replication core and the event bus — a working session mapped to your environment.',
    },
  },
  platformEngine: {
    breadcrumbPlatform: 'Platform',
    badge: 'Platform core',
    engineCounter: 'Engine {n} of {total} · {tag}',
    tags: {},
    ctaRequestDemo: 'Request a demo',
    ctaAllEngines: 'All 12 engines',
    whatItDoes: 'What it does',
    consumedBy: 'Consumed by',
    capabilities: 'Capabilities',
    insideTitle: 'Inside the {name}',
    otherEyebrow: 'The platform core',
    otherTitle: 'The other engines',
    otherLede: 'Every engine is built once and consumed by all four suites. That is the platform-first dividend.',
    cta: {
      title: 'See the platform core in a deep-dive',
      sub: 'From the gateway to the event bus — a working session on how the engines fit together in your environment.',
    },
  },
  solutions: {
    breadcrumb: 'Solutions',
    hero: {
      eyebrow: 'By role',
      title: 'Built for the people who run the institution',
      lede: 'Clario360 is one platform, but every role meets it differently. Here is where each team starts — and how the suites compound once they are connected.',
    },
    personas: [
      {
        title: 'IT & Data Teams',
        desc: 'Continuous protection, sovereign migration and a lakehouse that keeps data in-Kingdom — without stitching point tools together.',
        uses: [
          'ClarioDR for audit-grade failover and drills',
          'ClarioMigration for cloud-agnostic moves',
          'ClarioDWH as the single sovereign destination',
        ],
      },
      {
        title: 'Risk, Legal & Compliance',
        desc: 'Saudi frameworks pre-loaded, contracts authored Arabic-first, and a live compliance posture instead of a quarterly scramble.',
        uses: [
          'EHKAM with NCA, SAMA and PDPL on day one',
          'WatheeqTech for Arabic-native contract lifecycle',
          'One control mapped to many frameworks',
        ],
      },
      {
        title: 'PMO & Delivery',
        desc: 'Delivery that never drifts from strategy — every task traces up to an objective and across to a risk, automatically.',
        uses: [
          'MahamaTech for portfolios, programs and gates',
          'OKR cascade from BOSALAH',
          'Delivery risks escalate into EHKAM',
        ],
      },
      {
        title: 'Executives & Board',
        desc: 'A live read-model of the whole organisation — Vision-2030-aligned, with Arabic board packs generated from real numbers, not slides.',
        uses: [
          'BOSALAH strategy map and OKRs',
          'Live dashboards fed by the event bus',
          'Board packs in Arabic, on demand',
        ],
      },
      {
        title: 'Security & SOC',
        desc: 'A full security programme on one sovereign console — exposure, data security, behavioural analytics and a virtual CISO, all on the same bus.',
        uses: [
          'CTEM for continuous exposure reduction',
          'DSPM and UEBA for data and behaviour',
          'ClarioVCISO for a board-ready programme',
        ],
      },
      {
        title: 'Data & Analytics',
        desc: 'Governed data turned into live decisions — pipelines and quality feeding dashboards and KPIs that every team can trust.',
        uses: [
          'Data Intelligence for pipelines and quality',
          'Visus dashboards, KPIs and alerts',
          'Every figure traceable to governed data',
        ],
      },
    ],
    compare: {
      eyebrow: 'Why one platform',
      title: 'Point tools don’t compound. A platform does.',
      head: {
        capability: 'Capability',
        clario: 'Clario360 platform',
        other: 'Stitched point tools',
      },
      rows: [
        ['Identity & login', 'One login across every suite', 'Separate logins per tool'],
        ['Workflow & forms', 'Configured once, used everywhere', 'Rebuilt in each product'],
        ['Cross-product data', 'Facts flow on the event bus', 'Brittle point-to-point integrations'],
        ['Arabic-first / RTL', 'Solved once in the shared shell', 'Bolted on, if at all'],
        ['Sovereign deployment', 'SaaS, on-prem or air-gapped', 'Usually cloud-only'],
        ['Audit trail', 'One immutable, platform-wide trail', 'Fragmented across vendors'],
      ],
    },
  },
  sovereignty: {
    breadcrumb: 'Sovereignty & security',
    hero: {
      eyebrow: 'Sovereign by design',
      title: 'Your data, your Kingdom, your control',
      lede: 'Sovereignty is not a configuration flag bolted onto a cloud product — it is an architectural decision made at the foundation. No component of Clario360 depends on a public cloud to function.',
    },
    deploy: {
      eyebrow: 'Deployment',
      title: 'One codebase, three worlds',
      lede: 'The same components run as managed SaaS, inside your data centre, or in a fully disconnected environment — no feature cliff between them.',
      cards: [
        {
          tag: 'Managed',
          name: 'SaaS',
          body: 'Fully managed in a sovereign region. Fastest to value, with Clario360 operating the platform for you.',
          points: ['In-Kingdom hosting', 'Managed upgrades & SLOs', 'Elastic by tenant'],
        },
        {
          tag: 'Self-hosted',
          name: 'On-premise',
          body: 'Runs inside your own data centre under your control, using the identical components as the managed service.',
          points: ['Your infrastructure', 'Your operations team', 'Same codebase as SaaS'],
        },
        {
          tag: 'Disconnected',
          name: 'Air-gapped',
          body: 'A static-binary core with no cloud-only dependencies, deployable into fully disconnected, classified environments.',
          points: ['No external calls required', 'Static binaries, portable', 'Classified-environment ready'],
        },
      ],
    },
    compliance: {
      eyebrow: 'Compliance',
      title: 'Frameworks mapped, not promised',
      lede: 'EHKAM ships with the Kingdom’s frameworks pre-loaded and a unified control library, so evidence collected once satisfies every mapped regulation at the same time.',
      frameworks: [
        { title: 'NCA ECC / CSCC', desc: 'National Cybersecurity Authority essential and critical controls' },
        { title: 'SAMA CSF', desc: 'Saudi Central Bank cybersecurity framework' },
        { title: 'PDPL', desc: 'Personal Data Protection Law alignment' },
        { title: 'ISO 27001', desc: 'Information-security management baseline' },
        { title: 'NIST', desc: 'Control mapping for international alignment' },
        { title: 'Najiz / ZATCA', desc: 'Government-platform integration where applicable' },
      ],
    },
    security: {
      eyebrow: 'Security architecture',
      title: 'Defence built into the platform',
      items: [
        { title: 'Identity & access', desc: 'One IAM with RBAC, federated to your own IdP, enforced at the gateway.' },
        { title: 'Tenant isolation', desc: 'Per-tenant event partitions and data boundaries — no cross-tenant reads.' },
        { title: 'Immutable audit', desc: 'Every action attested to a tamper-evident, exportable trail.' },
        { title: 'Encryption in transit', desc: 'Replication and events compressed, encrypted and resumable.' },
      ],
      guarantee: {
        tag: 'The sovereign guarantee',
        title: 'No cloud-only dependencies. Anywhere.',
        body: 'The replication core is a static binary. The platform runs disconnected. Data stays in-Kingdom by construction — not by policy you have to trust.',
        badges: ['Air-gap ready', 'In-Kingdom data', 'Static binaries'],
      },
    },
    cta: {
      title: 'Review the controls with our security team',
      sub: 'A working session mapped to NCA, SAMA and PDPL — against your environment and your auditors’ requirements.',
    },
  },
  resources: {},
  pricing: {
    breadcrumb: 'Pricing',
    eyebrow: 'WatheeqTech · Pricing',
    title: 'Plans that grow with your legal team',
    lede: 'Flat SAR pricing, per user — from self-serve onboarding to sovereign, air-gapped deployment. Every plan includes AI review, drafting and legal chat.',
    ribbon: 'MOST POPULAR',
    tiers: [
      {
        name: 'Starter',
        desc: '',
        price: '139.99',
        note: 'SAR / user / month',
        sub: '5+ users · SaaS',
        feats: [
          'Self-serve onboarding',
          'Email support · 1-day SLA',
          '1M AI credits / month',
          'AI review, drafting & legal chat',
          'Basic clause library',
          '2 approval workflows',
          '1 GB storage / user',
        ],
        cta: 'Start now',
      },
      {
        name: 'Growth',
        desc: '',
        price: '189.99',
        note: 'SAR / user / month',
        sub: '15+ users · SaaS',
        feats: [
          'Guided onboarding',
          'Portal support · 8-hr SLA',
          '2M AI credits / month',
          'AI review, drafting & legal chat',
          'Standard clause library',
          '5 approval workflows',
          'SSO + standard connectors',
          'Read-only API access',
          'Data export + KSA data residency',
          '3 GB storage / user',
        ],
        cta: 'Talk to sales',
      },
      {
        name: 'Enterprise',
        desc: '',
        price: '239.99',
        note: 'SAR / user / month',
        sub: '35+ users · SaaS',
        feats: [
          '★ White-glove onboarding — FREE PoC',
          'Dedicated Success Manager',
          '2-hour SLA · extended hours',
          'Portal, email, chat & call support',
          'Custom training program',
          '5M AI credits / month',
          'Custom AI models',
          'AI review, drafting & legal chat',
          'Full clause library + cross-app data',
          'Unlimited approval workflows + SSO',
          'Standard connectors + full read/write API',
          'API deployment support included',
          'KSA data residency + BYOK',
          '6 GB active + 12 GB archive / user',
        ],
        cta: 'Request a demo',
      },
      {
        name: 'Custom',
        desc: '',
        price: 'Custom',
        note: 'tailored quote',
        sub: '35+ users · VPC / On-prem / Air-gapped',
        feats: [
          'Everything in Enterprise, tailored',
          'Dedicated Success Manager',
          '2-hour SLA · extended hours',
          'Custom training program',
          'Custom AI credits / month',
          'Custom AI models',
          'Full AI suite: review, drafting & chat',
          'Full clause library + cross-app data',
          'Unlimited workflows, SSO & connectors',
          'Full read/write API + deployment',
          'Custom active & archive storage',
          'Full data residency + BYOK',
        ],
        cta: 'Contact us',
      },
    ],
    tiersNote: '★ The Enterprise PoC is delivered white-glove (Discovery → Design → Implementation), production-ready and fully configured — not a minimal setup — so clients evaluate the real product and buy with full confidence.',
    configuratorHead: {
      eyebrow: 'Build your platform',
      title: 'Configure your suites',
      lede: 'Select the suites you need and your deployment model to see the suggested tier. Every configuration includes all 12 platform-core engines.',
    },
    configurator: {
      cards: {
        datastream: 'Resilience & mobility',
        business: 'Corporate operations',
        clariosec: 'Security & cyber',
        clarioinsight: 'Data & analytics',
      },
      selectedLabel: 'Selected',
      noSuites: 'No suites yet',
      applicationsLabel: 'Applications',
      appsWord: 'apps',
      platformCoreLabel: 'Platform core',
      platformCoreValue: 'All 12 engines included',
      suggestedTierLabel: 'Suggested tier',
      tierNone: '—',
      tierNames: { suite: 'Suite', platform: 'Platform', sovereign: 'Sovereign' },
      deploymentLabel: 'Deployment',
      deployAriaLabel: 'Deployment model',
      deployOptions: { saas: 'SaaS', onprem: 'On-premise', airgap: 'Air-gapped' },
      cta: 'Request a quote for this configuration',
    },
    faqHead: { eyebrow: 'Questions', title: 'Common questions' },
    faq: [
      {
        q: 'Is pricing per user?',
        a: 'No. Clario360 is licensed by suite and deployment model, not per seat. That keeps cost predictable as your organisation grows and avoids penalising adoption.',
      },
      {
        q: 'Can we start with one suite?',
        a: 'Yes. Many institutions begin with one suite — DataStream for resilience, Business+ for legal and GRC, ClarioSec for security, or ClarioInsight for analytics — and add others later. The platform core comes with any of them.',
      },
      {
        q: 'What about consumption costs?',
        a: 'There are none of the usual surprises. ClarioSync meters rows for observability, not billing, and ClarioDWH keeps data in-Kingdom at a lower cost per terabyte than global cloud warehouses.',
      },
      {
        q: 'Do air-gapped deployments cost more?',
        a: 'Sovereign and air-gapped deployments are bespoke because they involve dedicated infrastructure and assurance work. We scope them with you directly.',
      },
    ],
    cta: {
      title: 'Let’s scope the right configuration',
      sub: 'Tell us which suites you need and how you deploy, and we’ll put together pricing mapped to your environment.',
    },
  },
  about: {
    breadcrumb: 'About',
    heroEyebrow: 'About Clario360',
    heroTitle: 'A sovereign platform, built deliberately',
    heroLede: 'Clario360 was architected from a single conviction: that institutions in the Kingdom deserve enterprise software that is Arabic-first, sovereign by default, and platform-first — so capability compounds instead of fragmenting across vendors.',
    thesisEyebrow: 'The thesis',
    thesisTitle: 'Build the platform once. Let the products inherit it.',
    thesisP1: 'Most enterprise portfolios are a collection of products that each re-implement identity, workflow, forms, integration and audit. The cost of that duplication is paid forever. Clario360 inverts it: shared services are built once in the platform core, and every application — across all four suites — consumes them.',
    thesisP2: 'The result is a platform where adding the second suite is cheaper than the first, where a workflow built for legal can serve compliance, and where the board sees live numbers because they arrive on the same event bus that every app already publishes to.',
    specs: [
      { term: 'Arabic', def: 'First, not translated' },
      { term: 'Sovereign', def: 'By design, not by flag' },
      { term: 'Platform', def: 'Shared, not duplicated' },
      { term: 'Event-driven', def: 'Connected, not coupled' },
    ],
    roadmapEyebrow: 'Roadmap',
    roadmapTitle: 'Architecture meets roadmap',
    roadmapLede: 'Sequenced deliberately — protect first, reach parity, then scale and open the channel.',
    roadmap: [
      {
        phase: 'H1 · 2026',
        name: 'Foundation',
        body: 'Platform core, gateway and IAM. ClarioDR GA on the replication core. WatheeqTech and the shared shell. Workflow and Integration engines, v1.',
      },
      {
        phase: 'H2 · 2027',
        name: 'Parity race',
        body: 'ClarioSync and ClarioMigration GA. EHKAM, MahamaTech and BOSALAH. Automation engine GA with AI copilots. Benchmark-parity checks across the suite.',
      },
      {
        phase: 'H3 · 2028',
        name: 'Scale & channel',
        body: 'ClarioDWH GA with RPO ≤30s. Marketplace listings, local and international. Partner API ecosystem. Service split where scale demands it.',
      },
    ],
    cta: {
      title: 'Build the sovereign future with us',
      sub: 'Whether you’re evaluating, partnering, or buying — let’s talk about what Clario360 can do for your institution.',
    },
  },
  compare: {
    hero: {
      breadcrumb: 'Why Clario360',
      eyebrow: 'Platform vs point tools',
      title: 'One platform beats a stack of tools',
      lede: 'Most institutions assemble a portfolio of single-purpose products, each re-implementing identity, workflow, integration and audit. That duplication is paid for forever. Clario360 takes a different position: one sovereign platform where capability compounds across every suite.',
    },
    comparison: {
      eyebrow: 'The comparison',
      title: 'Where a platform pulls ahead',
      lede: 'An honest, category-level comparison — a sovereign enterprise platform versus a collection of point tools.',
      headDimension: 'Dimension',
      headClario: 'Clario360 platform',
      headOther: 'Stitched point tools',
      rows: [
        { label: 'Scope', clario: 'A unified platform spanning resilience, operations, security and analytics', other: 'Separate tools, one domain each' },
        { label: 'Identity & login', clario: 'One login, one RBAC model, federated to your IdP', other: 'A new login and user store per tool' },
        { label: 'Process & forms', clario: 'Workflow and forms built once, reused everywhere', other: 'Rebuilt inside each product' },
        { label: 'Cross-domain data', clario: 'Facts flow on one ordered, replayable event bus', other: 'Brittle point-to-point integrations' },
        { label: 'Arabic-first / RTL', clario: 'Solved once in the shared shell; Arabic as primary', other: 'Bolted on or English-first' },
        { label: 'Sovereign deployment', clario: 'SaaS, on-premise or fully air-gapped — same codebase', other: 'Typically cloud-only or single-mode' },
        { label: 'Compliance', clario: 'NCA, SAMA, PDPL, ISO, NIST mapped on day one', other: 'Manual mapping, per tool' },
        { label: 'Audit', clario: 'One immutable, platform-wide trail', other: 'Fragmented across vendors' },
        { label: 'Commercial model', clario: 'Licensed by suite; predictable, no consumption surprises', other: 'Per-seat or metered, stacked per tool' },
        { label: 'Total cost over time', clario: 'Build once, compound across suites', other: 'Duplicated cost paid per product, forever' },
      ],
      footnote: 'Comparison reflects the architectural difference between an integrated platform and independent point products. Specific competitor capabilities vary by vendor and release; we’re happy to do a detailed, like-for-like evaluation against any named alternative on request.',
    },
    economics: {
      eyebrow: 'The economic argument',
      title: 'The build-once dividend, quantified',
      lede: 'Estimate the difference between one platform and a stack of separate tools for your organisation.',
    },
    reasons: {
      eyebrow: 'Three reasons it holds',
      title: 'Why the platform position wins',
      items: [
        { title: 'Capability compounds', body: 'Adding the second, third and fourth suite is cheaper than the first — they inherit the platform core instead of rebuilding it.' },
        { title: 'One source of truth', body: 'Identity, audit and events are unified, so there is one answer to “who did what” and one live view of the organisation.' },
        { title: 'Sovereign without compromise', body: 'The same product runs SaaS, on-premise or air-gapped — you do not trade capability for control.' },
      ],
    },
    cta: {
      title: 'Bring your own shortlist',
      sub: 'Send us the tools you are evaluating and we will prepare a detailed, like-for-like comparison against Clario360 — mapped to your requirements.',
    },
  },
  contact: {
    breadcrumb: 'Contact',
    heroEyebrow: 'Request a demo',
    heroTitle: 'See it on your own environment',
    heroLede: 'Tell us which suites matter and how you deploy. We’ll prepare a guided session mapped to your frameworks, your workflows and your Arabic-first requirements.',
    info: [
      {
        title: 'Sales & demos',
        copy: 'Speak with our solutions team about a deployment scoped to your institution.',
      },
      {
        title: 'Security & compliance',
        copy: 'Review NCA, SAMA and PDPL alignment against your auditors’ requirements.',
      },
      {
        title: 'Partnerships',
        copy: 'Integrators and channel partners — explore the partner API ecosystem.',
      },
      {
        title: 'Sovereign deployments',
        copy: 'Air-gapped and classified environments, scoped directly with our team.',
      },
    ],
    arabicCallout: {
      flourish: 'نتحدث العربية',
      body: 'Our team works Arabic-first. Reach out in Arabic or English — your choice.',
    },
    form: {
      title: 'Request a demo',
      subtitle: 'We’ll respond within one business day.',
      nameLabel: 'Full name',
      namePlaceholder: 'Your name',
      emailLabel: 'Work email',
      emailPlaceholder: 'you@institution.gov.sa',
      orgLabel: 'Organisation',
      orgPlaceholder: 'Institution name',
      roleLabel: 'Role',
      rolePlaceholder: 'Your role',
      interestLabel: 'Which interests you most?',
      interestOptions: [
        'The whole platform',
        'DataStream Suite — resilience & data',
        'Business+ Suite — corporate operations',
        'ClarioSec Suite — security & cyber',
        'ClarioInsight Suite — analytics',
        'A specific application',
        'Sovereign / air-gapped deployment',
      ],
      deploymentLabel: 'Preferred deployment',
      deploymentOptions: [
        'Managed SaaS (in-Kingdom)',
        'On-premise',
        'Air-gapped / disconnected',
        'Not sure yet',
      ],
      messageLabel: 'What would you like to see?',
      messagePlaceholder: 'Tell us about your environment, frameworks, or the workflows you’d like demonstrated.',
      submit: 'Request a demo',
      submitting: 'Sending request',
      consent: 'By submitting, you agree to be contacted about Clario360.',
      successDefault: 'Request received. We will respond within one business day.',
      successWithRef: 'Request received. Reference {id}.',
      errorDefault: 'Request could not be sent. Please try again.',
    },
  },
  suite: {},
  suiteApp: {},
  trust: {
    back: 'Back to sign in',
    eyebrow: 'Trust & Compliance',
    title: 'Compliance & data residency',
    lede: 'Clario360 is engineered for regulated environments in the Kingdom of Saudi Arabia. Below are the frameworks we align to and our data-residency commitments. A full trust center is on the way.',
    badges: [
      { label: 'NCA ECC', desc: 'Aligned with the National Cybersecurity Authority Essential Cybersecurity Controls (ECC-1) for critical national infrastructure.' },
      { label: 'SAMA CSF', desc: 'Built to the Saudi Central Bank (SAMA) Cyber Security Framework, covering governance, risk, and resilience controls.' },
      { label: 'ISO 27001', desc: 'Information security management aligned to ISO/IEC 27001, with documented controls, audit trails, and continuous monitoring.' },
      { label: 'Data hosted in KSA', desc: 'All tenant data is stored and processed within Saudi Arabia, supporting sovereign data-residency requirements.' },
    ],
    chips: {
      regulator: 'Regulator-aligned',
      encrypted: 'Encrypted at rest & in transit',
      hosting: 'Sovereign hosting',
    },
  },
};

const AR: MarketingMessages = {
  dir: 'rtl',
  arrow: '←',
  nav: {
    products: 'المنتجات',
    platform: 'المنصة',
    solutions: 'الحلول',
    sovereignty: 'السيادة',
    resources: 'الموارد',
    pricing: 'الأسعار',
    about: 'من نحن',
    signIn: 'تسجيل الدخول',
    signedInAs: 'مسجّل الدخول باسم',
    requestDemo: 'اطلب عرضاً توضيحياً',
    productsMegaTitle: 'منصة Clario360',
    productsMegaSub: 'أربع مجموعات · نواة منصّة واحدة · تسجيل دخول واحد',
    platformArchitecture: 'بنية المنصة',
    platformCoreEngines: 'نواة المنصّة · ١٢ محرّكاً',
    architecture: 'البنية',
    skipToContent: 'تخطَّ إلى المحتوى',
    primaryNav: 'التنقّل الرئيسي',
    openMenu: 'فتح القائمة',
    closeMenu: 'إغلاق القائمة',
    siteMenu: 'قائمة الموقع',
    suiteWord: 'مجموعة',
    language: 'اللغة',
    switchToEnglish: 'Switch to English',
    switchToArabic: 'التبديل إلى العربية',
  },
  footer: {
    tagline:
      'المنصة السيادية للمؤسسات. أربع مجموعات، ونواة منصّة واحدة، وتسجيل دخول واحد — مبنيّة بالعربية أولاً وجاهزة للنشر سحابياً أو داخل مقارّكم أو معزولةً بالكامل.',
    flourish: 'The Sovereign Enterprise Platform',
    overview: 'نظرة عامة',
    colPlatform: 'المنصة',
    colCompany: 'الشركة',
    architecture: 'البنية',
    platformCore: 'نواة المنصّة',
    deployment: 'النشر',
    compliance: 'الامتثال',
    solutions: 'الحلول',
    whyClario: 'لماذا Clario360',
    about: 'من نحن',
    resources: 'الموارد',
    pricing: 'الأسعار',
    contact: 'تواصل معنا',
    requestDemo: 'اطلب عرضاً',
    security: 'الأمن',
    privacy: 'الخصوصية',
    terms: 'الشروط',
    copyright: '© 2026 Clario360',
    badges: ['متوافقة مع NCA', 'SAMA CSF', 'PDPL', 'ISO 27001', 'العربية أولاً'],
  },
  home: {
    heroBadgeLabel: 'سيادية',
    heroBadgeText: 'تُنشر سحابياً · داخل مقارّكم · ومعزولة بالكامل',
    heroFlourish: 'One platform · Four suites · Sovereign by design',
    heroTitleLine1: 'منصّة واحدة.',
    heroTitleLine2: 'أربع مجموعات.',
    heroTitleAccent: 'سيادية بالتصميم.',
    heroLede:
      'توحّد Clario360 مرونة البيانات والعمليات المؤسسية على نواة واحدة قابلة للتهيئة — بتسجيل دخول واحد، وسجلّ تدقيق واحد، وبالعربية أولاً. مبنيّة مرة واحدة كخدمات مشتركة، فيرث كل تطبيق المنصّة بدلاً من إعادة بنائها.',
    ctaRequestDemo: 'اطلب عرضاً توضيحياً',
    ctaExplorePlatform: 'استكشف المنصّة',
    trust: [
      { value: '٤', label: 'مجموعات منتجات' },
      { value: '١٥', label: 'تطبيقاً' },
      { value: '١٢', label: 'محرّكاً أساسياً مشتركاً' },
      { value: '٣', label: 'بيئات نشر' },
    ],
    stripLabel: 'مصمَّمة للمؤسسات التي تشترط السيادة',
    principlesEyebrow: 'الأسس',
    principlesTitle: 'ستة مبادئ يلتزم بها كل جزء من المنصّة',
    principlesLede:
      'هذه ليست شعارات — بل قيود معمارية. يزيل كل مبدأ منها فئةً كاملة من التكلفة أو الارتهان للمورّد أو التكرار قبل أن تتجذّر.',
    suitesEyebrow: 'المنتج',
    suitesTitle: 'أربع مجموعات مبنيّة على نواة واحدة',
    suitesLede:
      'كل مجموعة هي عائلة من التطبيقات تتشارك المنصّة — فتتراكم القدرات عبر المرونة والعمليات والأمن والتحليلات، ولا تدفع مرتين لبناء الشيء نفسه.',
    statLabels: [
      'زمن الاسترداد المستهدف مع تجاوز الفشل بترتيب الإقلاع',
      'حدّ الخدمة لزمن تأخّر التقاط تغييرات البيانات عبر ClarioSync',
      'التكلفة لكل تيرابايت مقارنةً بمستودعات السحابة العالمية',
      'إقامة كاملة للبيانات داخل المملكة، مع دعم العزل التام',
    ],
    deployEyebrow: 'سيادية بالتصميم',
    deployTitle: 'ثلاث بيئات نشر، قاعدة شيفرة واحدة',
    deployLede:
      'لا اعتماديات سحابية حصرية في أي موضع من المنظومة. تعمل المكوّنات نفسها كخدمة سحابية مُدارة، أو داخل مركز بياناتكم، أو في بيئة معزولة تماماً.',
    coverageLine:
      '{ga} من {total} تطبيقاً متاحة عموماً اليوم — و{roadmap} أخرى على خارطة طريق ٢٠٢٦–٢٠٢٧.',
    archTopLabel: 'Clario360 · منصّة واحدة',
    archBusLabel: 'ناقل الأحداث · مرتّب · لكل مستأجر · قابل لإعادة التشغيل',
    archCaption:
      '{total} تطبيقاً · {ga} متاح اليوم · {roadmap} على خارطة الطريق · {engines} محرّكاً مشتركاً',
    proof: {
      eyebrow: 'أسس موثوقة',
      title: 'مبنيّة وفق المعايير التنظيمية للمملكة',
      lede: 'تتوافق Clario360 مع الأطر التي تُدقَّق عليها المؤسسات السعودية — وتُنشر حيث يجب أن تبقى بياناتكم.',
      complianceLabel: 'التوافق التنظيمي',
      badgeNote:
        'حزم الأطر مضمّنة في المنصّة. رُوجِع التوافق في ٢٠٢٦ — والأدلة متاحة باتفاقية سرّية. تشير العلامات إلى التوافق لا إلى الاعتماد.',
      dateTag: 'مُواءَم ٢٠٢٦',
      partnersLabel: 'مواقع نشر لمؤسسات في أنحاء المملكة',
      partnerSlot: 'مؤسستكم',
      badges: [
        { name: 'NCA ECC', note: 'الضوابط الأساسية للأمن السيبراني' },
        { name: 'SAMA CSF', note: 'إطار الأمن السيبراني' },
        { name: 'PDPL', note: 'نظام حماية البيانات الشخصية' },
        { name: 'ISO 27001', note: 'إدارة أمن المعلومات' },
        { name: 'Najiz', note: 'التكامل مع وزارة العدل' },
        { name: 'ZATCA', note: 'الفوترة الإلكترونية (فاتورة)' },
      ],
    },
    problem: {
      eyebrow: 'المشكلة',
      title: 'الأدوات المتفرّقة لا تصنع منصّة',
      lede: 'تُشغّل معظم المؤسسات عشرات المنتجات المنفصلة. والتكلفة ليست في التراخيص — بل في كل ما يجب إعادة بنائه حولها.',
      items: [
        {
          title: 'تكاثر الأدوات',
          body: 'عشرات المنتجات المتخصّصة، لكلٍّ منها تسجيل دخول ونموذج بيانات وسجلّ تدقيق مستقل.',
        },
        {
          title: 'ضريبة التكامل',
          body: 'كل أداة جديدة تعني بناء تكاملات هشّة نقطة-إلى-نقطة — وصيانتها إلى الأبد.',
        },
        {
          title: 'خروج البيانات من المملكة',
          body: 'يَنقل مورّدو السحابة الحصرية البياناتِ المنظَّمة إلى الخارج، بعيداً عن رقابة الهيئة الوطنية للأمن السيبراني ونظام حماية البيانات.',
        },
        {
          title: 'لا مصدر واحد للحقيقة',
          body: 'لا هويّة أو تدقيق أو تقارير موحّدة عبر المنظومة — فتبقى العناية الواجبة يدويّة.',
        },
      ],
    },
    how: {
      eyebrow: 'كيف تعمل',
      title: 'نواة واحدة. تبنَّها على وتيرتك.',
      lede: 'كل شيء يعمل على خدمات مشتركة، فتبدأ صغيراً وتتراكم القدرات — دون إعادة بناء المنصّة.',
      steps: [
        {
          title: 'اختر مجموعاتك',
          body: 'ابدأ بمجموعة واحدة أو بالمنصّة كاملة. والنواة الكاملة تأتي مع أيٍّ منها.',
        },
        {
          title: 'انشر بطريقتك',
          body: 'سحابة مُدارة داخل المملكة، أو في مركز بياناتكم، أو معزولة تماماً — بقاعدة شيفرة واحدة.',
        },
        {
          title: 'هيّئ بلا برمجة',
          body: 'مسارات العمل والنماذج والتكاملات والأتمتة تُهيَّأ من الإدارة، لا بإعادة النشر.',
        },
        {
          title: 'تراكم عبر المجموعات',
          body: 'تتشارك التطبيقات الهويّة والتدقيق وناقل الأحداث، فكل إضافة تقوّي البقيّة.',
        },
      ],
    },
    suiteOutcomeLabel: 'الأثر',
    suiteOutcomes: {
      ds: 'استعِد خلال دقائق وانقل البيانات بين البيئات دون توقّف.',
      bp: 'أدر الشؤون القانونية والحوكمة والتنفيذ على نواة عمليات واحدة قابلة للتدقيق.',
      sec: 'اطّلع على التعرّض والوضع والسلوك في برنامج أمني واحد — لا أربع لوحات.',
      insight: 'حوّل بيانات المملكة إلى لوحات محوكمة يثق بها القادة فعلاً.',
    },
    midCta: {
      title: 'جاهزون لرؤيتها على بياناتكم؟',
      sub: 'عرض توضيحي موجَّه على نشرٍ سيادي — مربوط بأطركم ومسارات عملكم.',
    },
    sovereignty: {
      eyebrow: 'سيادية بالتصميم',
      title: 'بياناتكم لا يلزم أن تغادر المملكة',
      lede: 'السيادة ليست خياراً يُضاف في النهاية — بل قيدٌ بُني عليه كل مكوّن. لا اعتماديات سحابية حصرية في أي موضع من المنظومة.',
      points: [
        'إقامة البيانات داخل المملكة افتراضياً',
        'جاهزة للبيئات المعزولة والمصنّفة',
        'مفاتيحكم الخاصة (BYOK) — أنتم تملكون جذر الثقة',
        'سجلّ تدقيق كامل داخل مستأجركم',
        'ملفات تنفيذية ثابتة — لا حاجة لأي اتصال خارجي للتشغيل',
      ],
      pillars: [
        {
          title: 'الإقامة داخل المملكة',
          body: 'تبقى البيانات المنظَّمة على بنية تُقرّونها، تحت رقابة الهيئة الوطنية ونظام حماية البيانات.',
        },
        {
          title: 'قابلية العزل التام',
          body: 'نواة بملفات تنفيذية ثابتة تُنشر في بيئات معزولة ومصنّفة بالكامل.',
        },
        {
          title: 'تشفير بمفاتيحكم',
          body: 'مفاتيح بحوزة العميل ودعم مراسم المفاتيح يُبقيان جذر الثقة بين أيديكم.',
        },
      ],
    },
    security: {
      eyebrow: 'الأمن والامتثال',
      title: 'الامتثال مبنيّ في الأساس، لا مُضاف',
      lede: 'الضوابط التي يطلبها المدقّقون هي خصائص في المنصّة — تُبنى مرة، ويرثها كل تطبيق.',
      items: [
        {
          title: 'حزم الأطر',
          body: 'تكاملات NCA ECC وSAMA CSF وPDPL وISO 27001 مضمّنة في المنصّة وتبقى محدّثة.',
        },
        {
          title: 'سجلّ تدقيق واحد',
          body: 'كل إجراء عبر كل مجموعة يُكتب في سجلّ تدقيق واحد يصعب العبث به.',
        },
        {
          title: 'الهويّة والوصول',
          body: 'إدارة هويّة مشتركة مع الدخول الموحّد وصلاحيات الأدوار وفصل المهام المُنفَّذ عند البوابة.',
        },
        {
          title: 'التشفير والمفاتيح',
          body: 'بيانات مشفّرة أثناء النقل والتخزين، مع خيارات المفاتيح الخاصة بالعميل.',
        },
      ],
    },
    roi: {
      eyebrow: 'الاقتصاد',
      title: 'منصّة واحدة، لا كومة من الأدوات',
      lede: 'قدّر الفرق بين ترخيص وتكامل عشرات المنتجات مقابل تشغيل نواة واحدة. تقديري فقط — وسنبني نموذج تكلفة لبيئتكم.',
    },
    pricingPreview: {
      eyebrow: 'الأسعار',
      title: 'مرخَّصة بالمجموعة، ومسعَّرة للمؤسسة',
      lede: 'ثابتة وقابلة للتوقّع — بحسب المجموعة ونموذج النشر، لا بحسب المقعد. وكل تهيئة تتضمّن نواة المنصّة كاملة.',
      tiers: [
        {
          name: 'تجريبي',
          price: 'مجاني',
          note: '١٤ يوماً · سحابي',
          blurb: 'جرّب منتجات مختارة على الخطة التجريبية المشتركة.',
        },
        {
          name: 'مجموعة',
          price: 'مخصّص',
          note: 'لكل مجموعة · سنوي',
          blurb: 'مجموعة واحدة وعائلة تطبيقاتها كاملة على النواة الكاملة.',
        },
        {
          name: 'منصّة',
          price: 'مخصّص',
          note: 'كل المجموعات · سنوي',
          blurb: 'المجموعات الأربع، وكل التطبيقات، وتدفّقات الأحداث بينها.',
        },
        {
          name: 'سيادي',
          price: 'حسب الطلب',
          note: 'معزول / مصنّف',
          blurb: 'بنية سيادية مخصّصة مع ضمانات مصمَّمة لكم.',
        },
      ],
      cta: 'اطّلع على الأسعار كاملة',
      configure: 'ابنِ منصّتك',
    },
    faq: {
      eyebrow: 'أسئلة',
      title: 'أسئلة شائعة',
      items: [
        {
          q: 'ما هي Clario360 بالضبط؟',
          a: 'منصّة مؤسسية سيادية واحدة: أربع مجموعات منتجات ونواة مشتركة من محرّكات المنصّة، بتسجيل دخول واحد وسجلّ تدقيق واحد — مبنيّة بالعربية أولاً.',
        },
        {
          q: 'كم عدد التطبيقات المتاحة اليوم؟',
          a: '{ga} من {total} تطبيقاً متاحة الآن؛ و{roadmap} المتبقّية على خارطة طريق ٢٠٢٦–٢٠٢٧. وكل خطة تتضمّن نواة المنصّة كاملة المؤلَّفة من {engines} محرّكاً مشتركاً.',
        },
        {
          q: 'هل هي سيادية ومعزولة فعلاً؟',
          a: 'نعم. النواة مجموعة من الملفات التنفيذية الثابتة بلا اعتماديات سحابية حصرية، فتعمل المكوّنات نفسها كخدمة سحابية مُدارة، أو داخل مقارّكم، أو في بيئة معزولة تماماً.',
        },
        {
          q: 'أين تُقيم بياناتنا؟',
          a: 'داخل المملكة افتراضياً، على بنية تُقرّونها. والتشفير بمفاتيحكم الخاصة يُبقي جذر الثقة بين أيديكم.',
        },
        {
          q: 'هل يمكن أن نبدأ بمجموعة واحدة؟',
          a: 'نعم — تبدأ معظم المؤسسات بمجموعة واحدة وتضيف غيرها لاحقاً. والنواة الكاملة تأتي مع أيٍّ منها.',
        },
        {
          q: 'كيف تُسعَّر؟',
          a: 'بحسب المجموعة ونموذج النشر، لا بحسب المقعد — ثابتة وقابلة للتوقّع دون مفاجآت استهلاك. وتُحدَّد النشرات المعزولة معكم مباشرة.',
        },
      ],
    },
  },
  chrome: {
    breadcrumbHome: 'الرئيسية',
    cta: {
      title: 'شاهد Clario360 على بياناتكم',
      sub: 'عرض توضيحي موجَّه على نشرٍ سيادي — مربوط بأطركم ومسارات عملكم ومتطلباتكم بالعربية أولاً.',
      requestDemo: 'اطلب عرضاً توضيحياً',
      exploreArchitecture: 'استكشف البنية',
    },
    bus: {
      eyebrow: 'السمة المميِّزة · تدفّقات عبر المجموعات',
      title: 'الناقل هو الحدّ الفاصل',
      lede: 'ينشر كل تطبيق الحقائق على هيئة أحداث في مجاله. لا خدمة تستعلم من قاعدة بيانات خدمة أخرى؛ ولا وجود لسلاسل متزامنة بين المجموعات. هذه القاعدة الواحدة هي ما يتيح للمجموعات أن تُطلَق وتتوسّع وتتعطّل باستقلالٍ تام.',
      spineLabel: 'ناقل الأحداث',
      spineSub: 'مرتّب · مقسَّم لكل مستأجر · سجلّ مخطّطات · قابل لإعادة التشغيل',
      footnote: 'تحمل الأحداث حقائق لا أوامر، ويمتصّ الناقل ما كان الاقتران ليكسره لولاه.',
    },
  },
  notFound: {
    code: '404',
    title: 'هذا المسار ليس على الخريطة',
    lede: 'الصفحة التي تبحثون عنها غير موجودة — لكنّ المنصّة موجودة. عودوا إلى الصفحة الرئيسية أو استكشفوا إحدى المجموعات.',
    backHome: 'العودة إلى الرئيسية',
    explorePlatform: 'استكشف المنصّة',
  },
  platform: {
    breadcrumb: 'المنصة',
    hero: {
      eyebrow: 'بنية المنصّة',
      title: 'يُبنى مرة. ويُورَّث في كل مكان.',
      lede: 'Clario360 منصّة أولاً: نواة قابلة للتهيئة من محرّكات مشتركة، خلف بوابة واحدة، بهويّة واحدة وسجلّ تدقيق واحد. تستهلك التطبيقات هذه الخدمات — ولا تعيد بناءها أبداً. تلك هي الحجّة الاقتصادية كاملةً، مُعبَّراً عنها بالبنية.',
      ctaDeepDive: 'اطلب جلسة تقنية معمّقة',
      ctaDeployment: 'النشر والسيادة',
    },
    context: {
      eyebrow: 'سياق النظام',
      title: 'Clario360 في محيطها',
      lede: 'منصّة واحدة تخدم كل دور مؤسسي وتتّصل بالأنظمة التي تُشغّلها مؤسسة في المملكة فعلاً.',
      rows: [
        'مستخدمو المؤسسة، وفرق تقنية المعلومات والبيانات، والمخاطر والشؤون القانونية ومكتب إدارة المشاريع، والتنفيذيون والمجلس',
        'هويّة العميل — Active Directory / Entra، وتسجيل دخول موحّد',
        'المنصّات الحكومية — ناجز، وهيئة الزكاة والضريبة والجمارك، والجهات التنظيمية القطاعية',
        'الجهات التنظيمية — توافق مدمج مع الهيئة الوطنية للأمن السيبراني (NCA)، والبنك المركزي السعودي (SAMA)، ونظام حماية البيانات الشخصية (PDPL)',
      ],
      cardTop: 'دخول واحد · تدقيق واحد · بالعربية أولاً',
      cardAi: 'AI Services · مساعدون ذكيون وكشف',
      cardFoundation: 'البيانات · الأحداث · بنية تحتية سيادية',
      appsWord: 'تطبيقات',
    },
    engines: {
      eyebrow: 'نواة المنصّة',
      title: 'اثنا عشر محرّكاً يستهلكها كل تطبيق',
      lede: 'تُهيّأ من المسؤولين، ولا يُعيد المهندسون نشرها. ابنِ مسار عمل أو نموذجاً أو تكاملاً أو أتمتةً مرة واحدة — وكل مجموعة تستطيع استخدامها. اختر أيّ محرّك لعرض التفاصيل.',
    },
    master: {
      eyebrow: 'العرض الشامل',
      title: 'البنية المستهدَفة، من القمّة إلى القاع',
      layers: [
        {
          name: 'التجربة',
          detail: 'الويب · React (يمين/يسار) · الجوال · واجهات الشركاء والعامة · استوديو الإدارة',
        },
        {
          name: 'البوابة',
          detail: 'بوابة API · المصادقة والتفويض · حدود المعدل · التوجيه · الإصدارات · Go',
        },
        {
          name: 'المجموعات',
          detail: 'DataStream (Go) · Business+ (NestJS) · ClarioSec · ClarioInsight',
        },
        {
          name: 'نواة المنصّة',
          detail: 'Workflow · Forms · Automation · Integration · IAM · Files · Notify · Licensing · AI',
        },
        {
          name: 'ناقل الأحداث',
          detail: 'مرتّب · مقسَّم لكل مستأجر · سجلّ مخطّطات · قابل لإعادة التشغيل',
        },
        {
          name: 'الأساس',
          detail: 'البيانات · تخزين كائنات سيادي · قابلية الرصد · التدقيق',
        },
      ],
    },
    tenancy: {
      eyebrow: 'تعدّد المستأجرين والعزل',
      title: 'متعدّد المستأجرين، بحدود صارمة',
      lede: 'كل مستأجر معزول على مستوى البيانات والأحداث. الناقل مقسَّم لكل مستأجر؛ ولا يقرأ أي تطبيق عبر حدود المستأجرين، ولا تصل أي خدمة إلى قاعدة بيانات خدمة أخرى.',
      points: [
        'أقسام أحداث لكل مستأجر مع سجلّ مخطّطات مشترك',
        'العلامة التجارية والأطر والاستحقاقات مهيّأة لكل مستأجر',
        'الهويّة موحَّدة مع موفّر الهويّة الخاص بكل عميل',
        'سجلّ تدقيق محدَّد النطاق، غير قابل للعبث وقابل للتصدير لكل مستأجر',
      ],
      specs: [
        { value: '١', label: 'تسجيل دخول عبر المنصّة كاملة' },
        { value: '١', label: 'سجلّ تدقيق واحد، غير قابل للعبث' },
        { value: 'N', label: 'مستأجرون، معزولون تماماً' },
        { value: '٠', label: 'استدعاءات عبر قواعد البيانات، بحكم القاعدة' },
      ],
    },
    cta: {
      title: 'استعرض البنية مع فريقنا',
      sub: 'من سياق C4 نزولاً إلى نواة النسخ وناقل الأحداث — جلسة عمل مصمّمة على بيئتكم.',
    },
  },
  platformEngine: {
    breadcrumbPlatform: 'المنصة',
    badge: 'نواة المنصّة',
    engineCounter: 'المحرّك {n} من {total} · {tag}',
    tags: {
      workflow: 'العمليات',
      forms: 'التقاط البيانات',
      automation: 'كتيبات التشغيل',
      integration: 'الموصّلات',
      iam: 'الهويّة',
      files: 'المستندات',
      notifications: 'التنبيه',
      licensing: 'الاستحقاق',
      ai: 'الذكاء',
      gateway: 'الحافة · Go',
      'event-bus': 'العمود الفقري',
      observability: 'القياس عن بُعد',
    },
    ctaRequestDemo: 'اطلب عرضاً توضيحياً',
    ctaAllEngines: 'المحرّكات الاثنا عشر',
    whatItDoes: 'ماذا يفعل',
    consumedBy: 'الجهات المستهلِكة',
    capabilities: 'القدرات',
    insideTitle: 'داخل {name}',
    otherEyebrow: 'نواة المنصّة',
    otherTitle: 'المحرّكات الأخرى',
    otherLede: 'كل محرّك يُبنى مرة ويُستهلَك من المجموعات الأربع جميعها. ذلك هو عائد نهج المنصّة أولاً.',
    cta: {
      title: 'استعرض نواة المنصّة في جلسة معمّقة',
      sub: 'من البوابة إلى ناقل الأحداث — جلسة عمل حول كيف تتكامل المحرّكات في بيئتكم.',
    },
  },
  solutions: {
    breadcrumb: 'الحلول',
    hero: {
      eyebrow: 'حسب الدور',
      title: 'مبنيّة لمن يُديرون المؤسسة',
      lede: 'Clario360 منصّة واحدة، لكنّ كل دور يلتقي بها بشكل مختلف. هنا يبدأ كل فريق — وكيف تتراكم المجموعات حين تتّصل.',
    },
    personas: [
      {
        title: 'فرق تقنية المعلومات والبيانات',
        desc: 'حماية مستمرّة، وترحيل سيادي، وبحيرة-مستودع تُبقي البيانات داخل المملكة — دون خياطة أدوات متفرّقة معاً.',
        uses: [
          'ClarioDR لتجاوز الفشل والتجارب بجودة تدقيقية',
          'ClarioMigration للانتقالات المستقلّة عن السحابة',
          'ClarioDWH كوجهة سيادية واحدة',
        ],
      },
      {
        title: 'المخاطر والشؤون القانونية والامتثال',
        desc: 'أطر سعودية محمّلة مسبقاً، وعقود تُصاغ بالعربية أولاً، ووضع امتثال حيّ بدلاً من هرولة فصلية.',
        uses: [
          'EHKAM مع NCA وSAMA وPDPL من اليوم الأول',
          'WatheeqTech لدورة حياة العقود بالعربية أصالةً',
          'ضابط واحد مرتبط بأطر متعدّدة',
        ],
      },
      {
        title: 'مكتب إدارة المشاريع والتنفيذ',
        desc: 'تنفيذ لا ينحرف عن الاستراتيجية أبداً — كل مهمّة تتتبّع صعوداً إلى هدف وعرضاً إلى مخاطرة، تلقائياً.',
        uses: [
          'MahamaTech للمحافظ والبرامج والبوابات المرحلية',
          'تعاقب الأهداف والنتائج الرئيسية من BOSALAH',
          'مخاطر التنفيذ تتصاعد إلى EHKAM',
        ],
      },
      {
        title: 'التنفيذيون والمجلس',
        desc: 'نموذج قراءة حيّ للمؤسسة بأكملها — متوائم مع رؤية ٢٠٣٠، مع حِزم مجلس بالعربية تُولَّد من أرقام حقيقية لا من شرائح عرض.',
        uses: [
          'خريطة استراتيجية BOSALAH وأهدافها ونتائجها الرئيسية',
          'لوحات حيّة يغذّيها ناقل الأحداث',
          'حِزم المجلس بالعربية، عند الطلب',
        ],
      },
      {
        title: 'الأمن ومركز العمليات الأمنية',
        desc: 'برنامج أمني كامل على وحدة تحكّم سيادية واحدة — التعرّض، وأمن البيانات، والتحليلات السلوكية، ومدير أمن معلومات افتراضي، جميعها على الناقل ذاته.',
        uses: [
          'CTEM لخفض التعرّض المستمرّ',
          'DSPM وUEBA للبيانات والسلوك',
          'ClarioVCISO لبرنامج جاهز للعرض على المجلس',
        ],
      },
      {
        title: 'البيانات والتحليلات',
        desc: 'بيانات محوكمة تتحوّل إلى قرارات حيّة — خطوط معالجة وجودة تُغذّي لوحات ومؤشرات أداء يثق بها كل فريق.',
        uses: [
          'Data Intelligence لخطوط المعالجة والجودة',
          'لوحات Visus ومؤشرات الأداء والتنبيهات',
          'كل رقم قابل للتتبّع إلى بيانات محوكمة',
        ],
      },
    ],
    compare: {
      eyebrow: 'لماذا منصّة واحدة',
      title: 'الأدوات المتفرّقة لا تتراكم. المنصّة تتراكم.',
      head: {
        capability: 'القدرة',
        clario: 'منصّة Clario360',
        other: 'أدوات متفرّقة مخيَّطة',
      },
      rows: [
        ['الهويّة وتسجيل الدخول', 'دخول واحد عبر كل مجموعة', 'تسجيل دخول منفصل لكل أداة'],
        ['مسارات العمل والنماذج', 'تُهيَّأ مرة، وتُستخدم في كل مكان', 'يُعاد بناؤها في كل منتج'],
        ['البيانات بين المنتجات', 'الحقائق تتدفّق على ناقل الأحداث', 'تكاملات هشّة نقطة-إلى-نقطة'],
        ['العربية أولاً / يمين-إلى-يسار', 'مُعالَجة مرة في الغلاف المشترك', 'مُضافة لاحقاً، إن وُجدت'],
        ['نشر سيادي', 'سحابي أو داخل المقرّ أو معزول تماماً', 'سحابي حصري غالباً'],
        ['سجلّ التدقيق', 'سجلّ واحد غير قابل للعبث على مستوى المنصّة', 'مجزّأ عبر الموردين'],
      ],
    },
  },
  sovereignty: {
    breadcrumb: 'السيادة والأمن',
    hero: {
      eyebrow: 'سيادية بالتصميم',
      title: 'بياناتكم، ومملكتكم، وسيطرتكم',
      lede: 'السيادة ليست خياراً يُضاف إلى منتج سحابي عند النهاية — بل قرارٌ معماري يُتَّخذ عند الأساس. ولا يعتمد أيّ مكوّن من مكوّنات Clario360 على سحابة عامة كي يعمل.',
    },
    deploy: {
      eyebrow: 'النشر',
      title: 'قاعدة شيفرة واحدة، ثلاثة عوالم',
      lede: 'تعمل المكوّنات نفسها كخدمة سحابية مُدارة، أو داخل مركز بياناتكم، أو في بيئة معزولة تماماً — دون أيّ تفاوت في القدرات بينها.',
      cards: [
        {
          tag: 'مُدارة',
          name: 'خدمة سحابية (SaaS)',
          body: 'مُدارة بالكامل داخل نطاق سيادي. الأسرع في تحقيق القيمة، مع تولّي Clario360 تشغيل المنصّة نيابةً عنكم.',
          points: ['استضافة داخل المملكة', 'ترقيات وحدود خدمة مُدارة', 'توسّع مرن لكل مستأجر'],
        },
        {
          tag: 'استضافة ذاتية',
          name: 'داخل المقرّ',
          body: 'تعمل داخل مركز بياناتكم وتحت سيطرتكم، بالمكوّنات نفسها المستخدَمة في الخدمة المُدارة.',
          points: ['بنيتكم التحتية', 'فريق تشغيلكم', 'قاعدة الشيفرة نفسها كالخدمة السحابية'],
        },
        {
          tag: 'معزولة',
          name: 'معزولة تماماً',
          body: 'نواة بملفات تنفيذية ثابتة بلا اعتماديات سحابية حصرية، قابلة للنشر في بيئات معزولة ومصنّفة بالكامل.',
          points: ['لا حاجة لأيّ اتصال خارجي', 'ملفات تنفيذية ثابتة وقابلة للنقل', 'جاهزة للبيئات المصنّفة'],
        },
      ],
    },
    compliance: {
      eyebrow: 'الامتثال',
      title: 'أطر مُطابَقة، لا موعودة',
      lede: 'يأتي EHKAM بأطر المملكة محمّلةً مسبقاً وبمكتبة ضوابط موحّدة، فالدليل الذي يُجمَع مرة واحدة يستوفي كل لائحة مُطابَقة في الوقت ذاته.',
      frameworks: [
        { title: 'NCA ECC / CSCC', desc: 'الضوابط الأساسية والحَرِجة للهيئة الوطنية للأمن السيبراني' },
        { title: 'SAMA CSF', desc: 'إطار الأمن السيبراني للبنك المركزي السعودي' },
        { title: 'PDPL', desc: 'التوافق مع نظام حماية البيانات الشخصية' },
        { title: 'ISO 27001', desc: 'الأساس المرجعي لإدارة أمن المعلومات' },
        { title: 'NIST', desc: 'مطابقة الضوابط للتوافق الدولي' },
        { title: 'Najiz / ZATCA', desc: 'التكامل مع المنصّات الحكومية حيثما انطبق' },
      ],
    },
    security: {
      eyebrow: 'البنية الأمنية',
      title: 'دفاعٌ مبنيّ في صميم المنصّة',
      items: [
        { title: 'الهوية والوصول', desc: 'إدارة هوية واحدة بصلاحيات قائمة على الأدوار، متّحدة مع مزوّد هويتكم، ومُنفَّذة عند البوابة.' },
        { title: 'عزل المستأجرين', desc: 'أقسام أحداث وحدود بيانات لكل مستأجر — دون أيّ قراءة عابرة بين المستأجرين.' },
        { title: 'تدقيق غير قابل للتغيير', desc: 'كل إجراء موثَّق في سجلّ يصعب العبث به وقابلٍ للتصدير.' },
        { title: 'التشفير أثناء النقل', desc: 'النسخ المتماثل والأحداث مضغوطة ومشفّرة وقابلة للاستئناف.' },
      ],
      guarantee: {
        tag: 'الضمان السيادي',
        title: 'لا اعتماديات سحابية حصرية. في أيّ مكان.',
        body: 'نواة النسخ المتماثل ملفٌّ تنفيذي ثابت. تعمل المنصّة معزولةً. وتبقى البيانات داخل المملكة بحكم البناء — لا بسياسةٍ عليكم أن تثقوا بها.',
        badges: ['جاهزة للعزل التام', 'بيانات داخل المملكة', 'ملفات تنفيذية ثابتة'],
      },
    },
    cta: {
      title: 'راجعوا الضوابط مع فريق الأمن لدينا',
      sub: 'جلسة عمل مربوطة بأطر NCA وSAMA وPDPL — مقابل بيئتكم ومتطلبات مدقّقيكم.',
    },
  },
  resources: {},
  pricing: {
    breadcrumb: 'الأسعار',
    eyebrow: 'وثيقتك · الأسعار',
    title: 'باقات تنمو مع فريقك القانوني',
    lede: 'تسعير ثابت بالريال لكل مستخدم — من الإعداد الذاتي إلى النشر السيادي المعزول. تشمل كل باقة المراجعة والصياغة والمحادثة القانونية بالذكاء الاصطناعي.',
    ribbon: 'الأكثر شيوعاً',
    tiers: [
      {
        name: 'المبتدئة',
        desc: '',
        price: '139.99',
        note: 'ريال / مستخدم / شهرياً',
        sub: '5+ مستخدمين · SaaS',
        feats: [
          'إعداد ذاتي',
          'دعم عبر البريد · اتفاقية مستوى خدمة يوم واحد',
          'مليون رصيد ذكاء اصطناعي / شهرياً',
          'مراجعة وصياغة ومحادثة قانونية بالذكاء الاصطناعي',
          'مكتبة بنود أساسية',
          'مساران للموافقات',
          '1 غيغابايت تخزين / مستخدم',
        ],
        cta: 'ابدأ الآن',
      },
      {
        name: 'النمو',
        desc: '',
        price: '189.99',
        note: 'ريال / مستخدم / شهرياً',
        sub: '15+ مستخدماً · SaaS',
        feats: [
          'إعداد موجَّه',
          'دعم عبر البوابة · اتفاقية مستوى خدمة 8 ساعات',
          'مليونا رصيد ذكاء اصطناعي / شهرياً',
          'مراجعة وصياغة ومحادثة قانونية بالذكاء الاصطناعي',
          'مكتبة بنود قياسية',
          '5 مسارات للموافقات',
          'الدخول الموحّد + موصّلات قياسية',
          'وصول إلى الـ API للقراءة فقط',
          'تصدير البيانات + إقامة البيانات في السعودية',
          '3 غيغابايت تخزين / مستخدم',
        ],
        cta: 'تحدّث إلى المبيعات',
      },
      {
        name: 'المؤسسات',
        desc: '',
        price: '239.99',
        note: 'ريال / مستخدم / شهرياً',
        sub: '35+ مستخدماً · SaaS',
        feats: [
          '★ إعداد متكامل — إثبات مفهوم مجاني',
          'مدير نجاح مخصّص',
          'اتفاقية مستوى خدمة ساعتان · ساعات ممتدة',
          'دعم عبر البوابة والبريد والمحادثة والهاتف',
          'برنامج تدريب مخصّص',
          '5 ملايين رصيد ذكاء اصطناعي / شهرياً',
          'نماذج ذكاء اصطناعي مخصّصة',
          'مراجعة وصياغة ومحادثة قانونية بالذكاء الاصطناعي',
          'مكتبة بنود كاملة + بيانات مشتركة بين التطبيقات',
          'مسارات موافقات غير محدودة + الدخول الموحّد',
          'موصّلات قياسية + API كامل للقراءة والكتابة',
          'دعم نشر الـ API مشمول',
          'إقامة البيانات في السعودية + BYOK',
          '6 غيغابايت نشِطة + 12 غيغابايت أرشيف / مستخدم',
        ],
        cta: 'اطلب عرضاً توضيحياً',
      },
      {
        name: 'مخصّصة',
        desc: '',
        price: 'مخصّص',
        note: 'عرض سعر مصمَّم',
        sub: '35+ مستخدماً · VPC / محلي / معزول',
        feats: [
          'كل ما في باقة المؤسسات، مصمّم حسب الحاجة',
          'مدير نجاح مخصّص',
          'اتفاقية مستوى خدمة ساعتان · ساعات ممتدة',
          'برنامج تدريب مخصّص',
          'أرصدة ذكاء اصطناعي مخصّصة / شهرياً',
          'نماذج ذكاء اصطناعي مخصّصة',
          'حزمة الذكاء الاصطناعي الكاملة: مراجعة وصياغة ومحادثة',
          'مكتبة بنود كاملة + بيانات مشتركة بين التطبيقات',
          'مسارات ودخول موحّد وموصّلات غير محدودة',
          'API كامل للقراءة والكتابة + النشر',
          'تخزين نشِط وأرشيفي مخصّص',
          'إقامة بيانات كاملة + BYOK',
        ],
        cta: 'تواصل معنا',
      },
    ],
    tiersNote: '★ يُسلَّم إثبات المفهوم لباقة المؤسسات بخدمة متكاملة (اكتشاف ← تصميم ← تنفيذ)، جاهزًا للإنتاج ومهيّأً بالكامل — لا إعدادًا مبدئيًا — ليختبر العملاء المنتج الحقيقي ويشتروا بثقة تامة.',
    configuratorHead: {
      eyebrow: 'ابنِ منصّتك',
      title: 'هيّئ مجموعاتك',
      lede: 'اختاروا المجموعات التي تحتاجونها ونموذج النشر لعرض الفئة المقترحة. وكل تهيئة تتضمّن المحرّكات الـ١٢ في نواة المنصّة جميعها.',
    },
    configurator: {
      cards: {
        datastream: 'المرونة والتنقّل',
        business: 'العمليات المؤسسية',
        clariosec: 'الأمن والسيبرانية',
        clarioinsight: 'البيانات والتحليلات',
      },
      selectedLabel: 'المختار',
      noSuites: 'لا مجموعات بعد',
      applicationsLabel: 'التطبيقات',
      appsWord: 'تطبيقات',
      platformCoreLabel: 'نواة المنصّة',
      platformCoreValue: 'جميع المحرّكات الـ١٢ مضمّنة',
      suggestedTierLabel: 'الفئة المقترحة',
      tierNone: '—',
      tierNames: { suite: 'مجموعة', platform: 'منصّة', sovereign: 'سيادي' },
      deploymentLabel: 'النشر',
      deployAriaLabel: 'نموذج النشر',
      deployOptions: { saas: 'سحابي', onprem: 'داخل المقارّ', airgap: 'معزول' },
      cta: 'اطلب عرض سعر لهذه التهيئة',
    },
    faqHead: { eyebrow: 'أسئلة', title: 'أسئلة شائعة' },
    faq: [
      {
        q: 'هل التسعير بحسب المستخدم؟',
        a: 'لا. تُرخَّص Clario360 بحسب المجموعة ونموذج النشر، لا بحسب المقعد. وهذا يُبقي التكلفة قابلة للتوقّع مع نموّ مؤسستكم، ولا يعاقب على توسّع الاستخدام.',
      },
      {
        q: 'هل يمكننا البدء بمجموعة واحدة؟',
        a: 'نعم. تبدأ مؤسسات كثيرة بمجموعة واحدة — DataStream للمرونة، وBusiness+ للشؤون القانونية والحوكمة والمخاطر والامتثال، وClarioSec للأمن، أو ClarioInsight للتحليلات — وتضيف غيرها لاحقاً. وتأتي نواة المنصّة مع أيٍّ منها.',
      },
      {
        q: 'ماذا عن تكاليف الاستهلاك؟',
        a: 'لا مفاجآت من النوع المعتاد. يقيس ClarioSync الصفوف لأغراض المراقبة لا للفوترة، ويُبقي ClarioDWH البيانات داخل المملكة بتكلفة لكل تيرابايت أقل من مستودعات السحابة العالمية.',
      },
      {
        q: 'هل تكلّف النشرات المعزولة أكثر؟',
        a: 'النشرات السيادية والمعزولة مصمَّمة خصيصاً لأنها تتطلّب بنية مخصّصة وأعمال ضمان. ونحدّد نطاقها معكم مباشرة.',
      },
    ],
    cta: {
      title: 'لنحدّد التهيئة المناسبة',
      sub: 'أخبرونا بالمجموعات التي تحتاجونها وطريقة نشركم، وسنُعدّ تسعيراً مربوطاً ببيئتكم.',
    },
  },
  about: {
    breadcrumb: 'من نحن',
    heroEyebrow: 'عن Clario360',
    heroTitle: 'منصّة سيادية، بُنيت بتأنٍّ',
    heroLede: 'صُمِّمت Clario360 انطلاقاً من قناعة واحدة: أن مؤسسات المملكة تستحقّ برمجيات مؤسسية بالعربية أولاً، وسيادية افتراضياً، وقائمة على منصّة — فتتراكم القدرات بدلاً من أن تتشظّى بين المورّدين.',
    thesisEyebrow: 'الأطروحة',
    thesisTitle: 'ابنِ المنصّة مرة واحدة. ودَع المنتجات ترثها.',
    thesisP1: 'معظم المحافظ المؤسسية مجموعة من المنتجات، يعيد كلٌّ منها بناء الهويّة ومسار العمل والنماذج والتكامل والتدقيق. وثمن هذا التكرار يُدفَع إلى الأبد. تقلب Clario360 المعادلة: تُبنى الخدمات المشتركة مرة واحدة في نواة المنصّة، ويستهلكها كل تطبيق — عبر المجموعات الأربع جميعها.',
    thesisP2: 'والنتيجة منصّة تصبح فيها إضافة المجموعة الثانية أقلّ كلفة من الأولى، ويخدم فيها مسار عمل بُني للشؤون القانونية جهةَ الامتثال، ويرى فيها المجلس أرقاماً حيّة لأنها تصل عبر ناقل الأحداث نفسه الذي ينشر إليه كل تطبيق أصلاً.',
    specs: [
      { term: 'العربية', def: 'أولاً، لا ترجمة' },
      { term: 'سيادية', def: 'بالتصميم، لا بخيار' },
      { term: 'منصّة', def: 'مشتركة، لا مكرّرة' },
      { term: 'مدفوعة بالأحداث', def: 'موصولة، لا مقترنة' },
    ],
    roadmapEyebrow: 'خارطة الطريق',
    roadmapTitle: 'حيث تلتقي البنية بخارطة الطريق',
    roadmapLede: 'مُرتَّبة بتأنٍّ — الحماية أولاً، ثم بلوغ التكافؤ، ثم التوسّع وفتح القنوات.',
    roadmap: [
      {
        phase: 'H1 · 2026',
        name: 'التأسيس',
        body: 'نواة المنصّة والبوابة وإدارة الهويّة والوصول. توفّر ClarioDR عمومياً على نواة النسخ. WatheeqTech والقشرة المشتركة. محرّكا مسار العمل والتكامل، الإصدار الأول.',
      },
      {
        phase: 'H2 · 2027',
        name: 'سباق التكافؤ',
        body: 'توفّر ClarioSync وClarioMigration عمومياً. وEHKAM وMahamaTech وBOSALAH. توفّر محرّك الأتمتة عمومياً مع مساعِدي الذكاء الاصطناعي. وفحوص تكافؤ مرجعية عبر المجموعة.',
      },
      {
        phase: 'H3 · 2028',
        name: 'التوسّع والقنوات',
        body: 'توفّر ClarioDWH عمومياً بهدف نقطة استرداد ≤30 ثانية. وإدراجات في السوق، محلياً ودولياً. ومنظومة واجهات للشركاء. وتقسيم الخدمات حيث يفرض التوسّع ذلك.',
      },
    ],
    cta: {
      title: 'ابنوا المستقبل السيادي معنا',
      sub: 'سواءً كنتم تُقيّمون أو تشاركون أو تشترون — لنتحدّث عمّا يمكن أن تقدّمه Clario360 لمؤسستكم.',
    },
  },
  compare: {
    hero: {
      breadcrumb: 'لماذا Clario360',
      eyebrow: 'المنصّة مقابل الأدوات المتفرّقة',
      title: 'منصّة واحدة تتفوّق على كومة من الأدوات',
      lede: 'تجمع معظم المؤسسات حافظةً من المنتجات أحاديّة الغرض، يعيد كلٌّ منها بناء الهوية ومسار العمل والتكامل والتدقيق. وتُدفَع ثمن تلك الازدواجية إلى الأبد. تتّخذ Clario360 موقفاً مختلفاً: منصّة سيادية واحدة تتراكم فيها القدرات عبر كل مجموعة.',
    },
    comparison: {
      eyebrow: 'المقارنة',
      title: 'أين تتقدّم المنصّة',
      lede: 'مقارنة صادقة على مستوى الفئة — منصّة مؤسسية سيادية مقابل مجموعة من الأدوات المتفرّقة.',
      headDimension: 'المعيار',
      headClario: 'منصّة Clario360',
      headOther: 'أدوات متفرّقة مُجمَّعة',
      rows: [
        { label: 'النطاق', clario: 'منصّة موحّدة تمتدّ عبر المرونة والعمليات والأمن والتحليلات', other: 'أدوات منفصلة، لكلٍّ مجالٌ واحد' },
        { label: 'الهوية وتسجيل الدخول', clario: 'تسجيل دخول واحد، ونموذج صلاحيات واحد، متّحد مع مزوّد هويتكم', other: 'تسجيل دخول جديد ومخزن مستخدمين لكل أداة' },
        { label: 'الإجراءات والنماذج', clario: 'مسار العمل والنماذج يُبنيان مرة وتُعاد الاستفادة منهما في كل مكان', other: 'يُعاد بناؤهما داخل كل منتج' },
        { label: 'البيانات العابرة للمجالات', clario: 'الحقائق تتدفّق على ناقل أحداث واحد مرتّب وقابل لإعادة التشغيل', other: 'تكاملات هشّة نقطة-إلى-نقطة' },
        { label: 'العربية أولاً / الاتجاه من اليمين', clario: 'محلولة مرة واحدة في الواجهة المشتركة؛ والعربية أساسية', other: 'مُضافة لاحقاً أو الإنجليزية أولاً' },
        { label: 'النشر السيادي', clario: 'سحابياً أو داخل المقرّ أو معزولة تماماً — بقاعدة شيفرة واحدة', other: 'عادةً سحابية حصرية أو بنمطٍ واحد' },
        { label: 'الامتثال', clario: 'أطر NCA وSAMA وPDPL وISO وNIST مُطابَقة منذ اليوم الأول', other: 'مطابقة يدوية لكل أداة' },
        { label: 'التدقيق', clario: 'سجلٌّ واحد غير قابل للتغيير على مستوى المنصّة', other: 'مجزّأ عبر عدة موردين' },
        { label: 'النموذج التجاري', clario: 'مرخَّصة بالمجموعة؛ قابلة للتوقّع دون مفاجآت استهلاك', other: 'لكل مقعد أو بالاستهلاك، متراكمة لكل أداة' },
        { label: 'التكلفة الإجمالية عبر الزمن', clario: 'ابنِ مرة واحدة وتراكمِ القدرة عبر المجموعات', other: 'تكلفة مكرّرة تُدفَع لكل منتج، إلى الأبد' },
      ],
      footnote: 'تعكس المقارنة الفرق المعماري بين منصّة متكاملة ومنتجات متفرّقة مستقلة. تتفاوت قدرات المنافسين المحدّدة بحسب المورّد والإصدار؛ ويسعدنا إجراء تقييم تفصيلي مكافئ مقابل أيّ بديل مُسمّى عند الطلب.',
    },
    economics: {
      eyebrow: 'الحجّة الاقتصادية',
      title: 'عائد البناء مرة واحدة، مُقدَّراً بالأرقام',
      lede: 'قدِّروا الفرق بين منصّة واحدة وكومة من الأدوات المنفصلة لمؤسستكم.',
    },
    reasons: {
      eyebrow: 'ثلاثة أسباب تُثبِت ذلك',
      title: 'لماذا يفوز موقف المنصّة',
      items: [
        { title: 'القدرات تتراكم', body: 'إضافة المجموعة الثانية والثالثة والرابعة أرخص من الأولى — فهي ترث نواة المنصّة بدل إعادة بنائها.' },
        { title: 'مصدرٌ واحد للحقيقة', body: 'الهوية والتدقيق والأحداث موحّدة، فثمّة إجابة واحدة عن «مَن فعل ماذا» ورؤية حيّة واحدة للمؤسسة.' },
        { title: 'سيادةٌ بلا تنازل', body: 'المنتج نفسه يعمل سحابياً أو داخل المقرّ أو معزولاً — فلا تقايضون القدرة بالسيطرة.' },
      ],
    },
    cta: {
      title: 'أحضِروا قائمتكم المختصرة',
      sub: 'أرسلوا إلينا الأدوات التي تقيّمونها وسنُعدّ مقارنة تفصيلية مكافئة مع Clario360 — مربوطة بمتطلباتكم.',
    },
  },
  contact: {
    breadcrumb: 'تواصل معنا',
    heroEyebrow: 'اطلب عرضاً توضيحياً',
    heroTitle: 'شاهدها في بيئتكم أنتم',
    heroLede: 'أخبرونا بالمجموعات التي تهمّكم وطريقة نشركم. وسنُعِدّ جلسة موجَّهة مربوطة بأطركم ومسارات عملكم ومتطلباتكم بالعربية أولاً.',
    info: [
      {
        title: 'المبيعات والعروض',
        copy: 'تحدّثوا مع فريق الحلول لدينا حول نشرٍ مُحدَّد النطاق لمؤسستكم.',
      },
      {
        title: 'الأمن والامتثال',
        copy: 'راجعوا التوافق مع NCA وSAMA وPDPL وفق متطلبات مدقّقيكم.',
      },
      {
        title: 'الشراكات',
        copy: 'المُكامِلون وشركاء القنوات — استكشفوا منظومة واجهات الشركاء.',
      },
      {
        title: 'النشرات السيادية',
        copy: 'البيئات المعزولة والمصنّفة، تُحدَّد نطاقاتها مباشرة مع فريقنا.',
      },
    ],
    arabicCallout: {
      flourish: 'We speak your language',
      body: 'يعمل فريقنا بالعربية أولاً. تواصلوا معنا بالعربية أو الإنجليزية — الخيار لكم.',
    },
    form: {
      title: 'اطلب عرضاً توضيحياً',
      subtitle: 'سنردّ خلال يوم عمل واحد.',
      nameLabel: 'الاسم الكامل',
      namePlaceholder: 'اسمكم',
      emailLabel: 'البريد الإلكتروني للعمل',
      emailPlaceholder: 'you@institution.gov.sa',
      orgLabel: 'الجهة',
      orgPlaceholder: 'اسم المؤسسة',
      roleLabel: 'المنصب',
      rolePlaceholder: 'منصبكم',
      interestLabel: 'ما الذي يهمّكم أكثر؟',
      interestOptions: [
        'المنصّة بأكملها',
        'مجموعة DataStream — المرونة والبيانات',
        'مجموعة Business+ — العمليات المؤسسية',
        'مجموعة ClarioSec — الأمن والسيبرانية',
        'مجموعة ClarioInsight — التحليلات',
        'تطبيق محدَّد',
        'نشر سيادي / معزول',
      ],
      deploymentLabel: 'النشر المفضَّل',
      deploymentOptions: [
        'سحابة مُدارة (داخل المملكة)',
        'داخل المقارّ',
        'معزول / غير متّصل',
        'لم أقرّر بعد',
      ],
      messageLabel: 'ما الذي تودّون رؤيته؟',
      messagePlaceholder: 'حدّثونا عن بيئتكم وأطركم أو مسارات العمل التي تودّون عرضها.',
      submit: 'اطلب عرضاً توضيحياً',
      submitting: 'يجري الإرسال',
      consent: 'بإرسال الطلب، توافقون على أن نتواصل معكم بشأن Clario360.',
      successDefault: 'تمّ استلام الطلب. سنردّ خلال يوم عمل واحد.',
      successWithRef: 'تمّ استلام الطلب. الرقم المرجعي {id}.',
      errorDefault: 'تعذّر إرسال الطلب. حاولوا مرة أخرى من فضلكم.',
    },
  },
  suite: {},
  suiteApp: {},
  trust: {
    back: 'العودة إلى تسجيل الدخول',
    eyebrow: 'الثقة والامتثال',
    title: 'الامتثال وإقامة البيانات',
    lede: 'صُمِّمت Clario360 للبيئات المنظَّمة في المملكة العربية السعودية. فيما يلي الأطر التي نتوافق معها والتزاماتنا بإقامة البيانات. ومركز ثقة متكامل في الطريق.',
    badges: [
      { label: 'NCA ECC', desc: 'متوافقة مع الضوابط الأساسية للأمن السيبراني (ECC-1) الصادرة عن الهيئة الوطنية للأمن السيبراني للبنى التحتية الوطنية الحسّاسة.' },
      { label: 'SAMA CSF', desc: 'مبنيّة وفق إطار الأمن السيبراني للبنك المركزي السعودي (ساما)، الذي يغطّي ضوابط الحوكمة والمخاطر والمرونة.' },
      { label: 'ISO 27001', desc: 'إدارة أمن المعلومات متوافقة مع معيار ISO/IEC 27001، بضوابط موثّقة وسجلّات تدقيق ومراقبة مستمرة.' },
      { label: 'استضافة البيانات داخل المملكة', desc: 'تُخزَّن جميع بيانات المستأجرين وتُعالَج داخل المملكة العربية السعودية، دعماً لمتطلبات إقامة البيانات السيادية.' },
    ],
    chips: {
      regulator: 'متوافقة مع الجهات التنظيمية',
      encrypted: 'مشفّرة أثناء التخزين والنقل',
      hosting: 'استضافة سيادية',
    },
  },
};

export const MARKETING_MESSAGES: Record<MarketingLocale, MarketingMessages> = {
  en: EN,
  ar: AR,
};

export function getMarketingMessages(locale: MarketingLocale): MarketingMessages {
  return MARKETING_MESSAGES[locale] ?? EN;
}
