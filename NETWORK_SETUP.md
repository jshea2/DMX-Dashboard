# Network Setup Guide

## Overview

The DMX Dashboard application now supports binding different services to specific network interfaces. This allows you to have:
- **One network interface** dedicated to DMX output (Art-Net/sACN)
- **Another network interface** for the web application and client connections

This is a professional lighting control setup that isolates DMX traffic from general network traffic.

## Network Architecture

```
┌─────────────────────────────┐
│   Windows PC / Mac          │
│                             │
│  ┌──────────────────────┐   │
│  │  DMX Dashboard Server  │   │
│  │                      │   │
│  │  Web Server:         │───┼───► NIC 2: WiFi/LAN
│  │   Port 3001          │   │     (e.g., 10.25.231.56)
│  │                      │   │     For phones/tablets
│  │  DMX Output:         │   │
│  │   Art-Net/sACN       │───┼───► NIC 1: Ethernet
│  └──────────────────────┘   │     (e.g., 192.168.1.100)
│                             │     For lighting network
└─────────────────────────────┘
```

## Configuration Options

### 1. Art-Net Network Binding

**Settings Page → Network Output → Art-Net Section**

- **Bind to Network Interface**: Enter the IP address of the network interface you want to use for Art-Net output
  - Example: `192.168.1.100` (your dedicated lighting network adapter)
  - Leave empty to use all interfaces (default behavior)

- **Destination IP**: Where to send Art-Net packets
  - `255.255.255.255` - Broadcast to all devices on the bound interface's network
  - `2.x.x.x` - Specific Art-Net node IP address
  - `10.x.x.255` - Subnet broadcast

**How it works:**
- Art-Net UDP packets will be sent from the specified interface
- If you specify `bindAddress: 192.168.1.100`, Art-Net will only go out on that NIC
- Web traffic can still come in on other interfaces

### 2. sACN Network Binding

**Settings Page → Network Output → sACN Section**

- **Bind to Network Interface**: Enter the IP address for sACN output
  - Example: `192.168.1.100`
  - Leave empty for all interfaces

**Note:** The current e131 library has limited interface binding support. For production use with strict interface binding, you may need to:
- Use Art-Net instead (full support)
- Or upgrade to a different sACN library

### 3. Web Server Network Binding

**Settings Page → Web Server Network Section**

- **Server Port**: Which port the web application listens on (default: 3001)

- **Server Bind Address**: Which network interface accepts web connections
  - `0.0.0.0` - All interfaces (phones can connect from any network)
  - `10.25.231.56` - Only this specific interface
  - `192.168.1.100` - Only this specific interface

**Restart required** after changing server binding settings.

## Common Setup Scenarios

### Scenario 1: Two Separate Networks (Recommended for Production)

**Hardware:**
- NIC 1: USB/Thunderbolt Ethernet adapter → Lighting network (192.168.1.0/24)
- NIC 2: Built-in WiFi → User network (10.25.0.0/16)

**Configuration:**
```javascript
{
  "server": {
    "port": 3001,
    "bindAddress": "10.25.231.56"  // WiFi interface
  },
  "network": {
    "protocol": "artnet",
    "artnet": {
      "bindAddress": "192.168.1.100",  // Ethernet interface
      "destination": "192.168.1.255",   // Broadcast on lighting network
      "net": 0,
      "subnet": 0,
      "universe": 0
    }
  }
}
```

**Result:**
- DMX traffic stays on the dedicated lighting network (192.168.1.x)
- Web app is accessible from WiFi network (10.25.x.x)
- No DMX packets on the WiFi network
- No web traffic on the lighting network

### Scenario 2: Single Network (Simple Setup)

**Hardware:**
- Single network interface
- Everything on same network

**Configuration:**
```javascript
{
  "server": {
    "port": 3001,
    "bindAddress": "0.0.0.0"  // All interfaces
  },
  "network": {
    "protocol": "artnet",
    "artnet": {
      "bindAddress": "",  // Empty = use all
      "destination": "255.255.255.255",
      "net": 0,
      "subnet": 0,
      "universe": 0
    }
  }
}
```

**Result:**
- Everything on same network
- Simpler but less professional
- DMX and web traffic share bandwidth

### Scenario 3: Unicast to Specific Console

**Hardware:**
- Network interface: 192.168.1.100
- Lighting console: 192.168.1.50

