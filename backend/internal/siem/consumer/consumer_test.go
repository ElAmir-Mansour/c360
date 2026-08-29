package consumer_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/siem/consumer"
)

func TestConsumer_SubscribeRegistersTopic(t *testing.T) {
	t.Parallel()
	c := consumer.New(zerolog.Nop())
	require.NoError(t, c.Subscribe("siem.test", func(_ context.Context, _ *events.Event) error { return nil }))

	subs := c.Subscriptions()
	require.Len(t, subs, 1)
	require.Equal(t, "siem.test", subs[0])
}

func TestConsumer_SubscribeRejectsBadInputs(t *testing.T) {
	t.Parallel()
	c := consumer.New(zerolog.Nop())
	require.Error(t, c.Subscribe("", func(_ context.Context, _ *events.Event) error { return nil }))
	require.Error(t, c.Subscribe("topic", nil))
}

func TestConsumer_StartStopLifecycle(t *testing.T) {
	t.Parallel()
	c := consumer.New(zerolog.Nop())

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		require.NoError(t, c.Start(context.Background()))
	}()

	// Wait for goroutine to mark running.
	require.Eventually(t, c.IsRunning, time.Second, 5*time.Millisecond)

	c.Stop()
	wg.Wait()

	require.False(t, c.IsRunning())
}

func TestConsumer_StartHonoursContextCancel(t *testing.T) {
	t.Parallel()
	c := consumer.New(zerolog.Nop())
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan error, 1)
	go func() { done <- c.Start(ctx) }()
	require.Eventually(t, c.IsRunning, time.Second, 5*time.Millisecond)

	cancel()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("consumer did not exit on context cancel")
	}
}

func TestConsumer_DoubleStartErrors(t *testing.T) {
	t.Parallel()
	c := consumer.New(zerolog.Nop())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() { _ = c.Start(ctx) }()
	require.Eventually(t, c.IsRunning, time.Second, 5*time.Millisecond)

	require.Error(t, c.Start(ctx))
}

func TestConsumer_StopIsIdempotent(t *testing.T) {
	t.Parallel()
	c := consumer.New(zerolog.Nop())
	c.Stop()
	c.Stop()
}
