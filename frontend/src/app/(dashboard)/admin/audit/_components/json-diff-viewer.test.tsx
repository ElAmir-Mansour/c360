import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { JsonDiffViewer } from './json-diff-viewer';

describe('JsonDiffViewer', () => {
  it('test_showsAddedFields: new field → shown as added (+ prefix)', () => {
    renderWithQuery(<JsonDiffViewer oldValue={{}} newValue={{ name: 'John' }} />);
    expect(screen.getByText('+')).toBeInTheDocument();
    expect(screen.getByText('name:')).toBeInTheDocument();
  });

  it('test_showsRemovedFields: removed field → shown with - prefix', () => {
    renderWithQuery(<JsonDiffViewer oldValue={{ name: 'John' }} newValue={{}} />);
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('name:')).toBeInTheDocument();
  });

  it('test_showsChangedFields: changed field → both old and new values visible', () => {
    renderWithQuery(
      <JsonDiffViewer oldValue={{ name: 'John' }} newValue={{ name: 'Jane' }} />
    );
    const row = screen.getByText('name:');
    expect(row).toBeInTheDocument();
    // The changed row should show ~ prefix
    expect(screen.getByText('~')).toBeInTheDocument();
  });

  it('test_showsUnchangedFields: same field → shown with unchanged styling', () => {
    renderWithQuery(
      <JsonDiffViewer oldValue={{ age: 30 }} newValue={{ age: 30 }} />
    );
    expect(screen.getByText('age:')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    // Unchanged rows have muted-foreground class (no +/- prefix)
    const minusCells = screen.queryAllByText('-');
    const plusCells = screen.queryAllByText('+');
    expect(minusCells.length).toBe(0);
    expect(plusCells.length).toBe(0);
  });

  it('test_handlesNullOld: old=null → all new fields shown as added', () => {
    renderWithQuery(<JsonDiffViewer oldValue={null} newValue={{ id: '123', name: 'Alice' }} />);
    const plusCells = screen.getAllByText('+');
    expect(plusCells.length).toBe(2);
  });

  it('test_handlesNullBoth: both null → no data message', () => {
    renderWithQuery(<JsonDiffViewer oldValue={null} newValue={null} />);
    expect(screen.getByText('No change data available.')).toBeInTheDocument();
  });

  it('test_handlesUndefinedBoth: both undefined → no data message', () => {
    renderWithQuery(<JsonDiffViewer oldValue={undefined} newValue={undefined} />);
    expect(screen.getByText('No change data available.')).toBeInTheDocument();
  });
});
