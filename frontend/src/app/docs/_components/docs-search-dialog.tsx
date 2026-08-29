'use client';

import { ArrowRight, FileText, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { docArticles, type DocArticle, type DocBlock } from '../docs-content';
import styles from './docs-search-dialog.module.css';

export type DocsSearchSource = Pick<
  DocArticle,
  'slug' | 'title' | 'description' | 'group' | 'sections'
>;

export type DocsSearchItem = {
  slug: string;
  href: string;
  title: string;
  description: string;
  group: string;
  searchText: string;
  normalizedTitle: string;
  normalizedGroup: string;
  normalizedDescription: string;
};

export type DocsSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articles?: readonly DocsSearchSource[];
  onNavigate?: (item: DocsSearchItem) => void;
  enableKeyboardShortcut?: boolean;
  resultLimit?: number;
  className?: string;
  title?: string;
  placeholder?: string;
};

const DEFAULT_RESULT_LIMIT = 30;
const POPULAR_RESULT_LIMIT = 8;

function blockText(block: DocBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'bullets':
      return block.items.join(' ');
    case 'steps':
      return block.items.map((item) => `${item.title} ${item.text}`).join(' ');
    case 'code':
      return block.code;
    case 'callout':
      return `${block.title} ${block.text}`;
    case 'table':
      return `${block.headers.join(' ')} ${block.rows.flat().join(' ')}`;
  }
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\u0640/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}/]+/gu, ' ')
    .trim();
}

export function createDocsSearchItems(
  articles: readonly DocsSearchSource[] = docArticles,
): DocsSearchItem[] {
  return articles.map((article) => {
    const sectionText = article.sections
      .map((section) => {
        const blocks = section.blocks.map(blockText).join(' ');
        return `${section.title} ${blocks}`;
      })
      .join(' ');
    const normalizedTitle = normalize(article.title);
    const normalizedGroup = normalize(article.group);
    const normalizedDescription = normalize(article.description);

    return {
      slug: article.slug,
      href: `/docs/${article.slug}`,
      title: article.title,
      description: article.description,
      group: article.group,
      searchText: normalize(
        `${article.title} ${article.group} ${article.description} ${sectionText} ${article.slug}`,
      ),
      normalizedTitle,
      normalizedGroup,
      normalizedDescription,
    };
  });
}

export function searchDocs(
  items: readonly DocsSearchItem[],
  query: string,
  limit = DEFAULT_RESULT_LIMIT,
): DocsSearchItem[] {
  const normalizedQuery = normalize(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return items.slice(0, Math.min(POPULAR_RESULT_LIMIT, limit));
  }

  return items
    .flatMap((item, registryIndex) => {
      if (!tokens.every((token) => item.searchText.includes(token))) return [];

      let score = 0;
      if (item.normalizedTitle === normalizedQuery) score += 100;
      if (item.normalizedTitle.startsWith(normalizedQuery)) score += 60;
      if (item.normalizedTitle.includes(normalizedQuery)) score += 35;
      if (item.normalizedGroup.includes(normalizedQuery)) score += 15;
      if (item.normalizedDescription.includes(normalizedQuery)) score += 10;
      score += tokens.filter((token) => item.normalizedTitle.includes(token)).length * 8;

      return [{ item, score, registryIndex }];
    })
    .sort((left, right) => right.score - left.score || left.registryIndex - right.registryIndex)
    .slice(0, limit)
    .map(({ item }) => item);
}