**Configuration:**
```javascript
{
  "network": {
    "protocol": "artnet",
    "artnet": {
      "bindAddress": "192.168.1.100",
      "destination": "192.168.1.50",  // Direct to console
      "net": 0,
      "subnet": 0,
      "universe": 0
    }
  }
}
```

**Result:**
- Art-Net sent directly to console
- No broadcast traffic
- More efficient
- Works through managed switches

## Checking Your Network Interfaces

### Windows
```cmd
ipconfig
```

Look for:
```
Ethernet adapter Ethernet:
   IPv4 Address. . . . . . . . . : 192.168.1.100

Wireless LAN adapter Wi-Fi:
   IPv4 Address. . . . . . . . . : 10.25.231.56
```

### Mac/Linux
```bash
ifconfig
```

Look for:
```
en31: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	inet 192.168.0.101 netmask 0xffffff00 broadcast 192.168.0.255

en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	inet 10.25.231.56 netmask 0xffff0000 broadcast 10.25.255.255
```

## Testing Network Binding

### 1. Verify Server Binding

Start the application and check the console output:
```
Server running on port 3001
Bind address: 0.0.0.0
Network access: http://10.25.231.56:3001
Network access: http://192.168.0.101:3001
```

If you bound to a specific interface, you should only see that one.

### 2. Verify Art-Net Output

Use a network monitoring tool like Wireshark:

**Filter:** `udp.port == 6454`

**What to check:**
- Source IP should match your `bindAddress`
- Destination IP should match your configured destination
- Packets should only appear on the correct network interface

### 3. Test Web Access

From a phone/tablet:
- Connect to the WiFi network
- Navigate to `http://[server-ip]:3001`
- Move sliders and verify connection works

## Troubleshooting

### "Address already in use" Error

**Problem:** Port is already occupied

**Solution:**
```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID [number] /F

# Mac/Linux
lsof -ti :3001 | xargs kill -9
```

Or change the port in settings.

### Art-Net Not Reaching Devices

**Checklist:**
- [ ] Bind address matches one of your network interfaces
- [ ] Destination IP is on the same subnet as bind address
- [ ] Firewall allows UDP port 6454
- [ ] Network cable is connected
- [ ] Lighting devices are on same network

### Can't Access Web App from Phone

**Checklist:**
- [ ] Phone and PC are on same WiFi network
- [ ] Server `bindAddress` is `0.0.0.0` or the WiFi interface IP
- [ ] Firewall allows the server port (3001)
- [ ] Using the correct IP address (not localhost)

### Traffic on Wrong Interface

**Problem:** DMX appearing on WiFi or web traffic on lighting network

**Solution:**
- Verify `bindAddress` is set correctly for Art-Net/sACN
- Verify `server.bindAddress` is set for web server
- Restart the application after changing config
- Check with Wireshark to confirm

## Advanced: Routing and Firewall Rules

For maximum security and performance on Windows:

### 1. Disable Internet on Lighting Network

```cmd
# Set static IP without gateway on lighting adapter
# In Network Adapter Properties → IPv4 → Advanced
# Leave "Default Gateway" empty
```

### 2. Windows Firewall Rules

Allow outbound Art-Net on specific adapter:
```powershell
New-NetFirewallRule -DisplayName "DMX Art-Net Out" `
  -Direction Outbound -Protocol UDP -LocalPort 6454 `
  -InterfaceAlias "Ethernet" -Action Allow
```

## Performance Considerations

### Broadcast vs Unicast

**Broadcast** (`255.255.255.255`):
- ✅ Easy to set up
- ✅ Devices auto-discover
- ❌ More network traffic
- ❌ May not work through managed switches

**Unicast** (specific IP):
- ✅ Efficient
- ✅ Works through managed switches
- ✅ Reduces network load
- ❌ Must know device IP

### Network Interface Speed

- **Lighting Network**: Wired Gigabit Ethernet recommended
  - DMX is low bandwidth but benefits from low latency
- **User Network**: WiFi is fine
  - Web interface is lightweight

## Configuration File Location

Settings are stored in: `server/config.json`

You can edit this file directly (with server stopped) or use the Settings page in the web app.

## Summary

**For professional setup:**
1. Use two network interfaces
2. Bind Art-Net to dedicated Ethernet adapter
3. Bind web server to WiFi interface
4. Use unicast when possible
5. Monitor with Wireshark during initial setup

**For simple setup:**
1. Leave all bind addresses empty
2. Use broadcast Art-Net
3. Single network for everything
4. Works fine for small installations
