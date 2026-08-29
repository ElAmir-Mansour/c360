#!/usr/bin/env python3
"""
Functional (CRUD + lifecycle) API test for the Watheeq / Lex LEGAL REQUESTS & INTAKE module.

Targets the LOCAL running stack ONLY:
  - IAM   : http://localhost:8081   (login)
  - Gateway: http://localhost:8092  (lex API)

Auth: super-admin admin@clario.dev (permissions ["*"] -> passes all RBAC tiers).

Exercises:
  - Create + CAP-010 urgency-justification guard (missing / too-brief / requester-delay / valid)
  - Get / List / Filter
  - Update (allowed in draft/returned; blocked in other states = 409)
  - Submit + FSM (no-approval fast path -> approved -> routed)
  - Route auto-spawn: litigation -> legal_case ; consultation -> consultation (back-link check)
  - Illegal FSM transitions rejected (409): re-submit routed, route non-approved, edit routed
  - Reclassify priority (CAP-011) + priority-change history + same-priority conflict
  - Request audit trail (GET /{id}/audit)
  - Soft delete (204) + subsequent GET 404
  - Intake eligibility gate (POST /intake/submit)

Pure stdlib (urllib/json). Run: python3 requests.py
Exit code 0 if all PASS, 1 otherwise.
"""

import json
import sys
import urllib.request
import urllib.error

IAM = "http://localhost:8081"
GW = "http://localhost:8092"
LEX = GW + "/api/v1/lex"

EMAIL = "admin@clario.dev"
PASSWORD = "Cl@rio360Dev!"

RESULTS = []  # list of dicts: {op, expected, got, ok, note}
BUGS = []     # list of dicts: {op, detail, request, response}


