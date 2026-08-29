-- Restore only the exact palette-migrated platform defaults. Any template
-- customized after the forward migration is intentionally left untouched.
UPDATE notification_templates AS template
SET body_tmpl = replacement.old_body,
    updated_at = now()
FROM (VALUES
  ('alert.created', $old$<h2 style="color:#d32f2f;">{{.copy.SecurityAlertHeading}}</h2>
<p><strong>{{.copy.PriorityLabel}}:</strong> {{.priority}}</p>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#1B5E20; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAlertLabel}}</a></p>{{end}}$old$, $new$<h2 style="color:#d32f2f;">{{.copy.SecurityAlertHeading}}</h2>
<p><strong>{{.copy.PriorityLabel}}:</strong> {{.priority}}</p>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAlertLabel}}</a></p>{{end}}$new$),
  ('task.assigned', $old$<h2 style="color:#1B5E20;">{{.copy.TaskAssignedHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#1B5E20; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewTaskLabel}}</a></p>{{end}}$old$, $new$<h2 style="color:#06352F;">{{.copy.TaskAssignedHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewTaskLabel}}</a></p>{{end}}$new$),
  ('contract.expiring', $old$<h2 style="color:#C6A962;">{{.copy.ContractExpiringHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#1B5E20; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewContractLabel}}</a></p>{{end}}$old$, $new$<h2 style="color:#ABB705;">{{.copy.ContractExpiringHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewContractLabel}}</a></p>{{end}}$new$),
  ('generic', $old$<h2>{{.title}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#1B5E20; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewDetailsLabel}}</a></p>{{end}}$old$, $new$<h2 style="color:#06352F;">{{.title}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewDetailsLabel}}</a></p>{{end}}$new$),
  ('digest', $old$<h2>{{.copy.DigestHeading}}</h2>
<p><strong>{{.count}}</strong> {{.copy.DigestUnreadText}}.</p>
{{range .items}}<div style="border-bottom:1px solid #eee; padding:10px 0;">
<strong>{{.Title}}</strong><br>
<span style="color:#666;">{{.Body}}</span>
</div>{{end}}
<p><a href="{{.dashboard_url}}" style="background-color:#1B5E20; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAllNotificationsLabel}}</a></p>$old$, $new$<h2 style="color:#06352F;">{{.copy.DigestHeading}}</h2>
<p><strong>{{.count}}</strong> {{.copy.DigestUnreadText}}.</p>
{{range .items}}<div style="border-bottom:1px solid #D1D8D5; padding:10px 0;">
<strong>{{.Title}}</strong><br>
<span style="color:#6C7874;">{{.Body}}</span>
</div>{{end}}
<p><a href="{{.dashboard_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAllNotificationsLabel}}</a></p>$new$)
) AS replacement(id, old_body, new_body)
WHERE template.id = replacement.id
  AND template.tenant_id = '00000000-0000-0000-0000-000000000000'
  AND template.channel = 'email'
  AND template.body_tmpl = replacement.new_body;
