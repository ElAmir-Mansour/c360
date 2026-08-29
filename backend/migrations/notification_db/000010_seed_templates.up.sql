-- =============================================================================
-- 000010: Seed the platform-default email templates (#18).
--
-- model/template.go + notification_templates existed, but TemplateService only
-- ever rendered Go consts and never queried the table (the DB store was dead).
-- The service now prefers a DB template for (tenant, type), falling back to the
-- embedded const. This migration materializes the embedded defaults into the
-- table under the platform-default tenant so operators can inspect/override them.
--
-- Behaviour is UNCHANGED by default: these rows are byte-identical to the Go
-- consts, and resolution falls back to the same const when a row is absent.
-- Insert-if-absent (ON CONFLICT DO NOTHING) so a customized row is never
-- clobbered; the service also seeds these idempotently at startup
-- (TemplateService.SeedDefaultTemplates). Bodies are dollar-quoted to preserve
-- the HTML verbatim.
-- =============================================================================

INSERT INTO notification_templates (id, tenant_id, channel, subject_tmpl, body_tmpl) VALUES
('alert.created', '00000000-0000-0000-0000-000000000000', 'email', '', $tmpl$<h2 style="color:#d32f2f;">{{.copy.SecurityAlertHeading}}</h2>
<p><strong>{{.copy.PriorityLabel}}:</strong> {{.priority}}</p>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAlertLabel}}</a></p>{{end}}$tmpl$),
('alert.escalated', '00000000-0000-0000-0000-000000000000', 'email', '', $tmpl$<h2 style="color:#d32f2f;">{{.copy.AlertEscalatedHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#d32f2f; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAlertLabel}}</a></p>{{end}}$tmpl$),
('task.assigned', '00000000-0000-0000-0000-000000000000', 'email', '', $tmpl$<h2 style="color:#06352F;">{{.copy.TaskAssignedHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewTaskLabel}}</a></p>{{end}}$tmpl$),
('security.incident', '00000000-0000-0000-0000-000000000000', 'email', '', $tmpl$<h2 style="color:#d32f2f;">{{.copy.SecurityIncidentHeading}}</h2>
<p style="background-color:#fce4ec; padding:15px; border-left:4px solid #d32f2f;">{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#d32f2f; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.RespondNowLabel}}</a></p>{{end}}$tmpl$),
('system.maintenance', '00000000-0000-0000-0000-000000000000', 'email', '', $tmpl$<h2 style="color:#1565c0;">{{.copy.SystemMaintenanceHeading}}</h2>
<p>{{.body}}</p>$tmpl$),
('pipeline.failed', '00000000-0000-0000-0000-000000000000', 'email', '', $tmpl$<h2 style="color:#e65100;">{{.copy.PipelineFailedHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#e65100; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewPipelineLabel}}</a></p>{{end}}$tmpl$),
('contract.expiring', '00000000-0000-0000-0000-000000000000', 'email', '', $tmpl$<h2 style="color:#ABB705;">{{.copy.ContractExpiringHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewContractLabel}}</a></p>{{end}}$tmpl$),
('generic', '00000000-0000-0000-0000-000000000000', 'email', '', $tmpl$<h2 style="color:#06352F;">{{.title}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewDetailsLabel}}</a></p>{{end}}$tmpl$),
('digest', '00000000-0000-0000-0000-000000000000', 'email', '', $tmpl$<h2 style="color:#06352F;">{{.copy.DigestHeading}}</h2>
<p><strong>{{.count}}</strong> {{.copy.DigestUnreadText}}.</p>
{{range .items}}<div style="border-bottom:1px solid #D1D8D5; padding:10px 0;">
<strong>{{.Title}}</strong><br>
<span style="color:#6C7874;">{{.Body}}</span>
</div>{{end}}
<p><a href="{{.dashboard_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAllNotificationsLabel}}</a></p>$tmpl$)
ON CONFLICT (id, channel, tenant_id) DO NOTHING;
