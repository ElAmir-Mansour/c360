/**
 * Marketing shell — public barrel.
 *
 * Composable, token-driven, RTL-first chrome for the public marketing surface.
 * Phase 4 assembles these into proof pages; nothing here renders a page on its
 * own.
 */

export { MarketingShell } from './marketing-shell';
export type {
  MarketingShellProps,
  MarketingShellLabels,
  ShellAnnouncement,
} from './marketing-shell';

export { MegaMenu } from './mega-menu';
export type { MegaMenuProps } from './mega-menu';

export { MobileNav, MobileNavChevron } from './mobile-nav';
export type { MobileNavProps } from './mobile-nav';

export { MarketingFooter } from './marketing-footer';
export type { MarketingFooterProps } from './marketing-footer';

export {
  clarioDrNavModel,
  clarioDrFooterModel,
  clarioDrBrand,
} from './nav-model';
export type {
  NavModel,
  NavItem,
  NavColumn,
  NavLink,
  NavIcon,
  FooterColumn,
  FooterLink,
  ShellBrand,
} from './nav-model';
