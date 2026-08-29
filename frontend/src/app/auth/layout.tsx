// Literal /auth/** routes (magic-link verification, SSO completion) live
// OUTSIDE the `(auth)` route group because the emailed / configured backend
// URLs target real `/auth/...` paths — the route group adds no URL prefix, so
// a sibling literal segment is required. Re-exporting the group's layout keeps
// one source of truth for the auth chrome (brand lockup, locale/theme
// switchers, Riyadh hero panel, trust strip) instead of forking it.
export { default, generateMetadata } from '../(auth)/layout';
