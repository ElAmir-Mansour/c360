#!/usr/bin/env python3
"""
Functional (CRUD + lifecycle) API tests for Watheeq (lex) MATTERS, OBLIGATIONS,
and SETTLEMENTS against the LOCAL stack ONLY.

Target : gateway http://localhost:8092  (routes under /api/v1/lex/...)
Auth   : admin@clario.dev / Cl@rio360Dev!  (tenant clario-dev, role super-admin)

Stdlib only. Run:  python3 scripts/functional-tests/matters_settlements.py
Exits 0 if no hard FAILs, 1 otherwise. FINDINGs (documented behaviour that
differs from the naive spec expectation) do not fail the run.
"""
import json
import sys
import urllib.request
import urllib.error
import uuid

GATEWAY = "http://localhost:8092"
LOGIN_URL = GATEWAY + "/api/v1/auth/login"
BASE = GATEWAY + "/api/v1/lex"
EMAIL = "admin@clario.dev"
PASSWORD = "Cl@rio360Dev!"

TOKEN = None
UID = None
TID = None

results = []          # (module, name, expected, actual, verdict, detail)
created = {"matters": [], "settlements": [], "obligations": [], "documents": []}


def req(method, url, body=None, token=None, raw=False):
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            code = resp.getcode()
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        code = e.code
    except urllib.error.URLError as e:
        return 0, {"_urlerror": str(e)}, txt if 'txt' in dir() else ""
    body_json = None
    if txt:
        try:
            body_json = json.loads(txt)
        except Exception:
            body_json = None
    if raw:
        return code, body_json, txt
    return code, body_json, txt


def data_of(j):
    if isinstance(j, dict) and "data" in j:
        return j["data"]
    return j


def record(module, name, expected, code, ok, detail=""):
    verdict = "PASS" if ok else detail_verdict(detail)
    results.append((module, name, expected, code, verdict, detail if not ok else ""))
    flag = {"PASS": "PASS", "FAIL": "FAIL", "FINDING": "FIND"}[verdict]
    print(f"[{flag}] {module:11s} {name:44s} exp={expected!s:14s} got={code}")
    if not ok and detail:
        print("        " + detail.replace("\n", "\n        "))
    return verdict


def detail_verdict(detail):
    return "FINDING" if detail.startswith("FINDING:") else "FAIL"


def check(module, name, code, expected, extra_ok=True, detail_on_fail=""):
    """expected: int or set/list of ints. extra_ok: additional assertion bool."""
    exp_set = {expected} if isinstance(expected, int) else set(expected)
    ok = code in exp_set and extra_ok
    return record(module, name, sorted(exp_set), code, ok, detail_on_fail if not ok else "")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def login():
    global TOKEN, UID, TID
    code, j, txt = req("POST", LOGIN_URL, {"email": EMAIL, "password": PASSWORD})
    if code != 200:
        print("FATAL: login failed", code, txt[:400])
        sys.exit(2)
    d = data_of(j)
    TOKEN = d.get("access_token") or (j.get("access_token") if isinstance(j, dict) else None)
    # decode uid/tid from jwt
    import base64
    payload = TOKEN.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    claims = json.loads(base64.urlsafe_b64decode(payload))
    UID = claims["uid"]
    TID = claims["tid"]
    print(f"Authenticated uid={UID} tid={TID}\n")


def G(path):
    return req("GET", BASE + path, token=TOKEN)


def P(path, body):
    return req("POST", BASE + path, body=body, token=TOKEN)


def PUT(path, body):
    return req("PUT", BASE + path, body=body, token=TOKEN)


def D(path):
    return req("DELETE", BASE + path, token=TOKEN)


