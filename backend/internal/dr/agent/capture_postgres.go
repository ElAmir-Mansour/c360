package agent

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/datastream/core"
)

// pgCapturer wraps a shared-core PGCapturer together with the pgx pool it owns,
// so closing the capturer also releases the agent's connection to the local
// source database. The agent OWNS this pool (it dialed the customer's primary
// DB) so it is responsible for closing it.
type pgCapturer struct {
	*core.PGCapturer
	pool *pgxpool.Pool
}

// Close stops the capturer and releases the owned pgx pool.
func (c *pgCapturer) Close() error {
	err := c.PGCapturer.Close()
	if c.pool != nil {
		c.pool.Close()
	}
	return err
}

// newPostgresCapturer dials the local source PostgreSQL database and builds the
// configured PostgreSQL capture driver. Logical mode uses PostgreSQL's
// replication protocol (pgoutput/wal2json) and resumes from checkpointed LSNs;
// watermark mode is the compatibility fallback for estates without logical
// replication enabled.
func newPostgresCapturer(ctx context.Context, spec SourceSpec, cp Checkpoint) (core.Capturer, error) {
	tableCfg := core.PGTableConfig{
		Schema:     spec.PGTable.Schema,
		Table:      spec.PGTable.Table,
		Columns:    spec.PGTable.Columns,
		PrimaryKey: spec.PGTable.PrimaryKey,
		Watermark:  spec.PGTable.Watermark,
	}
	if spec.normalizedPostgresMode() == PostgresModeLogical {
		return newPostgresLogicalCapturer(ctx, spec, tableCfg, cp)
	}

	pool, err := pgxpool.New(ctx, spec.DSN)
	if err != nil {
		return nil, fmt.Errorf("agent: connect postgres source %s: %w", spec.StreamID, err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("agent: ping postgres source %s: %w", spec.StreamID, err)
	}

	capturer, err := core.NewPGCapturer(pool, spec.StreamID, tableCfg)
	if err != nil {
		pool.Close()
		return nil, err
	}
	if cp.SourceLSN != "" {
		capturer.SetResumeWatermark(cp.SourceLSN)
	}
	// The agent ships a perpetual stream: keep capturing changes until the
	// session ctx is cancelled (link drop / shutdown), then the runtime reconnects
	// and resumes from the local checkpoint.
	capturer.Continuous = true

	return &pgCapturer{PGCapturer: capturer, pool: pool}, nil
}

func newPostgresLogicalCapturer(ctx context.Context, spec SourceSpec, tableCfg core.PGTableConfig, cp Checkpoint) (core.Capturer, error) {
	replicationCfg := core.PGConnLogicalReplicationConfig{
		ConnString: spec.DSN,
		SlotName:   spec.PGLogical.SlotName,
		PluginArgs: append([]string(nil), spec.PGLogical.PluginArgs...),
	}
	var source core.PGLogSource
	var err error
	switch spec.normalizedLogicalPlugin() {
	case "pgoutput":
		if len(replicationCfg.PluginArgs) == 0 {
			replicationCfg.PluginArgs, err = core.PGOutputPluginArgs(spec.PGLogical.Publications...)
			if err != nil {
				return nil, err
			}
		}
		source, err = core.NewPGOutputLogSource(ctx, replicationCfg)
	case "wal2json":
		source, err = core.NewPGWal2JSONLogSource(ctx, replicationCfg)
	default:
		return nil, fmt.Errorf("agent: unsupported postgres logical plugin %q", spec.PGLogical.Plugin)
	}
	if err != nil {
		return nil, fmt.Errorf("agent: connect postgres logical source %s: %w", spec.StreamID, err)
	}

	capturer, err := core.NewPGLogCapturer(source, spec.StreamID, tableCfg)
	if err != nil {
		_ = source.Close()
		return nil, err
	}
	if cp.SourceLSN != "" {
		capturer.SetResumeLSN(cp.SourceLSN)
	}
	capturer.Continuous = true
	return capturer, nil
}
