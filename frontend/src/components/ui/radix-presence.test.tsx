import { useCallback, useReducer } from 'react';
import { render } from '@testing-library/react';
import { Presence } from '@radix-ui/react-presence';
import { Slot } from '@radix-ui/react-slot';
import { describe, expect, it } from 'vitest';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

describe('Radix Presence regression', () => {
  it('does not loop when an unstable callback ref triggers a render on attach', () => {
    let renderCount = 0;

    function OverlayContent() {
      renderCount += 1;
      const [, forceRender] = useReducer((count: number) => count + 1, 0);

      return (
        <Presence present>
          <div
            ref={(node) => {
              if (node) forceRender();
            }}
          >
            Overlay content
          </div>
        </Presence>
      );
    }

    expect(() => render(<OverlayContent />)).not.toThrow();
    expect(renderCount).toBeLessThan(25);
  });

  it('mounts a closed Select trigger without a composed-ref update loop', () => {
    expect(() =>
      render(
        <Select value="role">
          <SelectTrigger aria-label="Assignee strategy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="role">Role</SelectItem>
          </SelectContent>
        </Select>,
      ),
    ).not.toThrow();
  });

  it('keeps a Slot ref stable when its attach callback triggers a render', () => {
    let renderCount = 0;

    function SlottedButton() {
      renderCount += 1;
      const [, forceRender] = useReducer((count: number) => count + 1, 0);
      const ref = useCallback((node: HTMLElement | null) => {
        if (node) forceRender();
      }, []);

      return (
        <Slot ref={ref}>
          <button type="button">Slotted trigger</button>
        </Slot>
      );
    }

    expect(() => render(<SlottedButton />)).not.toThrow();
    expect(renderCount).toBeLessThan(25);
  });
});
