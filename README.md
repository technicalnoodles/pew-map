# pew-map

Live network packet capture and firewall syslog visualization with animated geographic connections. Supports live packet capture, PCAP file replay, and real-time Cisco FTD syslog ingestion for IPS and Security Intelligence events.

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

If UFW is enabled, allow the application port and syslog reception:

```bash
sudo ufw allow 3000/tcp    # Web UI
sudo ufw allow 514/udp     # Syslog UDP
sudo ufw allow 514/tcp     # Syslog TCP
```

Or, if you plan to reverse-proxy behind Nginx on port 80/443, allow HTTP/HTTPS instead:

```bash
sudo ufw allow 'Nginx Full'
```

> **Note:** If you use a custom syslog port (e.g. 5514), open that port instead of 514.

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

## Syslog Mode — Cisco FTD IPS & Security Intelligence

pew-map can ingest syslog events from Cisco Firepower Threat Defense (FTD) devices and visualize malicious connections on the map in real time.

### Supported Event Types

- **430001** — Intrusion (IPS) events
- **430002** — Security Intelligence (SI) events

All other syslog message types (e.g. 430003 connection events) are ignored.

### Data Source Options

| Mode | Description |
|------|-------------|
| **Syslog File (IPS/SI)** | Load a JSON file containing an array of syslog strings for replay |
| **Live Syslog Receiver (IPS/SI)** | Start a UDP+TCP syslog server to receive events in real time |

### Configuring Your FTD

1. In FMC, navigate to **Devices > Platform Settings > Syslog**
2. Add a syslog server pointing to `<pew-map-server-ip>` on port `514` (or your custom port)
3. Ensure IPS and SI event logging is enabled under **Policies > Intrusion / Access Control**
4. Deploy changes to the FTD

### Threat Coloring

Connections are colored based on threat severity:

- **Security Intelligence events** — colored by `IP_ReputationSI_Category` (Malicious = red, Botnet/CnC = orange-red, Phishing = orange, Tor/Proxy = yellow-orange)
- **Intrusion events** — colored by `PriorityID` (1 = critical/red, 2 = high/orange, 3 = medium/yellow, 4 = low, 5 = info)

### Local Network Detection

If the ResponderIP is one of the following Cisco Umbrella/OpenDNS addresses, the connection is treated as originating from the local network:

- `208.67.222.222`, `208.67.220.220`
- `2620:119:35::35`, `2620:119:53::53`

Private (RFC 1918) IPs are mapped to your configured home location. Internal-to-internal connections are ignored.

### Example Syslog File

An example file is included at `examples/ftd-syslog-ips.json`. It contains a JSON array of raw syslog strings:

```json
[
  "2026-02-09T18:11:48Z FTD1  %FTD-1-430002: {\"EventPriority\":\"High\", ...}",
  "2026-02-09T17:35:19Z FTD1  %FTD-1-430001: {\"PriorityID\":3, ...}"
]
```

---

## Troubleshooting

- **`Error: No network interface available`** — Ensure libpcap is installed and the user has permission to capture packets (see Step 8).
- **`Cannot find module 'pcap'`** — The native addon failed to build. Verify `build-essential` and `libpcap-dev` are installed, then re-run `npm install`.
- **Frontend shows a blank page** — Make sure you ran `npm run build` so the `dist/` directory exists.
- **WebSocket connection fails behind Nginx** — Confirm the `Upgrade` and `Connection` proxy headers are set in the Nginx config.
- **Syslog events not appearing** — Verify the FTD is sending to the correct IP/port. Test with `sudo tcpdump -i any port 514 -A` to confirm traffic is arriving.
- **`EACCES` error on port 514** — Ports below 1024 require root. Either run with `sudo npm start` or use a port above 1024 (e.g. 5514) and update the FTD config to match.
- **Only seeing some syslog events** — pew-map only processes 430001 (IPS) and 430002 (SI) events. Connection events (430003) and other types are intentionally filtered out.
