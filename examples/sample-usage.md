# Sample Usage Examples

## Example 1: Monitor Live Network Traffic

```bash
# Start the server with root privileges
sudo npm start

# In browser (http://localhost:3000):
# 1. Select "Live Capture"
# 2. Choose network interface (e.g., en0, eth0)
# 3. Click "Start Capture"
# 4. Browse the web or generate traffic
# 5. Watch connections appear on the map!
```

## Example 2: Analyze a PCAP File

```bash
# First, create a test PCAP file
sudo tcpdump -c 100 -w /tmp/test.pcap

# Start the server
sudo npm start

# In browser (http://localhost:3000):
# 1. Select "PCAP File"
# 2. Enter path: /tmp/test.pcap
# 3. Click "Start Capture"
```

## Example 3: Generate Traffic for Testing

```bash
# Terminal 1: Start capture
sudo npm start

# Terminal 2: Generate diverse traffic
ping -c 10 google.com
curl https://www.github.com
curl https://www.reddit.com
curl https://www.bbc.co.uk
nslookup amazon.com
```

## Example 4: Capture Specific Traffic

```bash
# Capture only HTTP/HTTPS traffic
sudo tcpdump -w web-traffic.pcap port 80 or port 443

# Capture only DNS traffic
sudo tcpdump -w dns-traffic.pcap port 53

# Capture traffic from specific host
sudo tcpdump -w host-traffic.pcap host 8.8.8.8
```

## Tips

### Get the Absolute Path of a PCAP File
```bash
realpath myfile.pcap
# or
readlink -f myfile.pcap
```

### Monitor Busy Interface
If you have a server with lots of traffic, adjust animation duration to see connections better:
- Set to 1000ms for fast-paced visualization
- Set to 5000ms for slower, easier-to-follow connections

### Test with Public IPs Only
The visualizer automatically filters private IP connections. To see results:
- Use `curl` to fetch from various international websites
- Run `ping` to various geographic locations
- Browse different country-specific websites
