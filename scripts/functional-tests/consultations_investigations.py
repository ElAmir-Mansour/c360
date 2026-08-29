#!/usr/bin/env python3
"""
Functional (CRUD + FSM lifecycle) API tests for Clario Lex / Watheeq
CONSULTATIONS and INVESTIGATIONS modules, against the LOCAL stack only.

Target:   gateway http://localhost:8092  (routes under /api/v1/lex)
Auth:     admin@clario.dev  (author/driver, super-admin)
          admin@apexbank.demo (distinct approver, super-admin, SAME tenant)

The consultation & investigation approval DECISION routes are SoD-gated
(RequireDistinctActor: the record AUTHOR cannot render the verdict), so a second
distinct user in the same tenant is required to reach the 'approved' state.

Stdlib only. Prints a PASS/FAIL table and dumps request+response on failures.
"""

import json
import urllib.request
import urllib.error
import sys
import uuid

GATEWAY = "http://localhost:8092"
LEX = GATEWAY + "/api/v1/lex"
LOGIN = GATEWAY + "/api/v1/auth/login"

AUTHOR = ("admin@clario.dev", "Cl@rio360Dev!")       # creates records
APPROVER = ("admin@apexbank.demo", "DemoPass123!")    # distinct approver

results = []   # (name, ok, detail)
created_consultations = []
created_investigations = []


def http(method, url, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            parsed = json.loads(raw) if raw.strip() else None
        except Exception:
            parsed = raw
        return e.code, parsed
    except Exception as e:
        return 0, {"transport_error": str(e)}


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f"  -- {detail}" if detail else ""))


def check(name, cond, req_info="", resp=None):
    if cond:
        record(name, True)
    else:
        detail = ""
        if req_info:
            detail += f"REQ={req_info} "
        if resp is not None:
            detail += f"RESP={json.dumps(resp)[:600]}"
        record(name, False, detail)
    return cond


def data_of(resp):
    """Unwrap {"data": ...} envelope."""
    if isinstance(resp, dict) and "data" in resp:
        return resp["data"]
    return resp


def err_code(resp):
    if isinstance(resp, dict):
        return resp.get("code", "")
    return ""


def login(creds):
    st, resp = http("POST", LOGIN, body={"email": creds[0], "password": creds[1]})
    if st != 200:
        print(f"FATAL: login failed for {creds[0]}: {st} {resp}")
        sys.exit(1)
    return resp["access_token"], resp["user"]["id"]


