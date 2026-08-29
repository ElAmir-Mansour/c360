import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { ApiKeysClient } from "./api-keys-client";

export const metadata: Metadata = {
  title: "API Keys",
};

/**
 * API Keys (admin) — RSC shell.
 *
 * Server Component: exports static `metadata` and streams the interactive
 * `<ApiKeysClient />` (data-table + revoke/rotate mutations + dialogs) behind a
 * `<Suspense>` boundary. The fallback is a header + table skeleton (no KPI row)
 * to match the resolved layout. All hooks/state remain in the client child.
 *
 * Pattern reference: docs/frontend/rsc-shell-pattern.md
 */
export default function ApiKeysPage() {
  return (
    <Suspense fallback={<PageLoader kpis={0} rows={8} />}>
      <ApiKeysClient />
    </Suspense>
  );
}
