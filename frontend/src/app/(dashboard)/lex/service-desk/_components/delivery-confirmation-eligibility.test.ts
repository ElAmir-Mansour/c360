import { describe, expect, it } from "vitest";
import {
  canAchieveDeliveryConfirmation,
  canRespondToDeliveryConfirmation,
  deliveryConfirmationRequestNote,
} from "./delivery-confirmation-eligibility";

const recipientId = "11111111-1111-1111-1111-111111111111";
const otherId = "22222222-2222-2222-2222-222222222222";

describe("canRespondToDeliveryConfirmation", () => {
  it("allows the intended recipient while the confirmation is requested", () => {
    expect(
      canRespondToDeliveryConfirmation(
        { status: "requested", recipient_user_id: recipientId },
        recipientId,
        true,
      ),
    ).toBe(true);
  });

  it("rejects unrelated and provider actors", () => {
    const confirmation = {
      status: "requested" as const,
      recipient_user_id: recipientId,
    };
    expect(canRespondToDeliveryConfirmation(confirmation, otherId, true)).toBe(
      false,
    );
    expect(
      canRespondToDeliveryConfirmation(confirmation, undefined, true),
    ).toBe(false);
  });

  it("rejects resolved confirmations and actors without request-edit access", () => {
    expect(
      canRespondToDeliveryConfirmation(
        { status: "confirmed", recipient_user_id: recipientId },
        recipientId,
        true,
      ),
    ).toBe(false);
    expect(
      canRespondToDeliveryConfirmation(
        { status: "requested", recipient_user_id: recipientId },
        recipientId,
        false,
      ),
    ).toBe(false);
  });

  it("allows contract requester response only after legal work is achieved", () => {
    expect(
      canRespondToDeliveryConfirmation(
        { status: "requested", recipient_user_id: recipientId },
        recipientId,
        true,
        true,
      ),
    ).toBe(false);
    expect(
      canRespondToDeliveryConfirmation(
        { status: "achieved", recipient_user_id: recipientId },
        recipientId,
        true,
        true,
      ),
    ).toBe(true);
  });
});

describe("canAchieveDeliveryConfirmation", () => {
  const requested = {
    status: "requested" as const,
    recipient_user_id: recipientId,
  };

  it("allows a distinct contracts operator before requester final close", () => {
    expect(
      canAchieveDeliveryConfirmation(requested, otherId, recipientId, true),
    ).toBe(true);
  });

  it("blocks the requester, resolved confirmations, and non-contract editors", () => {
    expect(
      canAchieveDeliveryConfirmation(
        requested,
        recipientId,
        recipientId,
        true,
      ),
    ).toBe(false);
    expect(
      canAchieveDeliveryConfirmation(
        { ...requested, status: "achieved" },
        otherId,
        recipientId,
        true,
      ),
    ).toBe(false);
    expect(
      canAchieveDeliveryConfirmation(
        requested,
        otherId,
        recipientId,
        false,
      ),
    ).toBe(false);
  });
});

describe("deliveryConfirmationRequestNote", () => {
  it("returns the trimmed provider note persisted in metadata", () => {
    expect(
      deliveryConfirmationRequestNote({
        metadata: { notes: "  Please review the attached delivery package.  " },
      }),
    ).toBe("Please review the attached delivery package.");
  });

  it("ignores empty and malformed legacy note metadata", () => {
    expect(
      deliveryConfirmationRequestNote({ metadata: { notes: "   " } }),
    ).toBeNull();
    expect(
      deliveryConfirmationRequestNote({
        metadata: { notes: { text: "invalid" } },
      }),
    ).toBeNull();
    expect(deliveryConfirmationRequestNote({ metadata: {} })).toBeNull();
  });
});
