# Deploying on a VPS with nginx and pm2

This guide runs fic-invoicing as a Node process managed by [pm2](https://pm2.keymetrics.io/), behind nginx
with TLS. Builds happen in a sibling directory, so the running release is never half-built; the switch is an
atomic symlink swap followed by a pm2 reload.

Assumptions: Ubuntu/Debian, Node 24, a MySQL 8 server, a domain such as `invoices.example.com`.
Adapt paths and names to your setup.

## Layout

```
/srv/fic-invoicing/
├── shared/.env               # secrets, shared by all releases
├── releases/20261111-1530/   # one directory per build
├── releases/20261112-0900/
└── current -> releases/20261112-0900
```

## 1. One-time setup

```bash
sudo mkdir -p /srv/fic-invoicing/{releases,shared}
sudo chown -R deploy:deploy /srv/fic-invoicing
npm install -g pm2

# MySQL database and user
mysql -u root -p <<'SQL'
CREATE DATABASE fic_invoicing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'fic'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON fic_invoicing.* TO 'fic'@'localhost';
SQL
```

Create `/srv/fic-invoicing/shared/.env` from `.env.example` (`chmod 600`). Set
`PUBLIC_BASE_URL=https://invoices.example.com` and
`DATABASE_URL=mysql://fic:...@127.0.0.1:3306/fic_invoicing`.

## 2. Build a release (in a sibling directory)

```bash
set -euo pipefail
APP=/srv/fic-invoicing
REL=$APP/releases/$(date +%Y%m%d-%H%M)

git clone --depth 1 https://github.com/<you>/fic-invoicing.git "$REL"
cd "$REL"
ln -s $APP/shared/.env .env
npm ci
npm run build

# Standalone output: copy static assets next to the server
cp -r .next/static .next/standalone/.next/static
ln -s $APP/shared/.env .next/standalone/.env

# Apply database migrations (backwards-compatible migrations make this safe while the old release runs)
npx prisma migrate deploy
```

## 3. Smoke test the new release before switching

Start it on a spare port and hit the health check:

```bash
cd "$REL/.next/standalone"
PORT=3999 HOSTNAME=127.0.0.1 node server.js &
PID=$!
sleep 3
curl -fsS http://127.0.0.1:3999/api/v1/health   # {"status":"ok","database":"ok"}
kill $PID
```

If the health check fails, stop here: `current` still points at the old release.

## 4. Swap and reload

```bash
ln -sfn "$REL" $APP/current.tmp && mv -T $APP/current.tmp $APP/current
pm2 reload fic-invoicing --update-env || \
  pm2 start $APP/current/.next/standalone/server.js --name fic-invoicing \
    --cwd $APP/current/.next/standalone --time
pm2 save
curl -fsS https://invoices.example.com/api/v1/health
```

The first time, also run `pm2 startup` and follow its instructions so pm2 starts on boot. pm2 resolves the
`current` symlink at start; `pm2 reload` restarts the process in the new directory.

Environment: `server.js` listens on `PORT` (default 3000) and `HOSTNAME`. Set them in pm2, for example with an
`ecosystem.config.cjs`:

```js
module.exports = {
  apps: [{
    name: "fic-invoicing",
    script: "server.js",
    cwd: "/srv/fic-invoicing/current/.next/standalone",
    env: { NODE_ENV: "production", PORT: "3000", HOSTNAME: "127.0.0.1" },
  }],
};
```

Run **one instance** (no cluster mode): the API rate limiter is in memory. Token refresh is safe with
several instances because it uses a database row lock.

## 5. Rollback

```bash
ln -sfn /srv/fic-invoicing/releases/<previous> /srv/fic-invoicing/current
pm2 reload fic-invoicing
```

Keep the last few releases and delete older ones: `ls -1dt /srv/fic-invoicing/releases/* | tail -n +6 | xargs rm -rf`.

## 6. nginx

```nginx
server {
  listen 443 ssl http2;
  server_name invoices.example.com;

  ssl_certificate     /etc/letsencrypt/live/invoices.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/invoices.example.com/privkey.pem;

  client_max_body_size 1m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}

server {
  listen 80;
  server_name invoices.example.com;
  return 301 https://$host$request_uri;
}
```

The `Host` and `X-Forwarded-*` headers matter: Next.js checks the origin of admin form submissions (server
actions) against them.

Consider restricting `/admin` to your IP or VPN with an extra `location /admin { allow ...; deny all; ... }`
block, since the admin panel has a single shared password.

## 7. Monitoring

- Health check: `GET /api/v1/health` (no auth) returns `200` when the app and database are up, `503` otherwise.
- Logs: `pm2 logs fic-invoicing`. Errors from Fatture in Cloud are also stored on the invoice (`errorMessage`).
- Watch for tenants flagged **reconnect required** in the admin panel.
- Back up the MySQL database and keep `ENCRYPTION_KEY` safe: without it the stored tokens cannot be decrypted.
