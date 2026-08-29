import { LexRouteGuard } from "../../_guards/lex-route-guard";
import { ApprovalQueueContent } from "./approval-queue-content";

export default function ApprovalQueuePage() {
  return (
    <LexRouteGuard route="/lex/approvals/requests">
      <ApprovalQueueContent />
    </LexRouteGuard>
  );
}
