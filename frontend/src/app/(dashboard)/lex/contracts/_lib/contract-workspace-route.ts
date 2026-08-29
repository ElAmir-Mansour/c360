import type { LexContractStatus } from "@/types/suites";

export interface ContractWorkspaceRouteInput {
  id: string;
  status: LexContractStatus;
}

/**
 * Reopens a contract in the lifecycle workspace that owns its persisted state.
 * This is deliberately derived from server data, so logging out/in cannot send
 * the same contract back to the legacy generic detail screen.
 */
export function contractWorkspaceHref(
  contract: ContractWorkspaceRouteInput,
): string {
  const base = `/lex/contracts/${contract.id}`;
  switch (contract.status) {
    case "draft":
      return `${base}/draft`;
    case "internal_review":
    case "legal_review":
      return `${base}/approval`;
    case "negotiation":
      return `${base}/negotiation`;
    case "pending_signature":
      return `${base}/signature`;
    default:
      return base;
  }
}
