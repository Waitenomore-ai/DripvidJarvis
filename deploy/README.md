# DripVid JARVIS — Production Runbook

Deploys JARVIS on the dripvid.uk host behind the existing nginx.

## 1. Push code

```bash
sudo mkdir -p /opt/dripvid-jarvis
sudo chown dripvid-jarvis:dripvid-jarvis /opt/dripvid-jarvis
# either clone and let dripvid-jarvis own the tree:
sudo -u dripvid-jarvis git clone <this-repo> /opt/dripvid-jarvis/app
# or rsync the built `app` tree from a release:
# rsync -az app/ dripvid-jarvis@<host>:/opt/dripvid-jarvis/app/
sudo chown -R dripvid-jarvis:dripvid-jarvis /opt/dripvid-jarvis
```

JARVIS has no npm deps (Node-builtins only), so no `npm install` is required.

## 2. Environment

```bash
sudo install -m 0600 deploy/dripvid-jarvis.env.example /etc/dripvid-jarvis.env
sudo nano /etc/dripvid-jarvis.env      # set a real cloud LLM key + voice key
```

The systemd unit (`deploy/dripvid-jarvis.service`) reads `/etc/dripvid-jarvis.env`
and runs under the `dripvid-jarvis` user with `ReadWritePaths=/opt/dripvid-jarvis`.

```bash
sudo install -m 0644 deploy/dripvid-jarvis.service /etc/systemd/system/
sudo useradd --system --home /opt/dripvid-jarvis --shell /usr/sbin/nologin dripvid-jarvis || true
sudo systemctl daemon-reload
sudo systemctl enable --now dripvid-jarvis
sudo systemctl status dripvid-jarvis
curl -s http://127.0.0.1:3342/api/health
```

## 3. Optional auto-verify

```bash
sudo install -m 0644 deploy/dripvid-jarvis-verify.service /etc/systemd/system/
sudo install -m 0644 deploy/dripvid-jarvis-verify.timer  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dripvid-jarvis-verify.timer
```

## 4. Expose at dripvid.uk/jarvis

Add `deploy/nginx-jarvis.conf` to the dripvid.uk server block, create the
basic-auth password file, then validate and reload:

```bash
sudo htpasswd -c /etc/nginx/.htpasswd-jarvis <admin-user>
sudo nginx -t
sudo systemctl reload nginx
```

Verify from outside:
```bash
curl -u <admin-user> https://dripvid.uk/jarvis/api/health
```

## Verify end-to-end

- Browser → `https://dripvid.uk/jarvis/` prompts for basic auth.
- HUD shows OverdueHealth; DripVid + MCP should be `online` when those
  services run on this host (defaults: `http://127.0.0.1:3000` and
  `http://127.0.0.1:8788/mcp`).
- Confirmations still require in-app approval (JARVIS stays read-only by
  default); nothing changes DripVid state without explicit consenting.

## TLS / firewalling notes

- JARVIS binds 127.0.0.1 only — nginx is the only entry point.
- do NOT publish port 3342 publicly. If the host firewall allows, restrict to loopback:
  `ufw deny 3342` (or omit the allow rule entirely).
- Secrets live only in `/etc/dripvid-jarvis.env` (0600). Nothing is committed to git.