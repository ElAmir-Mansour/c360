'use client';

import { LexRouteGuard } from '../../../_guards/lex-route-guard';
import { ManagerWorkspace } from '../_components/manager-workspace';

export default function CasesManagerOverviewPage() {
  return (
    <LexRouteGuard route="/lex/cases/control/overview">
      <ManagerWorkspace view="overview" />
    </LexRouteGuard>
  );
}