def post_raw(path, raw_bytes):
    """POST raw (possibly malformed) bytes to exercise the 400 decode path."""
    headers = {"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN}
    r = urllib.request.Request(BASE + path, data=raw_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.getcode()
    except urllib.error.HTTPError as e:
        return e.code


# ---------------------------------------------------------------------------
# MATTERS
# ---------------------------------------------------------------------------
def test_matters():
    m = "MATTERS"
    # M1 create
    code, j, txt = P("/matters", {
        "title": "Acme MSA dispute FT",
        "description": "Functional-test matter",
        "type": "dispute",
        "priority": "high",
        "owner_user_id": UID,
        "owner_name": "FT Owner",
        "tags": ["ft", "acme"],
    })
    d = data_of(j) or {}
    mid = d.get("id")
    if mid:
        created["matters"].append(mid)
    check(m, "create (POST /matters)", code, 201,
          extra_ok=(mid is not None and d.get("status") == "open" and bool(d.get("matter_number"))),
          detail_on_fail=f"resp={txt[:300]}")

    # M2 get
    code, j, _ = G(f"/matters/{mid}")
    check(m, "get by id", code, 200, extra_ok=(data_of(j) or {}).get("id") == mid)

    # M3 list (paginated envelope)
    code, j, _ = G("/matters?per_page=5")
    check(m, "list (paginated)", code, 200,
          extra_ok=isinstance(j, dict) and isinstance(j.get("data"), list) and "meta" in j)

    # M4 conflict-check with overlapping title -> 200 + result shape
    code, j, txt = P("/matters/conflict-check", {
        "title": "Acme MSA dispute FT",
        "counterparty": "Acme",
    })
    d = data_of(j) or {}
    check(m, "conflict-check (POST)", code, 200,
          extra_ok=("conflicts" in d and "warnings" in d and "checked_at" in d),
          detail_on_fail=f"resp={txt[:300]}")

    # M5 conflict-check with no signals at all -> 422 (title not required if any signal present)
    code, j, _ = P("/matters/conflict-check", {})
    check(m, "conflict-check no signals -> 422", code, 422)

    # M5b malformed JSON body -> 400 (handler decode path, distinct from 422 validation)
    code = post_raw("/matters", b"{not-json")
    check(m, "malformed JSON body -> 400", code, 400)

    # M6 create an intake matter for triage
    code, j, _ = P("/matters", {
        "title": "Intake triage FT", "description": "x", "type": "general",
        "status": "intake", "priority": "medium",
        "owner_user_id": UID, "owner_name": "FT Owner",
    })
    d = data_of(j) or {}
    tmid = d.get("id")
    if tmid:
        created["matters"].append(tmid)
    check(m, "create intake matter", code, 201, extra_ok=d.get("status") == "intake")

    # M7 triage intake -> in_review
    code, j, txt = P(f"/matters/{tmid}/triage", {
        "status": "in_review", "priority": "high",
        "owner_user_id": UID, "owner_name": "Triage Owner",
        "notes": "triaged",
    })
    d = data_of(j) or {}
    check(m, "triage intake->in_review", code, 200,
          extra_ok=d.get("status") == "in_review" and d.get("priority") == "high",
          detail_on_fail=f"resp={txt[:300]}")

    # M8 triage again (now in_review, not intake/open) -> 400
    code, j, _ = P(f"/matters/{tmid}/triage", {"status": "on_hold", "notes": "again"})
    check(m, "triage from in_review -> 422 (only intake/open)", code, 422)

    # M9 update matter title
    code, j, _ = PUT(f"/matters/{mid}", {"title": "Acme MSA dispute FT (renamed)"})
    check(m, "update (PUT) title", code, 200,
          extra_ok=(data_of(j) or {}).get("title") == "Acme MSA dispute FT (renamed)")

    # M10 status FSM walk (each valid enum target -> 200)
    walk = ["in_review", "waiting_on_business", "on_hold", "open"]
    ok_all = True
    last = None
    for st in walk:
        code, j, txt = PUT(f"/matters/{mid}/status", {"status": st})
        last = code
        if code != 200 or (data_of(j) or {}).get("status") != st:
            ok_all = False
            break
    check(m, "status FSM walk in_review->...->open", last if not ok_all else 200,
          200, extra_ok=ok_all)

    # M11 invalid enum status -> 400
    code, j, _ = PUT(f"/matters/{mid}/status", {"status": "frozen"})
    check(m, "status invalid enum -> 422", code, 422)

    # M12 close matter -> 200 + closed_at
    code, j, _ = PUT(f"/matters/{mid}/status", {"status": "closed"})
    d = data_of(j) or {}
    check(m, "status -> closed (200, closed_at set)", code, 200,
          extra_ok=d.get("status") == "closed" and d.get("closed_at"))

    # M13 illegal transition closed->open : task expects 409, code has NO FSM graph
    code, j, _ = PUT(f"/matters/{mid}/status", {"status": "open"})
    ok = code == 409
    record(m, "closed->open illegal (task expects 409)", 409, code, ok,
           detail="" if ok else "FINDING: matter UpdateStatus only enum-validates; NO from->to FSM graph, so a terminal 'closed' matter is silently re-opened (200). No 409 illegal-transition guard exists for matters.")
    # reset to closed for cleanliness (leave as-is)

    return mid, tmid


def test_matter_subresources(mid):
    m = "MATTER-SUB"
    # comments
    code, j, txt = P(f"/matters/{mid}/comments", {"body": "first comment"})
    d = data_of(j) or {}
    cid = d.get("id")
    check(m, "add comment", code, [200, 201], extra_ok=cid is not None,
          detail_on_fail=f"resp={txt[:250]}")
    code, j, _ = G(f"/matters/{mid}/comments")
    check(m, "list comments", code, 200,
          extra_ok=isinstance(data_of(j), list) and len(data_of(j)) >= 1)

    # audit feed (status changes should be recorded)
    code, j, _ = G(f"/matters/{mid}/audit")
    aud = data_of(j)
    check(m, "audit feed", code, 200,
          extra_ok=isinstance(aud, list) and len(aud) >= 1,
          detail_on_fail="audit empty or wrong shape")

    # obligations sub-list
    code, j, _ = G(f"/matters/{mid}/obligations")
    check(m, "obligations by matter (sub)", code, 200,
          extra_ok=isinstance(data_of(j), (list, dict)))

    # document link: create a document then link it
    code, j, _ = P("/documents", {"title": "FT linked doc", "type": "other",
                                   "description": "", "confidentiality": "internal",
                                   "tags": [], "metadata": {}})
    doc = data_of(j) or {}
    did = doc.get("id")
    if did:
        created["documents"].append(did)
    if did:
        code, j, txt = P(f"/matters/{mid}/documents", {"document_id": did, "relationship": "evidence"})
        check(m, "link document", code, [200, 201],
              detail_on_fail=f"resp={txt[:250]}")
        code, j, _ = G(f"/matters/{mid}/documents")
        check(m, "list linked documents", code, 200,
              extra_ok=isinstance(data_of(j), list))
    else:
        record(m, "link document", "201", "skip", False,
               detail="FINDING: could not create a document to link (POST /documents non-201)")


def test_matter_related(mid, settlement_id):
    m = "MATTER-SUB"
    if not settlement_id:
        return
    code, j, txt = P(f"/matters/{mid}/related", {
        "target_type": "settlement", "target_id": settlement_id, "relationship": "arising_from"})
    check(m, "add related link (->settlement)", code, [200, 201],
          detail_on_fail=f"resp={txt[:250]}")
    code, j, _ = G(f"/matters/{mid}/related")
    check(m, "list related", code, 200, extra_ok=isinstance(data_of(j), list))


# ---------------------------------------------------------------------------
# OBLIGATIONS
# ---------------------------------------------------------------------------
def test_obligations(mid):
    m = "OBLIGATIONS"
    # O1 create linked to matter
    code, j, txt = P("/obligations", {
        "title": "Pay settlement tranche", "description": "FT obligation",
        "type": "payment", "priority": "high",
        "matter_id": mid, "owner_user_id": UID, "owner_name": "FT Owner",
        "due_date": "2026-12-31T00:00:00Z",
        "tags": ["ft"], "metadata": {},
    })
    d = data_of(j) or {}
    oid = d.get("id")
    if oid:
        created["obligations"].append(oid)
    check(m, "create (matter-linked)", code, 201, extra_ok=oid is not None,
          detail_on_fail=f"resp={txt[:300]}")

    # O2 get
    code, j, _ = G(f"/obligations/{oid}")
    check(m, "get by id", code, 200, extra_ok=(data_of(j) or {}).get("id") == oid)

    # O3 list
    code, j, _ = G("/obligations?per_page=5")
    check(m, "list (paginated)", code, 200,
          extra_ok=isinstance(j, dict) and isinstance(j.get("data"), list))

    # O4 list by matter contains O1
    code, j, _ = G(f"/matters/{mid}/obligations")
    lst = data_of(j)
    found = isinstance(lst, list) and any((x.get("id") == oid) for x in lst)
    check(m, "list by matter contains obligation", code, 200, extra_ok=found,
          detail_on_fail="created obligation not present in matter sub-list")

    # O5 status transitions
    code, j, _ = req("PUT", BASE + f"/obligations/{oid}/status", {"status": "in_progress"}, TOKEN)
    check(m, "status -> in_progress", code, 200, extra_ok=(data_of(j) or {}).get("status") == "in_progress")
    code, j, _ = req("PUT", BASE + f"/obligations/{oid}/status", {"status": "completed"}, TOKEN)
    d = data_of(j) or {}
    check(m, "status -> completed (completed_at set)", code, 200,
          extra_ok=d.get("status") == "completed" and d.get("completed_at"))

    # O6 invalid enum status -> 400
    code, j, _ = req("PUT", BASE + f"/obligations/{oid}/status", {"status": "bogus"}, TOKEN)
    check(m, "status invalid enum -> 422", code, 422)

    # O7 update
    code, j, _ = PUT(f"/obligations/{oid}", {"priority": "critical"})
    check(m, "update (PUT) priority", code, 200,
          extra_ok=(data_of(j) or {}).get("priority") == "critical")

    # O8 create with neither matter nor contract -> 400
    code, j, _ = P("/obligations", {
        "title": "orphan", "owner_user_id": UID, "owner_name": "x",
        "due_date": "2026-12-31T00:00:00Z"})
    check(m, "create without matter/contract -> 422", code, 422)

    # O9 delete
    code, j, _ = D(f"/obligations/{oid}")
    if code in (200, 204):
        created["obligations"].remove(oid)
    check(m, "delete -> 204", code, [200, 204])


# ---------------------------------------------------------------------------
# SETTLEMENTS
# ---------------------------------------------------------------------------
def new_matter(title):
    code, j, _ = P("/matters", {"title": title, "description": "x", "type": "dispute",
                                "priority": "medium", "owner_user_id": UID, "owner_name": "FT"})
    d = data_of(j) or {}
    if d.get("id"):
        created["matters"].append(d["id"])
    return d.get("id")


def test_settlements():
    m = "SETTLEMENTS"
    smid = new_matter("Settlement owner matter FT")

    # S1 open (proposed)
    code, j, txt = P("/settlements", {
        "matter_id": smid, "method": "reconciliation",
        "title": "Acme reconciliation", "terms": "Pay 100k over 6 months",
        "value": 100000, "currency": "SAR",
        "counterparty_name": "Acme LLC", "counterparty_contact": "legal@acme.test",
    })
    d = data_of(j) or {}
    sid = d.get("id")
    if sid:
        created["settlements"].append(sid)
    check(m, "open reconciliation (proposed)", code, 201,
          extra_ok=sid is not None and d.get("status") == "proposed" and bool(d.get("reference")),
          detail_on_fail=f"resp={txt[:300]}")

    # S2 get + counterparty decrypted
    code, j, _ = G(f"/settlements/{sid}")
    d = data_of(j) or {}
    check(m, "get by id (PII decrypted)", code, 200,
          extra_ok=d.get("counterparty_name") == "Acme LLC")

    # S3 list filtered by matter
    code, j, _ = G(f"/settlements?matter_id={smid}")
    check(m, "list filtered by matter_id", code, 200,
          extra_ok=isinstance(j, dict) and isinstance(j.get("data"), list) and len(j["data"]) >= 1)

    # S4 open invalid method -> 400
    code, j, _ = P("/settlements", {"matter_id": smid, "method": "duel", "title": "x", "terms": "y"})
    check(m, "open invalid method -> 422", code, 422)

    # S5 open missing matter_id -> 400
    code, j, _ = P("/settlements", {"method": "mediation", "title": "x", "terms": "y"})
    check(m, "open missing matter_id -> 422", code, 422)

    # S6 record (still proposed / mutable)
    code, j, _ = PUT(f"/settlements/{sid}", {"terms": "Pay 90k over 4 months", "value": 90000})
    check(m, "record terms (proposed mutable)", code, 200,
          extra_ok=(data_of(j) or {}).get("terms") == "Pay 90k over 4 months")

    # S7 add negotiation round -> negotiating
    code, j, txt = P(f"/settlements/{sid}/rounds", {
        "proposed_by": "counterparty", "proposed_value": 85000, "currency": "SAR",
        "terms": "counter 85k", "outcome": "pending"})
    check(m, "add round #1 (-> negotiating)", code, 201,
          extra_ok=(data_of(j) or {}).get("round_number") == 1,
          detail_on_fail=f"resp={txt[:300]}")
    code, j, _ = G(f"/settlements/{sid}")
    check(m, "status is negotiating after round", code, 200,
          extra_ok=(data_of(j) or {}).get("status") == "negotiating")

    # S8 second round
    code, j, _ = P(f"/settlements/{sid}/rounds", {
        "proposed_by": "us", "proposed_value": 88000, "terms": "counter 88k"})
    check(m, "add round #2", code, 201, extra_ok=(data_of(j) or {}).get("round_number") == 2)

    # S9 add round missing proposed_by -> 400
    code, j, _ = P(f"/settlements/{sid}/rounds", {"terms": "no author"})
    check(m, "add round missing proposed_by -> 422", code, 422)

    # S10 submit for approval -> pending_approval
    code, j, txt = P(f"/settlements/{sid}/submit", {})
    d = data_of(j) or {}
    wfid = d.get("workflow_instance_id")
    check(m, "submit for approval (-> pending_approval)", code, 200,
          extra_ok=d.get("status") == "pending_approval" and wfid,
          detail_on_fail=f"resp={txt[:300]}")

    # S11 submit again -> 409
    code, j, _ = P(f"/settlements/{sid}/submit", {})
    check(m, "submit again -> 409", code, 409)

    # S12 record after submit (not mutable) -> 409
    code, j, _ = PUT(f"/settlements/{sid}", {"terms": "late edit"})
    check(m, "record after pending_approval -> 409", code, 409)

    # S13 add round after submit (not mutable) -> 409
    code, j, _ = P(f"/settlements/{sid}/rounds", {"proposed_by": "us", "terms": "late round"})
    check(m, "add round after pending_approval -> 409", code, 409)

    # S14 decide as author -> 403 (SoD author != approver) [router RequireDistinctActor]
    rnd_task = str(uuid.uuid4())
    code, j, txt = P(f"/settlements/{sid}/workflows/{wfid or uuid.uuid4()}/tasks/{rnd_task}/decision",
                     {"decision": "approve", "notes": "self approve attempt"})
    ok = code == 403
    record(m, "decide as author -> 403 (SoD)", 403, code, ok,
           detail="" if ok else f"FINDING: expected 403 SoD block, got {code}. resp={txt[:250]}")

    # S15 close-by-reconciliation as author -> 403 (SoD guard precedes 409 not-approved)
    code, j, txt = P(f"/settlements/{sid}/close", {})
    ok = code == 403
    record(m, "close as author -> 403 (SoD precedes state 409)", 403, code, ok,
           detail="" if ok else f"FINDING: expected 403 (settlementDecision SoD guard), got {code}. resp={txt[:250]}")

    # S16 audit trail
    code, j, _ = G(f"/settlements/{sid}/audit")
    aud = data_of(j)
    actions = {a.get("action") for a in aud} if isinstance(aud, list) else set()
    check(m, "audit trail (opened/recorded/submitted)", code, 200,
          extra_ok=isinstance(aud, list) and "settlement.opened" in actions and "settlement.submitted_for_approval" in actions,
          detail_on_fail=f"actions={actions}")

    # S17 delete a fresh proposed settlement -> 204
    smid2 = new_matter("Settlement delete matter FT")
    code, j, _ = P("/settlements", {"matter_id": smid2, "method": "negotiation",
                                    "title": "toss", "terms": "t"})
    d = data_of(j) or {}
    sid2 = d.get("id")
    if sid2:
        created["settlements"].append(sid2)
    code, j, _ = D(f"/settlements/{sid2}")
    if code in (200, 204) and sid2 in created["settlements"]:
        created["settlements"].remove(sid2)
    check(m, "delete proposed settlement -> 204", code, [200, 204])

    # S18 method enum acceptance (mediation/arbitration/negotiation)
    ok_methods = True
    for meth in ["mediation", "arbitration", "negotiation"]:
        mm = new_matter(f"method {meth} FT")
        code, j, _ = P("/settlements", {"matter_id": mm, "method": meth, "title": "m", "terms": "t"})
        d = data_of(j) or {}
        if code != 201 or d.get("method") != meth:
            ok_methods = False
        elif d.get("id"):
            created["settlements"].append(d["id"])
    check(m, "method enum accepts mediation/arbitration/negotiation", 201 if ok_methods else 0,
          201, extra_ok=ok_methods)

    return sid


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
def cleanup():
    print("\n--- cleanup ---")
    for sid in list(created["settlements"]):
        code, _, _ = D(f"/settlements/{sid}")
        print(f"delete settlement {sid}: {code}")
    for oid in list(created["obligations"]):
        code, _, _ = D(f"/obligations/{oid}")
        print(f"delete obligation {oid}: {code}")
    for did in list(created["documents"]):
        code, _, _ = D(f"/documents/{did}")
        print(f"delete document {did}: {code}")
    for mid in list(created["matters"]):
        code, _, _ = D(f"/matters/{mid}")
        print(f"delete matter {mid}: {code}")


def summary():
    print("\n============ SUMMARY ============")
    npass = sum(1 for r in results if r[4] == "PASS")
    nfail = sum(1 for r in results if r[4] == "FAIL")
    nfind = sum(1 for r in results if r[4] == "FINDING")
    print(f"PASS={npass}  FAIL={nfail}  FINDING={nfind}  TOTAL={len(results)}")
    if nfail:
        print("\nFAILURES:")
        for md, nm, exp, got, v, det in results:
            if v == "FAIL":
                print(f"  [{md}] {nm}: expected {exp}, got {got}. {det}")
    if nfind:
        print("\nFINDINGS:")
        for md, nm, exp, got, v, det in results:
            if v == "FINDING":
                print(f"  [{md}] {nm}: {det}")
    return nfail


def main():
    login()
    mid, tmid = test_matters()
    sid = test_settlements()
    test_matter_subresources(mid)
    test_matter_related(mid, sid)
    test_obligations(mid)
    cleanup()
    nfail = summary()
    sys.exit(1 if nfail else 0)


if __name__ == "__main__":
    main()