function isModifiedClick(event: ReactMouseEvent<HTMLAnchorElement>): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function DocsSearchDialog({
  open,
  onOpenChange,
  articles = docArticles,
  onNavigate,
  enableKeyboardShortcut = true,
  resultLimit = DEFAULT_RESULT_LIMIT,
  className,
  title = 'Search documentation',
  placeholder = 'Search all documentation…',
}: DocsSearchDialogProps) {
  const router = useRouter();
  const reactId = useId().replace(/:/g, '');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const items = useMemo(() => createDocsSearchItems(articles), [articles]);
  const results = useMemo(
    () => searchDocs(items, query, Math.max(1, resultLimit)),
    [items, query, resultLimit],
  );
  const titleId = `docs-search-title-${reactId}`;
  const descriptionId = `docs-search-description-${reactId}`;
  const listboxId = `docs-search-results-${reactId}`;
  const activeResult = results[activeIndex];
  const activeDescendant = activeResult
    ? `docs-search-result-${reactId}-${activeIndex}`
    : undefined;

  onOpenChangeRef.current = onOpenChange;
  const close = useCallback(() => onOpenChangeRef.current(false), []);

  const navigate = useCallback(
    (item: DocsSearchItem) => {
      onNavigate?.(item);
      onOpenChange(false);
      router.push(item.href);
    },
    [onNavigate, onOpenChange, router],
  );

  useEffect(() => {
    if (!enableKeyboardShortcut) return;

    const handleShortcut = (event: KeyboardEvent) => {
      if (
        !event.altKey &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === 'k'
      ) {
        event.preventDefault();
        if (!open) {
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          onOpenChangeRef.current(true);
        } else {
          inputRef.current?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [enableKeyboardShortcut, open]);

  useEffect(() => {
    if (!open) return;

    if (!returnFocusRef.current) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }

    const focusTarget = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus({ preventScroll: true });

    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href]',
        ),
      ).filter((element) => element.tabIndex >= 0 && !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleModalKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleModalKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (focusTarget?.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
      returnFocusRef.current = null;
    };
  }, [close, open]);

  useEffect(() => {
    if (results.length === 0) {
      setActiveIndex(-1);
    } else if (activeIndex < 0 || activeIndex >= results.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, results.length]);

  useEffect(() => {
    if (!activeDescendant) return;
    document
      .getElementById(activeDescendant)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeDescendant]);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.length > 0) {
        setActiveIndex((index) => (index + 1 + results.length) % results.length);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length > 0) {
        setActiveIndex((index) => (index - 1 + results.length) % results.length);
      }
    } else if (event.key === 'Enter' && activeResult) {
      event.preventDefault();
      navigate(activeResult);
    }
  };

  if (!open) return null;

  return (
    <div
      className={[styles.overlay, className].filter(Boolean).join(' ')}
      data-testid="docs-search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId} className={styles.visuallyHidden}>
          {title}
        </h2>
        <p id={descriptionId} className={styles.visuallyHidden}>
          Type to search every documentation page. Use the up and down arrow keys
          to choose a result, then press Enter to open it.
        </p>

        <div className={styles.searchBar}>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <label className={styles.visuallyHidden} htmlFor={`docs-search-input-${reactId}`}>
            {title}
          </label>
          <input
            ref={inputRef}
            id={`docs-search-input-${reactId}`}
            className={styles.input}
            role="combobox"
            type="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded="true"
            aria-activedescendant={activeDescendant}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={placeholder}
          />
          <kbd className={styles.shortcut} aria-hidden="true">
            Esc
          </kbd>
          <Button
            className={styles.closeButton}
            type="button"
            variant="ghost"
            size="icon"
            onClick={close}
          >
            <X aria-hidden="true" />
            <span className={styles.visuallyHidden}>Close search</span>
          </Button>
        </div>

        <p className={styles.resultStatus} role="status" aria-live="polite">
          {query.trim()
            ? `${results.length} ${results.length === 1 ? 'result' : 'results'}`
            : 'Suggested documentation'}
        </p>

        <div
          id={listboxId}
          className={styles.results}
          role="listbox"
          aria-label="Documentation search results"
        >
          {results.length > 0 ? (
            results.map((item, index) => {
              const selected = index === activeIndex;
              return (
                <a
                  id={`docs-search-result-${reactId}-${index}`}
                  className={styles.result}
                  href={item.href}
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  key={item.slug}
                  onMouseMove={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onClick={(event) => {
                    onNavigate?.(item);
                    onOpenChange(false);
                    if (!isModifiedClick(event)) {
                      event.preventDefault();
                      router.push(item.href);
                    }
                  }}
                >
                  <span className={styles.resultIcon} aria-hidden="true">
                    <FileText />
                  </span>
                  <span className={styles.resultCopy}>
                    <span className={styles.resultMeta}>{item.group}</span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  <ArrowRight className={styles.resultArrow} aria-hidden="true" />
                </a>
              );
            })
          ) : (
            <div className={styles.empty} role="presentation">
              <span className={styles.emptyIcon} aria-hidden="true">
                <Search />
              </span>
              <strong>No documentation found</strong>
              <p>Try a feature name, task, route, or broader keyword.</p>
            </div>
          )}
        </div>

        <footer className={styles.footer} aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </footer>
      </div>
    </div>
  );
}
