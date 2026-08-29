'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp,
  Copy, ExternalLink, Menu, Search, ThumbsDown, ThumbsUp, X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SimpleTable } from '@/components/shared/simple-table';
import { docArticles, docGroups, findDoc, type DocBlock } from '../docs-content';
import { DocsSearchDialog } from '../_components';
import styles from '../docs.module.css';

function Block({ block }: { block: DocBlock }) {
  const [copied, setCopied] = useState(false);
  if (block.type === 'text') return <p className={styles.articleText}>{block.text}</p>;
  if (block.type === 'bullets') return <ul className={styles.articleBullets}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>;
  if (block.type === 'steps') return <ol className={styles.articleSteps}>{block.items.map((item, index) => <li key={item.title}><span>{index + 1}</span><div><strong>{item.title}</strong><p>{item.text}</p></div></li>)}</ol>;
  if (block.type === 'callout') return <div className={`${styles.articleCallout} ${styles[`callout_${block.tone}`]}`}><strong>{block.title}</strong><p>{block.text}</p></div>;
  if (block.type === 'table') {
    const data = block.rows.map((row) =>
      Object.fromEntries(block.headers.map((_, index) => [`column_${index}`, row[index]])),
    );
    return <SimpleTable columns={block.headers.map((header, index) => {
      const key = `column_${index}`;
      return {
        key,
        header,
        render: (item: Record<string, unknown>) => {
          const value = String(item[key] ?? '');
          return value.startsWith('/lex') ? (
            <Link className={styles.applicationRouteLink} href={value}>
              {value} <ExternalLink />
            </Link>
          ) : value;
        },
      };
    })} data={data} className={styles.articleTableWrap} ariaLabel="Documentation reference table" />;
  }
  const copy = async () => {
    await navigator.clipboard.writeText(block.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return <div className={styles.articleCode}><div><span>{block.language}</span><Button variant="ghost" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy'}</Button></div><pre><code>{block.code}</code></pre></div>;
}

export function DocsArticlePortal({ slug }: { slug: string }) {
  // The server route validates the slug before this client island renders.
  const article = findDoc(slug) ?? docArticles[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpful, setHelpful] = useState<'yes' | 'no' | null>(null);
  const index = docArticles.findIndex((item) => item.slug === article.slug);
  const previous = index > 0 ? docArticles[index - 1] : null;
  const next = index < docArticles.length - 1 ? docArticles[index + 1] : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <div className={styles.docs} dir="ltr">
    <a className={styles.skipLink} href="#documentation-content">Skip to documentation content</a>
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><Image src="/brand/Clario360_logo-colored.svg" width={145} height={35} alt="Clario360" priority /><span className={styles.brandDivider} /><span className={styles.docsLabel}>DOCS</span></Link>
      <Button variant="ghost" className={styles.searchButton} onClick={() => setSearchOpen(true)}><Search size={17} /><span>Search documentation…</span><kbd>⌘ K</kbd></Button>
      <nav className={styles.headerNav}><Link href="/docs">Docs home</Link><Link href="/resources">Resources</Link><Link href="/login" className={styles.consoleLink}>Open console <ArrowRight size={15} /></Link></nav>
      <Button variant="ghost" className={styles.menuButton} onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X /> : <Menu />}</Button>
    </header>
    <div className={styles.layout}>
      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarScroll}>
          <Link href="/docs" className={styles.versionSelect}><span><span className={styles.statusDot} /> Documentation</span><span>v1 · Stable <ChevronDown size={14} /></span></Link>
          {docGroups.map((group) => {
            const links = group.items.map((item) => (
              <Link
                href={`/docs/${item.slug}`}
                key={item.slug}
                aria-current={item.slug === article.slug ? 'page' : undefined}
                className={item.slug === article.slug ? styles.activeNav : ''}
                onClick={() => setMenuOpen(false)}
              >
                {item.title}
                {item.slug === article.slug ? <ChevronRight size={14} /> : null}
              </Link>
            ));
            const isRouteCatalog = group.title === 'WATHEEQTECH PAGES';
            return isRouteCatalog ? (
              <details
                className={`${styles.navGroup} ${styles.collapsibleNavGroup}`}
                key={group.title}
                open={article.group === 'WatheeqTech pages'}
              >
                <summary>{group.title}<ChevronDown /></summary>
                <div>{links}</div>
              </details>
            ) : (
              <div className={styles.navGroup} key={group.title}>
                <p>{group.title}</p>
                {links}
              </div>
            );
          })}
        </div>
        <Link href="/contact" className={styles.sidebarHelp}><CircleHelp size={17} /><span><strong>Need help?</strong>Talk to an engineer</span><ExternalLink size={13} /></Link>
      </aside>
      <main id="documentation-content" className={`${styles.main} ${styles.articleMain}`}>
        <div className={styles.articleLayout}>
          <article className={styles.article}>
            <div className={styles.breadcrumb}><Link href="/docs">Documentation</Link><ChevronRight /><span>{article.group}</span><ChevronRight /><span>{article.title}</span></div>
            <div className={styles.articleHeading}><span className={styles.articleIcon}><article.icon /></span><div><span className={styles.overline}>{article.group.toUpperCase()}</span><h1>{article.title}</h1><p>{article.description}</p><small>Last updated {article.updated} · 6 min read</small></div></div>
            {article.sections.map((section) => <section className={styles.articleSection} id={section.id} key={section.id}><h2><a href={`#${section.id}`}>#</a>{section.title}</h2>{section.blocks.map((block, i) => <Block block={block} key={i} />)}</section>)}
            <div className={styles.feedback}><div>{helpful ? <><Check /> Thanks for your feedback.</> : 'Was this page helpful?'}</div>{!helpful ? <span><Button variant="outline" onClick={() => setHelpful('yes')}><ThumbsUp /> Yes</Button><Button variant="outline" onClick={() => setHelpful('no')}><ThumbsDown /> No</Button></span> : null}</div>
            <div className={styles.articlePager}>
              {previous ? <Link href={`/docs/${previous.slug}`}><ArrowLeft /><span><small>PREVIOUS</small>{previous.title}</span></Link> : <span />}
              {next ? <Link href={`/docs/${next.slug}`}><span><small>NEXT</small>{next.title}</span><ArrowRight /></Link> : null}
            </div>
          </article>
          <aside className={styles.toc}><p>ON THIS PAGE</p>{article.sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}<div><span className={styles.statusDot} /><strong>Docs status</strong><small>All systems operational</small></div></aside>
        </div>
        <footer className={styles.footer}><span>© 2026 Clario360</span><nav><Link href="/trust">Trust centre</Link><Link href="/contact">Support</Link><Link href="/resources">Changelog</Link></nav></footer>
      </main>
    </div>
    <DocsSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
  </div>;
}