def http(method, url, token=None, body=None):
    """Return (status_code, parsed_json_or_text_or_None)."""
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.getcode(), _parse(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, _parse(raw)
    except urllib.error.URLError as e:
        return 0, {"_urlerror": str(e)}


def _parse(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def record(op, expected, got, ok, note="", request=None, response=None):
    RESULTS.append({"op": op, "expected": expected, "got": got, "ok": ok, "note": note})
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {op}  (expected {expected}, got {got}) {note}")
    if not ok:
        BUGS.append({"op": op, "detail": note, "request": request, "response": response})


def data_of(resp):
    return resp.get("data") if isinstance(resp, dict) else None


def field_err(resp):
    """Extract validation field-error map from an error envelope."""
    if isinstance(resp, dict):
        return resp.get("details")
    return None


# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------
def mk_create(request_type, priority="normal", urgency=None,
              req_appr=False, prov_appr=False, title_en="Test legal request",
              requester_name="QA Bot", description="Functional test request"):
    body = {
        "request_type": request_type,
        "title": {"ar": "طلب اختبار", "en": title_en},
        "description": description,
        "requester_name": requester_name,
        "priority": priority,
        "requester_approval_required": req_appr,
        "provider_approval_required": prov_appr,
    }
    if urgency is not None:
        body["urgency_justification"] = urgency
    return body


PROPER_JUSTIFICATION = "Court-ordered filing deadline expires within 48 hours per official summons"
JUNK_ASAP = "asap"                       # 4 chars < 20 -> too_brief
JUNK_DELAY = "I forgot, my bad, asap"    # 22 chars, pure requester delay -> requester_delay_not_allowed


# ---------------------------------------------------------------------------
def login():
    code, resp = http("POST", IAM + "/api/v1/auth/login",
                      body={"email": EMAIL, "password": PASSWORD})
    if code != 200 or not isinstance(resp, dict) or "access_token" not in resp:
        print(f"FATAL: login failed ({code}): {resp}")
        sys.exit(2)
    return resp["access_token"]


def main():
    token = login()
    print(f"Authenticated as {EMAIL}\n")

    # =====================================================================
    # GROUP 1 - CAP-010 urgency-justification guard on CREATE
    # =====================================================================
    print("--- Group 1: CAP-010 urgency guard (create) ---")

    # NOTE: lex maps validation failures to HTTP 422 (Unprocessable Entity),
    # reserving 400 for malformed JSON. 422 is the expected "guard fired" code.
    b = mk_create("consultation", priority="urgent")  # urgent, NO justification
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    fe = field_err(resp)
    ok = code == 422 and isinstance(fe, dict) and fe.get("urgency_justification") == "required_for_urgent"
    record("CREATE urgent w/o justification -> reject", "422+required_for_urgent",
           f"{code}/{fe}", ok, "" if ok else "guard did not reject missing justification",
           request=b, response=resp)

    b = mk_create("consultation", priority="urgent", urgency=JUNK_ASAP)
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    fe = field_err(resp)
    ok = code == 422 and isinstance(fe, dict) and fe.get("urgency_justification") in ("too_brief", "requester_delay_not_allowed")
    record("CREATE urgent 'asap' junk -> reject", "422+too_brief",
           f"{code}/{fe}", ok, "" if ok else "junk 'asap' urgency accepted",
           request=b, response=resp)

    b = mk_create("consultation", priority="urgent", urgency=JUNK_DELAY)
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    fe = field_err(resp)
    ok = code == 422 and isinstance(fe, dict) and fe.get("urgency_justification") == "requester_delay_not_allowed"
    record("CREATE urgent requester-delay reason -> reject", "422+requester_delay_not_allowed",
           f"{code}/{fe}", ok, "" if ok else "pure requester-delay justification accepted",
           request=b, response=resp)

    b = mk_create("consultation", priority="urgent", urgency=PROPER_JUSTIFICATION)
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    d = data_of(resp)
    urgent_id = d.get("id") if isinstance(d, dict) else None
    ok = code == 201 and isinstance(d, dict) and d.get("priority") == "urgent" and d.get("status") == "draft"
    record("CREATE urgent w/ valid justification -> accept", "201+urgent+draft",
           f"{code}/{d.get('status') if isinstance(d, dict) else d}", ok,
           "" if ok else "valid urgent create rejected", request=b, response=resp)

    b = mk_create("power_of_attorney", priority="normal")
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    d = data_of(resp)
    normal_id = d.get("id") if isinstance(d, dict) else None
    ok = code == 201 and isinstance(d, dict) and d.get("status") == "draft" and d.get("request_number")
    record("CREATE normal baseline -> accept", "201+draft", f"{code}", ok,
           "" if ok else "baseline create failed", request=b, response=resp)

    # =====================================================================
    # GROUP 2 - Get / List / Filter
    # =====================================================================
    print("\n--- Group 2: Get / List / Filter ---")

    code, resp = http("GET", f"{LEX}/legal-requests/{normal_id}", token)
    d = data_of(resp)
    ok = code == 200 and isinstance(d, dict) and d.get("id") == normal_id
    record("GET by id", "200+id-match", f"{code}", ok,
           "" if ok else "get by id mismatch", response=resp)

    code, resp = http("GET", f"{LEX}/legal-requests?per_page=50&status=draft", token)
    d = data_of(resp)
    ids = [x.get("id") for x in d] if isinstance(d, list) else []
    ok = code == 200 and normal_id in ids
    record("LIST filter status=draft", "200+contains-normal", f"{code}", ok,
           "" if ok else "draft filter missing our request", response=resp)

    code, resp = http("GET", f"{LEX}/legal-requests?per_page=50&priority=urgent", token)
    d = data_of(resp)
    ids = [x.get("id") for x in d] if isinstance(d, list) else []
    prios = set(x.get("priority") for x in d) if isinstance(d, list) else set()
    ok = code == 200 and urgent_id in ids and prios <= {"urgent"}
    record("LIST filter priority=urgent", "200+only-urgent", f"{code}", ok,
           "" if ok else f"priority filter leaked {prios}", response=resp)

    code, resp = http("GET", f"{LEX}/legal-requests?request_type=power_of_attorney&per_page=50", token)
    d = data_of(resp)
    types = set(x.get("request_type") for x in d) if isinstance(d, list) else set()
    ok = code == 200 and types <= {"power_of_attorney"}
    record("LIST filter request_type", "200+type-match", f"{code}", ok,
           "" if ok else f"request_type filter leaked {types}", response=resp)

    # =====================================================================
    # GROUP 3 - Update (draft editable)
    # =====================================================================
    print("\n--- Group 3: Update (draft) ---")

    upd = {"description": "edited description in draft"}
    code, resp = http("PUT", f"{LEX}/legal-requests/{normal_id}", token, upd)
    d = data_of(resp)
    ok = code == 200 and isinstance(d, dict) and d.get("description") == "edited description in draft"
    record("UPDATE draft request", "200+updated", f"{code}", ok,
           "" if ok else "draft update failed", request=upd, response=resp)

    # =====================================================================
    # GROUP 4 - Submit + FSM: litigation -> approved -> routed -> legal_case spawn
    # =====================================================================
    print("\n--- Group 4: Submit/FSM + litigation -> legal_case spawn ---")

    b = mk_create("litigation", priority="normal", title_en="Company vs Vendor dispute",
                  description="Breach of supply contract; company intends to file suit.")
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    d = data_of(resp)
    lit_id = d.get("id") if isinstance(d, dict) else None
    ok = code == 201 and lit_id
    record("CREATE litigation (no approvals)", "201", f"{code}", ok,
           "" if ok else "litigation create failed", request=b, response=resp)

    code, resp = http("POST", f"{LEX}/legal-requests/{lit_id}/submit", token, {"notes": "ready"})
    d = data_of(resp)
    lit_status = d.get("status") if isinstance(d, dict) else None
    lit_subject = d.get("subject_type") if isinstance(d, dict) else None
    lit_subject_id = d.get("subject_id") if isinstance(d, dict) else None
    # No approvals => submit target = approved => auto-route => routed
    ok = code == 200 and lit_status == "routed"
    record("SUBMIT litigation -> auto-route to routed", "200+routed",
           f"{code}/{lit_status}", ok,
           "" if ok else f"expected routed, got '{lit_status}' (auto-route/spawn may have failed)",
           response=resp)

    ok = lit_subject == "legal_case" and lit_subject_id
    record("ROUTE spawns legal_case (subject back-link)", "subject=legal_case",
           f"{lit_subject}/{lit_subject_id}", ok,
           "" if ok else "litigation request did NOT spawn/link a legal_case", response=resp)

    if lit_subject == "legal_case" and lit_subject_id:
        code, resp = http("GET", f"{LEX}/legal-cases/{lit_subject_id}", token)
        d = data_of(resp)
        back = d.get("request_id") if isinstance(d, dict) else None
        ok = code == 200 and back == lit_id
        record("legal_case back-links request_id", "200+request_id-match",
               f"{code}/{back}", ok,
               "" if ok else "spawned case does not back-link the request", response=resp)
    else:
        record("legal_case back-links request_id", "skipped", "n/a", False,
               "no subject_id to verify (spawn failed above)")

    # Illegal: re-submit an already-routed request
    code, resp = http("POST", f"{LEX}/legal-requests/{lit_id}/submit", token, {})
    ok = code == 409
    record("RE-SUBMIT routed request -> 409", "409", f"{code}", ok,
           "" if ok else "re-submit of routed request not rejected", response=resp)

    # Idempotent route on already-routed
    code, resp = http("POST", f"{LEX}/legal-requests/{lit_id}/route", token, {})
    d = data_of(resp)
    ok = code == 200 and isinstance(d, dict) and d.get("status") == "routed"
    record("ROUTE already-routed (idempotent)", "200+routed", f"{code}", ok,
           "" if ok else "idempotent route did not return routed row", response=resp)

    # Illegal: edit a routed request (Update only allowed in draft/returned)
    code, resp = http("PUT", f"{LEX}/legal-requests/{lit_id}", token, {"description": "nope"})
    ok = code == 409
    record("UPDATE routed request -> 409", "409", f"{code}", ok,
           "" if ok else "edit of routed request not blocked", response=resp)

    # =====================================================================
    # GROUP 5 - consultation -> consultation spawn
    # =====================================================================
    print("\n--- Group 5: consultation -> consultation spawn ---")

    b = mk_create("consultation", priority="normal", title_en="Need legal opinion on NDA",
                  description="Requesting a legal opinion on the enforceability of an NDA clause.")
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    d = data_of(resp)
    cons_id = d.get("id") if isinstance(d, dict) else None
    record("CREATE consultation (no approvals)", "201", f"{code}", code == 201 and bool(cons_id),
           "" if code == 201 else "consultation create failed", request=b, response=resp)

    code, resp = http("POST", f"{LEX}/legal-requests/{cons_id}/submit", token, {})
    d = data_of(resp)
    cons_status = d.get("status") if isinstance(d, dict) else None
    cons_subject = d.get("subject_type") if isinstance(d, dict) else None
    cons_subject_id = d.get("subject_id") if isinstance(d, dict) else None
    ok = code == 200 and cons_status == "routed" and cons_subject == "consultation" and cons_subject_id
    record("SUBMIT consultation -> routed + spawn consultation", "200+routed+consultation",
           f"{code}/{cons_status}/{cons_subject}", ok,
           "" if ok else "consultation request did not route/spawn a consultation", response=resp)

    if cons_subject == "consultation" and cons_subject_id:
        code, resp = http("GET", f"{LEX}/consultations/{cons_subject_id}", token)
        d = data_of(resp)
        back = d.get("legal_request_id") if isinstance(d, dict) else None
        ok = code == 200 and back == cons_id
        record("consultation back-links legal_request_id", "200+match",
               f"{code}/{back}", ok,
               "" if ok else "spawned consultation does not back-link the request", response=resp)

    # =====================================================================
    # GROUP 6 - FSM illegal transitions (approval branch + route guard)
    # =====================================================================
    print("\n--- Group 6: FSM illegal transitions ---")

    # Request that REQUIRES approval -> submit stops at 'submitted' (not approved)
    b = mk_create("power_of_attorney", priority="normal", prov_appr=True)
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    appr_id = data_of(resp).get("id") if isinstance(data_of(resp), dict) else None
    code, resp = http("POST", f"{LEX}/legal-requests/{appr_id}/submit", token, {})
    d = data_of(resp)
    st = d.get("status") if isinstance(d, dict) else None
    ok = code == 200 and st == "submitted"
    record("SUBMIT (approval-required) stops at submitted", "200+submitted",
           f"{code}/{st}", ok,
           "" if ok else f"approval-required submit went to '{st}' instead of submitted", response=resp)

    # Illegal: route a request still in 'submitted' (only approved may route)
    code, resp = http("POST", f"{LEX}/legal-requests/{appr_id}/route", token, {})
    ok = code == 409
    record("ROUTE submitted (non-approved) request -> 409", "409", f"{code}", ok,
           "" if ok else "route of non-approved request not rejected", response=resp)

    # Illegal: route a fresh draft
    b = mk_create("power_of_attorney", priority="normal")
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    draft_id = data_of(resp).get("id") if isinstance(data_of(resp), dict) else None
    code, resp = http("POST", f"{LEX}/legal-requests/{draft_id}/route", token, {})
    ok = code == 409
    record("ROUTE draft request -> 409", "409", f"{code}", ok,
           "" if ok else "route of draft request not rejected", response=resp)

    # =====================================================================
    # GROUP 7 - Reclassify priority (CAP-011) + history
    # =====================================================================
    print("\n--- Group 7: Reclassify priority (CAP-011) ---")

    b = mk_create("power_of_attorney", priority="normal")
    code, resp = http("POST", LEX + "/legal-requests", token, b)
    pr_id = data_of(resp).get("id") if isinstance(data_of(resp), dict) else None

    code, resp = http("POST", f"{LEX}/legal-requests/{pr_id}/priority", token,
                      {"priority": "urgent", "reason": ""})
    ok = code == 422
    record("RECLASSIFY empty reason -> reject", "422", f"{code}", ok,
           "" if ok else "empty reclassify reason accepted", response=resp)

    code, resp = http("POST", f"{LEX}/legal-requests/{pr_id}/priority", token,
                      {"priority": "urgent", "reason": "escalation", "urgency_justification": JUNK_ASAP})
    ok = code == 422
    record("RECLASSIFY ->urgent junk justification -> reject", "422", f"{code}", ok,
           "" if ok else "junk justification accepted on reclassify", response=resp)

    code, resp = http("POST", f"{LEX}/legal-requests/{pr_id}/priority", token,
                      {"priority": "urgent", "reason": "Regulator hearing scheduled Sunday",
                       "urgency_justification": PROPER_JUSTIFICATION})
    d = data_of(resp)
    ok = code == 200 and isinstance(d, dict) and d.get("priority") == "urgent"
    record("RECLASSIFY normal->urgent valid -> 200", "200+urgent", f"{code}", ok,
           "" if ok else "valid reclassify to urgent failed", response=resp)

    code, resp = http("GET", f"{LEX}/legal-requests/{pr_id}/priority-changes", token)
    d = data_of(resp)
    entry = d[0] if isinstance(d, list) and d else None
    ok = (code == 200 and isinstance(d, list) and len(d) >= 1 and isinstance(entry, dict)
          and entry.get("from_priority") == "normal" and entry.get("to_priority") == "urgent")
    record("PRIORITY-CHANGES history (CAP-011)", "200+1entry(normal->urgent)",
           f"{code}/{len(d) if isinstance(d, list) else 'n/a'}", ok,
           "" if ok else "priority change not audited", response=resp)

    code, resp = http("POST", f"{LEX}/legal-requests/{pr_id}/priority", token,
                      {"priority": "urgent", "reason": "again"})
    ok = code == 409
    record("RECLASSIFY same priority -> 409", "409", f"{code}", ok,
           "" if ok else "same-priority reclassify not rejected", response=resp)

    code, resp = http("POST", f"{LEX}/legal-requests/{pr_id}/priority", token,
                      {"priority": "normal", "reason": "de-escalated after review"})
    d = data_of(resp)
    ok = code == 200 and isinstance(d, dict) and d.get("priority") == "normal"
    record("RECLASSIFY urgent->normal -> 200", "200+normal", f"{code}", ok,
           "" if ok else "de-escalation failed", response=resp)

    # =====================================================================
    # GROUP 8 - Request audit trail
    # =====================================================================
    print("\n--- Group 8: Request audit trail (GET /{id}/audit) ---")

    code, resp = http("GET", f"{LEX}/legal-requests/{lit_id}/audit", token)
    d = data_of(resp)
    actions = set(e.get("action") for e in d) if isinstance(d, list) else set()
    ok = code == 200 and isinstance(d, list) and "submitted" in actions and "routed" in actions
    record("AUDIT trail has submitted+routed", "200+{submitted,routed}",
           f"{code}/{sorted(actions)}", ok,
           "" if ok else "spine audit trail incomplete", response=resp)

    # =====================================================================
    # GROUP 9 - Soft delete
    # =====================================================================
    print("\n--- Group 9: Soft delete ---")

    code, resp = http("DELETE", f"{LEX}/legal-requests/{draft_id}", token)
    ok = code == 204
    record("DELETE (soft) request", "204", f"{code}", ok,
           "" if ok else "soft delete failed", response=resp)

    code, resp = http("GET", f"{LEX}/legal-requests/{draft_id}", token)
    ok = code == 404
    record("GET deleted request -> 404", "404", f"{code}", ok,
           "" if ok else "deleted request still retrievable", response=resp)

    # =====================================================================
    # GROUP 10 - Intake eligibility gate
    # =====================================================================
    print("\n--- Group 10: Intake eligibility gate ---")

    # Missing service_id (validation -> 422)
    code, resp = http("POST", f"{LEX}/intake/submit", token,
                      {"title": {"ar": "طلب", "en": "Intake test"}, "description": "x"})
    ok = code == 422
    record("INTAKE submit missing service_id -> reject", "422", f"{code}", ok,
           "" if ok else "missing service_id accepted", response=resp)

    # Non-existent service_id (validation -> 422)
    code, resp = http("POST", f"{LEX}/intake/submit", token,
                      {"service_id": "00000000-0000-0000-0000-0000000000ff",
                       "title": {"ar": "طلب", "en": "Intake test"}, "description": "x"})
    ok = code == 422
    record("INTAKE submit unknown service_id -> reject", "422", f"{code}", ok,
           "" if ok else "unknown service_id accepted", response=resp)

    # Real service_id from catalog -> exercises the eligibility gate (201 eligible OR 403 denied)
    code, resp = http("GET", f"{LEX}/service-catalog?per_page=10", token)
    d = data_of(resp)
    svc = None
    if isinstance(d, list):
        svc = next((s for s in d if s.get("active") and s.get("channel") == "platform"), None)
    if svc:
        code, resp = http("POST", f"{LEX}/intake/submit", token,
                          {"service_id": svc["id"],
                           "title": {"ar": "طلب استشارة", "en": "Intake via catalog"},
                           "description": "Platform intake exercising eligibility rules.",
                           "priority": "normal"})
        ok = code in (201, 403)
        note = ("eligible: legal_request created" if code == 201
                else "denied by eligibility gate (403)" if code == 403
                else "unexpected")
        record(f"INTAKE submit real service '{svc.get('code')}' (eligibility gate)",
               "201 or 403", f"{code}", ok, note, response=resp)
    else:
        record("INTAKE submit real service (eligibility gate)", "n/a", "no-catalog", False,
               "no active platform service found in catalog")

    # =====================================================================
    # Summary
    # =====================================================================
    total = len(RESULTS)
    passed = sum(1 for r in RESULTS if r["ok"])
    print("\n" + "=" * 70)
    print(f"SUMMARY: {passed}/{total} PASS, {total - passed} FAIL")
    print("=" * 70)
    if BUGS:
        print("\nFAILURES / BUGS:")
        for b in BUGS:
            print(f"  - {b['op']}: {b['detail']}")
            if b.get("request") is not None:
                print(f"      request : {json.dumps(b['request'])[:300]}")
            if b.get("response") is not None:
                print(f"      response: {json.dumps(b['response'])[:300]}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
