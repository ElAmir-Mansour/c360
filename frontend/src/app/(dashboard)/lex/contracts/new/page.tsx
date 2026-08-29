import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { ContractDraftingWorkspace } from './_components/contract-drafting-workspace';

export default function NewContractPage() {
  return (
    <LexRouteGuard route="/lex/contracts">
      <ContractDraftingWorkspace />
    </LexRouteGuard>
  );
}
