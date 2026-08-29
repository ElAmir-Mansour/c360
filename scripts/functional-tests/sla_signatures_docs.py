#!/usr/bin/env python3
"""
Functional API test for Watheeq (lex) against the LOCAL stack ONLY.

Modules exercised: SLA, E-SIGNATURE (native provider), DOCUMENTS, ORG-ENTITIES,
WORKING-CALENDARS, CASE-CLASSIFICATIONS.

Target:  gateway http://localhost:8092  (routes under /api/v1/lex/...)
Auth:    admin@clario.dev / Cl@rio360Dev!

Stdlib only. Run:  python3 sla_signatures_docs.py
Does NOT touch the live demo box.
"""

import json
import sys
import time
import uuid
import urllib.request
import urllib.error

GATEWAY = "http://localhost:8092"
LOGIN_URL = f"{GATEWAY}/api/v1/auth/login"
BASE = f"{GATEWAY}/api/v1/lex"
EMAIL = "admin@clario.dev"
PASSWORD = "Cl@rio360Dev!"

TOKEN = None
RESULTS = []          # (module, name, ok, detail)
CLEANUP = []          # (method, url) executed in reverse at the end
BUGS = []             # (title, request_summary, response_summary)


def req(method, url, body=None, token=None, expect=None):
    """Perform an HTTP request. Returns (status, parsed_json_or_text)."""
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        status = e.code
    except Exception as e:
        return 0, {"_transport_error": str(e)}
    try:
        parsed = json.loads(raw) if raw.strip() else {}
    except Exception:
        parsed = raw
    return status, parsed


def data_of(parsed):
    """Unwrap {data: ...} envelope if present."""
    if isinstance(parsed, dict) and "data" in parsed:
        return parsed["data"]
    return parsed


