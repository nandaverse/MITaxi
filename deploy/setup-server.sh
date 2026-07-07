#!/bin/bash
# One-time MiTaxi docs server bootstrap (Ubuntu/Debian).
# Run on the CLIENT server with sudo where noted.
#
# Prerequisites:
#   - DNS A record: docs.mitaxi.mx → this server's public IP
#   - Ports 80 and 443 open in firewall / security group
#   - git, nginx, certbot installed

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/nandaverse/MITaxi.git}"
BASE_DIR="${BASE_DIR:-/var/www/mitaxi-docs}"
DOMAIN="${DOMAIN:-docs.mitaxi.mx}"
DEPLOY_EMAIL="${DEPLOY_EMAIL:-admin@mitaxi.mx}"

echo "===== MiTaxi Docs — server bootstrap ====="

echo "Installing packages (nginx, certbot, git)..."
sudo apt-get update -qq
sudo apt-get install -y nginx certbot python3-certbot-nginx git

if [ ! -d "$BASE_DIR/.git" ]; then
  echo "Cloning repository to $BASE_DIR..."
  sudo mkdir -p "$(dirname "$BASE_DIR")"
  sudo git clone "$REPO_URL" "$BASE_DIR"
  sudo chown -R "$USER:$USER" "$BASE_DIR"
else
  echo "Repo already exists at $BASE_DIR"
fi

echo "Installing nginx site config..."
sudo cp "$BASE_DIR/deploy/nginx-docs.mitaxi.mx.conf" "/etc/nginx/sites-available/$DOMAIN"
sudo ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"

# Disable default site if it conflicts on port 80
if [ -f /etc/nginx/sites-enabled/default ]; then
  sudo rm -f /etc/nginx/sites-enabled/default
fi

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

echo "Requesting TLS certificate for $DOMAIN..."
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$DEPLOY_EMAIL" || {
  echo ""
  echo "Certbot failed — common causes:"
  echo "  - DNS not propagated yet (wait and re-run certbot)"
  echo "  - Port 80 not reachable from the internet"
  echo "  Re-run manually: sudo certbot --nginx -d $DOMAIN"
}

chmod +x "$BASE_DIR/deploy/deploy.sh"

echo ""
echo "===== Bootstrap complete ====="
echo "Site URL : https://$DOMAIN/"
echo "Deploy   : cd $BASE_DIR && ./deploy/deploy.sh"
echo "Nginx log: /var/log/nginx/$DOMAIN.error.log"