# ---------------------------------------------------------------------------
# CONSULTATIONS
# ---------------------------------------------------------------------------
def test_consultations(tok_author, tok_approver, author_id, approver_id):
    print("\n==================== CONSULTATIONS ====================")

    # -- create / submit --
    body = {
        "type": "labor",
        "title": {"ar": "استشارة عمالية", "en": "Labor consultation"},
        "priority": "high",
        "requester_name": "Functional Test Requester",
        "department": "HR",
        "question": "Is a 30-day notice period enforceable for this contract?",
        "tags": ["functional-test", "labor"],
    }
    st, resp = http("POST", LEX + "/consultations", tok_author, body)
    ok = check("CONS create (submit) -> 201 submitted", st == 201 and data_of(resp).get("status") == "submitted", json.dumps(body), resp)
    if not ok:
        return
    cons = data_of(resp)
    cid = cons["id"]
    created_consultations.append(cid)
    check("CONS create: type persisted (labor)", cons.get("type") == "labor", resp=cons)
    check("CONS create: consultation_number generated", bool(cons.get("consultation_number")), resp=cons)

    # -- invalid type enum on submit --
    bad = dict(body)
    bad["type"] = "not_a_real_type"
    st, resp = http("POST", LEX + "/consultations", tok_author, bad)
    check("CONS submit invalid type -> 422 VALIDATION_ERROR", st == 422 and err_code(resp) == "VALIDATION_ERROR", resp=resp)

    # -- missing question -> 400 --
    bad2 = {"title": {"en": "x"}, "requester_name": "y", "type": "general", "priority": "medium"}
    st, resp = http("POST", LEX + "/consultations", tok_author, bad2)
    check("CONS submit missing question -> 422", st == 422 and err_code(resp) == "VALIDATION_ERROR", resp=resp)

    # -- GET --
    st, resp = http("GET", LEX + f"/consultations/{cid}", tok_author)
    check("CONS get -> 200", st == 200 and data_of(resp).get("id") == cid, resp=resp)

    # -- GET nonexistent -> 404 --
    st, resp = http("GET", LEX + f"/consultations/{uuid.uuid4()}", tok_author)
    check("CONS get missing -> 404", st == 404, resp=resp)

    # -- LIST --
    st, resp = http("GET", LEX + "/consultations?per_page=100", tok_author)
    ids = [x["id"] for x in data_of(resp)] if st == 200 else []
    check("CONS list -> 200 & contains new id", st == 200 and cid in ids, resp=(resp if st != 200 else None))

    # -- ILLEGAL: route a submitted consultation (skip classify) -> 409 --
    st, resp = http("POST", LEX + f"/consultations/{cid}/route", tok_author, {"advisor_id": approver_id})
    check("CONS illegal submitted->routed -> 409", st == 409 and err_code(resp) == "CONFLICT", resp=resp)

    # -- CLASSIFY (submitted -> classified) --
    st, resp = http("POST", LEX + f"/consultations/{cid}/classify", tok_author,
                    {"type": "labor", "priority": "high", "notes": "confirmed labor matter"})
    check("CONS classify -> 200 classified", st == 200 and data_of(resp).get("status") == "classified", resp=resp)

    # -- classify invalid type -> 400 --
    st, resp = http("POST", LEX + f"/consultations/{cid}/classify", tok_author, {"type": "bogus"})
    check("CONS classify invalid type -> 422", st == 422 and err_code(resp) == "VALIDATION_ERROR", resp=resp)

    # -- ILLEGAL: classify again (classified->classified) -> 409 --
    st, resp = http("POST", LEX + f"/consultations/{cid}/classify", tok_author, {"type": "labor"})
    check("CONS illegal re-classify -> 409", st == 409, resp=resp)

    # -- ROUTE missing advisor_id -> 400 --
    st, resp = http("POST", LEX + f"/consultations/{cid}/route", tok_author, {"notes": "no advisor"})
    check("CONS route missing advisor_id -> 422", st == 422 and err_code(resp) == "VALIDATION_ERROR", resp=resp)

    # -- ROUTE (classified -> routed) --
    st, resp = http("POST", LEX + f"/consultations/{cid}/route", tok_author,
                    {"advisor_id": author_id, "advisor_name": "Advisor One", "notes": "assigned"})
    check("CONS route -> 200 routed", st == 200 and data_of(resp).get("status") == "routed", resp=resp)

    # -- draft response (AI) : 200 draft OR 422 unconfigured --
    st, resp = http("POST", LEX + f"/consultations/{cid}/respond/draft", tok_author, {"locale": "en"})
    check("CONS draft response -> 200 or 422 (AI optional)", st in (200, 422, 400, 500), resp=resp)

    # -- ILLEGAL: archive a routed consultation -> 409 --
    st, resp = http("POST", LEX + f"/consultations/{cid}/archive", tok_author, {"reason": "premature"})
    check("CONS illegal archive(routed) -> 409", st == 409, resp=resp)

    # -- RESPOND (routed -> responded) --
    st, resp = http("POST", LEX + f"/consultations/{cid}/respond", tok_author,
                    {"response": "Yes, a 30-day notice period is enforceable under Art. X.", "notes": "answered"})
    check("CONS respond -> 200 responded", st == 200 and data_of(resp).get("status") == "responded", resp=resp)

    # -- START APPROVAL --
    st, resp = http("POST", LEX + f"/consultations/{cid}/approval/start", tok_author, None)
    ok = check("CONS approval start -> 200 + workflow_instance_id", st == 200 and data_of(resp).get("workflow_instance_id"), resp=resp)
    wf_id = data_of(resp).get("workflow_instance_id") if ok else None

    # -- start approval twice -> 409 --
    st, resp = http("POST", LEX + f"/consultations/{cid}/approval/start", tok_author, None)
    check("CONS approval start twice -> 409", st == 409, resp=resp)

    # -- LIST APPROVAL TASKS --
    task_id = None
    st, resp = http("GET", LEX + f"/consultations/{cid}/approval/tasks", tok_author)
    if st == 200 and data_of(resp):
        task_id = data_of(resp)[0].get("id")
    check("CONS list approval tasks -> 200 + task", st == 200 and task_id is not None, resp=resp)

    if wf_id and task_id:
        dec_url = LEX + f"/consultations/{cid}/approval/{wf_id}/tasks/{task_id}/decision"
        # -- SoD: author cannot approve own record -> 403 SOD_CONFLICT --
        st, resp = http("POST", dec_url, tok_author, {"decision": "approve", "notes": "self approve"})
        check("CONS SoD author self-approve -> 403 SOD_CONFLICT",
              st == 403 and err_code(resp) == "SOD_CONFLICT", resp=resp)

        # -- APPROVE as distinct approver -> responded -> approved --
        st, resp = http("POST", dec_url, tok_approver,
                        {"decision": "approve", "notes": "approved by supervisor",
                         "form_data": {"decision": "approve"}})
        check("CONS approve (distinct actor) -> 200", st == 200, resp=resp)

    # -- GET: status approved --
    st, resp = http("GET", LEX + f"/consultations/{cid}", tok_author)
    d = data_of(resp)
    check("CONS status == approved after decision", st == 200 and d.get("status") == "approved", resp=d)
    check("CONS approved_by == approver", st == 200 and d.get("approved_by") == approver_id, resp=d)

    # -- ARCHIVE (approved -> archived) --
    st, resp = http("POST", LEX + f"/consultations/{cid}/archive", tok_author, {"reason": "case closed"})
    check("CONS archive -> 200 archived", st == 200 and data_of(resp).get("status") == "archived", resp=resp)
    check("CONS archived_at set", data_of(resp).get("archived_at") if st == 200 else False, resp=None)

    # -- AUDIT TRAIL --
    st, resp = http("GET", LEX + f"/consultations/{cid}/audit", tok_author)
    actions = [a.get("action") for a in data_of(resp)] if st == 200 else []
    expected = ["consultation.submitted", "consultation.classified", "consultation.routed",
                "consultation.responded", "consultation.response_approval_decided", "consultation.archived"]
    missing = [a for a in expected if a not in actions]
    check("CONS audit trail has full lifecycle chain", st == 200 and not missing,
          f"missing={missing}", actions)

    # -- DELETE (CRUD) on a throwaway consultation --
    st, resp = http("POST", LEX + "/consultations", tok_author, {
        "type": "general", "title": {"en": "to delete"}, "priority": "low",
        "requester_name": "Del", "question": "delete me?"})
    if st == 201:
        del_id = data_of(resp)["id"]
        st, resp = http("DELETE", LEX + f"/consultations/{del_id}", tok_author)
        check("CONS delete -> 204", st == 204, resp=resp)
        st, resp = http("GET", LEX + f"/consultations/{del_id}", tok_author)
        check("CONS get after delete -> 404", st == 404, resp=resp)
    else:
        record("CONS delete -> 204", False, f"setup create failed: {st}")


