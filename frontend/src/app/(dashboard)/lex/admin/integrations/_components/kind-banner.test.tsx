import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { KindBanner } from './kind-banner';
import { integrationLabels } from '../_labels';

const t = integrationLabels.en;

describe('KindBanner', () => {
  it('renders an honest gov-gated onboarding banner for a gov-gated kind', () => {
    renderWithQuery(<KindBanner kind="najiz" />);
    expect(screen.getByText(t.govGatedBadge)).toBeInTheDocument();
    expect(screen.getByText(t.govGatedHint)).toBeInTheDocument();
  });

  it('renders the SSO discovery hint banner', () => {
    renderWithQuery(<KindBanner kind="sso" />);
    expect(
      screen.getByText(/IdP issuer|مزوّد الهوية/),
    ).toBeInTheDocument();
  });

  it('renders the in-kingdom WORM note for archiving', () => {
    renderWithQuery(<KindBanner kind="archiving" />);
    expect(screen.getByText(/WORM/)).toBeInTheDocument();
  });

  it('renders nothing for a plain kind with no contextual note', () => {
    const { container } = renderWithQuery(<KindBanner kind="internal" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the Arabic surface under the ar locale', () => {
    renderWithQuery(<KindBanner kind="najiz" />, { locale: 'ar' });
    expect(screen.getByText(integrationLabels.ar.govGatedBadge)).toBeInTheDocument();
  });
});
