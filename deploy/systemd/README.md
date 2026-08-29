# clario-dr-agent systemd deployment

This directory contains a reference systemd unit for running the customer-side
ClarioDR capture agent on Linux hosts. The agent has no dependency on the
platform service config; all runtime inputs come from
`/etc/clario360/clario-dr-agent.yaml` plus optional environment overrides.

## Host install

Build the static binary:

```sh
make dr-agent-build-static
```

Create the service user and install the files:

```sh
sudo useradd --system --home-dir /var/lib/clario-dr-agent --shell /usr/sbin/nologin clario-dr-agent
sudo install -d -o clario-dr-agent -g clario-dr-agent -m 0700 /var/lib/clario-dr-agent
sudo install -d -o root -g clario-dr-agent -m 0750 /etc/clario360
sudo install -o root -g root -m 0755 backend/bin/clario-dr-agent /usr/local/bin/clario-dr-agent
sudo install -o root -g clario-dr-agent -m 0640 backend/cmd/clario-dr-agent/clario-dr-agent.example.yaml /etc/clario360/clario-dr-agent.yaml
sudo install -o root -g clario-dr-agent -m 0640 deploy/systemd/clario-dr-agent.env.example /etc/clario360/clario-dr-agent.env
sudo install -o root -g root -m 0644 deploy/systemd/clario-dr-agent.service /etc/systemd/system/clario-dr-agent.service
```

Edit `/etc/clario360/clario-dr-agent.yaml` for the site and put secrets in
`/etc/clario360/clario-dr-agent.env`. The enrollment token is single-use; remove
it from the env file after the first successful enrollment.

For long-running agents, deliver fresh single-use rotate tokens to the configured
`renewal_token_file` before the certificate enters its renewal window. The agent
rereads that file at renewal time, exchanges a new CSR, persists the renewed
certificate atomically, and uses it on the next mTLS reconnect without a process
restart. Stream DEKs and DSNs can also be supplied through
`CLARIO_DR_AGENT_DEK_<STREAM>_FILE` and
`CLARIO_DR_AGENT_DSN_<STREAM>_FILE`; direct environment values take precedence
over file-backed values.

```sh
sudo install -d -o clario-dr-agent -g clario-dr-agent -m 0700 /run/clario-dr-agent
printf '%s' "$ROTATE_TOKEN" | sudo -u clario-dr-agent tee /run/clario-dr-agent/rotate-token.jwt >/dev/null
sudo chmod 0600 /run/clario-dr-agent/rotate-token.jwt
```

Start the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now clario-dr-agent
systemctl status clario-dr-agent
journalctl -u clario-dr-agent -f
```

The unit writes to `/var/lib/clario-dr-agent`, where the private key, issued
certificate, CA chain, and stream checkpoints are persisted, and to
`/run/clario-dr-agent`, where short-lived rotation tokens can be delivered.

## Enrollment-only dry run

To verify enrollment and persist the certificate before starting shipping:

```sh
sudo -u clario-dr-agent CLARIO_DR_AGENT_ENROLLMENT_TOKEN="$TOKEN" \
  /usr/local/bin/clario-dr-agent --config /etc/clario360/clario-dr-agent.yaml --enroll-only
```

## Reference container

Build the image:

```sh
make dr-agent-image
```

Run it with persistent state and a read-only config mount:

```sh
docker run --rm --name clario-dr-agent \
  --env-file /etc/clario360/clario-dr-agent.env \
  -e CLARIO_DR_AGENT_METRICS_ADDR=:9098 \
  -v /etc/clario360/clario-dr-agent.yaml:/etc/clario360/clario-dr-agent.yaml:ro \
  -v /etc/clario360/enroll-ca.pem:/etc/clario360/enroll-ca.pem:ro \
  -v /run/clario-dr-agent:/run/clario-dr-agent \
  -v /var/lib/clario-dr-agent:/var/lib/clario-dr-agent \
  -p 127.0.0.1:9098:9098 \
  clario360/clario-dr-agent:latest
```
