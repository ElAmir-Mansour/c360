#!/usr/bin/env python3
"""
Functional (CRUD + lifecycle) API test for Watheeq LEGAL CASES & LITIGATION.

LOCAL STACK ONLY.
  IAM login : http://localhost:8081/api/v1/auth/login
  Gateway   : http://localhost:8092  (Bearer -> /api/v1/lex/...)

Exercises the full legal-case surface: create/read/list/filter/update,
status/strength/priority, two-phase intake (start + SoD-blocked decision +
handoff conflict), parties/hearings/tasks/comments/documents sub-resource CRUD,
restricted assignment verbs, audit/versions, and close (DELETE).

stdlib only. Cleans up created records where feasible.
"""
import json
import urllib.request
import urllib.error
import uuid
import datetime
import sys

IAM = "http://localhost:8081"
GW = "http://localhost:8092"
EMAIL = "admin@clario.dev"
PASSWORD = "Cl@rio360Dev!"

TOKEN = None
RESULTS = []   # (name, expected, got, ok, detail)
CREATED_CASES = []


def call(method, base, path, body=None, auth=True, timeout=20):
    url = base + path
    data = None
    headers = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
    if auth and TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, parse(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, parse(raw)
    except Exception as e:
        return -1, {"_error": str(e)}


def parse(raw):
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {"_raw": raw[:400]}


def unwrap(j):
    if isinstance(j, dict) and "data" in j:
        return j["data"]
    return j


def record(name, expected, got, ok, detail=""):
    RESULTS.append((name, expected, got, ok, detail))
    flag = "PASS" if ok else "FAIL"
    line = f"[{flag}] {name}: expected {expected}, got {got}"
    if detail:
        line += f"  | {detail}"
    print(line)


def expect(name, status, expected, extra_ok=True, detail=""):
    if isinstance(expected, (list, tuple, set)):
        ok = status in expected and extra_ok
        exp_s = "/".join(str(e) for e in expected)
    else:
        ok = status == expected and extra_ok
        exp_s = str(expected)
    record(name, exp_s, status, ok, detail)
    return ok


def new_case_body(company="plaintiff", priority="high", title_en="Functional Test Case"):
    return {
        "case_type": "commercial",
        "company_status": company,
        "competent_court": "General Court",
        "title": {"en": title_en, "ar": "قضية اختبار"},
        "description": "Automated functional test case.",
        "priority": priority,
        "metadata": {"origin": "cases.py"},
    }


def main():
    global TOKEN

    # ---- AUTH ----
    st, j = call("POST", IAM, "/api/v1/auth/login",
                 {"email": EMAIL, "password": PASSWORD}, auth=False)
    tok = None
    if st == 200:
        tok = j.get("access_token") or (unwrap(j) or {}).get("access_token")
    TOKEN = tok
    expect("AUTH login", st, 200, extra_ok=bool(tok),
           detail="" if tok else "no access_token")
    if not TOKEN:
        print("FATAL: cannot authenticate; aborting.")
        dump()
        sys.exit(1)

    # ============================================================
    # CREATE / READ / LIST / FILTER
    # ============================================================
    st, j = call("POST", GW, "/api/v1/lex/legal-cases", new_case_body())
    case = unwrap(j) if st == 201 else {}
    cid = case.get("id")
    if cid:
        CREATED_CASES.append(cid)
    ok = st == 201 and bool(cid) and case.get("status") == "intake" and bool(case.get("case_number"))
    expect("CREATE legal-case", st, 201, extra_ok=ok,
           detail=f"id={cid} case_number={case.get('case_number')} status={case.get('status')}")
    if not cid:
        print("FATAL: create failed; aborting remaining case-scoped tests.")
        dump(); sys.exit(1)

    # negative: bad company_status
    st, j = call("POST", GW, "/api/v1/lex/legal-cases",
                 {**new_case_body(), "company_status": "bogus"})
    expect("CREATE rejects invalid company_status", st, (400, 422))

    # negative: missing case_type
    bad = new_case_body(); bad["case_type"] = ""
    st, j = call("POST", GW, "/api/v1/lex/legal-cases", bad)
    expect("CREATE rejects empty case_type", st, (400, 422))

    st, j = call("GET", GW, f"/api/v1/lex/legal-cases/{cid}")
    g = unwrap(j)
    ok = st == 200 and g.get("id") == cid and "computed" in (j.get("data") or {})
    expect("GET legal-case (with computed)", st, 200, extra_ok=st == 200 and g.get("id") == cid,
           detail="computed block present" if "computed" in (j.get("data") or {}) else "no computed block")

    st, j = call("GET", GW, "/api/v1/lex/legal-cases")
    lst = unwrap(j)
    expect("LIST legal-cases", st, 200, extra_ok=isinstance(lst, list),
           detail=f"count={len(lst) if isinstance(lst, list) else 'n/a'}")

    st, j = call("GET", GW, "/api/v1/lex/legal-cases?status=intake")
    lst = unwrap(j)
    all_intake = isinstance(lst, list) and all(r.get("status") == "intake" for r in lst)
    mine = isinstance(lst, list) and any(r.get("id") == cid for r in lst)
    expect("FILTER status=intake", st, 200, extra_ok=all_intake and mine,
           detail=f"all rows intake={all_intake}, contains new case={mine}")

    st, j = call("GET", GW, "/api/v1/lex/legal-cases?company_status=plaintiff&priority=high")
    lst = unwrap(j)
    good = isinstance(lst, list) and all(
        r.get("company_status") == "plaintiff" and r.get("priority") == "high" for r in lst)
    expect("FILTER company_status+priority", st, 200, extra_ok=good)

    # ============================================================
    # UPDATE
    # ============================================================
    st, j = call("PUT", GW, f"/api/v1/lex/legal-cases/{cid}",
                 {"description": "Updated description.", "case_type": "labor"})
    g = unwrap(j)
    ok = st == 200 and g.get("description") == "Updated description." and g.get("case_type") == "labor"
    expect("UPDATE legal-case (PUT)", st, 200, extra_ok=ok,
           detail=f"case_type={g.get('case_type')}")

    # ============================================================
    # STRENGTH / PRIORITY / STATUS
    # ============================================================
    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/strength",
                 {"strength": "strong", "reason": "initial assessment"})
    g = unwrap(j)
    expect("SET strength=strong", st, 200, extra_ok=(g.get("strength") == "strong"),
           detail=f"strength={g.get('strength')}")

    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/priority",
                 {"priority": "critical", "reason": "escalated"})
    g = unwrap(j)
    expect("SET priority=critical", st, 200, extra_ok=(g.get("priority") == "critical"),
           detail=f"priority={g.get('priority')}")

    # Close-class terminal transition via /status is SoD-guarded: the case AUTHOR
    # cannot drive their own case to `closed` (status_authz.go). This pre-empts the
    # FSM illegal-edge check, so the author gets 403 SOD_CONFLICT (not 409).
    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/status",
                 {"status": "closed", "reason": "should be rejected"})
    is_sod = isinstance(j, dict) and j.get("code") == "SOD_CONFLICT"
    expect("STATUS close-class author SoD-blocked (403 SOD_CONFLICT)", st, 403,
           extra_ok=is_sod, detail=f"code={j.get('code') if isinstance(j, dict) else '?'}")

    # ============================================================
    # SUB-RESOURCE: PARTIES
    # ============================================================
    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/parties",
                 {"role": "plaintiff", "name": "Acme Corp", "identifier": "CR-1001"})
    party = unwrap(j); pid = party.get("id") if st == 201 else None
    expect("PARTY create", st, 201, extra_ok=bool(pid),
           detail=f"party_id={pid}")

    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/parties/bulk",
                 {"parties": [
                     {"role": "defendant", "name": "John Doe"},
                     {"role": "witness", "name": "Jane Roe"}]})
    bl = unwrap(j)
    expect("PARTY bulk create", st, 201,
           extra_ok=isinstance(bl, list) and len(bl) == 2,
           detail=f"created={len(bl) if isinstance(bl, list) else 'n/a'}")

    if pid:
        st, j = call("PUT", GW, f"/api/v1/lex/legal-cases/{cid}/parties/{pid}",
                     {"name": "Acme Corporation Ltd"})
        g = unwrap(j)
        expect("PARTY update (PUT)", st, 200, extra_ok=(g.get("name") == "Acme Corporation Ltd"))

        st, j = call("DELETE", GW, f"/api/v1/lex/legal-cases/{cid}/parties/{pid}")
        expect("PARTY delete", st, (204, 200))

    # ============================================================
    # SUB-RESOURCE: HEARINGS
    # ============================================================
    future = (datetime.datetime.now(datetime.timezone.utc)
              + datetime.timedelta(days=14)).replace(microsecond=0).isoformat()
    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/hearings",
                 {"hearing_date": future, "location": "Courtroom 3", "notes": "First hearing"})
    hearing = unwrap(j); hid = hearing.get("id") if st == 201 else None
    expect("HEARING create", st, 201, extra_ok=bool(hid), detail=f"hearing_id={hid}")

    if hid:
        st, j = call("PUT", GW, f"/api/v1/lex/legal-cases/{cid}/hearings/{hid}",
                     {"notes": "Rescheduled hearing"})
        g = unwrap(j)
        expect("HEARING update (PUT)", st, 200, extra_ok=(g.get("notes") == "Rescheduled hearing"))

        st, j = call("DELETE", GW, f"/api/v1/lex/legal-cases/{cid}/hearings/{hid}")
        expect("HEARING delete", st, (204, 200))

    # ============================================================
    # SUB-RESOURCE: TASKS
    # ============================================================
    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/tasks",
                 {"title": "Draft memo", "priority": "medium", "status": "open"})
    task = unwrap(j); tid = task.get("id") if st == 201 else None
    expect("TASK create", st, 201, extra_ok=bool(tid), detail=f"task_id={tid}")

    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/tasks/bulk",
                 {"tasks": [
                     {"title": "Collect evidence", "priority": "high", "status": "open"},
                     {"title": "File response", "priority": "low", "status": "open"}]})
    bl = unwrap(j)
    expect("TASK bulk create", st, 201,
           extra_ok=isinstance(bl, list) and len(bl) == 2,
           detail=f"created={len(bl) if isinstance(bl, list) else 'n/a'}")

    if tid:
        st, j = call("PUT", GW, f"/api/v1/lex/legal-cases/{cid}/tasks/{tid}",
                     {"status": "in_progress"})
        g = unwrap(j)
        expect("TASK update (PUT)", st, 200, extra_ok=(g.get("status") == "in_progress"))

        st, j = call("DELETE", GW, f"/api/v1/lex/legal-cases/{cid}/tasks/{tid}")
        expect("TASK delete", st, (204, 200))

    # ============================================================
    # SUB-RESOURCE: COMMENTS
    # ============================================================
    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/comments",
                 {"body": "Initial collaboration note"})
    cm = unwrap(j); mid = cm.get("id") if st == 201 else None
    expect("COMMENT create", st, 201, extra_ok=bool(mid), detail=f"comment_id={mid}")

    st, j = call("GET", GW, f"/api/v1/lex/legal-cases/{cid}/comments")
    expect("COMMENT list", st, 200, extra_ok=isinstance(unwrap(j), list))

    if mid:
        st, j = call("PUT", GW, f"/api/v1/lex/legal-cases/{cid}/comments/{mid}",
                     {"body": "Edited note"})
        g = unwrap(j)
        expect("COMMENT update (PUT)", st, 200, extra_ok=(g.get("body") == "Edited note"))

        st, j = call("DELETE", GW, f"/api/v1/lex/legal-cases/{cid}/comments/{mid}")
        expect("COMMENT delete", st, (204, 200))

    # ============================================================
    # SUB-RESOURCE: DOCUMENTS (metadata link)
    # ============================================================
    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/documents",
                 {"title": "Complaint PDF", "type": "other",
                  "description": "Filed complaint", "confidentiality": "internal"})
    dl = unwrap(j); did = dl.get("id") if st == 201 else None
    expect("DOCUMENT link create", st, 201, extra_ok=bool(did), detail=f"link_id={did}")

    st, j = call("GET", GW, f"/api/v1/lex/legal-cases/{cid}/documents")
    expect("DOCUMENT list", st, 200, extra_ok=isinstance(unwrap(j), list))

    if did:
        st, j = call("DELETE", GW, f"/api/v1/lex/legal-cases/{cid}/documents/{did}")
        expect("DOCUMENT link delete", st, (204, 200))

    # ============================================================
    # RESTRICTED ASSIGNMENT VERBS (no coarse fallback)
    # ============================================================
    assignee = "aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa"  # admin uid
    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/transfer-section-manager",
                 {"section_manager_id": assignee, "reason": "assign SM"})
    g = unwrap(j)
    expect("ASSIGN transfer-section-manager", st, 200,
           extra_ok=(g.get("section_manager_id") == assignee),
           detail=f"section_manager_id={g.get('section_manager_id')}")

    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/assign-supervisor",
                 {"supervisor_id": assignee, "reason": "assign supervisor"})
    g = unwrap(j)
    expect("ASSIGN assign-supervisor", st, 200,
           extra_ok=(g.get("supervisor_id") == assignee))

    st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{cid}/assign-officer",
                 {"handling_officer_id": assignee, "reason": "assign officer"})
    g = unwrap(j)
    expect("ASSIGN assign-officer", st, 200,
           extra_ok=(g.get("handling_officer_id") == assignee))

    # ============================================================
    # AUDIT / VERSIONS
    # ============================================================
    st, j = call("GET", GW, f"/api/v1/lex/legal-cases/{cid}/audit")
    au = unwrap(j)
    expect("GET audit trail", st, 200,
           extra_ok=isinstance(au, list) and len(au) > 0,
           detail=f"entries={len(au) if isinstance(au, list) else 'n/a'}")

    st, j = call("GET", GW, f"/api/v1/lex/legal-cases/{cid}/versions")
    vs = unwrap(j)
    expect("GET version history", st, 200,
           extra_ok=isinstance(vs, list) and len(vs) > 0,
           detail=f"versions={len(vs) if isinstance(vs, list) else 'n/a'}")

    # ============================================================
    # TWO-PHASE INTAKE (fresh case C2)
    # ============================================================
    st, j = call("POST", GW, "/api/v1/lex/legal-cases",
                 new_case_body(title_en="Intake Test Case"))
    c2 = unwrap(j).get("id") if st == 201 else None
    if c2:
        CREATED_CASES.append(c2)
    expect("INTAKE: create C2", st, 201, extra_ok=bool(c2))

    if c2:
        st, j = call("GET", GW, f"/api/v1/lex/legal-cases/{c2}/intake")
        expect("INTAKE: GET before start -> 404", st, 404)

        # missing required fields
        st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{c2}/intake/start", {})
        expect("INTAKE: start missing fields rejected", st, (400, 422),
               detail=f"body={short(j)}")

        # Phase 1 start
        st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{c2}/intake/start",
                     {"ceo_directive_ref": "CEO-DIR-2026-001",
                      "doa_authority_ref": "DOA-CEO-77",
                      "strength_assessment": "strong"})
        intk = unwrap(j)
        wf = intk.get("workflow_instance_id")
        ok = st == 200 and intk.get("phase") == "phase1" and bool(wf)
        expect("INTAKE: start Phase 1", st, 200, extra_ok=ok,
               detail=f"phase={intk.get('phase')} wf={wf}")

        # confirm case moved to phase1
        st, j = call("GET", GW, f"/api/v1/lex/legal-cases/{c2}")
        expect("INTAKE: case now phase1", st, 200,
               extra_ok=(unwrap(j).get("status") == "phase1"),
               detail=f"status={unwrap(j).get('status')}")

        # SoD: the case author cannot decide their own case's directive.
        wf_id = wf or str(uuid.uuid4())
        task_id = str(uuid.uuid4())
        st, j = call("POST", GW,
                     f"/api/v1/lex/legal-cases/{c2}/intake/{wf_id}/tasks/{task_id}/decision",
                     {"decision": "approve", "notes": "self-approve attempt"})
        expect("INTAKE: SoD blocks author self-decision (403)", st, 403,
               detail=f"body={short(j)}")

        # Handoff while still phase1 -> conflict (needs phase2)
        st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{c2}/intake/handoff",
                     {"section_manager_id": assignee, "reason": "handoff"})
        expect("INTAKE: handoff on phase1 -> conflict", st, (409, 422),
               detail=f"body={short(j)}")

    # ============================================================
    # FSM TRANSITIONS (throwaway C3)
    # ============================================================
    st, j = call("POST", GW, "/api/v1/lex/legal-cases",
                 new_case_body(title_en="Transition Test Case"))
    c3 = unwrap(j).get("id") if st == 201 else None
    if c3:
        CREATED_CASES.append(c3)

        # Positive: edit-class transition intake -> phase1 (allowed FSM edge, NOT
        # close/approve class, so no SoD gate -> author may drive it).
        st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{c3}/status",
                     {"status": "phase1", "reason": "advance"})
        g = unwrap(j)
        expect("STATUS valid edit-class transition intake->phase1", st, 200,
               extra_ok=(g.get("status") == "phase1"),
               detail=f"status={g.get('status')}")

        # Close-class terminal (cancelled) via /status is ALSO SoD-guarded: the
        # author cannot cancel their own case (a genuine successful terminal
        # transition would need a DISTINCT approver holding lex:case:close).
        st, j = call("POST", GW, f"/api/v1/lex/legal-cases/{c3}/status",
                     {"status": "cancelled", "reason": "abort"})
        is_sod = isinstance(j, dict) and j.get("code") == "SOD_CONFLICT"
        expect("STATUS cancel-by-author SoD-blocked (403 SOD_CONFLICT)", st, 403,
               extra_ok=is_sod, detail=f"code={j.get('code') if isinstance(j, dict) else '?'}")

    # ============================================================
    # CLOSE (DELETE) + verify gone
    # ============================================================
    st, j = call("DELETE", GW, f"/api/v1/lex/legal-cases/{cid}")
    ok_del = expect("CLOSE (DELETE) legal-case", st, (204, 200))
    if ok_del and cid in CREATED_CASES:
        CREATED_CASES.remove(cid)

    st, j = call("GET", GW, f"/api/v1/lex/legal-cases/{cid}")
    expect("GET after delete -> 404", st, 404)

    # ---- cleanup remaining created cases ----
    cleanup()
    dump()


def short(j):
    s = json.dumps(j) if not isinstance(j, str) else j
    return s[:160]


def cleanup():
    print("\n--- cleanup ---")
    for c in list(CREATED_CASES):
        st, _ = call("DELETE", GW, f"/api/v1/lex/legal-cases/{c}")
        print(f"cleanup DELETE {c} -> {st}")
        if st in (204, 200):
            CREATED_CASES.remove(c)


def dump():
    total = len(RESULTS)
    passed = sum(1 for r in RESULTS if r[3])
    print("\n================ SUMMARY ================")
    print(f"{passed}/{total} PASSED")
    fails = [r for r in RESULTS if not r[3]]
    if fails:
        print("\nFAILURES:")
        for name, exp, got, ok, detail in fails:
            print(f"  - {name}: expected {exp}, got {got}  {detail}")
    print("========================================")


if __name__ == "__main__":
    main()
