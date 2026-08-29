import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const page = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/lex/tasks/page.tsx'),
  'utf8',
);

describe('/lex/tasks page contract', () => {
  it('uses the dedicated manager-task backend and guarded route', () => {
    expect(page).toContain('managerTasksApi.list');
    expect(page).toContain('managerTasksApi.create');
    expect(page).toContain('managerTasksApi.start');
    expect(page).toContain('managerTasksApi.submit');
    expect(page).toContain('managerTasksApi.decide');
    expect(page).toContain('<LexRouteGuard route="/lex/tasks">');
  });

  it('uploads optional attachments using the backend-required file scope', () => {
    expect(page).toContain("suite: 'lex'");
    expect(page).toContain("entity_type: 'manager_task_attachment'");
    expect(page).toContain('waitForCleanAttachment');
  });

  it('applies active locale direction to the page and portalled dialogs', () => {
    expect(page).toContain('dir={direction} lang={locale}');
    expect(page.match(/<DialogContent dir=\{direction\} lang=\{locale\}/g)?.length).toBe(
      3,
    );
    expect(page).toContain('managerTasksCopy(locale)');
  });
});
