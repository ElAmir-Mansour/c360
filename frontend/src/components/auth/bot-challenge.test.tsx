import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, renderHook, act } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';

import {
  BotChallenge,
  BOT_CHALLENGE_LOCAL_TOKEN,
  useBotChallenge,
} from './bot-challenge';

function getSlider(): HTMLInputElement {
  return screen.getByRole('slider') as HTMLInputElement;
}

// The component requires a minimum interaction time before accepting a pass.
// Drive Date.now() so tests are deterministic and fast.
describe('BotChallenge', () => {
  let now = 1_000_000;

  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function slideToEnd(slider: HTMLInputElement) {
    // First interaction stamps the start time.
    fireEvent.pointerDown(slider);
    // Advance past the minimum interaction window so the pass is accepted.
    now += 500;
    fireEvent.change(slider, { target: { value: '100' } });
  }

  it('renders an accessible slider with an aria label', () => {
    renderWithQuery(<BotChallenge onPass={vi.fn()} />);
    const slider = getSlider();
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-labelledby');
    expect(slider).toHaveAttribute('aria-valuetext');
  });

  it('calls onPass with the local token after a complete slide', () => {
    const onPass = vi.fn();
    renderWithQuery(<BotChallenge onPass={onPass} />);
    slideToEnd(getSlider());
    expect(onPass).toHaveBeenCalledWith(BOT_CHALLENGE_LOCAL_TOKEN);
  });

  it('does not pass on an instant (sub-threshold time) slide', () => {
    const onPass = vi.fn();
    renderWithQuery(<BotChallenge onPass={onPass} />);
    const slider = getSlider();
    fireEvent.pointerDown(slider);
    // No time advance — completion is implausibly instant.
    fireEvent.change(slider, { target: { value: '100' } });
    expect(onPass).not.toHaveBeenCalled();
  });

  it('does not pass on a partial slide', () => {
    const onPass = vi.fn();
    renderWithQuery(<BotChallenge onPass={onPass} />);
    const slider = getSlider();
    fireEvent.pointerDown(slider);
    now += 500;
    fireEvent.change(slider, { target: { value: '50' } });
    expect(onPass).not.toHaveBeenCalled();
  });

  it('fails (does not pass) when the honeypot is filled', () => {
    const onPass = vi.fn();
    const { container } = renderWithQuery(<BotChallenge onPass={onPass} />);
    const honeypot = container.querySelector(
      'input[name="nickname"]',
    ) as HTMLInputElement;
    expect(honeypot).toBeTruthy();
    // A bot fills the hidden field.
    fireEvent.change(honeypot, { target: { value: 'i-am-a-bot' } });
    slideToEnd(getSlider());
    expect(onPass).not.toHaveBeenCalled();
    // "Try again" only renders in the visible failure notice, so it is unique.
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it('honeypot is hidden from assistive tech and keyboard', () => {
    const { container } = renderWithQuery(<BotChallenge onPass={vi.fn()} />);
    const honeypot = container.querySelector(
      'input[name="nickname"]',
    ) as HTMLInputElement;
    expect(honeypot).toHaveAttribute('tabindex', '-1');
    expect(honeypot).toHaveAttribute('autocomplete', 'off');
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('useBotChallenge', () => {
  it('is not required before the failure threshold', () => {
    const { result } = renderHook(() => useBotChallenge({ threshold: 3 }));
    expect(result.current.required).toBe(false);
    act(() => result.current.markFailure());
    act(() => result.current.markFailure());
    expect(result.current.required).toBe(false);
    expect(result.current.failureCount).toBe(2);
  });

  it('becomes required once the threshold is reached', () => {
    const { result } = renderHook(() => useBotChallenge({ threshold: 3 }));
    act(() => {
      result.current.markFailure();
      result.current.markFailure();
      result.current.markFailure();
    });
    expect(result.current.required).toBe(true);
  });

  it('a 429 forces the challenge immediately', () => {
    const { result } = renderHook(() => useBotChallenge({ threshold: 5 }));
    act(() => result.current.markFailure(429));
    expect(result.current.required).toBe(true);
  });

  it('reset clears the required state', () => {
    const { result } = renderHook(() => useBotChallenge({ threshold: 1 }));
    act(() => result.current.markFailure(429));
    expect(result.current.required).toBe(true);
    act(() => result.current.reset());
    expect(result.current.required).toBe(false);
    expect(result.current.failureCount).toBe(0);
  });
});
