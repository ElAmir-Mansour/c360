import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { VirtualList } from './virtual-list';

describe('VirtualList', () => {
  it('mounts a long collection without rendering every row', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `Row ${i}` }));
    const { container } = render(
      <VirtualList
        items={items}
        estimateSize={48}
        className="max-h-[240px]"
        getKey={(item) => item.id}
        renderItem={(item) => <div data-row>{item.label}</div>}
      />,
    );
    expect(container.firstChild).toBeTruthy();
    // Windowing: nowhere near all 1000 rows are in the DOM.
    expect(container.querySelectorAll('[data-row]').length).toBeLessThan(1000);
  });
});
