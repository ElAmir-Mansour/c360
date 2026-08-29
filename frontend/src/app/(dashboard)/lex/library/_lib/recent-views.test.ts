import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  upsertRecent,
  recordView,
  useRecentlyViewed,
  type RecentView,
} from './recent-views';

beforeEach(() => {
  window.localStorage.clear();
});

describe('upsertRecent', () => {
  it('prepends a new id newest-first', () => {
    const out = upsertRecent([], 'a', 1);
    expect(out).toEqual([{ id: 'a', at: 1 }]);
  });

  it('dedups by id, moving the re-viewed doc to the front', () => {
    const start: RecentView[] = [
      { id: 'a', at: 1 },
      { id: 'b', at: 2 },
    ];
    const out = upsertRecent(start, 'a', 3);
    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
    expect(out[0].at).toBe(3);
  });

  it('caps the list length', () => {
    let list: RecentView[] = [];
    for (let i = 0; i < 20; i += 1) list = upsertRecent(list, `d${i}`, i);
    expect(list.length).toBeLessThanOrEqual(12);
    expect(list[0].id).toBe('d19');
  });
});

describe('recordView', () => {
  it('is a no-op for an empty id', () => {
    recordView('');
    expect(window.localStorage.getItem('lex.library.recentViews.v1')).toBeNull();
  });

  it('persists a view that round-trips through the hook', () => {
    recordView('doc-x', 100);
    const { result } = renderHook(() => useRecentlyViewed());
    expect(result.current.recent[0]?.id).toBe('doc-x');
  });
});

describe('useRecentlyViewed', () => {
  it('records and clears', () => {
    const { result } = renderHook(() => useRecentlyViewed());
    act(() => result.current.record('a'));
    act(() => result.current.record('b'));
    expect(result.current.recent.map((e) => e.id)).toEqual(['b', 'a']);
    act(() => result.current.clear());
    expect(result.current.recent).toEqual([]);
  });
});
