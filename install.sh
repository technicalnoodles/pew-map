#!/usr/bin/env bash
set -euo pipefail

echo "=== pew-map installer for Ubuntu Server 24.04 ==="
echo ""

if [ ! -f "package.json" ]; then
  echo "ERROR: package.json not found. Run this script from the pew-map directory."
  exit 1
fi

# 1. Update the system
echo "[1/7] Updating system packages..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js v20 LTS
echo "[2/7] Installing Node.js v20 LTS..."
if command -v node &>/dev/null; then
  echo "       Node.js already installed: $(node -v)"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo "       node $(node -v) / npm $(npm -v)"

# 3. Install native dependencies
echo "[3/7] Installing build tools and libpcap..."
sudo apt install -y build-essential libpcap-dev python3

# 4. Install node modules
echo "[4/7] Installing node modules..."
npm install

# 5. Build the frontend
echo "[5/7] Building frontend..."
npm run build

# 6. Configure environment variables
echo "[6/7] Configuring environment variables..."
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "       Created .env from .env.example — edit .env to set your location."
else
  echo "       .env already exists, skipping."
fi

# 7. Allow packet capture without root
echo "[7/7] Granting cap_net_raw to Node.js..."
sudo setcap cap_net_raw+ep "$(which node)"

echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your location coordinates"
echo "  2. Run: sudo npm start"
echo "  3. Open http://<your-server-ip>:3000 in a browser"
