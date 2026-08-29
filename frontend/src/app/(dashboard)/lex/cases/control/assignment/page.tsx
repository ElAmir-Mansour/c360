'use client';

import { LexRouteGuard } from '../../../_guards/lex-route-guard';
import { ManagerWorkspace } from '../_components/manager-workspace';

export default function CasesManagerAssignmentPage() {
  return (
    <LexRouteGuard route="/lex/cases/control/assignment">
      <ManagerWorkspace view="assignment" />
    </LexRouteGuard>
  );
}
