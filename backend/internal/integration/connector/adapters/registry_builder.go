package adapters

import (
	"github.com/clario360/platform/internal/integration/connector"
	"github.com/clario360/platform/internal/integration/connector/connectors"
	"github.com/clario360/platform/internal/integration/service/jira"
	"github.com/clario360/platform/internal/integration/service/servicenow"
	"github.com/clario360/platform/internal/integration/service/slack"
	"github.com/clario360/platform/internal/integration/service/teams"
	"github.com/clario360/platform/internal/integration/service/webhook"
)

// Clients bundles the five existing client/service instances the integration
// engine already constructs in main.go. BuildDefaultRegistry wraps each in its
// adapter and registers it, producing the single dispatch point used by the
// delivery and integration services.
type Clients struct {
	Slack      *slack.Client
	Teams      *teams.Client
	Webhook    *webhook.Client
	Jira       *jira.Service
	ServiceNow *servicenow.Service
}

// BuildDefaultRegistry constructs the five client-backed adapters from the
// supplied client instances, plus the three pure-SDK connectors (email,
// pagerduty, rest) that need no client instance, and registers them all into a
// fresh connector.Registry. It uses MustRegister because a registration failure
// here is a programming error (a malformed built-in manifest or a duplicate
// type), not a runtime condition — and every manifest is validated at
// registration time.
//
// The same client instances main.go builds are passed through, so the registry
// dispatches to the identical client code the legacy type-switch invoked. The
// three SDK connectors are stateless (each constructs its own HTTP/SMTP client),
// so they are safe to register here unconditionally — this is also what makes
// the config-validation registry (built with empty Clients) able to validate
// their config via the same manifest path.
//
// This single builder is the one source of truth used by both the dispatch
// services (delivery + integration) and the config-validation path, so any
// connector is validated and dispatched through exactly the same manifest.
func BuildDefaultRegistry(clients Clients) *connector.Registry {
	r := connector.NewRegistry()
	r.MustRegister(NewSlackAdapter(clients.Slack))
	r.MustRegister(NewTeamsAdapter(clients.Teams))
	r.MustRegister(NewWebhookAdapter(clients.Webhook))
	r.MustRegister(NewJiraAdapter(clients.Jira))
	r.MustRegister(NewServiceNowAdapter(clients.ServiceNow))
	r.MustRegister(connectors.New())          // email (SMTP)
	r.MustRegister(connectors.NewPagerDuty()) // pagerduty
	r.MustRegister(connectors.NewREST())      // rest / generic webhook
	return r
}
