import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const lexAppRoot = path.join(frontendRoot, 'src/app/(dashboard)/lex');
const requireFromFrontend = createRequire(path.join(frontendRoot, 'package.json'));
const { chromium } = requireFromFrontend('@playwright/test');

const baseUrl = process.env.WATHEEQ_BASE_URL ?? 'https://devops.ofpsplatform.com';
const authState = process.env.WATHEEQ_AUTH_STATE ?? '/tmp/watheeq-devops-auth-state.json';
const outputPath =
  process.env.WATHEEQ_CAPTURE_OUT ??
  path.join(repoRoot, 'docs/client_requirement_must/watheeq_visible_text_capture_2026-07-12.json');
const maxPages = Number(process.env.WATHEEQ_MAX_PAGES ?? 140);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name === 'page.tsx') {
      files.push(fullPath);
    }
  }
  return files;
}

function routeFromPageFile(filePath) {
  const rel = path.relative(lexAppRoot, path.dirname(filePath)).replaceAll(path.sep, '/');
  if (!rel) return '/lex';
  if (rel.split('/').some((segment) => segment.startsWith('['))) return null;
  return `/lex/${rel}`;
}

function normalizeCandidate(rawHref) {
  if (!rawHref) return null;
  let url;
  try {
    url = new URL(rawHref, baseUrl);
  } catch {
    return null;
  }
  if (url.origin !== baseUrl) return null;
  if (!url.pathname.startsWith('/lex')) return null;
  if (url.pathname.includes('/logout') || url.pathname.includes('/api/')) return null;
  if (/\.(csv|json|pdf|xlsx?|docx?|zip)$/i.test(url.pathname)) return null;

  const clean = new URL(url.pathname, baseUrl);
  const page = url.searchParams.get('page');
  if (page && Number(page) > 0 && Number(page) <= 3) {
    clean.searchParams.set('page', page);
  }
  return `${clean.pathname}${clean.search}`;
}

function uniquePush(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function extractStaticRoutes() {
  const routes = walk(lexAppRoot)
    .map(routeFromPageFile)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  uniquePush(routes, '/lex/cases?page=1');
  return routes;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const distance = Math.max(480, Math.floor(window.innerHeight * 0.75));
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        total += distance;
        if (total >= document.body.scrollHeight - window.innerHeight || total > 16000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 140);
    });
  });
}

