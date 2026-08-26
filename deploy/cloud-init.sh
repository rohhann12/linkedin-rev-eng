#!/bin/bash
# EC2 bootstrap. Passed as user-data by deploy/launch-ec2.sh.
#
# Note what is deliberately NOT in here: the LinkedIn session. User-data is
# readable by anything that can reach the instance metadata service, so a
# cookie baked in here would be a credential sitting in plaintext for the life
# of the instance. The session arrives afterwards, over TLS, through the
# authenticated admin endpoint:
#
#     npm run mint -- --push https://<host>
#
# The box therefore never holds a LinkedIn password, and never receives the
# cookie by any channel an operator did not explicitly open.
set -euxo pipefail

REPO_URL="${REPO_URL:-https://github.com/rohhann12/linkedin-rev-eng.git}"
APP_DIR=/opt/linkedin-api
DOMAIN="${DOMAIN:-}"

dnf update -y
dnf install -y git

# Node 22 from NodeSource.
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs

id -u app &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin app

git clone --depth 1 "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"
npm ci --omit=dev
chown -R app:app "$APP_DIR"

# Runtime config. ADMIN_TOKEN is injected by the launch script; the LinkedIn
# session is seeded later via the admin endpoint.
install -o app -g app -m 600 /dev/null "$APP_DIR/.env"
cat > "$APP_DIR/.env" <<ENVEOF
PORT=3000
ADMIN_TOKEN=${ADMIN_TOKEN}
API_KEYS=${API_KEYS:-}
# Survives restarts and reboots. systemd's ProtectSystem=strict makes
# /opt/linkedin-api the only writable path, so the session lives there.
SESSION_FILE=/opt/linkedin-api/.session.json
CACHE_TTL_SECONDS=86400
RATE_LIMIT_PER_MINUTE=20
UPSTREAM_MIN_INTERVAL_MS=1500
FETCH_TIMEOUT_MS=20000
STRATEGY_ORDER=rest,embedded,graphql
ENVEOF
chown app:app "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

cat > /etc/systemd/system/linkedin-api.service <<'UNITEOF'
[Unit]
Description=LinkedIn Profile API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=app
WorkingDirectory=/opt/linkedin-api
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# The process needs nothing but its own directory and outbound network.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/linkedin-api

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable --now linkedin-api

# Caddy terminates TLS and reverse-proxies to the app. With a DOMAIN set it
# provisions a Let's Encrypt certificate automatically on first request; without
# one it serves plain HTTP on :80 so the instance is reachable by IP immediately.
dnf install -y 'dnf-command(copr)'
dnf copr enable -y @caddy/caddy epel-9-x86_64 || true
dnf install -y caddy || {
  curl -fsSL "https://github.com/caddyserver/caddy/releases/latest/download/caddy_linux_amd64.tar.gz" \
    | tar -xz -C /usr/local/bin caddy
  useradd --system --create-home --shell /usr/sbin/nologin caddy || true
}

if [ -n "$DOMAIN" ]; then
  cat > /etc/caddy/Caddyfile <<CADDYEOF
${DOMAIN} {
    reverse_proxy localhost:3000
}
CADDYEOF
else
  cat > /etc/caddy/Caddyfile <<'CADDYEOF'
:80 {
    reverse_proxy localhost:3000
}
CADDYEOF
fi

systemctl enable --now caddy
systemctl restart caddy

echo "bootstrap complete"
