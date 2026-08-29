import { describe, expect, it } from "vitest";
import type { ExecutionStateView } from "@/lib/lex/requests";
import { resolveExecutionPrimaryAction } from "./request-action-bar";

function executionView({
  status = "awaiting_completeness",
  completenessConfirmed = false,
  clockStarted = false,
  delivered = false,
  outstanding = 0,
  openDelivery = false,
  deliveryStatus = "requested",
}: {
  status?: "awaiting_completeness" | "in_progress" | "delivered";
  completenessConfirmed?: boolean;
  clockStarted?: boolean;
  delivered?: boolean;
  outstanding?: number;
  openDelivery?: boolean;
  deliveryStatus?: "requested" | "achieved";
} = {}): ExecutionStateView {
  const timestamp = "2026-07-22T10:00:00Z";
  const tenantId = "tenant-1";
  const requestId = "request-1";

  return {
    state: {
      id: "execution-1",
      tenant_id: tenantId,
      legal_request_id: requestId,
      status,
      completeness_confirmed_at: completenessConfirmed ? timestamp : null,
      clock_started_at: clockStarted ? timestamp : null,
      sla_target_seconds: null,
      working_calendar_id: null,
      review_round_count: 0,
      max_review_rounds: 2,
      cloned_from_request_id: null,
      clone_request_id: null,
      delivered_at: delivered ? "2026-07-22T11:00:00Z" : null,
      closed_at: null,
      metadata: {},
      created_at: timestamp,
      updated_at: timestamp,
    },
    requirements: Array.from({ length: outstanding }, (_, index) => ({
      id: `requirement-${index}`,
      tenant_id: tenantId,
      legal_request_id: requestId,
      code: `requirement_${index}`,
      label: { en: `Requirement ${index}`, ar: `المتطلب ${index}` },
      kind: "data" as const,
      required: true,
      satisfied: false,
      sort_order: index,
      metadata: {},
      created_at: timestamp,
      updated_at: timestamp,
    })),
    review_rounds: [],
    delivery_confirmations: openDelivery
      ? [
          {
            id: "delivery-1",
            tenant_id: tenantId,
            legal_request_id: requestId,
            status: deliveryStatus,
            requested_by: "officer-1",
            recipient_user_id: "requester-1",
            requested_at: timestamp,
            auto_close_at: "2026-07-23T10:00:00Z",
            metadata: {},
            created_at: timestamp,
            updated_at: timestamp,
          },
        ]
      : [],
  };
}

describe("resolveExecutionPrimaryAction", () => {
  it("offers completeness while execution is still awaiting completeness", () => {
    expect(resolveExecutionPrimaryAction(executionView()).kind).toBe(
      "confirm_completeness",
    );
  });

  it("offers record delivery after completeness starts execution", () => {
    const result = resolveExecutionPrimaryAction(
      executionView({
        status: "in_progress",
        completenessConfirmed: true,
        clockStarted: true,
      }),
    );

    expect(result.kind).toBe("record_delivery");
  });

  it("opens delivery management after delivery has been recorded", () => {
    expect(
      resolveExecutionPrimaryAction(
        executionView({ status: "delivered", openDelivery: true }),
      ).kind,
    ).toBe("manage_delivery");
  });

  it("keeps contract delivery in management after achievement while final notes are pending", () => {
    expect(
      resolveExecutionPrimaryAction(
        executionView({
          openDelivery: true,
          deliveryStatus: "achieved",
        }),
      ).kind,
    ).toBe("manage_delivery");
  });

  it("routes outstanding requirements to the execution panel", () => {
    expect(
      resolveExecutionPrimaryAction(executionView({ outstanding: 2 })),
    ).toEqual({
      kind: "outstanding",
      outstandingCount: 2,
    });
  });
});
