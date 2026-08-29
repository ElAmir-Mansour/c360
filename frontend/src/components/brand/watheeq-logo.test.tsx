import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WatheeqLogo } from './watheeq-logo';

describe('WatheeqLogo', () => {
  it('uses the white-background lockup by default', () => {
    render(<WatheeqLogo title="WatheeqTech" />);

    expect(screen.getByRole('img', { name: 'WatheeqTech' })).toHaveAttribute(
      'src',
      '/brand/watheeqtech/logo-white-bg.svg',
    );
  });

  it('maps dark green chrome to the green-background lockup', () => {
    render(<WatheeqLogo tone="onDark" title="WatheeqTech" />);

    expect(screen.getByRole('img', { name: 'WatheeqTech' })).toHaveAttribute(
      'src',
      '/brand/watheeqtech/logo-green-bg.svg',
    );
  });

  it('exposes the supplied yellow-background lockup explicitly', () => {
    render(<WatheeqLogo background="yellow" title="WatheeqTech" />);

    expect(screen.getByRole('img', { name: 'WatheeqTech' })).toHaveAttribute(
      'src',
      '/brand/watheeqtech/logo-yellow-bg.svg',
    );
  });

  it.each([
    ['green', '/brand/watheeqtech/arabic-logo-green-bg.svg'],
    ['white', '/brand/watheeqtech/arabic-logo-white-bg.svg'],
    ['yellow', '/brand/watheeqtech/arabic-logo-yellow-bg.svg'],
  ] as const)('uses the Arabic %s-background lockup for Arabic locales', (background, src) => {
    render(<WatheeqLogo locale="ar-SA" background={background} title="وثيقتك" />);

    expect(screen.getByRole('img', { name: 'وثيقتك' })).toHaveAttribute('src', src);
  });

  it('uses the matching cropped gavel mark for compact placements', () => {
    render(<WatheeqLogo variant="mark" tone="onDark" title="WatheeqTech" />);

    expect(screen.getByRole('img', { name: 'WatheeqTech' })).toHaveAttribute(
      'src',
      '/brand/watheeqtech/mark-green-bg.svg',
    );
  });

  it('renders white- and green-background assets for automatic theme selection', () => {
    const { container } = render(<WatheeqLogo tone="auto" decorative />);

    expect(
      container.querySelector('img[src="/brand/watheeqtech/logo-white-bg.svg"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('img[src="/brand/watheeqtech/logo-green-bg.svg"]'),
    ).toBeInTheDocument();
  });

  it('keeps automatic theme selection locale-aware in Arabic', () => {
    const { container } = render(<WatheeqLogo locale="ar" tone="auto" decorative />);

    expect(
      container.querySelector('img[src="/brand/watheeqtech/arabic-logo-white-bg.svg"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('img[src="/brand/watheeqtech/arabic-logo-green-bg.svg"]'),
    ).toBeInTheDocument();
  });
});
