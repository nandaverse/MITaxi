#!/bin/bash
# MiTaxi documentation — production deploy on client server
# Serves the static site/ folder at https://docs.mitaxi.mx
#
# First-time server setup (run once as root/sudo):
#   1. Clone repo:  git clone https://github.com/nandaverse/MITaxi.git /var/www/mitaxi-docs
#   2. Copy nginx:  sudo cp deploy/nginx-docs.mitaxi.mx.conf /etc/nginx/sites-available/docs.mitaxi.mx
#   3. Enable site: sudo ln -sf /etc/nginx/sites-available/docs.mitaxi.mx /etc/nginx/sites-enabled/
#   4. DNS A record: docs.mitaxi.mx → this server's public IP
#   5. SSL cert:     sudo certbot --nginx -d docs.mitaxi.mx
#   6. Test/reload:  sudo nginx -t && sudo systemctl reload nginx
#
# Routine deploy (after setup):
#   cd /var/www/mitaxi-docs && ./deploy/deploy.sh

set -euo pipefail

BASE_DIR="${BASE_DIR:-/var/www/mitaxi-docs}"
SITE_DIR="$BASE_DIR/site"
DOMAIN="${DOMAIN:-docs.mitaxi.mx}"
BRANCH="${BRANCH:-main}"

echo "===== MiTaxi Docs Deploy — $DOMAIN ====="
echo "Base: $BASE_DIR"

if [ ! -d "$BASE_DIR/.git" ]; then
  echo "ERROR: $BASE_DIR is not a git repo. Clone first:"
  echo "  git clone https://github.com/nandaverse/MITaxi.git $BASE_DIR"
  exit 1
fi

echo "Pulling latest from origin/$BRANCH..."
cd "$BASE_DIR"
git fetch origin
git reset --hard "origin/$BRANCH"

if [ ! -f "$SITE_DIR/index.html" ]; then
  echo "ERROR: $SITE_DIR/index.html not found after pull."
  exit 1
fi

# Optional: verify key assets exist
for f in app.js styles.css content/driver.json content/passenger.json content/admin.json; do
  if [ ! -e "$SITE_DIR/$f" ]; then
    echo "WARNING: missing $SITE_DIR/$f"
  fi
done

# Reload nginx if installed (picks up any config changes + clears stale file handles)
if command -v nginx >/dev/null 2>&1; then
  if sudo nginx -t 2>/dev/null; then
    echo "Reloading nginx..."
    sudo systemctl reload nginx
  else
    echo "WARNING: nginx config test failed — skipping reload."
  fi
fi

echo "------------------------------"
echo "Site root : $SITE_DIR"
echo "Domain    : https://$DOMAIN/"
echo "Files     : $(find "$SITE_DIR" -type f | wc -l | tr -d ' ') files"
echo "Size      : $(du -sh "$SITE_DIR" | cut -f1)"
echo "===== DEPLOY COMPLETE at $(TZ='America/Mexico_City' date '+%Y-%m-%d %H:%M:%S %Z') ====="