'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileJson,
  Github,
  KeyRound,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DocsSearchDialog } from './_components';
import styles from './docs.module.css';

const navigation = [
  {
    title: 'GET STARTED',
    links: [
      ['Introduction', '/docs/getting-started/introduction'],
      ['Quickstart', '/docs/getting-started/quickstart'],
      ['Core concepts', '/docs/getting-started/core-concepts'],
    ],
  },
  {
    title: 'BUILD',
    links: [
      ['Authentication', '/docs/build/authentication'],
      ['API conventions', '/docs/build/api-conventions'],
      ['Python SDK', '/docs/build/python-sdk'],
      ['Webhooks', '/docs/build/webhooks'],
    ],
  },
  {
    title: 'WATHEEQTECH',
    links: [
      ['How-to overview', '/docs/watheeq/overview'],
      ['Legal Service Desk', '/docs/watheeq/submit-legal-request'],
      ['Matters & litigation', '/docs/watheeq/manage-litigation'],
      ['Contract lifecycle', '/docs/watheeq/contract-lifecycle'],
      ['All WatheeqTech pages', '/docs/watheeq/pages/home'],
    ],
  },
  {
    title: 'REFERENCE',
    links: [
      ['API catalog', '/docs/api'],
      ['Watheeq API', '/docs/api/watheeq'],
      ['ClarioDR API', '/docs/api/clario-dr'],
      ['Licensing API', '/docs/api/licensing'],
    ],
  },
  {
    title: 'OPERATE',
    links: [
      ['Deployment', '/docs/operate/deployment'],
      ['Security', '/docs/operate/security'],
      ['Audit & compliance', '/docs/operate/audit-compliance'],
    ],
  },
] as const;

const snippets = {
  cURL: `curl --request GET \\
  --url "$CLARIO360_API_URL/api/v1/cyber/alerts?per_page=5" \\
  --header "X-API-Key: $CLARIO360_API_KEY" \\
  --header 'Accept: application/json'`,
  Python: `from clario360 import Clario360

client = Clario360(
    base_url=CLARIO360_API_URL,
    api_key=CLARIO360_API_KEY,
)

alerts = client.cyber.alerts.list(per_page=5)
for alert in alerts.data:
    print(alert.title, alert.severity)`,
};

const apiFamilies = [
  { method: 'GET', path: '/api/v1/cyber', title: 'Cybersecurity', description: 'Assets, alerts, risk, CTEM, DSPM and remediation.' },
  { method: 'GET', path: '/api/v1/data', title: 'Data intelligence', description: 'Sources, pipelines, quality, lineage and analytics.' },
  { method: 'GET', path: '/api/v1/watheeq', title: 'Watheeq legal', description: 'Contracts, matters, obligations and compliance.' },
  { method: 'GET', path: '/api/v1/acta', title: 'Acta governance', description: 'Committees, meetings and governed action items.' },
  { method: 'GET', path: '/api/v1/visus', title: 'Executive intelligence', description: 'Dashboards, KPIs and executive reporting.' },
  { method: 'POST', path: '/api/v1/automation', title: 'Automation', description: 'Workflows, integrations and signed webhooks.' },
];

