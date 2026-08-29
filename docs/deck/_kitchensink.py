"""Exercise every deck_lib component; render to PNG for visual QA."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pptx import Presentation
from pptx.util import Inches
import deck_lib as D

prs = Presentation()
prs.slide_width = Inches(D.SW); prs.slide_height = Inches(D.SH)

# 1 cover
D.cover_slide(prs, "Watheeq (وثيق): Sovereign Legal Operations",
              "Arabic-first · in-kingdom · whole-department",
              ["Built and demoable today", "Sovereign by architecture", "Vision 2030 aligned"],
              kicker="Clario360 · Sovereign Legal")

# 2 section
D.section_slide(prs, 3, "Executive Summary", "What it is, what's built, why now")

# 3 process flow + chevron
s, cr = D.content_scaffold(prs, 13, "The Legal Affairs Spine", "Service desk for the whole department", kicker="Product")
D.process_flow(s, cr['x']+0.2, 2.1, 12.0, 1.5,
               [("Intake", "email + form"), ("Triage", "eligibility · priority"),
                ("Route", "8-service catalog"), ("Track", "audited FSM"), ("Resolve", "SLA close")])
D.chevron_flow(s, cr['x']+0.2, 4.0, 12.0, 0.7,
               ["Consultation", "Contract Review", "Drafting", "Litigation", "Opinion", "Compliance"])
D.bullets(s, cr['x']+0.2, 5.0, 12.0, 1.3,
          ["Central intake — email and form", "Priority tiers incl. urgent-with-justification"], size=13)

# 4 layered stack
s, cr = D.content_scaffold(prs, 27, "Architecture Overview", "Sovereign-ready by construction", kicker="Platform")
D.layered_stack(s, cr['x']+0.2, 2.05, 12.0, 4.4, [
    dict(name="Clients", items=["Web (Next.js)", "Mobile", "API consumers"], fill=D.C.card2, txt=D.C.ink, pill=D.C.white),
    dict(name="Gateway", items=["JWT auth", "RBAC", "Rate limit", "Audit"], fill=D.C.teal_md, txt=D.C.white, pill=D.C.white, tag="API-first"),
    dict(name="Services", items=["Spine", "CLM", "Litigation", "Investigations", "Settlements"], fill=D.C.teal, txt=D.C.white, pill=D.C.white),
    dict(name="Data (RLS)", items=["Row-level security", "AES-256-GCM", "WORM", "Audit log"], fill=D.C.teal_dk, txt=D.C.white, pill=D.C.gold_pale, tag="In-kingdom"),
])

# 5 hub-spoke
s, cr = D.content_scaffold(prs, 28, "Shared Workflow Engine", "One FSM engine, reused across the platform", kicker="Moat")
D.hub_spoke(s, 6.6, 4.2, "FSM\nEngine", [
    dict(title="Watheeq", sub="legal", color=D.C.gold),
    dict(title="Cyber/SIEM", sub="security", color=D.C.navy),
    dict(title="Governance", sub="risk", color=D.C.teal),
    dict(title="Automation", sub="ops", color=D.C.teal_md),
    dict(title="Onboarding", sub="provision", color=D.C.green),
], hub_sub="claim · delegate · escalate")

# 6 comparison table
s, cr = D.content_scaffold(prs, 7, "The Sovereignty Gap", "Why foreign legal SaaS can't serve KSA", kicker="Why now")
D.comparison_table(s, cr['x']+0.4, 2.1, 11.4, 4.0,
                   ["Capability", "Foreign CLM", "Local point tools", "Watheeq"],
                   [["In-kingdom residency", "✗", "~", "✓"],
                    ["Arabic-first / RTL", "✗", "~", "✓"],
                    ["Hijri working calendar", "✗", "✗", "✓"],
                    ["Najiz / Nafath / emdha", "✗", "✗", "✓"],
                    ["Whole department", "✗", "✗", "✓"]],
                   highlight_col=3)

# 7 quadrant
s, cr = D.content_scaffold(prs, 11, "Competitive Landscape", "Sovereign-native + full-department", kicker="Market")
D.quadrant(s, 3.6, 2.0, 6.1, 4.2, "Contract-only  →  Whole department", "Global  →  Sovereign",
           items=[dict(label="Foreign CLM", qx=0.2, qy=0.2, color=D.C.muted),
                  dict(label="Local tools", qx=0.18, qy=0.55, color=D.C.muted),
                  dict(label="Watheeq", qx=0.8, qy=0.82, color=D.C.gold, winner=True)])

# 8 timeline
s, cr = D.content_scaffold(prs, 37, "Roadmap", "Phase 1 → full depth → scale & AI", kicker="Execution")
D.timeline(s, 1.0, 4.0, 11.4, [
    dict(label="Phase 1", items=["Core dept live", "Design-partner rollout"], color=D.C.teal_dk, tag="Now"),
    dict(label="Gov go-live", items=["Najiz", "Nafath", "emdha"], color=D.C.gold_dk, tag="Next"),
    dict(label="Depth", items=["Full spec coverage"], color=D.C.teal),
    dict(label="Scale + AI", items=["GCC expansion", "AI plane"], color=D.C.green),
])

# 9 kpi tiles + capability map
s, cr = D.content_scaffold(prs, 39, "Execution Capability", "Proven delivery on a large system", kicker="Team")
D.kpi_tiles(s, cr['x']+0.2, 2.1, 12.0, 1.9, [
    dict(num="~70", label="Migrations"), dict(num="~72", label="Models"),
    dict(num="~128", label="Services"), dict(num="~57", label="Handlers"),
    dict(num="20+", label="Domains"), dict(num="40+", label="Screens"),
], cols=6)
D.capability_map(s, cr['x']+0.2, 4.2, 12.0, 2.2, [
    dict(name="Spine", color=D.C.teal_dk, items=["Intake", "Catalog", "Routing", "FSM"]),
    dict(name="Matters", color=D.C.teal, items=["CLM", "Litigation", "Investigations", "Settlements"]),
    dict(name="Intelligence", color=D.C.navy, items=["AI Drafting", "Clause AI", "Analytics", "Entity-360"]),
])

# 10 funnel + ladder + gauge + progress + screenshot
s, cr = D.content_scaffold(prs, 24, "SLA Engine & Escalation", "The flagship KPI on a sovereign clock", kicker="Governance")
D.funnel(s, 0.8, 2.1, 3.4, 3.0, [
    dict(label="All requests", color=D.C.teal_dk),
    dict(label="At-risk", color=D.C.teal),
    dict(label="Escalated", color=D.C.warn),
    dict(label="Breached", color=D.C.crit)])
D.ladder(s, 4.6, 2.1, 3.6, 3.6, [("Section supervisor", "L1"), ("Dept manager", "L2"), ("Shared-services mgr", "L3")])
D.gauge(s, 10.0, 3.1, 0.95, 92, "Quarterly SLA")
D.progress_bar(s, 8.7, 4.6, 3.6, "On-time resolution", 88, color=D.C.green)
D.progress_bar(s, 8.7, 5.5, 3.6, "Within Ramadan hours", 76, color=D.C.gold_dk)

# 11 screenshot frame
s, cr = D.content_scaffold(prs, 26, "The Experience", "Bilingual, RTL, premium", kicker="Product")
sp = D.shot('lex-overview')
D.browser_frame(s, 0.8, 2.05, 7.2, 4.3, sp, title="watheeq · overview")
D.browser_frame(s, 8.3, 2.6, 4.3, 3.2, D.shot('contracts'), title="contracts")

prs.save('/Users/mac/clario360/docs/deck/_kitchensink.pptx')
issues = D.audit(prs)
print("slides:", len(prs.slides._sldIdLst))
print("audit issues:", len(issues))
for it in issues[:20]:
    print("  ", it)
out = D.render_pngs('/Users/mac/clario360/docs/deck/_kitchensink.pptx', '/Users/mac/clario360/docs/deck/_qa')
print("rendered to:", out)
