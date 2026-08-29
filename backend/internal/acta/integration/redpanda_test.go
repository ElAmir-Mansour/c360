//go:build integration

package integration

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"time"

	"github.com/docker/go-connections/nat"
	tc "github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	actaRedpandaImage     = "docker.redpanda.com/redpandadata/redpanda:v24.1.8"
	actaRedpandaKafkaPort = "9092/tcp"
)

func startActaRedpanda(ctx context.Context) (tc.Container, string, error) {
	container, err := tc.GenericContainer(ctx, tc.GenericContainerRequest{
		ContainerRequest: tc.ContainerRequest{
			Image:        actaRedpandaImage,
			User:         "root:root",
			ExposedPorts: []string{actaRedpandaKafkaPort},
			Entrypoint:   []string{"/bin/sh", "-c"},
			Cmd: []string{
				`until grep -q "# Injected by acta integration" /etc/redpanda/redpanda.yaml; do sleep 0.1; done; exec /entrypoint.sh redpanda start --mode=dev-container --smp=1 --memory=1G`,
			},
			Files: []tc.ContainerFile{
				{
					Reader:            bytes.NewReader([]byte(actaRedpandaBootstrapConfig)),
					ContainerFilePath: "/etc/redpanda/.bootstrap.yaml",
					FileMode:          0o600,
				},
			},
			WaitingFor: wait.ForMappedPort(actaRedpandaKafkaPort).WithStartupTimeout(2 * time.Minute),
		},
		Started: true,
	})
	if err != nil {
		return nil, "", fmt.Errorf("run redpanda: %w", err)
	}

	cleanup := func() {
		_ = container.Terminate(context.Background())
	}

	host, err := container.Host(ctx)
	if err != nil {
		cleanup()
		return nil, "", fmt.Errorf("resolve redpanda host: %w", err)
	}
	mappedKafkaPort, err := container.MappedPort(ctx, nat.Port(actaRedpandaKafkaPort))
	if err != nil {
		cleanup()
		return nil, "", fmt.Errorf("resolve redpanda kafka port: %w", err)
	}
	broker := net.JoinHostPort(host, mappedKafkaPort.Port())

	nodeConfig := []byte(renderActaRedpandaNodeConfig(host, mappedKafkaPort.Int()))
	if err := container.CopyToContainer(ctx, nodeConfig, "/etc/redpanda/redpanda.yaml", 0o600); err != nil {
		cleanup()
		return nil, "", fmt.Errorf("copy redpanda node config: %w", err)
	}

	ready := wait.ForAll(
		wait.ForLog("Successfully started Redpanda!").WithStartupTimeout(2*time.Minute),
		wait.ForListeningPort(nat.Port(actaRedpandaKafkaPort)).
			SkipInternalCheck().
			WithStartupTimeout(2*time.Minute),
	).WithDeadline(2 * time.Minute)
	if err := ready.WaitUntilReady(ctx, container); err != nil {
		logs := readActaRedpandaLogs(ctx, container)
		cleanup()
		if logs != "" {
			return nil, "", fmt.Errorf("wait for readiness: %w\nredpanda logs:\n%s", err, logs)
		}
		return nil, "", fmt.Errorf("wait for readiness: %w", err)
	}

	return container, broker, nil
}

func renderActaRedpandaNodeConfig(advertisedHost string, advertisedPort int) string {
	return fmt.Sprintf(`# Injected by acta integration
redpanda:
  admin:
    address: 0.0.0.0
    port: 9644

  kafka_api:
    - address: 0.0.0.0
      name: external
      port: 9092
      authentication_method: none
    - address: 0.0.0.0
      name: internal
      port: 9093
      authentication_method: none

  advertised_kafka_api:
    - address: %s
      name: external
      port: %d
    - address: 127.0.0.1
      name: internal
      port: 9093

schema_registry:
  schema_registry_api:
    - address: 0.0.0.0
      name: main
      port: 8081
      authentication_method: none

schema_registry_client:
  brokers:
    - address: localhost
      port: 9093

pandaproxy:
  pandaproxy_api:
    - address: 0.0.0.0
      port: 8082
      name: main
      authentication_method: none

pandaproxy_client:
  brokers:
    - address: localhost
      port: 9093

auto_create_topics_enabled: true
`, advertisedHost, advertisedPort)
}

const actaRedpandaBootstrapConfig = `# Injected by acta integration
superusers:
  []

auto_create_topics_enabled: true
`

func readActaRedpandaLogs(ctx context.Context, container tc.Container) string {
	logCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	logReader, err := container.Logs(logCtx)
	if err != nil {
		return ""
	}
	defer func() { _ = logReader.Close() }()

	raw, err := io.ReadAll(logReader)
	if err != nil {
		return ""
	}
	if len(raw) > 20000 {
		raw = raw[len(raw)-20000:]
	}
	return string(raw)
}