async function extractPage(page, route, responseStatus) {
  return page.evaluate(
    ({ route, responseStatus, baseUrl }) => {
      const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      const splitLines = (value) =>
        (value || '')
          .split(/\n+/)
          .map((line) => line.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
      const isVisible = (el) => {
        if (!el || !(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const collectText = (selector, root = document) => {
        const values = [];
        for (const el of root.querySelectorAll(selector)) {
          if (!isVisible(el)) continue;
          const text = textOf(el);
          if (text && !values.includes(text)) values.push(text);
        }
        return values;
      };
      const collectInputs = (root = document) => {
        const values = [];
        for (const el of root.querySelectorAll('input, textarea, select')) {
          if (!isVisible(el)) continue;
          const id = el.getAttribute('id');
          const label =
            (id && textOf(document.querySelector(`label[for="${CSS.escape(id)}"]`))) ||
            textOf(el.closest('label')) ||
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name');
          if (label && !values.includes(label)) values.push(label);
          const placeholder = el.getAttribute('placeholder');
          if (placeholder && !values.includes(placeholder)) values.push(placeholder);
          if (el instanceof HTMLSelectElement) {
            for (const option of el.options) {
              const optionText = textOf(option);
              if (optionText && !values.includes(optionText)) values.push(optionText);
            }
          }
        }
        return values;
      };
      const collectLines = (root) => {
        const lines = [];
        for (const line of splitLines(root?.innerText || '')) {
          if (!lines.includes(line)) lines.push(line);
        }
        return lines;
      };

      const main = document.querySelector('main') || document.body;
      const bodyLines = collectLines(document.body);
      const mainLines = collectLines(main);
      const h1 = collectText('h1', main);
      const allH1 = collectText('h1');
      const unavailable = /sign in to clario360|this page could not be found|404|not found/i.test(
        `${allH1.join(' ')} ${bodyLines.slice(0, 12).join(' ')}`,
      );

      const links = [];
      for (const anchor of document.querySelectorAll('a[href]')) {
        const text = textOf(anchor);
        if (!isVisible(anchor) || !text) continue;
        let href = '';
        try {
          href = new URL(anchor.getAttribute('href'), baseUrl).toString();
        } catch {
          href = anchor.getAttribute('href') || '';
        }
        if (!links.some((item) => item.text === text && item.href === href)) links.push({ text, href });
      }

      return {
        route,
        url: window.location.href,
        path: window.location.pathname + window.location.search,
        title: document.title,
        responseStatus,
        capturedAt: new Date().toISOString(),
        renderable: !unavailable && mainLines.length > 0,
        h1,
        headings: {
          h2: collectText('h2', main),
          h3: collectText('h3', main),
          h4: collectText('h4', main),
        },
        descriptions: collectText('p', main).slice(0, 30),
        buttons: collectText('button', main),
        links,
        formText: collectInputs(main),
        tableHeaders: collectText('th', main),
        navLines: collectLines(document.querySelector('aside')).slice(0, 120),
        topBarLines: collectLines(document.querySelector('header')).slice(0, 80),
        mainLines: mainLines.slice(0, 900),
        discoveredLexRoutes: links.map((link) => link.href),
      };
    },
    { route, responseStatus, baseUrl },
  );
}

async function main() {
  if (!fs.existsSync(authState)) {
    throw new Error(`Auth state not found: ${authState}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const seedRoutes = extractStaticRoutes();
  const queue = [...seedRoutes];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];
  const skipped = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authState,
    viewport: { width: 1680, height: 1120 },
    locale: 'en-US',
    timezoneId: 'Africa/Lagos',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  while (queue.length && visited.size < maxPages) {
    const route = queue.shift();
    if (!route || visited.has(route)) continue;
    visited.add(route);
    const url = new URL(route, baseUrl).toString();
    process.stdout.write(`[${visited.size}/${Math.min(maxPages, queued.size)}] ${route} ... `);

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 9000 }).catch(() => {});
      await autoScroll(page).catch(() => {});
      await page.waitForTimeout(350);

      const currentUrl = page.url();
      const responseStatus = response?.status() ?? null;
      const capture = await extractPage(page, route, responseStatus);
      if (currentUrl.includes('/login') || !capture.renderable) {
        skipped.push({
          route,
          url: currentUrl,
          responseStatus,
          reason: currentUrl.includes('/login') ? 'redirected to login' : 'not renderable or unavailable',
          h1: capture.h1,
        });
        process.stdout.write(`skipped (${skipped.at(-1).reason})\n`);
        continue;
      }

      pages.push(capture);
      const before = queued.size;
      for (const href of capture.discoveredLexRoutes) {
        const normalized = normalizeCandidate(href);
        if (!normalized || queued.has(normalized) || visited.has(normalized)) continue;
        queued.add(normalized);
        queue.push(normalized);
      }
      process.stdout.write(`captured, +${queued.size - before} discovered\n`);
    } catch (error) {
      skipped.push({ route, url, reason: error.message.split('\n')[0] });
      process.stdout.write(`error (${error.message.split('\n')[0]})\n`);
    }
  }

  await browser.close();

  const sharedNav = [];
  const sharedTopBar = [];
  for (const capture of pages) {
    for (const line of capture.navLines) uniquePush(sharedNav, line);
    for (const line of capture.topBarLines) uniquePush(sharedTopBar, line);
  }

  const output = {
    metadata: {
      baseUrl,
      capturedAt: new Date().toISOString(),
      source: 'Authenticated Playwright capture of deployed WatheeqTech pages',
      routeSource: 'Static frontend routes plus same-origin /lex links discovered from rendered pages',
      maxPages,
      seedRouteCount: seedRoutes.length,
      capturedPageCount: pages.length,
      skippedPageCount: skipped.length,
    },
    sharedShell: {
      navigation: sharedNav,
      topBar: sharedTopBar,
    },
    pages,
    skipped,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
  console.log(`Captured ${pages.length} pages; skipped ${skipped.length}; discovered ${queued.size} candidate routes.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
