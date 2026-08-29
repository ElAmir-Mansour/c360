import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCommandPaletteStore } from '@/stores/command-palette-store';
import { LexGlobalSearch } from './global-search';

vi.mock('./lex-shell-labels', () => ({
  useLexShellLabels: () => ({
    search: {
      label: 'Search legal suite',
      placeholder: 'Search cases, contracts, requests…',
    },
  }),
}));

describe('LexGlobalSearch', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({
      open: false,
      query: '',
      commands: {},
    });
  });

  it('opens the shared command palette from the compact search trigger', () => {
    render(<LexGlobalSearch />);

    fireEvent.click(screen.getByRole('button', { name: 'Search legal suite' }));

    expect(useCommandPaletteStore.getState().open).toBe(true);
  });

  it('seeds the shared command palette with text entered in the desktop field', () => {
    render(<LexGlobalSearch />);
    const input = screen.getByRole('searchbox', { name: 'Search legal suite' });

    fireEvent.change(input, { target: { value: 'employment case' } });

    expect(useCommandPaletteStore.getState()).toMatchObject({
      open: true,
      query: 'employment case',
    });
  });
});
