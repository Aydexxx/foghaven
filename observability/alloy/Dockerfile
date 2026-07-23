# syntax=docker/dockerfile:1
#
# A small, standalone Railway service running Grafana Alloy — the agent that
# scrapes the Foghaven game server's /metrics and remote_writes it to Grafana
# Cloud. See config.alloy for what it does and docs/DEPLOYMENT.md for how to
# deploy this service and wire its environment variables.

FROM grafana/alloy:latest
COPY config.alloy /etc/alloy/config.alloy
ENTRYPOINT ["/bin/alloy", "run", "/etc/alloy/config.alloy", "--server.http.listen-addr=0.0.0.0:12345"]