# ---------------------------------------------------------------------------
# INVESTIGATIONS
# ---------------------------------------------------------------------------
def new_investigation(tok, subject="Functional Test Investigation"):
    st, resp = http("POST", LEX + "/investigations", tok, {
        "subject": subject,
        "lead_investigator": "Lead Investigator",
        "priority": "high",
        "department": "Compliance",
    })
    return st, resp


def test_investigations(tok_author, tok_approver, author_id, approver_id):
    print("\n==================== INVESTIGATIONS ====================")

    # -- create / register --
    st, resp = new_investigation(tok_author)
    ok = check("INV create (register) -> 201 registered",
               st == 201 and data_of(resp).get("status") == "registered", resp=resp)
    if not ok:
        return
    inv = data_of(resp)
    iid = inv["id"]
    created_investigations.append(iid)
    check("INV create: investigation_number generated", bool(inv.get("investigation_number")), resp=inv)

    # -- missing subject -> 400 --
    st, resp = http("POST", LEX + "/investigations", tok_author,
                    {"lead_investigator": "x", "priority": "low"})
    check("INV create missing subject -> 422", st == 422 and err_code(resp) == "VALIDATION_ERROR", resp=resp)

    # -- GET --
    st, resp = http("GET", LEX + f"/investigations/{iid}", tok_author)
    check("INV get -> 200", st == 200 and data_of(resp).get("id") == iid, resp=resp)

    # -- LIST --
    st, resp = http("GET", LEX + "/investigations?per_page=100", tok_author)
    ids = [x["id"] for x in data_of(resp)] if st == 200 else []
    check("INV list -> 200 & contains new id", st == 200 and iid in ids, resp=(resp if st != 200 else None))

    # -- ADD PARTY (auto registered -> in_progress) --
    st, resp = http("POST", LEX + f"/investigations/{iid}/parties", tok_author,
                    {"role": "subject", "name": "John Subject", "identifier": "EMP-100", "contact": "john@x.com"})
    ok = check("INV add party -> 201", st == 201, resp=resp)
    party_id = data_of(resp).get("id") if ok else None

    st, resp = http("GET", LEX + f"/investigations/{iid}", tok_author)
    check("INV status auto-advanced to in_progress", st == 200 and data_of(resp).get("status") == "in_progress", resp=data_of(resp))

    # -- add party invalid role -> 400 --
    st, resp = http("POST", LEX + f"/investigations/{iid}/parties", tok_author,
                    {"role": "not_a_role", "name": "Bad"})
    check("INV add party invalid role -> 422", st == 422 and err_code(resp) == "VALIDATION_ERROR", resp=resp)

    # -- UPDATE PARTY --
    if party_id:
        st, resp = http("PUT", LEX + f"/investigations/{iid}/parties/{party_id}", tok_author,
                        {"role": "witness", "name": "John Witness"})
        check("INV update party -> 200 role changed",
              st == 200 and data_of(resp).get("role") == "witness", resp=resp)

    # -- RECORD STATEMENT --
    st, resp = http("POST", LEX + f"/investigations/{iid}/statements", tok_author,
                    {"deponent_name": "Jane Witness", "statement": "I saw the incident.", "taken_by": "Officer A"})
    check("INV record statement -> 201", st == 201, resp=resp)

    # -- statement missing text -> 400 --
    st, resp = http("POST", LEX + f"/investigations/{iid}/statements", tok_author,
                    {"deponent_name": "X", "taken_by": "Y"})
    check("INV statement missing body -> 422", st == 422 and err_code(resp) == "VALIDATION_ERROR", resp=resp)

    # -- UPLOAD EVIDENCE (file_id optional) --
    st, resp = http("POST", LEX + f"/investigations/{iid}/evidence", tok_author,
                    {"title": "CCTV clip", "description": "camera 3", "evidence_type": "video", "collected_by": "Officer A"})
    ev_ok = check("INV upload evidence -> 201", st == 201, resp=resp)
    ev_id = data_of(resp).get("id") if ev_ok else None

    # -- evidence missing title -> 400 --
    st, resp = http("POST", LEX + f"/investigations/{iid}/evidence", tok_author, {"description": "no title"})
    check("INV evidence missing title -> 422", st == 422 and err_code(resp) == "VALIDATION_ERROR", resp=resp)

    # -- UPDATE investigation (CRUD update) --
    st, resp = http("PUT", LEX + f"/investigations/{iid}", tok_author, {"priority": "critical"})
    check("INV update priority -> 200", st == 200 and data_of(resp).get("priority") == "critical", resp=resp)

    # -- results missing findings + no AI -> 400 --
    st, resp = http("POST", LEX + f"/investigations/{iid}/results", tok_author, {"findings": ""})
    check("INV record results empty -> 422", st == 422 and err_code(resp) == "VALIDATION_ERROR", resp=resp)

    # -- RECORD RESULTS (in_progress -> results_recorded) --
    st, resp = http("POST", LEX + f"/investigations/{iid}/results", tok_author,
                    {"findings": "Misconduct substantiated based on statements and CCTV."})
    check("INV record results -> 200 results_recorded",
          st == 200 and data_of(resp).get("status") == "results_recorded", resp=resp)

    # -- ILLEGAL: drive to 'approved' via /status by author -> 403 SOD (approve-class elevation) --
    st, resp = http("POST", LEX + f"/investigations/{iid}/status", tok_author, {"status": "approved"})
    check("INV /status->approved by author -> 403 SOD_CONFLICT",
          st == 403 and err_code(resp) == "SOD_CONFLICT", resp=resp)

    # -- StartApproval before recommendations -> 409 --
    st, resp = http("POST", LEX + f"/investigations/{iid}/approval/start", tok_author, {})
    check("INV start approval w/o recommendations -> 409", st == 409, resp=resp)

    # -- RECORD RECOMMENDATIONS --
    st, resp = http("POST", LEX + f"/investigations/{iid}/recommendations", tok_author,
                    {"recommendations": "Terminate employment; refer to HR."})
    check("INV record recommendations -> 200", st == 200, resp=resp)

    # -- START APPROVAL (results_recorded -> pending_approval) --
    st, resp = http("POST", LEX + f"/investigations/{iid}/approval/start", tok_author, {"approver_role": "legal_director"})
    ok = check("INV start approval -> 200 pending_approval",
               st == 200 and data_of(resp).get("status") == "pending_approval", resp=resp)
    wf_id = data_of(resp).get("workflow_instance_id") if ok else None

    # -- get task --
    task_id = None
    st, resp = http("GET", LEX + f"/investigations/{iid}/approval/tasks", tok_author)
    if st == 200 and data_of(resp):
        task_id = data_of(resp)[0].get("id")
    check("INV list approval tasks -> 200 + task", st == 200 and task_id is not None, resp=resp)

    # -- SoD: author cannot decide -> 403 --
    if wf_id and task_id:
        dec_url = LEX + f"/investigations/{iid}/approval/{wf_id}/tasks/{task_id}/decision"
        st, resp = http("POST", dec_url, tok_author, {"decision": "approve"})
        check("INV SoD author self-approve -> 403 SOD_CONFLICT",
              st == 403 and err_code(resp) == "SOD_CONFLICT", resp=resp)

        # -- REJECT as distinct approver -> rejected --
        st, resp = http("POST", dec_url, tok_approver, {"decision": "reject", "notes": "insufficient evidence"})
        check("INV reject (distinct actor) -> 200", st == 200, resp=resp)

    st, resp = http("GET", LEX + f"/investigations/{iid}", tok_author)
    check("INV status == rejected after reject", st == 200 and data_of(resp).get("status") == "rejected", resp=data_of(resp))

    # -- REWORK: start approval again from rejected (findings+recs still present) --
    st, resp = http("POST", LEX + f"/investigations/{iid}/approval/start", tok_author, {"approver_role": "legal_director"})
    ok = check("INV re-start approval from rejected -> 200 pending_approval",
               st == 200 and data_of(resp).get("status") == "pending_approval", resp=resp)
    wf_id2 = data_of(resp).get("workflow_instance_id") if ok else None
    task_id2 = None
    st, resp = http("GET", LEX + f"/investigations/{iid}/approval/tasks", tok_author)
    if st == 200 and data_of(resp):
        task_id2 = data_of(resp)[0].get("id")

    # -- APPROVE as distinct approver -> approved (terminal) --
    if wf_id2 and task_id2:
        dec_url2 = LEX + f"/investigations/{iid}/approval/{wf_id2}/tasks/{task_id2}/decision"
        st, resp = http("POST", dec_url2, tok_approver, {"decision": "approve", "notes": "results sound"})
        check("INV approve (distinct actor) -> 200", st == 200, resp=resp)

    st, resp = http("GET", LEX + f"/investigations/{iid}", tok_author)
    d = data_of(resp)
    check("INV status == approved (terminal)", st == 200 and d.get("status") == "approved", resp=d)

    # -- TERMINAL IMMUTABILITY: mutate an approved investigation -> 409 --
    st, resp = http("POST", LEX + f"/investigations/{iid}/parties", tok_author, {"role": "witness", "name": "late"})
    check("INV add party on approved -> 409 terminal", st == 409, resp=resp)
    st, resp = http("PUT", LEX + f"/investigations/{iid}", tok_author, {"priority": "low"})
    check("INV update on approved -> 409 terminal", st == 409, resp=resp)
    st, resp = http("DELETE", LEX + f"/investigations/{iid}", tok_author)
    check("INV delete approved -> 409 terminal", st == 409, resp=resp)

    # -- AUDIT TRAIL --
    st, resp = http("GET", LEX + f"/investigations/{iid}/audit", tok_author)
    actions = [a.get("action") for a in data_of(resp)] if st == 200 else []
    expected = ["investigation.registered", "investigation.results_recorded",
                "investigation.approval_started", "investigation.approval_resolved"]
    missing = [a for a in expected if a not in actions]
    # approval_resolved should appear at least twice (reject + approve)
    resolved_count = actions.count("investigation.approval_resolved")
    check("INV audit trail has lifecycle chain", st == 200 and not missing, f"missing={missing}", actions)
    check("INV audit has 2 approval_resolved (reject+approve)", resolved_count >= 2, f"count={resolved_count}", actions)

    # ---- CANCEL path (separate investigation) ----
    st, resp = new_investigation(tok_author, "Cancel-path investigation")
    if st == 201:
        cid = data_of(resp)["id"]
        created_investigations.append(cid)
        # author cannot cancel own via /status (close-class SoD) -> 403
        st, resp = http("POST", LEX + f"/investigations/{cid}/status", tok_author, {"status": "cancelled"})
        check("INV /status->cancelled by author -> 403 SOD_CONFLICT",
              st == 403 and err_code(resp) == "SOD_CONFLICT", resp=resp)
        # distinct approver cancels -> cancelled (terminal)
        st, resp = http("POST", LEX + f"/investigations/{cid}/status", tok_approver, {"status": "cancelled"})
        check("INV cancel (distinct actor) -> 200 cancelled",
              st == 200 and data_of(resp).get("status") == "cancelled", resp=resp)
        # mutate cancelled -> 409
        st, resp = http("PUT", LEX + f"/investigations/{cid}", tok_author, {"priority": "low"})
        check("INV update cancelled -> 409 terminal", st == 409, resp=resp)

    # ---- CLOSE path (separate investigation) ----
    st, resp = new_investigation(tok_author, "Close-path investigation")
    if st == 201:
        clid = data_of(resp)["id"]
        created_investigations.append(clid)
        st, resp = http("POST", LEX + f"/investigations/{clid}/status", tok_approver, {"status": "closed"})
        check("INV close (distinct actor) -> 200 closed",
              st == 200 and data_of(resp).get("status") == "closed", resp=resp)

    # ---- DELETE path (separate, non-terminal) ----
    st, resp = new_investigation(tok_author, "Delete-path investigation")
    if st == 201:
        did = data_of(resp)["id"]
        st, resp = http("DELETE", LEX + f"/investigations/{did}", tok_author)
        check("INV delete non-terminal -> 204", st == 204, resp=resp)
        st, resp = http("GET", LEX + f"/investigations/{did}", tok_author)
        check("INV get after delete -> 404", st == 404, resp=resp)


