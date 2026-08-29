import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsClient, SettingsFallback } from "./settings-client";

export const metadata: Metadata = {
  title: "Account Settings",
};

/**
 * Account Settings — RSC shell.
 *
 * The page is a Server Component: it exports static `metadata` and renders an
 * instant, content-shaped skeleton (header + stacked form cards) while the
 * interactive `<SettingsClient />` (locale hook + section forms) streams in
 * through the `<Suspense>` boundary. All hooks/state live in the client child;
 * behaviour is unchanged beyond the streamed fallback.
 *
 * Pattern reference: docs/frontend/rsc-shell-pattern.md
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsClient />
    </Suspense>
  );
}
