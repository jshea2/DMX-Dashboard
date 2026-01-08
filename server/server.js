const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const state = require('./state');
const outputEngine = require('./outputEngine');
const dmxEngine = require('./dmxEngine');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static React build files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
}

// REST API Routes

// Get available network interfaces
app.get('/api/network-interfaces', (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const activeInterfaces = [];

  Object.keys(interfaces).forEach((ifname) => {
    interfaces[ifname].forEach((iface) => {
      // Only include IPv4 non-internal interfaces (active ethernet/wifi)
      if (iface.family === 'IPv4' && !iface.internal) {
        activeInterfaces.push({
          name: ifname,
          address: iface.address,
          label: `${ifname} (${iface.address})`
        });
      }
    });
  });

  res.json(activeInterfaces);
});

// Get DMX output
app.get('/api/dmx-output', (req, res) => {
  const universes = dmxEngine.computeOutput();
  res.json(universes);
});

// Get current state
app.get('/api/state', (req, res) => {
  res.json(state.get());
});

// Update state
app.post('/api/state', (req, res) => {
  state.update(req.body);
  res.json({ success: true, state: state.get() });
});

// Get config
app.get('/api/config', (req, res) => {
  res.json(config.get());
});

// Update config
app.post('/api/config', (req, res) => {
  const success = config.update(req.body);
  if (success) {
    // Reinitialize state and restart output engine with new config
    state.reinitialize();
    dmxEngine.initializeUniverses();
    outputEngine.restart();
    res.json({ success: true, config: config.get() });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save config' });
  }
});

// Reset config to defaults
app.post('/api/config/reset', (req, res) => {
  config.reset();
  outputEngine.restart();
  res.json({ success: true, config: config.get() });
});

// Export config
app.get('/api/config/export', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="dmx-config.json"');
  res.send(config.exportConfig());
});

// Import config
app.post('/api/config/import', (req, res) => {
  try {
    const success = config.importConfig(JSON.stringify(req.body));
    if (success) {
      outputEngine.restart();
      res.json({ success: true, config: config.get() });
    } else {
      res.status(500).json({ success: false, error: 'Failed to import config' });
    }
  } catch (error) {
    res.status(400).json({ success: false, error: 'Invalid config format' });
  }
});

// Capture current state into a look
app.post('/api/looks/:lookId/capture', (req, res) => {
  const { lookId } = req.params;
  const { targets } = req.body;
  const cfg = config.get();

  const look = cfg.looks.find(l => l.id === lookId);
  if (!look) {
    return res.status(404).json({ success: false, error: 'Look not found' });
  }

  // Use targets sent from client (current HTP-computed values)
  // This captures exactly what's displayed on the sliders
  if (targets) {
    look.targets = targets;
  } else {
    // Fallback: empty targets if none provided
    look.targets = {};
  }

  config.update(cfg);
  res.json({ success: true, look });
});

// Serve React app for all other routes (in production)
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

// WebSocket handling
wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  // Send current state immediately
  ws.send(JSON.stringify({
    type: 'state',
    data: state.get()
  }));

  // Handle messages from client
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.type === 'update') {
        state.update(msg.data);

        // Broadcast to all connected clients
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'state',
              data: state.get()
            }));
          }
        });
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Listen for state changes and broadcast to all WebSocket clients
state.addListener((newState) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'state',
        data: newState
      }));
    }
  });
});

// Start output engine
outputEngine.start();

// Get server configuration
const cfg = config.get();
const serverPort = cfg.server?.port || PORT;
const serverBindAddress = cfg.server?.bindAddress || '0.0.0.0';

// Start server
server.listen(serverPort, serverBindAddress, () => {
  console.log(`Server running on port ${serverPort}`);
  console.log(`Bind address: ${serverBindAddress}`);
  console.log(`Local access: http://localhost:${serverPort}`);

  // Get local IP address
  const os = require('os');
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach((ifname) => {
    interfaces[ifname].forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`Network access: http://${iface.address}:${serverPort}`);
      }
    });
  });

  // Show Art-Net/sACN binding info
  if (cfg.network.protocol === 'artnet' && cfg.network.artnet.bindAddress) {
    console.log(`Art-Net output bound to: ${cfg.network.artnet.bindAddress}`);
  } else if (cfg.network.protocol === 'sacn' && cfg.network.sacn.bindAddress) {
    console.log(`sACN output bound to: ${cfg.network.sacn.bindAddress}`);
  }
});

// Graceful shutdown handler
const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  outputEngine.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  // Force exit after 3 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('Forced exit after timeout');
    process.exit(1);
  }, 3000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