export function DocsPortal() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [language, setLanguage] = useState<keyof typeof snippets>('cURL');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(snippets[language]);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={styles.docs} dir="ltr">
      <a className={styles.skipLink} href="#documentation-content">Skip to documentation content</a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Clario360 home">
          <Image
            src="/brand/Clario360_logo-colored.svg"
            width={145}
            height={35}
            alt="Clario360"
            priority
          />
          <span className={styles.brandDivider} />
          <span className={styles.docsLabel}>DEVELOPERS</span>
        </Link>

        <Button variant="ghost" className={styles.searchButton} onClick={() => setSearchOpen(true)}>
          <Search size={17} />
          <span>Search documentation…</span>
          <kbd>⌘ K</kbd>
        </Button>

        <nav className={styles.headerNav} aria-label="Utility navigation">
          <Link href="/resources">Resources</Link>
          <Link href="/docs/api">API reference</Link>
          <Link href="/login" className={styles.consoleLink}>
            Open console <ArrowRight size={15} />
          </Link>
        </nav>
        <Button
          variant="ghost"
          className={styles.menuButton}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Toggle documentation navigation"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X /> : <Menu />}
        </Button>
      </header>

      <div className={styles.layout}>
        <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarScroll}>
            <div className={styles.versionSelect}>
              <span><span className={styles.statusDot} /> Operational</span>
              <span>API v1 <ChevronDown size={14} /></span>
            </div>
            {navigation.map((group) => (
              <div className={styles.navGroup} key={group.title}>
                <p>{group.title}</p>
                {group.links.map(([label, href], index) => (
                  <a
                    href={href}
                    key={label}
                    className={label === 'Introduction' ? styles.activeNav : ''}
                    onClick={() => setMenuOpen(false)}
                  >
                    {label}
                    {index === 0 && group.title === 'GET STARTED' ? <ChevronRight size={14} /> : null}
                  </a>
                ))}
              </div>
            ))}
          </div>
          <Link href="/contact" className={styles.sidebarHelp}>
            <CircleHelp size={17} />
            <span><strong>Need help?</strong> Talk to an engineer</span>
            <ExternalLink size={13} />
          </Link>
        </aside>

        <main id="documentation-content" className={styles.main}>
          <section className={styles.hero} id="overview">
            <div className={styles.heroGlow} />
            <div className={styles.heroGrid} />
            <div className={styles.heroContent}>
              <div className={styles.eyebrow}><Sparkles size={14} /> CLARIO360 DEVELOPER PLATFORM</div>
              <h1>Build on trusted<br /><span>enterprise intelligence.</span></h1>
              <p>
                Everything you need to integrate, automate and extend the sovereign
                platform your organisation runs on.
              </p>
              <div className={styles.heroActions}>
                <Link href="/docs/getting-started/quickstart" className={styles.primaryButton}>
                  Start building <ArrowRight size={17} />
                </Link>
                <Link href="/docs/api" className={styles.secondaryButton}>
                  Explore the API
                </Link>
              </div>
              <div className={styles.heroMeta}>
                <span><Check size={13} /> REST + JSON</span>
                <span><Check size={13} /> Scoped API keys</span>
                <span><Check size={13} /> Cloud or self-hosted</span>
              </div>
            </div>
            <div className={styles.heroOrb} aria-hidden="true">
              <div className={styles.orbitOne} />
              <div className={styles.orbitTwo} />
              <div className={styles.orbCore}><Boxes size={32} /></div>
              <span className={styles.nodeOne}><Database size={17} /></span>
              <span className={styles.nodeTwo}><ShieldCheck size={17} /></span>
              <span className={styles.nodeThree}><Code2 size={17} /></span>
            </div>
          </section>

          <div className={styles.content}>
            <section className={styles.section} id="concepts">
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.overline}>EXPLORE THE PLATFORM</span>
                  <h2>One core. Every capability.</h2>
                  <p>Choose a path and get productive in minutes.</p>
                </div>
                <Link href="/docs/getting-started/introduction">View all documentation <ArrowRight size={15} /></Link>
              </div>
              <div className={styles.cardGrid}>
                <Link href="/docs/getting-started/quickstart" className={styles.featureCard}>
                  <span className={`${styles.cardIcon} ${styles.green}`}><BookOpen /></span>
                  <div><h3>Get started</h3><p>Understand the platform and make your first API request.</p></div>
                  <ArrowRight className={styles.cardArrow} />
                </Link>
                <Link href="/docs/api" className={styles.featureCard}>
                  <span className={`${styles.cardIcon} ${styles.blue}`}><FileJson /></span>
                  <div><h3>API reference</h3><p>Explore endpoints, schemas, responses and error codes.</p></div>
                  <ArrowRight className={styles.cardArrow} />
                </Link>
                <Link href="/docs/build/python-sdk" className={styles.featureCard}>
                  <span className={`${styles.cardIcon} ${styles.amber}`}><Terminal /></span>
                  <div><h3>SDKs & tools</h3><p>Build faster with typed libraries and command-line tools.</p></div>
                  <ArrowRight className={styles.cardArrow} />
                </Link>
                <Link href="/docs/operate/deployment" className={styles.featureCard}>
                  <span className={`${styles.cardIcon} ${styles.violet}`}><Cloud /></span>
                  <div><h3>Deploy anywhere</h3><p>SaaS, private cloud, on-premise, or fully air-gapped.</p></div>
                  <ArrowRight className={styles.cardArrow} />
                </Link>
              </div>
            </section>

            <section className={styles.watheeqFeature} aria-labelledby="watheeq-howto-title">
              <div className={styles.watheeqFeatureCopy}>
                <span className={styles.overline}>WATHEEQTECH · COMPLETE HOW-TO</span>
                <h2 id="watheeq-howto-title">Operate the legal suite, end to end.</h2>
                <p>
                  Task guidance for every shipped WatheeqTech page—from intake and
                  approval through litigation, contracts, signatures, administration,
                  integrations, reporting and audit.
                </p>
                <div>
                  <Link href="/docs/watheeq/overview" className={styles.primaryButton}>Start the WatheeqTech guide <ArrowRight /></Link>
                  <Link href="/docs/watheeq/pages/home">Browse every page <ArrowRight /></Link>
                </div>
              </div>
              <div className={styles.watheeqJourneyGrid}>
                {[
                  ['Legal Service Desk', 'Submit, approve, route and deliver', '/docs/watheeq/submit-legal-request'],
                  ['Cases & litigation', 'Hearings, evidence, judgments and holds', '/docs/watheeq/manage-litigation'],
                  ['Contracts & signatures', 'Review, approve, execute and monitor', '/docs/watheeq/contract-lifecycle'],
                  ['Administration', 'Catalog, roles, SLAs and integrations', '/docs/watheeq/admin-integrations'],
                ].map(([title, description, href]) => (
                  <Link href={href} key={title}>
                    <span><strong>{title}</strong><small>{description}</small></span>
                    <ChevronRight />
                  </Link>
                ))}
              </div>
            </section>

            <section className={styles.quickstart} id="quickstart">
              <div className={styles.quickCopy}>
                <span className={styles.overline}>QUICKSTART</span>
                <h2>Your first request,<br />in under five minutes.</h2>
                <p>Use the unified API to securely query services across every Clario360 suite.</p>
                <ol>
                  <li id="authentication"><span>1</span><div><strong>Create an API key</strong><small>Generate a scoped key from Settings → Developer.</small></div></li>
                  <li><span>2</span><div><strong>Choose your environment</strong><small>Connect to Cloud, private, or local endpoints.</small></div></li>
                  <li><span>3</span><div><strong>Make a request</strong><small>Send your key as a Bearer token and you’re ready.</small></div></li>
                </ol>
              </div>
              <div className={styles.codeWindow}>
                <div className={styles.codeTop}>
                  <div className={styles.codeTabs}>
                    {(Object.keys(snippets) as Array<keyof typeof snippets>).map((item) => (
                      <Button
                        variant="ghost"
                        key={item}
                        onClick={() => { setLanguage(item); setCopied(false); }}
                        className={language === item ? styles.activeTab : ''}
                      >
                        {item}
                      </Button>
                    ))}
                  </div>
                  <Button variant="ghost" className={styles.copyButton} onClick={copyCode} aria-label="Copy code">
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <pre><code>{snippets[language]}</code></pre>
                <div className={styles.codeResult}>
                  <span className={styles.successDot} /> 200 OK
                  <span>126 ms</span>
                </div>
              </div>
            </section>

            <section className={styles.trustStrip} id="security">
              <div><ShieldCheck /><span><strong>Sovereign by design</strong><small>Your data stays in your chosen jurisdiction.</small></span></div>
              <div><KeyRound /><span><strong>Secure by default</strong><small>Scoped access, encryption and immutable audit.</small></span></div>
              <div><Boxes /><span><strong>One unified API</strong><small>Consistent patterns across every suite.</small></span></div>
            </section>

            <section className={styles.apiFamilies} id="api-families">
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.overline}>UNIFIED API</span>
                  <h2>One gateway. Six ways to build.</h2>
                  <p>Use consistent authentication and response patterns across the platform.</p>
                </div>
                <span className={styles.versionBadge}>API v1</span>
              </div>
              <div className={styles.familyGrid}>
                {apiFamilies.map((family) => (
                  <Link href="/docs/api" className={styles.familyCard} key={family.path}>
                    <div>
                      <span className={family.method === 'GET' ? styles.getMethod : styles.postMethod}>
                        {family.method}
                      </span>
                      <code>{family.path}</code>
                    </div>
                    <h3>{family.title}</h3>
                    <p>{family.description}</p>
                    <ArrowRight />
                  </Link>
                ))}
              </div>
            </section>

            <section className={styles.bottomSection} id="api-reference">
              <div>
                <span className={styles.overline}>REFERENCE</span>
                <h2>Built for serious work.</h2>
                <p>Predictable resources, structured errors, idempotent operations, and complete audit context.</p>
              </div>
              <div className={styles.referenceLinks}>
                <Link href="/docs/build/authentication"><Code2 /> REST API <ArrowRight /></Link>
                <Link href="/docs/build/python-sdk" id="sdks"><Terminal /> Python SDK <ArrowRight /></Link>
                <Link href="/docs/operate/deployment" id="deployment"><Cloud /> Deployment guide <ArrowRight /></Link>
                <Link href="/docs/operate/security" id="compliance"><ShieldCheck /> Security model <ArrowRight /></Link>
              </div>
              <span id="webhooks" />
            </section>
          </div>

          <footer className={styles.footer}>
            <span>© 2026 Clario360</span>
            <nav aria-label="Developer footer">
              <Link href="/trust">Trust centre</Link>
              <Link href="/contact">Support</Link>
              <Link href="/resources">Changelog</Link>
              <a href="https://github.com/clario360" aria-label="Clario360 on GitHub"><Github size={14} /></a>
            </nav>
          </footer>
        </main>
      </div>

      <DocsSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