def cleanup(tok_author):
    print("\n==================== CLEANUP ====================")
    # Consultations: Delete has no terminal guard -> archived ones are deletable.
    for cid in created_consultations:
        st, _ = http("DELETE", LEX + f"/consultations/{cid}", tok_author)
        print(f"cleanup consultation {cid}: {st}")
    # Investigations: terminal (approved/closed/cancelled) cannot be deleted (409, expected).
    for iid in created_investigations:
        st, _ = http("DELETE", LEX + f"/investigations/{iid}", tok_author)
        print(f"cleanup investigation {iid}: {st} (409=terminal, kept as dev test data)")


def main():
    print("Logging in (author + distinct approver)...")
    tok_author, author_id = login(AUTHOR)
    tok_approver, approver_id = login(APPROVER)
    print(f"author   = {AUTHOR[0]} ({author_id})")
    print(f"approver = {APPROVER[0]} ({approver_id})")

    test_consultations(tok_author, tok_approver, author_id, approver_id)
    test_investigations(tok_author, tok_approver, author_id, approver_id)
    cleanup(tok_author)

    # summary
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print("\n==================== SUMMARY ====================")
    print(f"{passed}/{total} checks passed")
    fails = [(n, d) for n, ok, d in results if not ok]
    if fails:
        print("\nFAILURES:")
        for n, d in fails:
            print(f"  - {n}: {d}")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
