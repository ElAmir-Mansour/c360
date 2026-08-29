import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import {
  DocsSearchDialog,
  createDocsSearchItems,
  searchDocs,
  type DocsSearchItem,
  type DocsSearchSource,
} from './docs-search-dialog';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/docs',
  useParams: () => ({}),
  useSearchParams: () => ({ get: () => null, forEach: () => undefined }),
  redirect: vi.fn(),
}));

const articles: DocsSearchSource[] = [
  {
    slug: 'getting-started/introduction',
    title: 'Introduction',
    description: 'Understand the Clario360 platform.',
    group: 'Get started',
    sections: [
      {
        id: 'platform',
        title: 'Platform model',
        blocks: [{ type: 'text', text: 'Shared identity and event services.' }],
      },
    ],
  },
  {
    slug: 'watheeq/contracts',
    title: 'Manage legal contracts',
    description: 'Review and approve governed agreements.',
    group: 'WatheeqTech',
    sections: [
      {
        id: 'renewal',
        title: 'Renewal workflow',
        blocks: [
          {
            type: 'steps',
            items: [
              {
                title: 'Schedule the reminder',
                text: 'Create an obligation before the counterparty deadline.',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'watheeq/litigation',
    title: 'Manage litigation',
    description: 'Track cases, hearings, evidence, and outcomes.',
    group: 'WatheeqTech',
    sections: [
      {
        id: 'hearings',
        title: 'Court hearings',
        blocks: [{ type: 'bullets', items: ['Record the judge and next hearing date.'] }],
      },
    ],
  },
];

function Harness({
  initialOpen = false,
  onNavigate,
}: {
  initialOpen?: boolean;
  onNavigate?: (item: DocsSearchItem) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Open search
      </Button>
      <DocsSearchDialog
        open={open}
        onOpenChange={setOpen}
        articles={articles}
        onNavigate={onNavigate}
      />
    </>
  );
}

describe('documentation search indexing', () => {
  it('indexes section and block content, not only article metadata', () => {
    const items = createDocsSearchItems(articles);

    expect(searchDocs(items, 'counterparty deadline')).toEqual([
      expect.objectContaining({ slug: 'watheeq/contracts' }),
    ]);
    expect(searchDocs(items, 'judge hearing')).toEqual([
      expect.objectContaining({ slug: 'watheeq/litigation' }),
    ]);
  });

  it('requires every query token and ranks exact title matches first', () => {
    const items = createDocsSearchItems(articles);
    const results = searchDocs(items, 'manage litigation');

    expect(results[0]?.slug).toBe('watheeq/litigation');
    expect(searchDocs(items, 'litigation contracts')).toHaveLength(0);
  });
});

describe('DocsSearchDialog', () => {
  beforeEach(() => {
    pushMock.mockClear();
    document.body.style.overflow = '';
  });

  it('opens with Cmd/Ctrl+K, moves focus into search, and locks body scroll', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open search' });
    trigger.focus();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    const dialog = await screen.findByRole('dialog', { name: 'Search documentation' });
    const input = within(dialog).getByRole('combobox', { name: 'Search documentation' });
    await waitFor(() => expect(input).toHaveFocus());
    expect(document.body.style.overflow).toBe('hidden');
    expect(input).toHaveAttribute('aria-controls');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('listbox')).toBeInTheDocument();
  });

  it('restores focus and the prior body overflow value after Escape', async () => {
    document.body.style.overflow = 'clip';
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open search' });

    await user.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Search documentation' })).toHaveFocus(),
    );
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('clip');
  });

  it('exposes a roving listbox selection and navigates the active result with Enter', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Harness initialOpen onNavigate={onNavigate} />);

    const input = screen.getByRole('combobox', { name: 'Search documentation' });
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);

    await user.keyboard('{ArrowDown}');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);

    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'watheeq/contracts' }),
    );
    expect(pushMock).toHaveBeenCalledWith('/docs/watheeq/contracts');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('wraps ArrowUp selection from the first result to the last', async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    const options = screen.getAllByRole('option');

    await user.keyboard('{ArrowUp}');

    expect(options.at(-1)).toHaveAttribute('aria-selected', 'true');
  });

  it('filters across full article content and presents a useful empty state', async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    const input = screen.getByRole('combobox', { name: 'Search documentation' });

    await user.type(input, 'counterparty deadline');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Manage legal contracts/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 result');

    await user.clear(input);
    await user.type(input, 'does not exist anywhere');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('No documentation found')).toBeInTheDocument();
    expect(screen.getByText(/feature name, task, route/i)).toBeInTheDocument();
  });

  it('traps Tab focus between the search input and mobile close control', async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    const input = screen.getByRole('combobox', { name: 'Search documentation' });
    const closeButton = screen.getByRole('button', { name: 'Close search' });
    await waitFor(() => expect(input).toHaveFocus());

    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(closeButton).toHaveFocus();
  });

  it('closes when the backdrop is pressed without closing for dialog interaction', async () => {
    render(<Harness initialOpen />);
    const overlay = screen.getByTestId('docs-search-overlay');
    const input = screen.getByRole('combobox', { name: 'Search documentation' });

    fireEvent.mouseDown(input);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.mouseDown(overlay);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('supports direct pointer navigation through semantic result links', async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    const result = screen.getByRole('option', { name: /Manage litigation/ });

    expect(result).toHaveAttribute('href', '/docs/watheeq/litigation');
    await user.click(result);

    expect(pushMock).toHaveBeenCalledWith('/docs/watheeq/litigation');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
