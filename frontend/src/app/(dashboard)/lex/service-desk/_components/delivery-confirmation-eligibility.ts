import type { DeliveryConfirmation } from "@/lib/lex/requests";

type DeliveryResponseCandidate = Pick<
  DeliveryConfirmation,
  "status" | "recipient_user_id"
>;
type DeliveryNoteCandidate = Pick<DeliveryConfirmation, "metadata">;
type DeliveryAchievementCandidate = Pick<
  DeliveryConfirmation,
  "status" | "recipient_user_id"
>;

/**
 * The provider's delivery note is persisted in confirmation metadata. Resolve
 * it defensively so malformed legacy metadata never reaches requester-facing
 * copy as "[object Object]".
 */
export function deliveryConfirmationRequestNote(
  confirmation: DeliveryNoteCandidate | null | undefined,
): string | null {
  const value = confirmation?.metadata?.notes;
  if (typeof value !== "string") return null;
  const note = value.trim();
  return note || null;
}

/**
 * Mirrors the server's response boundary: request-edit capability admits the
 * route, while the persisted recipient is the record-level authorization.
 */
export function canRespondToDeliveryConfirmation(
  confirmation: DeliveryResponseCandidate,
  currentUserId: string | null | undefined,
  canEditRequest: boolean,
  contractFlow = false,
): boolean {
  const expectedStatus = contractFlow ? "achieved" : "requested";
  return Boolean(
    canEditRequest &&
    currentUserId &&
    confirmation.status === expectedStatus &&
    confirmation.recipient_user_id === currentUserId,
  );
}

/**
 * Contract completion is deliberately maker-checker: the actor needs
 * contract-edit capability and neither the requester nor delegated delivery
 * recipient may mark the legal work achieved. Requester final notes come later.
 */
export function canAchieveDeliveryConfirmation(
  confirmation: DeliveryAchievementCandidate,
  currentUserId: string | null | undefined,
  requesterUserId: string,
  canEditContract: boolean,
): boolean {
  return Boolean(
    canEditContract &&
    currentUserId &&
    currentUserId !== requesterUserId &&
    currentUserId !== confirmation.recipient_user_id &&
    confirmation.status === "requested",
  );
}