def record(module, name, ok, detail=""):
    RESULTS.append((module, name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {module} :: {name}  {('- ' + detail) if detail else ''}")


def bug(title, req_summary, resp_summary):
    BUGS.append((title, req_summary, resp_summary))
    print(f"  !! BUG: {title} | req={req_summary} | resp={resp_summary}")


def login():
    global TOKEN
    st, p = req("POST", LOGIN_URL, {"email": EMAIL, "password": PASSWORD})
    if st == 200 and isinstance(p, dict) and p.get("access_token"):
        TOKEN = p["access_token"]
        return True
    print(f"LOGIN FAILED status={st} body={p}")
    return False


# ---------------------------------------------------------------------------
# SLA
# ---------------------------------------------------------------------------
def test_sla():
    M = "SLA"
    rnd = uuid.uuid4().hex[:8].upper()
    svc_urgent = f"TST-U-{rnd}"
    svc_normal = f"TST-N-{rnd}"

    # 1. Create target (urgent => working_hours) POSITIVE
    st, p = req("POST", f"{BASE}/sla/targets", {
        "service_code": svc_urgent, "priority": "urgent",
        "turnaround_working_days": 3,
        "ack_window_value": 4, "ack_window_unit": "working_hours",
    }, TOKEN)
    tgt = data_of(p)
    urgent_id = tgt.get("id") if isinstance(tgt, dict) else None
    ok = st == 201 and urgent_id and tgt.get("ack_window_unit") == "working_hours"
    record(M, "create target urgent+working_hours (201)", ok, f"status={st}")
    if urgent_id:
        CLEANUP.append(("DELETE", f"{BASE}/sla/targets/{urgent_id}"))

    # 2. Constraint enforcement: urgent + working_days must be rejected 400
    st, p = req("POST", f"{BASE}/sla/targets", {
        "service_code": f"TST-BAD-{rnd}", "priority": "urgent",
        "turnaround_working_days": 3,
        "ack_window_value": 1, "ack_window_unit": "working_days",
    }, TOKEN)
    ok = st in (400, 422)
    record(M, "reject urgent+working_days (validation constraint)", ok, f"status={st}")
    if not ok and st in (200, 201):
        bug("SLA urgent target accepted working_days ack unit (constraint bypass)",
            "urgent + working_days", f"status={st} body={p}")

    # 2b. normal + working_days POSITIVE
    st, p = req("POST", f"{BASE}/sla/targets", {
        "service_code": svc_normal, "priority": "normal",
        "turnaround_working_days": 5,
        "ack_window_value": 1, "ack_window_unit": "working_days",
    }, TOKEN)
    tgt2 = data_of(p)
    normal_id = tgt2.get("id") if isinstance(tgt2, dict) else None
    record(M, "create target normal+working_days (201)", st == 201 and bool(normal_id), f"status={st}")
    if normal_id:
        CLEANUP.append(("DELETE", f"{BASE}/sla/targets/{normal_id}"))

    # 2c. normal + working_hours must be rejected
    st, p = req("POST", f"{BASE}/sla/targets", {
        "service_code": f"TST-BAD2-{rnd}", "priority": "normal",
        "turnaround_working_days": 5,
        "ack_window_value": 1, "ack_window_unit": "working_hours",
    }, TOKEN)
    record(M, "reject normal+working_hours (validation constraint)", st in (400, 422), f"status={st}")

    # 3. List
    st, p = req("GET", f"{BASE}/sla/targets?per_page=100", None, TOKEN)
    lst = data_of(p)
    found = isinstance(lst, list) and any(isinstance(x, dict) and x.get("id") == urgent_id for x in lst)
    record(M, "list targets contains created (200)", st == 200 and found, f"status={st} n={len(lst) if isinstance(lst, list) else '?'}")

    # 4. Get
    if urgent_id:
        st, p = req("GET", f"{BASE}/sla/targets/{urgent_id}", None, TOKEN)
        record(M, "get target (200)", st == 200 and data_of(p).get("id") == urgent_id, f"status={st}")

    # 5. Update
    if urgent_id:
        st, p = req("PATCH", f"{BASE}/sla/targets/{urgent_id}", {"turnaround_working_days": 7}, TOKEN)
        upd = data_of(p)
        ok = st == 200 and upd.get("turnaround_working_days") == 7
        record(M, "update target turnaround->7 (200)", ok, f"status={st} val={upd.get('turnaround_working_days')}")

    # 6. Start clock (deadlines must materialize)
    clock_id = None
    if urgent_id:
        lr = str(uuid.uuid4())
        st, p = req("POST", f"{BASE}/sla/clocks", {
            "legal_request_id": lr, "service_code": svc_urgent, "priority": "urgent",
        }, TOKEN)
        clk = data_of(p)
        clock_id = clk.get("id") if isinstance(clk, dict) else None
        ack_due = clk.get("ack_due_at") if isinstance(clk, dict) else None
        turn_due = clk.get("turnaround_due_at") if isinstance(clk, dict) else None
        esc1 = clk.get("escalation_l1_due_at") if isinstance(clk, dict) else None
        materialized = bool(ack_due) and bool(turn_due) and bool(esc1) and \
            not str(ack_due).startswith("0001") and not str(turn_due).startswith("0001")
        ok = st == 201 and clock_id and materialized
        record(M, "start clock + deadlines materialize (201)", ok,
               f"status={st} ack_due={ack_due} turn_due={turn_due}")
        if not (isinstance(clk, dict) and materialized) and st == 201:
            bug("SLA clock deadlines not materialized", "start clock urgent", f"body={clk}")

    # 6b. Verify calendar is honored: start a clock WITH a working-calendar id and
    #     compare turnaround_due_at to the no-calendar clock (should differ if the
    #     calendar's weekly profile differs from the default).
    #     (Covered separately in working-calendars test; here just assert clock get.)

    # 7. Get clock
    if clock_id:
        st, p = req("GET", f"{BASE}/sla/clocks/{clock_id}", None, TOKEN)
        record(M, "get clock (200)", st == 200 and data_of(p).get("id") == clock_id, f"status={st}")

    # 7b. List clocks (operations board)
    st, p = req("GET", f"{BASE}/sla/clocks?per_page=50", None, TOKEN)
    record(M, "list clocks board (200)", st == 200, f"status={st}")

    # 8. Acknowledge
    if clock_id:
        st, p = req("POST", f"{BASE}/sla/clocks/{clock_id}/acknowledge", {}, TOKEN)
        ack = data_of(p)
        acked = isinstance(ack, dict) and ack.get("ack_done") is True and bool(ack.get("ack_done_at"))
        record(M, "acknowledge clock (200)", st == 200 and bool(acked), f"status={st} ack_done={ack.get('ack_done') if isinstance(ack, dict) else None} ack_done_at={ack.get('ack_done_at') if isinstance(ack, dict) else None}")

    # 9. Trigger escalation
    if clock_id:
        st, p = req("POST", f"{BASE}/sla/clocks/{clock_id}/escalate", {"level": 1, "note": "func-test escalation"}, TOKEN)
        esc = data_of(p)
        lvl = esc.get("escalation_level") if isinstance(esc, dict) else None
        record(M, "trigger escalation L1 (200)", st == 200 and lvl == 1, f"status={st} level={lvl}")

    # 10. Dispatch outbox
    st, p = req("POST", f"{BASE}/sla/outbox/dispatch", {"provider": "native", "retry": False}, TOKEN)
    record(M, "dispatch outbox (200)", st == 200, f"status={st} body={_short(p)}")

    return {"svc_urgent": svc_urgent, "urgent_target": urgent_id, "clock": clock_id}


# ---------------------------------------------------------------------------
# DOCUMENTS
# ---------------------------------------------------------------------------
def test_documents():
    M = "DOCUMENTS"
    st, p = req("POST", f"{BASE}/documents", {
        "title": f"Func Test Doc {uuid.uuid4().hex[:6]}",
        "type": "memo", "description": "functional test document",
        "confidentiality": "internal", "tags": ["func-test"],
    }, TOKEN)
    doc = data_of(p)
    doc_id = doc.get("id") if isinstance(doc, dict) else None
    record(M, "create document (201)", st == 201 and bool(doc_id), f"status={st}")

    # list
    st, p = req("GET", f"{BASE}/documents?per_page=50", None, TOKEN)
    lst = data_of(p)
    found = isinstance(lst, list) and any(x.get("id") == doc_id for x in lst if isinstance(x, dict))
    record(M, "list documents contains created (200)", st == 200 and found, f"status={st}")

    # get
    if doc_id:
        st, p = req("GET", f"{BASE}/documents/{doc_id}", None, TOKEN)
        record(M, "get document (200)", st == 200 and data_of(p).get("id") == doc_id, f"status={st}")

    # versions
    if doc_id:
        st, p = req("GET", f"{BASE}/documents/{doc_id}/versions", None, TOKEN)
        record(M, "get document versions (200)", st == 200, f"status={st}")

    # update
    if doc_id:
        st, p = req("PUT", f"{BASE}/documents/{doc_id}", {"title": "Func Test Doc UPDATED"}, TOKEN)
        record(M, "update document (200)", st == 200 and data_of(p).get("title") == "Func Test Doc UPDATED", f"status={st}")

    # legal hold (apply + release) on the document
    hold_id = None
    if doc_id:
        st, p = req("POST", f"{BASE}/legal-holds", {
            "subject_type": "document", "subject_id": doc_id,
            "reason": "func-test litigation hold", "reference": "FT-001",
            "custodian": "func-test",
        }, TOKEN)
        hold = data_of(p)
        hold_id = hold.get("id") if isinstance(hold, dict) else None
        record(M, "apply legal hold on document (201)", st in (200, 201) and bool(hold_id), f"status={st}")
        if hold_id:
            st, p = req("POST", f"{BASE}/legal-holds/{hold_id}/release", {"reason": "func-test release"}, TOKEN)
            if st in (400, 422):
                # retry without body in case reason not required / different shape
                st, p = req("POST", f"{BASE}/legal-holds/{hold_id}/release", {}, TOKEN)
            record(M, "release legal hold (200)", st == 200, f"status={st}")

    # a throwaway doc to test delete (keep primary doc for signature test)
    st, p = req("POST", f"{BASE}/documents", {
        "title": "Func Test Doc DELETE", "type": "other",
        "confidentiality": "internal",
    }, TOKEN)
    del_doc = data_of(p).get("id") if st == 201 else None
    if del_doc:
        st, p = req("DELETE", f"{BASE}/documents/{del_doc}", None, TOKEN)
        record(M, "delete document (204)", st == 204, f"status={st}")

    if doc_id:
        CLEANUP.append(("DELETE", f"{BASE}/documents/{doc_id}"))
    return {"doc_id": doc_id}


# ---------------------------------------------------------------------------
# E-SIGNATURE (native)
# ---------------------------------------------------------------------------
def test_signatures(doc_id):
    M = "E-SIGNATURE"
    if not doc_id:
        record(M, "prerequisite document", False, "no document id; skipping signature tests")
        return

    # 1. Create envelope (native provider)
    st, p = req("POST", f"{BASE}/signatures", {
        "document_id": doc_id,
        "title": "Func Test Envelope",
        "subject": "Please sign", "message": "Native provider functional test",
        "language": "en",
        "provider": "native", "method": "otp",
        "recipients": [{
            "name": "Test Signer", "email": "signer@example.com",
            "role": "signer", "method": "otp", "signing_order": 1,
        }],
    }, TOKEN)
    env = data_of(p)
    env_id = env.get("id") if isinstance(env, dict) else None
    recips = env.get("recipients") if isinstance(env, dict) else None
    recip_id = recips[0].get("id") if isinstance(recips, list) and recips else None
    ok = st == 201 and env_id and env.get("status") == "draft" and env.get("provider") == "native"
    record(M, "create native envelope draft (201)", ok, f"status={st} status_field={env.get('status') if isinstance(env, dict) else None}")

    # 2. List
    st, p = req("GET", f"{BASE}/signatures?per_page=50", None, TOKEN)
    lst = data_of(p)
    found = isinstance(lst, list) and any(x.get("id") == env_id for x in lst if isinstance(x, dict))
    record(M, "list envelopes contains created (200)", st == 200 and found, f"status={st}")

    # 3. Get
    if env_id:
        st, p = req("GET", f"{BASE}/signatures/{env_id}", None, TOKEN)
        record(M, "get envelope (200)", st == 200 and data_of(p).get("id") == env_id, f"status={st}")

    # 4. Send (dispatch via native deterministic provider) -> sent + evidence
    sent_env = None
    if env_id:
        st, p = req("POST", f"{BASE}/signatures/{env_id}/send", {}, TOKEN)
        sent_env = data_of(p)
        status_field = sent_env.get("status") if isinstance(sent_env, dict) else None
        ehash = sent_env.get("evidence_hash") if isinstance(sent_env, dict) else None
        # evidence hash may live in evidence_metadata; check both
        meta = sent_env.get("evidence_metadata") if isinstance(sent_env, dict) else None
        has_evidence = bool(ehash) or (isinstance(meta, dict) and any(
            k for k in meta if "proof" in k or "envelope_id" in k or "hash" in k))
        ok = st == 200 and status_field == "sent"
        record(M, "send envelope -> sent (200)", ok, f"status={st} env_status={status_field}")
        record(M, "send produced provider evidence", bool(has_evidence),
               f"evidence_hash={'set' if ehash else 'none'} meta_keys={list(meta.keys()) if isinstance(meta, dict) else None}")
        if ok and not has_evidence:
            bug("Native send produced no evidence hash / proof metadata", f"POST /signatures/{env_id}/send", f"body={_short(sent_env)}")

    # 5. Drive the recipient sign action to completion (envelope -> signed), which
    #    is the precondition for recording signed-file custody.
    if env_id and recip_id:
        st, p = req("POST", f"{BASE}/signatures/{env_id}/recipients/{recip_id}/actions", {
            "action": "sign", "actor_name": "Test Signer", "actor_email": "signer@example.com",
            "evidence_hash": "sha256:" + uuid.uuid4().hex,
        }, TOKEN)
        signed = data_of(p)
        sstatus = signed.get("status") if isinstance(signed, dict) else None
        record(M, "recipient sign -> envelope signed (200)", st == 200 and sstatus == "signed",
               f"status={st} env_status={sstatus}")

    # 5b. Record custody evidence (only valid after completion)
    if env_id:
        st, p = req("POST", f"{BASE}/signatures/{env_id}/custody", {
            "file_id": "func-test-file-1",
            "file_name": "signed.pdf",
            "file_size_bytes": 12345,
            "content_hash": "sha256:" + uuid.uuid4().hex,
            "evidence_hash": "sha256:" + uuid.uuid4().hex,
            "provider": "native",
        }, TOKEN)
        cust = data_of(p)
        record(M, "record custody evidence after completion (200)", st == 200, f"status={st} body={_short(cust)}")

    # 6. Gov provider honesty: create + send najiz envelope, observe behavior.
    st, p = req("POST", f"{BASE}/signatures", {
        "document_id": doc_id, "title": "Gov Provider Probe",
        "provider": "najiz", "method": "nafath",
        "recipients": [{"name": "Gov Signer", "email": "gov@example.com",
                        "role": "signer", "method": "nafath", "signing_order": 1}],
    }, TOKEN)
    gov = data_of(p)
    gov_id = gov.get("id") if isinstance(gov, dict) else None
    if st == 201 and gov_id:
        st2, p2 = req("POST", f"{BASE}/signatures/{gov_id}/send", {}, TOKEN)
        gsent = data_of(p2)
        gstatus = gsent.get("status") if isinstance(gsent, dict) else None
        meta = gsent.get("evidence_metadata") if isinstance(gsent, dict) else {}
        adapter = None
        if isinstance(meta, dict):
            adapter = meta.get("provider_adapter") or (meta.get("provider_outbound_proof", {}) or {}).get("provider")
        # Honest = NOT a fabricated real gov signature. Local deterministic stub is
        # acceptable IF it is clearly labeled deterministic/local (not a real Najiz seal).
        deterministic = isinstance(meta, dict) and (
            str(adapter).endswith(".deterministic") or
            meta.get("provider_dispatch_mode") == "deterministic_local")
        record(M, "gov provider (najiz) send is honest local-stub, not fabricated",
               deterministic or st2 != 200,
               f"send_status={st2} env_status={gstatus} adapter={adapter}")
        if st2 == 200 and not deterministic:
            bug("Gov provider (najiz) send appears to fabricate a real signature (no deterministic/sandbox marker)",
                f"POST /signatures/{gov_id}/send", f"meta={_short(meta)}")
        req("POST", f"{BASE}/signatures/{gov_id}/cancel", {"reason": "func-test cleanup"}, TOKEN)
    else:
        record(M, "gov provider (najiz) create", st == 201, f"status={st}")

    # 6b. emdha is NOT an allowed provider -> must be rejected at validation (honest)
    st, p = req("POST", f"{BASE}/signatures", {
        "document_id": doc_id, "title": "Emdha Probe",
        "provider": "emdha", "method": "certificate",
        "recipients": [{"name": "X", "email": "x@example.com", "role": "signer",
                        "method": "certificate", "signing_order": 1}],
    }, TOKEN)
    record(M, "emdha provider rejected as not-configured (validation)", st in (400, 422), f"status={st}")

    # 7. Cancel a fresh draft envelope
    st, p = req("POST", f"{BASE}/signatures", {
        "document_id": doc_id, "title": "Cancel Probe",
        "provider": "native", "method": "otp",
        "recipients": [{"name": "Y", "email": "y@example.com", "role": "signer",
                        "method": "otp", "signing_order": 1}],
    }, TOKEN)
    cid = data_of(p).get("id") if st == 201 else None
    if cid:
        st, p = req("POST", f"{BASE}/signatures/{cid}/cancel", {"reason": "func-test cancel"}, TOKEN)
        record(M, "cancel envelope (200)", st == 200 and data_of(p).get("status") == "cancelled", f"status={st}")


# ---------------------------------------------------------------------------
# ORG-ENTITIES
# ---------------------------------------------------------------------------
def test_org_entities():
    M = "ORG-ENTITIES"
    code = f"FT-ORG-{uuid.uuid4().hex[:6].upper()}"
    st, p = req("POST", f"{BASE}/org-entities", {
        "entity_type": "department", "code": code,
        "name": {"en": "Func Test Dept", "ar": "قسم الاختبار"},
    }, TOKEN)
    ent = data_of(p)
    ent_id = ent.get("id") if isinstance(ent, dict) else None
    record(M, "create org entity (201)", st == 201 and bool(ent_id), f"status={st}")

    st, p = req("GET", f"{BASE}/org-entities?per_page=100", None, TOKEN)
    lst = data_of(p)
    found = isinstance(lst, list) and any(x.get("id") == ent_id for x in lst if isinstance(x, dict))
    record(M, "list org entities contains created (200)", st == 200 and found, f"status={st}")

    if ent_id:
        st, p = req("GET", f"{BASE}/org-entities/{ent_id}", None, TOKEN)
        record(M, "get org entity (200)", st == 200 and data_of(p).get("id") == ent_id, f"status={st}")

    # assign role binding
    role_key = "legal_director"
    if ent_id:
        st, p = req("POST", f"{BASE}/org-entities/{ent_id}/roles", {
            "role_key": role_key,
            "user_id": "aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa",
            "label": {"en": "Legal Director", "ar": "مدير قانوني"},
        }, TOKEN)
        record(M, "assign role binding (200)", st in (200, 201), f"status={st} body={_short(p)}")

    # escalation resolution
    if ent_id:
        st, p = req("GET", f"{BASE}/org-entities/{ent_id}/escalation", None, TOKEN)
        record(M, "resolve escalation ladder (200)", st == 200, f"status={st} body={_short(p)}")

    # remove role
    if ent_id:
        st, p = req("DELETE", f"{BASE}/org-entities/{ent_id}/roles/{role_key}", None, TOKEN)
        record(M, "remove role binding (200/204)", st in (200, 204), f"status={st}")

    # update
    if ent_id:
        st, p = req("PUT", f"{BASE}/org-entities/{ent_id}", {"name": {"en": "Func Test Dept UPDATED", "ar": "محدث"}}, TOKEN)
        record(M, "update org entity (200)", st == 200, f"status={st}")

    # delete
    if ent_id:
        st, p = req("DELETE", f"{BASE}/org-entities/{ent_id}", None, TOKEN)
        record(M, "delete org entity (204)", st in (200, 204), f"status={st}")


# ---------------------------------------------------------------------------
# WORKING-CALENDARS
# ---------------------------------------------------------------------------
def test_working_calendars():
    M = "WORKING-CALENDARS"
    # standard Sun-Thu (day_of_week 0..4) 08:00-16:00 = minutes 480..960
    wh = [{"profile": "standard", "day_of_week": d, "segment_index": 0,
           "start_minute": 480, "end_minute": 960} for d in range(0, 5)]
    st, p = req("POST", f"{BASE}/working-calendars", {
        "name": f"Func Test Calendar {uuid.uuid4().hex[:5]}",
        "description": "functional test",
        "timezone": "Asia/Riyadh", "is_default": False,
        "working_hours": wh,
    }, TOKEN)
    cal = data_of(p)
    cal_id = cal.get("id") if isinstance(cal, dict) else None
    record(M, "create working calendar (201)", st == 201 and bool(cal_id), f"status={st} body={_short(p) if st != 201 else ''}")

    st, p = req("GET", f"{BASE}/working-calendars", None, TOKEN)
    lst = data_of(p)
    found = isinstance(lst, list) and any(x.get("id") == cal_id for x in lst if isinstance(x, dict))
    record(M, "list calendars contains created (200)", st == 200 and found, f"status={st}")

    if cal_id:
        st, p = req("GET", f"{BASE}/working-calendars/{cal_id}", None, TOKEN)
        record(M, "get calendar (200)", st == 200 and data_of(p).get("id") == cal_id, f"status={st}")

    # add holiday on an ordinary mid-week working day (Tue 2026-11-03), chosen to
    # avoid coinciding with any seeded KSA national holiday so the delta is isolable.
    holiday_id = None
    holiday_date = "2026-11-03"
    if cal_id:
        st, p = req("POST", f"{BASE}/working-calendars/{cal_id}/holidays", {
            "date": holiday_date + "T00:00:00Z", "kind": "official",
            "name": {"en": "Func Test Holiday", "ar": "عطلة اختبار"},
        }, TOKEN)
        h = data_of(p)
        # AddHoliday returns the full calendar; the new holiday is in holidays[].
        if isinstance(h, dict) and isinstance(h.get("holidays"), list) and h["holidays"]:
            holiday_id = h["holidays"][-1].get("id")
        elif isinstance(h, dict):
            holiday_id = h.get("id")
        record(M, "add holiday (200/201)", st in (200, 201) and bool(holiday_id), f"status={st} holiday_id={'set' if holiday_id else 'none'}")

    # Verify SLA calc honors the calendar: create an SLA target, start a clock with
    # calendar_id vs without, and assert the deadline shifts around the holiday.
    if cal_id:
        rnd = uuid.uuid4().hex[:6].upper()
        svc = f"TST-CAL-{rnd}"
        stt, _ = req("POST", f"{BASE}/sla/targets", {
            "service_code": svc, "priority": "normal", "turnaround_working_days": 3,
            "ack_window_value": 1, "ack_window_unit": "working_days",
        }, TOKEN)
        started = "2026-11-01T08:00:00Z"  # Sunday, 2 working days before the Tue holiday
        st_a, pa = req("POST", f"{BASE}/sla/clocks", {
            "legal_request_id": str(uuid.uuid4()), "service_code": svc, "priority": "normal",
            "calendar_id": cal_id, "started_at": started,
        }, TOKEN)
        st_b, pb = req("POST", f"{BASE}/sla/clocks", {
            "legal_request_id": str(uuid.uuid4()), "service_code": svc, "priority": "normal",
            "started_at": started,
        }, TOKEN)
        due_a = data_of(pa).get("turnaround_due_at") if st_a == 201 else None
        due_b = data_of(pb).get("turnaround_due_at") if st_b == 201 else None
        ok = bool(due_a) and bool(due_b)
        record(M, "SLA clock honors calendar_id (deadlines materialize)", ok,
               f"cal_due={due_a} nocal_due={due_b}")
        # The custom calendar has a holiday inside the 3-working-day window, so its
        # turnaround due date must be strictly LATER than the default calendar's.
        if due_a and due_b:
            record(M, "custom-calendar holiday extends turnaround past default", due_a > due_b,
                   f"cal={due_a} default={due_b}")

    # delete holiday
    if cal_id and holiday_id:
        st, p = req("DELETE", f"{BASE}/working-calendars/{cal_id}/holidays/{holiday_id}", None, TOKEN)
        record(M, "delete holiday (200/204)", st in (200, 204), f"status={st}")

    # update
    if cal_id:
        st, p = req("PUT", f"{BASE}/working-calendars/{cal_id}", {"description": "updated"}, TOKEN)
        record(M, "update calendar (200)", st == 200, f"status={st}")

    # delete
    if cal_id:
        st, p = req("DELETE", f"{BASE}/working-calendars/{cal_id}", None, TOKEN)
        record(M, "delete calendar (200/204)", st in (200, 204), f"status={st}")


# ---------------------------------------------------------------------------
# CASE-CLASSIFICATIONS
# ---------------------------------------------------------------------------
def test_case_classifications():
    M = "CASE-CLASSIFICATIONS"
    rnd = uuid.uuid4().hex[:6].upper()
    # create two sibling roots (for reorder + merge)
    ids = []
    for i in (1, 2):
        st, p = req("POST", f"{BASE}/case-classifications", {
            "code": f"FT-CC-{rnd}-{i}",
            "name": {"en": f"Func Test Class {i}", "ar": f"تصنيف {i}"},
        }, TOKEN)
        cid = data_of(p).get("id") if isinstance(data_of(p), dict) else None
        ids.append(cid)
        record(M, f"create classification #{i} (201)", st == 201 and bool(cid), f"status={st}")

    st, p = req("GET", f"{BASE}/case-classifications?per_page=100", None, TOKEN)
    record(M, "list classifications (200)", st == 200, f"status={st}")

    st, p = req("GET", f"{BASE}/case-classifications/tree", None, TOKEN)
    record(M, "get classification tree (200)", st == 200, f"status={st}")

    if ids[0]:
        st, p = req("GET", f"{BASE}/case-classifications/{ids[0]}", None, TOKEN)
        record(M, "get classification (200)", st == 200 and data_of(p).get("id") == ids[0], f"status={st}")

    # reorder (both roots as siblings under null parent)
    if all(ids):
        st, p = req("POST", f"{BASE}/case-classifications/reorder", {
            "parent_id": None, "ordered_ids": [ids[1], ids[0]],
        }, TOKEN)
        record(M, "reorder classifications (200)", st == 200, f"status={st} body={_short(p)}")

    # update #1
    if ids[0]:
        st, p = req("PUT", f"{BASE}/case-classifications/{ids[0]}", {
            "name": {"en": "Func Test Class 1 UPDATED", "ar": "محدث"},
        }, TOKEN)
        record(M, "update classification (200)", st == 200, f"status={st}")

    # merge #2 -> #1 (source ids[1] merged into target ids[0])
    if all(ids):
        st, p = req("POST", f"{BASE}/case-classifications/{ids[1]}/merge", {"target_id": ids[0]}, TOKEN)
        res = data_of(p)
        ok = st == 200 and isinstance(res, dict) and res.get("source_deactivated") is not None
        record(M, "merge classifications (200)", ok, f"status={st} body={_short(res)}")

    # delete #1 (source #2 already deactivated by merge)
    if ids[0]:
        st, p = req("DELETE", f"{BASE}/case-classifications/{ids[0]}", None, TOKEN)
        record(M, "delete classification (200/204)", st in (200, 204), f"status={st}")


def _short(obj, n=220):
    try:
        s = json.dumps(obj) if not isinstance(obj, str) else obj
    except Exception:
        s = str(obj)
    return s[:n]


def cleanup():
    print("\n--- cleanup ---")
    for method, url in reversed(CLEANUP):
        st, _ = req(method, url, None, TOKEN)
        print(f"  {method} {url.split('/api/v1/lex')[-1]} -> {st}")


def summary():
    print("\n================ SUMMARY ================")
    by_mod = {}
    for mod, name, ok, _ in RESULTS:
        by_mod.setdefault(mod, [0, 0])
        by_mod[mod][0 if ok else 1] += 1
    total_pass = sum(v[0] for v in by_mod.values())
    total_fail = sum(v[1] for v in by_mod.values())
    for mod, (pz, fz) in by_mod.items():
        print(f"  {mod:22s} PASS={pz} FAIL={fz}")
    print(f"  {'TOTAL':22s} PASS={total_pass} FAIL={total_fail}")
    if any(not ok for _, _, ok, _ in RESULTS):
        print("\n  FAILURES:")
        for mod, name, ok, detail in RESULTS:
            if not ok:
                print(f"   - [{mod}] {name}  ({detail})")
    if BUGS:
        print("\n  BUGS:")
        for t, rq, rs in BUGS:
            print(f"   - {t}\n       req: {rq}\n       resp: {rs}")
    print("========================================")
    return total_fail


def main():
    print("== Watheeq LOCAL functional test ==")
    if not login():
        sys.exit(2)
    print("logged in OK\n")
    print("[SLA]")
    test_sla()
    print("[DOCUMENTS]")
    docs = test_documents()
    print("[E-SIGNATURE]")
    test_signatures(docs.get("doc_id"))
    print("[ORG-ENTITIES]")
    test_org_entities()
    print("[WORKING-CALENDARS]")
    test_working_calendars()
    print("[CASE-CLASSIFICATIONS]")
    test_case_classifications()
    cleanup()
    fails = summary()
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
