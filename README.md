# pew-map

Live network packet capture visualization with animated geographic connections.

## Installation Guide — Ubuntu Server 24.04

### Prerequisites

- Ubuntu Server 24.04 LTS
- A user account with `sudo` privileges
- Internet access

---

### 1. Update the System

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js (v20 LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify the installation:

```bash
node -v
npm -v
```

### 3. Install Native Dependencies

The `pcap` npm package requires `libpcap` development headers and a C++ build toolchain:

```bash
sudo apt install -y build-essential libpcap-dev python3
```

### 4. Clone the Repository

```bash
git clone <your-repo-url> /opt/pew-map
cd /opt/pew-map
```

> Replace `<your-repo-url>` with the actual Git remote URL, or copy the project files manually.

### 5. Install Node Modules

```bash
npm install
```

### 6. Build the Frontend

```bash
npm run build
```

This compiles the React/Vite frontend into the `dist/` directory, which the Express server serves automatically.

### 7. Configure Environment Variables

```bash
cp .env.example .env
nano .env
```

Adjust the values to match your server's location:

```
PORT=3000

# Home Location (for private/RFC1918 IP addresses)
# Find coordinates at: https://www.latlong.net/
HOME_LATITUDE=37.7749
HOME_LONGITUDE=-122.4194
HOME_CITY=San Francisco
HOME_STATE=CA
HOME_COUNTRY=US
```

### 8. Allow Packet Capture Without Root

By default, raw packet capture requires root. To allow Node.js to capture packets as a regular user, grant the `cap_net_raw` capability:

```bash
sudo setcap cap_net_raw+ep $(which node)
```

> **Note:** This must be re-applied after any Node.js update.

### 9. Test the Application

```bash
sudo npm start
```

Visit `http://<your-server-ip>:3000` in a browser. You should see the map interface and be able to select a network interface to begin capturing.

Press `Ctrl+C` to stop.

### 10. Firewall Configuration

If UFW is enabled, allow the application port:

```bash
sudo ufw allow 3000/tcp
```

Or, if you plan to reverse-proxy behind Nginx on port 80/443, allow HTTP/HTTPS instead:

```bash
sudo ufw allow 'Nginx Full'
```

### 11. (Optional) Reverse Proxy with Nginx

Install Nginx:

```bash
sudo apt install -y nginx
```

Create a site configuration:

```bash
sudo nano /etc/nginx/sites-available/pew-map
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/pew-map /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

> The `Upgrade` and `Connection` headers are required for WebSocket support.

---

## Troubleshooting

- **`Error: No network interface available`** — Ensure libpcap is installed and the user has permission to capture packets (see Step 8).
- **`Cannot find module 'pcap'`** — The native addon failed to build. Verify `build-essential` and `libpcap-dev` are installed, then re-run `npm install`.
- **Frontend shows a blank page** — Make sure you ran `npm run build` so the `dist/` directory exists.
- **WebSocket connection fails behind Nginx** — Confirm the `Upgrade` and `Connection` proxy headers are set in the Nginx config.
