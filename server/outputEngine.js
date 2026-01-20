const e131 = require('e131');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const config = require('./config');
const dmxEngine = require('./dmxEngine');

// Find the first non-internal IPv4 address for multicast binding
function getDefaultMulticastInterface() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

// Generate a random UUID as a 16-byte buffer for sACN CID
function generateCID() {
  return crypto.randomBytes(16);
}

class OutputEngine {
  constructor() {
    this.clients = {};
    this.packets = {};  // Store packets for reuse (sequence number tracking)
    this.interval = null;
    this.running = false;
    // Generate a persistent CID for this instance
    this.cid = generateCID();
    console.log(`sACN CID generated: ${this.cid.toString('hex').toUpperCase().replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')}`);
  }

  start() {
    if (this.running) {
      this.stop();
    }

    const cfg = config.get();
    const fps = cfg.network.outputFps || 30;
    const intervalMs = 1000 / fps;

    this.running = true;

    this.interval = setInterval(() => {
      this.sendFrame();
    }, intervalMs);

    console.log(`Output engine started at ${fps} fps`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Close all clients/sockets properly
    Object.entries(this.clients).forEach(([key, client]) => {
      try {
        if (client) {
          if (key.startsWith('artnet_') && client.close) {
            // dgram socket - unref first to allow process to exit
            client.unref();
            client.close();
            console.log(`Closed Art-Net socket: ${key}`);
          } else if (key.startsWith('sacn_') && client.close) {
            client.close();
            console.log(`Closed sACN client: ${key}`);
          }
        }
      } catch (err) {
        console.error(`Error closing ${key}:`, err.message);
      }
    });

    this.clients = {};
    this.packets = {};  // Clear cached packets
    this.running = false;
    console.log('Output engine stopped');
  }

  sendFrame() {
    const cfg = config.get();
    const universes = dmxEngine.computeOutput();

    if (cfg.network.protocol === 'sacn') {
      this.sendSACN(universes);
    } else if (cfg.network.protocol === 'artnet') {
      this.sendArtNet(universes);
    }
  }

  sendSACN(universes) {
    const cfg = config.get();
    const sacnCfg = cfg.network.sacn;

    Object.keys(universes).forEach(universeNum => {
      const universeInt = parseInt(universeNum);
      const dmxData = universes[universeNum];

      // Validate universe range (sACN requires 1-63999)
      if (universeInt < 1 || universeInt > 63999) {
        console.error(`sACN: Invalid universe ${universeInt} (must be 1-63999), skipping`);
        return;
      }

      if (sacnCfg.multicast) {
        // Multicast mode: one client per universe
        const clientKey = `sacn_${universeNum}`;
        if (!this.clients[clientKey]) {
          const client = new e131.Client(universeInt);
          
          // Set multicast interface to ensure packets go out the correct network interface
          // Use configured bindAddress, or auto-detect the first external interface
          const multicastInterface = sacnCfg.bindAddress || getDefaultMulticastInterface();
          if (multicastInterface && client._socket) {
            // Bind the socket first (required before setting multicast options)
            client._socket.bind(0, multicastInterface, () => {
              try {
                client._socket.setMulticastTTL(64);
                client._socket.setMulticastInterface(multicastInterface);
                console.log(`sACN multicast interface set to: ${multicastInterface}`);
              } catch (err) {
                console.error(`Failed to set multicast interface: ${err.message}`);
              }
            });
          }
          
          this.clients[clientKey] = client;
          const multicastAddr = `239.255.${Math.floor(universeInt / 256)}.${universeInt % 256}`;
          console.log(`sACN multicast client created for universe ${universeInt} → ${multicastAddr}:5568`);
        }

        const client = this.clients[clientKey];
        
        // Reuse packet for proper sequence number tracking
        if (!this.packets[clientKey]) {
          const packet = client.createPacket(512);
          packet.setCID(this.cid);
          packet.setSourceName('DMX Dashboard');
          packet.setUniverse(universeInt);
          this.packets[clientKey] = packet;
        }
        
        const packet = this.packets[clientKey];
        const slotsData = packet.getSlotsData();

        for (let i = 0; i < 512; i++) {
          slotsData[i] = dmxData[i];
        }

        const priority = sacnCfg.priority !== undefined ? sacnCfg.priority : 100;
        packet.setPriority(priority);
        
        // Increment sequence number for each frame
        packet.incrementSequenceNumber();

        // Log non-zero channels for debugging
        const nonZeroChannels = [];
        for (let i = 0; i < dmxData.length; i++) {
          if (dmxData[i] > 0) {
            nonZeroChannels.push(`Ch${i + 1}=${dmxData[i]}`);
          }
        }

        if (nonZeroChannels.length > 0) {
          const multicastAddr = `239.255.${Math.floor(universeInt / 256)}.${universeInt % 256}`;
          console.log(`[sACN TX] → ${multicastAddr}:5568 | Universe:${universeInt} Priority:${priority} | ${nonZeroChannels.join(', ')}`);
        }

        client.send(packet, (err) => {
          if (err) {
            console.error(`sACN multicast send error (universe ${universeInt}):`, err.message);
          }
        });
      } else {
        // Unicast mode: one client per universe+destination pair
        if (!sacnCfg.unicastDestinations || sacnCfg.unicastDestinations.length === 0) {
          console.warn(`sACN configured for unicast but no destinations specified for universe ${universeInt}`);
          return;
        }

        sacnCfg.unicastDestinations.forEach(dest => {
          const clientKey = `sacn_${universeNum}_${dest}`;
          if (!this.clients[clientKey]) {
            // Create unicast client with destination host (pass IP as first arg)
            this.clients[clientKey] = new e131.Client(dest);
            console.log(`sACN unicast client created for universe ${universeInt} → ${dest}:5568`);
          }

          const client = this.clients[clientKey];
          
          // Reuse packet for proper sequence number tracking
          if (!this.packets[clientKey]) {
            const packet = client.createPacket(512);
            packet.setCID(this.cid);
            packet.setSourceName('DMX Dashboard');
            packet.setUniverse(universeInt);
            this.packets[clientKey] = packet;
          }
          
          const packet = this.packets[clientKey];
          const slotsData = packet.getSlotsData();

          for (let i = 0; i < 512; i++) {
            slotsData[i] = dmxData[i];
          }

          const priority = sacnCfg.priority !== undefined ? sacnCfg.priority : 100;
          packet.setPriority(priority);
          
          // Increment sequence number for each frame
          packet.incrementSequenceNumber();

          // Log non-zero channels for debugging
          const nonZeroChannels = [];
          for (let i = 0; i < dmxData.length; i++) {
            if (dmxData[i] > 0) {
              nonZeroChannels.push(`Ch${i + 1}=${dmxData[i]}`);
            }
          }

          if (nonZeroChannels.length > 0) {
            console.log(`[sACN TX] → ${dest}:5568 | Universe:${universeInt} Priority:${priority} | ${nonZeroChannels.join(', ')}`);
          }

          client.send(packet, (err) => {
            if (err) {
              console.error(`sACN unicast send error (universe ${universeInt} to ${dest}):`, err.message);
            }
          });
        });
      }
    });
  }

  sendArtNet(universes) {
    const cfg = config.get();
    const artnetCfg = cfg.network.artnet;

    Object.keys(universes).forEach(universeKey => {
      const dmxData = universes[universeKey];

      // Parse Art-Net addressing from key (format: artnet_net_subnet_universe)
      let net = 0, subnet = 0, universe = 0;
      if (universeKey.startsWith('artnet_')) {
        const parts = universeKey.split('_');
        net = parseInt(parts[1]) || 0;
        subnet = parseInt(parts[2]) || 0;
        universe = parseInt(parts[3]) || 0;
      }

      // Create Art-Net packet
      const packet = this.createArtNetPacket(net, subnet, universe, dmxData);

      // Create or reuse UDP socket
      const clientKey = `artnet_socket_${universeKey}`;
      if (!this.clients[clientKey]) {
        const socket = dgram.createSocket('udp4');

        // Bind to specific interface if specified
        if (artnetCfg.bindAddress) {
          socket.bind(0, artnetCfg.bindAddress, () => {
            console.log(`Art-Net bound to interface: ${artnetCfg.bindAddress}`);
            // Enable broadcast after binding completes
            if (artnetCfg.destination === '255.255.255.255' ||
                artnetCfg.destination.endsWith('.255')) {
              socket.setBroadcast(true);
            }
          });
        } else {
          // No specific bind address - bind to default and enable broadcast
          socket.bind(() => {
            // Enable broadcast after binding
            if (artnetCfg.destination === '255.255.255.255' ||
                artnetCfg.destination.endsWith('.255')) {
              socket.setBroadcast(true);
            }
          });
        }

        // Store socket
        this.clients[clientKey] = socket;
        console.log(`Art-Net client created for Net:${net} Sub:${subnet} Univ:${universe}`);
      }

      const socket = this.clients[clientKey];
      const port = artnetCfg.port || 6454;
      const destination = artnetCfg.destination || '255.255.255.255';

      // Log non-zero channels for debugging
      const nonZeroChannels = [];
      for (let i = 0; i < dmxData.length; i++) {
        if (dmxData[i] > 0) {
          nonZeroChannels.push(`Ch${i + 1}=${dmxData[i]}`);
        }
      }

      if (nonZeroChannels.length > 0) {
        const portAddress = ((net & 0x7F) << 8) | ((subnet & 0x0F) << 4) | (universe & 0x0F);
        console.log(`[Art-Net TX] → ${destination}:${port} | Net:${net} Sub:${subnet} Univ:${universe} (Port:${portAddress}) | ${nonZeroChannels.join(', ')}`);
      }

      socket.send(packet, port, destination, (err) => {
        if (err) {
          console.error('Art-Net send error:', err);
        }
      });
    });
  }

  createArtNetPacket(net, subnet, universe, dmxData) {
    // Art-Net packet structure
    const packet = Buffer.alloc(18 + 512);

    // Header
    packet.write('Art-Net\0', 0, 8);

    // OpCode (0x5000 = OpDmx in little-endian)
    packet.writeUInt16LE(0x5000, 8);

    // Protocol version (14)
    packet.writeUInt16BE(14, 10);

    // Sequence (0 = no sequencing)
    packet.writeUInt8(0, 12);

    // Physical port
    packet.writeUInt8(0, 13);

    // Universe (SubUni combined)
    const portAddress = ((net & 0x7F) << 8) | ((subnet & 0x0F) << 4) | (universe & 0x0F);
    packet.writeUInt16LE(portAddress, 14);

    // Length (512 in big-endian)
    packet.writeUInt16BE(512, 16);

    // DMX data
    for (let i = 0; i < 512; i++) {
      packet.writeUInt8(dmxData[i], 18 + i);
    }

    return packet;
  }

  restart() {
    this.stop();
    setTimeout(() => {
      this.start();
    }, 100);
  }
}

module.exports = new OutputEngine();
