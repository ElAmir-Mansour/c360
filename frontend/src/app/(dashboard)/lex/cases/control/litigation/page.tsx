'use client';

import { LexRouteGuard } from '../../../_guards/lex-route-guard';
import { ManagerWorkspace } from '../_components/manager-workspace';

export default function CasesManagerLitigationPage() {
  return (
    <LexRouteGuard route="/lex/cases/control/litigation">
      <ManagerWorkspace view="litigation" />
    </LexRouteGuard>
  );
}
