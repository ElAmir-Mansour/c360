package service

import (
	"errors"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/channel"
	"github.com/clario360/platform/internal/notification/model"
)

func boolPtr(b bool) *bool { return &b }

// TestDeliveryFailureRetryable covers the 429/5xx-retryable vs 4xx-terminal
// classification used by both the dispatcher and the retry worker.
func TestDeliveryFailureRetryable(t *testing.T) {
	tests := []struct {
		name string
		res  *channel.ChannelResult
		want bool
	}{
		{name: "explicit retryable true", res: &channel.ChannelResult{Retryable: boolPtr(true), Error: errors.New("x")}, want: true},
		{name: "explicit retryable false", res: &channel.ChannelResult{Retryable: boolPtr(false), Error: errors.New("x")}, want: false},
		{name: "webhook 503 retriable", res: &channel.ChannelResult{Error: errors.New("webhook returned 503 (retriable)")}, want: true},
		{name: "webhook 404 permanent", res: &channel.ChannelResult{Error: errors.New("webhook returned 404 (permanent)")}, want: false},
		{name: "sendgrid 429", res: &channel.ChannelResult{Error: errors.New("sendgrid returned status 429")}, want: true},
		{name: "sendgrid 400", res: &channel.ChannelResult{Error: errors.New("sendgrid returned status 400")}, want: false},
		{name: "sendgrid 500", res: &channel.ChannelResult{Error: errors.New("sendgrid returned status 500")}, want: true},
		{name: "network error transient", res: &channel.ChannelResult{Error: errors.New("dial tcp 10.0.0.1:587: connect: connection refused")}, want: true},
		{name: "circuit breaker open", res: &channel.ChannelResult{Error: errors.New("circuit breaker is open")}, want: true},
		{name: "nil error", res: &channel.ChannelResult{Success: false}, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := deliveryFailureRetryable(tt.res); got != tt.want {
				t.Fatalf("deliveryFailureRetryable(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

// TestBackoffExponentialBounded asserts the backoff grows exponentially with the
// attempt number, stays within the [d/2, d] full-jitter band, and is capped at
// maxBackoff.
func TestBackoffExponentialBounded(t *testing.T) {
	w := NewRetryWorker(nil, nil, nil, 0, 0, zerolog.Nop())
	policy := model.WebhookRetryPolicy{BackoffType: "exponential", InitialDelaySeconds: 10, MaxRetries: 5}

	// attempt → nominal delay (base 10s, exponential): 10, 20, 40.
	cases := []struct {
		attempt int
		nominal time.Duration
	}{
		{1, 10 * time.Second},
		{2, 20 * time.Second},
		{3, 40 * time.Second},
	}
	for _, c := range cases {
		// Sample several times because of jitter.
		for i := 0; i < 50; i++ {
			d := w.backoff(model.ChannelWebhook, c.attempt, policy)
			if d < c.nominal/2 || d > c.nominal {
				t.Fatalf("attempt %d: backoff %s outside jitter band [%s,%s]", c.attempt, d, c.nominal/2, c.nominal)
			}
		}
	}

	// Very high attempt is capped at maxBackoff.
	d := w.backoff(model.ChannelWebhook, 40, policy)
	if d > w.maxBackoff {
		t.Fatalf("backoff %s exceeded cap %s", d, w.maxBackoff)
	}
	if d < w.maxBackoff/2 {
		t.Fatalf("capped backoff %s below expected jitter floor %s", d, w.maxBackoff/2)
	}
}

// TestBackoffFixedPolicy asserts a webhook "fixed" backoff_type does not grow
// with the attempt number.
func TestBackoffFixedPolicy(t *testing.T) {
	w := NewRetryWorker(nil, nil, nil, 0, 0, zerolog.Nop())
	policy := model.WebhookRetryPolicy{BackoffType: "fixed", InitialDelaySeconds: 15}

	for _, attempt := range []int{1, 3, 7} {
		d := w.backoff(model.ChannelWebhook, attempt, policy)
		// Fixed base 15s → jitter band [7.5s, 15s] regardless of attempt.
		if d < 7500*time.Millisecond || d > 15*time.Second {
			t.Fatalf("fixed backoff attempt %d = %s, want within [7.5s,15s]", attempt, d)
		}
	}
}

// TestBackoffNonWebhookUsesBase asserts non-webhook channels use the worker base
// backoff (30s) exponentially.
func TestBackoffNonWebhookUsesBase(t *testing.T) {
	w := NewRetryWorker(nil, nil, nil, 0, 0, zerolog.Nop())
	d := w.backoff(model.ChannelInApp, 1, model.DefaultRetryPolicy())
	if d < defaultBaseBackoff/2 || d > defaultBaseBackoff {
		t.Fatalf("first-attempt in_app backoff %s outside [%s,%s]", d, defaultBaseBackoff/2, defaultBaseBackoff)
	}
}
