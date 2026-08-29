import { describe, expect, it } from "vitest";
import type { LexDocument } from "@/types/suites";
import {
  buildFallbackEditorSession,
  coerceEditorMode,
  normalizeEditorSessionResponse,
} from "./editor-session";

const doc = {
  id: "doc-1",
  tenant_id: "tenant-1",
  title: "Vendor MSA",
  type: "template",
  description: "Editable agreement.",
  file_id: "file-1",
  file_name: "vendor-msa.docx",
  confidentiality: "confidential",
  current_version: 7,
  status: "active",
  tags: ["vendor"],
  metadata: {},
  created_by: "u-1",
  created_at: "2026-06-25T09:00:00Z",
  updated_at: "2026-06-26T09:00:00Z",
} satisfies LexDocument;

describe("Lex Word editor session normalization", () => {
  it("coerces supported route modes and falls back to view", () => {
    expect(coerceEditorMode("EDIT")).toBe("edit");
    expect(coerceEditorMode("comment")).toBe("comment");
    expect(coerceEditorMode("redline")).toBe("view");
    expect(coerceEditorMode(null)).toBe("view");
  });

  it("normalizes provider, lock, autosave, review, clause, and audit state", () => {
    const session = normalizeEditorSessionResponse(
      {
        data: {
          editor_session: {
            session_id: "session-1",
            document_id: "doc-1",
            mode: "edit",
            available_modes: ["view", "comment", "edit"],
            provider: "Only Office",
            editor_provider: {
              iframe_url: "https://office.example.test/editor/doc-1",
              status: "healthy",
              capabilities: ["comments", "track_changes", 123],
            },
            lock: {
              status: "mine",
              holder_name: "Aisha Counsel",
              holder_email: "aisha@example.test",
              checked_out_at: "2026-06-26T10:00:00Z",
              expires_at: "2026-06-26T10:30:00Z",
              can_check_out: false,
            },
            autosave: {
              status: "dirty",
              last_saved_at: "2026-06-26T10:05:00Z",
              recovery_point_at: "2026-06-26T10:04:00Z",
              conflict_count: 2,
            },
            current_version: "7",
            latest_snapshot_at: "2026-06-26T09:59:00Z",
            pending_changes: "3",
            snapshot_allowed: true,
            comments: {
              total: 2,
              unresolved: 1,
              threads: [
                {
                  id: "comment-1",
                  author_name: "Reviewer One",
                  body: "Clarify indemnity cap.",
                  status: "open",
                },
              ],
            },
            track_changes: {
              enabled: true,
              changes: [
                {
                  id: "change-1",
                  author_name: "Reviewer Two",
                  summary: "Inserted audit-trail clause.",
                  status: "pending",
                },
              ],
            },
            clause_library: {
              recommendations: [
                {
                  clause_id: "clause-1",
                  clause_title: "Audit rights",
                  category: "governance",
                  score: 0.91,
                  explanation: "Matches vendor-risk playbook.",
                },
              ],
            },
            audit: [
              {
                id: "audit-1",
                actor_name: "Aisha Counsel",
                action: "editor.lock_acquired",
                created_at: "2026-06-26T10:00:00Z",
                detail: "Checked out for negotiation.",
              },
            ],
          },
          document: {
            id: "doc-1",
            title: "Vendor MSA",
            file_name: "vendor-msa.docx",
            type: "contract",
            confidentiality: "confidential",
            status: "active",
            current_version: 7,
            updated_at: "2026-06-26T09:00:00Z",
          },
        },
      },
      "doc-1",
      "edit",
    );

    expect(session).toMatchObject({
      sessionId: "session-1",
      documentId: "doc-1",
      mode: "edit",
      readOnly: false,
      document: {
        title: "Vendor MSA",
        fileName: "vendor-msa.docx",
        currentVersion: 7,
      },
      provider: {
        provider: "onlyoffice",
        label: "OnlyOffice",
        status: "ready",
        hasConfig: true,
        iframeUrl: "https://office.example.test/editor/doc-1",
        capabilities: ["comments", "track_changes"],
      },
      lock: {
        status: "locked_by_me",
        holderName: "Aisha Counsel",
        holderEmail: "aisha@example.test",
        canCheckOut: false,
      },
      autosave: {
        status: "pending",
        conflictCount: 2,
      },
      version: {
        currentVersion: 7,
        latestSnapshotAt: "2026-06-26T09:59:00Z",
        pendingChanges: 3,
        snapshotAllowed: true,
      },
    });
    expect(session.comments).toMatchObject({
      total: 2,
      unresolved: 1,
      threads: [
        { authorName: "Reviewer One", excerpt: "Clarify indemnity cap." },
      ],
    });
    expect(session.trackChanges).toMatchObject({
      enabled: true,
      total: 1,
      changes: [
        { authorName: "Reviewer Two", summary: "Inserted audit-trail clause." },
      ],
    });
    expect(session.clauseLibrary.recommendations).toEqual([
      {
        id: "clause-1",
        title: "Audit rights",
        category: "governance",
        confidence: 0.91,
        reason: "Matches vendor-risk playbook.",
      },
    ]);
    expect(session.audit).toEqual([
      {
        id: "audit-1",
        actorName: "Aisha Counsel",
        action: "editor.lock_acquired",
        createdAt: "2026-06-26T10:00:00Z",
        detail: "Checked out for negotiation.",
      },
    ]);
  });

  it("normalizes next-wave editor operations from workspace payloads", () => {
    const session = normalizeEditorSessionResponse(
      {
        data: {
          editor_session: {
            document_id: "doc-1",
            mode: "edit",
            provider: "onlyoffice",
            editor_provider: {
              iframe_url: "https://office.example.test/editor/doc-1",
            },
            editor_workspace: {
              provider_events: [
                {
                  id: "event-1",
                  provider: "onlyoffice",
                  event_type: "track_change_accepted",
                  status: "processed",
                },
              ],
              guest_portal: {
                active_links: 2,
                expired_links: 1,
                status: "ready",
                watermark_enabled: true,
              },
              automation_tasks: [
                {
                  id: "task-1",
                  title: "Resolve indemnity comment",
                  task_type: "comment",
                  status: "in_progress",
                  priority: "high",
                  owner_name: "Aisha Counsel",
                },
              ],
              clause_anchors: [
                {
                  id: "anchor-1",
                  label: "Clause 8.2",
                  section: "Indemnity",
                  status: "anchored",
                },
              ],
              redline_packages: [
                {
                  id: "pkg-1",
                  status: "ready",
                  package_type: "negotiation",
                  formats: ["docx", "pdf"],
                },
              ],
              approval_matrix: {
                status: "pending",
                gates: [
                  {
                    id: "gate-1",
                    name: "External sharing",
                    status: "pending",
                    required: true,
                    severity: "high",
                  },
                ],
              },
              compare_workspace: {
                id: "compare-1",
                base_label: "v6",
                target_label: "v7",
                status: "ready",
                changes_count: 14,
                material_changes_count: 3,
              },
              collaboration_inbox: {
                unread_count: 1,
                items: [
                  {
                    id: "inbox-1",
                    item_type: "mention",
                    title: "You were mentioned",
                    status: "unread",
                    priority: "medium",
                  },
                ],
              },
              playbook_rules: {
                links: [
                  {
                    id: "rule-1",
                    name: "Vendor MSA rules",
                    status: "active",
                    rule_count: 12,
                  },
                ],
              },
              term_repairs: {
                repairs: [
                  {
                    id: "repair-1",
                    term: "Services",
                    action: "define",
                    status: "suggested",
                    severity: "medium",
                  },
                ],
              },
              evidence_bindings: [
                {
                  id: "evidence-1",
                  title: "AI usage policy",
                  source_type: "policy",
                  status: "linked",
                  confidence: 0.88,
                },
              ],
              ai_change_safety: {
                enabled: true,
                mode: "approval_required",
                pending_proposals: 2,
                required_approvals: 1,
                blockers: ["Human approval required"],
              },
              offline_recovery: {
                status: "restore_available",
                queued_edits: 2,
                queued_comments: 1,
                conflict_count: 0,
              },
              editor_analytics: {
                cycle_time_hours: 36,
                revision_count: 5,
                unresolved_issue_count: 2,
                playbook_deviation_rate: 0.25,
                signature_readiness_trend: "improving",
              },
            },
          },
        },
      },
      "doc-1",
      "edit",
    );

    expect(session.providerEvents).toEqual([
      {
        id: "event-1",
        provider: "onlyoffice",
        eventType: "track_change_accepted",
        status: "processed",
        summary: undefined,
        createdAt: undefined,
      },
    ]);
    expect(session.guestPortal).toMatchObject({
      status: "ready",
      activeLinks: 2,
      expiredLinks: 1,
      watermarkEnabled: true,
    });
    expect(session.automationTasks[0]).toMatchObject({
      title: "Resolve indemnity comment",
      status: "in_progress",
      priority: "high",
      ownerName: "Aisha Counsel",
    });
    expect(session.clauseAnchors[0]).toMatchObject({
      label: "Clause 8.2",
      status: "anchored",
    });
    expect(session.redlinePackages[0]).toMatchObject({
      packageType: "negotiation",
      formats: ["docx", "pdf"],
    });
    expect(session.approvalMatrix).toMatchObject({
      status: "pending",
      gates: [{ name: "External sharing", status: "pending" }],
    });
    expect(session.compareWorkspaces[0]).toMatchObject({
      baseLabel: "v6",
      targetLabel: "v7",
      materialChangesCount: 3,
    });
    expect(session.collaborationInbox).toMatchObject({
      unreadCount: 1,
      items: [{ title: "You were mentioned", status: "unread" }],
    });
    expect(session.playbookRuleLinks[0]).toMatchObject({
      name: "Vendor MSA rules",
      status: "active",
      ruleCount: 12,
    });
    expect(session.termRepairActions[0]).toMatchObject({
      term: "Services",
      action: "define",
      status: "suggested",
    });
    expect(session.evidenceBindings[0]).toMatchObject({
      title: "AI usage policy",
      sourceType: "policy",
      status: "linked",
    });
    expect(session.aiChangeSafety).toMatchObject({
      enabled: true,
      mode: "approval_required",
      pendingProposals: 2,
    });
    expect(session.offlineRecovery).toMatchObject({
      status: "restore_available",
      queuedEdits: 2,
      queuedComments: 1,
    });
    expect(session.editorAnalytics).toMatchObject({
      cycleTimeHours: 36,
      revisionCount: 5,
      unresolvedIssueCount: 2,
      signatureReadinessTrend: "improving",
    });
  });

  it("builds a read-only fallback when provider configuration is unavailable", () => {
    const fallback = buildFallbackEditorSession(
      { ...doc, status: "archived" },
      "edit",
    );

    expect(fallback).toMatchObject({
      documentId: "doc-1",
      mode: "edit",
      readOnly: true,
      provider: {
        provider: "unconfigured",
        status: "unavailable",
        hasConfig: false,
      },
      lock: {
        status: "read_only",
        canCheckOut: false,
      },
      autosave: {
        status: "disabled",
        conflictCount: 0,
      },
      version: {
        currentVersion: 7,
        pendingChanges: 0,
        snapshotAllowed: false,
      },
    });
  });

  it("normalizes next-wave Word editor workspace contracts", () => {
    const session = normalizeEditorSessionResponse(
      {
        data: {
          editor_session: {
            session_id: "session-1",
            document_id: "doc-1",
            mode: "edit",
            provider: "onlyoffice",
            editor_provider: {
              iframe_url: "https://office.example.test/editor/doc-1",
              status: "healthy",
            },
            editor_workspace: {
              provider_events: {
                latest_event_type: "save",
                latest_status: "processed",
                events: [
                  {
                    id: "event-1",
                    provider: "onlyoffice",
                    event_type: "save",
                    status: "processed",
                  },
                ],
              },
              guest_portal: {
                status: "active",
                active_links: 1,
                watermark_enabled: true,
              },
              automation_tasks: {
                tasks: [
                  {
                    id: "task-1",
                    title: "Resolve limitation issue",
                    task_type: "legal_issue",
                    status: "open",
                  },
                ],
              },
              clause_anchors: {
                anchors: [
                  {
                    id: "anchor-1",
                    section_id: "section-1",
                    path: "1.1",
                    status: "current",
                  },
                ],
              },
              redline_packages: {
                latest_package_id: "package-1",
                status: "ready",
              },
              approval_matrix: {
                status: "pending",
                gates: [
                  {
                    id: "approval-1",
                    name: "External share approval",
                    status: "pending",
                  },
                ],
              },
              compare_workspace: {
                base_version: 6,
                comparison_version: 7,
                changed_sections: 4,
              },
              collaboration_inbox: {
                unread_count: 3,
                items: [{ id: "inbox-1", type: "mention", status: "unread" }],
              },
              playbook_rules: {
                rules: [
                  {
                    id: "rule-1",
                    name: "Liability cap approval",
                    severity: "high",
                  },
                ],
              },
              term_repair_actions: [
                {
                  id: "repair-1",
                  term: "Services",
                  action: "define",
                  status: "available",
                },
              ],
              citations: [
                {
                  id: "citation-1",
                  section_id: "section-1",
                  source_type: "policy",
                  source_id: "policy-1",
                },
              ],
              ai_change_safety: {
                mode: "approval_required",
                pending_proposals: 1,
              },
              offline_recovery: {
                status: "available",
                recovery_id: "recovery-1",
                queued_edits: 5,
              },
              editor_analytics: {
                cycle_time_hours: 18,
                revision_count: 7,
                playbook_deviation_rate: 0.18,
              },
            },
          },
          document: {
            id: "doc-1",
            title: "Vendor MSA",
            file_name: "vendor-msa.docx",
            current_version: 7,
          },
        },
      },
      "doc-1",
      "edit",
    );

    const normalized = session as unknown as Record<string, unknown>;
    const expectedKeys = [
      "providerEvents",
      "guestPortal",
      "automationTasks",
      "clauseAnchors",
      "redlinePackages",
      "approvalMatrix",
      "compareWorkspaces",
      "collaborationInbox",
      "playbookRuleLinks",
      "termRepairActions",
      "evidenceBindings",
      "aiChangeSafety",
      "offlineRecovery",
      "editorAnalytics",
    ];
    const missing = expectedKeys.filter((key) => !(key in normalized));
    expect(missing).toEqual([]);
    if (missing.length > 0) return;

    expect(normalized.providerEvents).toMatchObject({
      0: { eventType: "save", status: "processed" },
    });
    expect(normalized.guestPortal).toMatchObject({
      status: "ready",
      activeLinks: 1,
      watermarkEnabled: true,
    });
    expect(normalized.automationTasks).toMatchObject([
      { id: "task-1", taskType: "legal_issue", status: "open" },
    ]);
    expect(normalized.clauseAnchors).toMatchObject({
      0: { id: "anchor-1", section: "section-1" },
    });
    expect(normalized.approvalMatrix).toMatchObject({
      status: "pending",
      gates: [{ id: "approval-1", status: "pending" }],
    });
    expect(normalized.editorAnalytics).toMatchObject({
      cycleTimeHours: 18,
      revisionCount: 7,
    });
  });
});
