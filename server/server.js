const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const state = require('./state');
const outputEngine = require('./outputEngine');
const dmxEngine = require('./dmxEngine');
const clientManager = require('./clientManager');
const { runMigrations } = require('./migration');

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
    broadcastConfigUpdated();
    res.json({ success: true, config: config.get() });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save config' });
  }
});

// Reset config to defaults
app.post('/api/config/reset', (req, res) => {
  config.reset();
  outputEngine.restart();
  broadcastConfigUpdated();
  res.json({ success: true, config: config.get() });
});

// Set active layout
app.post('/api/config/active-layout', (req, res) => {
  const { activeLayoutId } = req.body;
  const currentConfig = config.get();
  currentConfig.activeLayoutId = activeLayoutId;
  const success = config.update(currentConfig);
  if (success) {
    broadcastConfigUpdated();
    res.json({ success: true, activeLayoutId });
  } else {
    res.status(500).json({ success: false, error: 'Failed to update active layout' });
  }
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
      broadcastConfigUpdated();
      res.json({ success: true, config: config.get() });
    } else {
      res.status(500).json({ success: false, error: 'Failed to import config' });
    }
  } catch (error) {
    res.status(400).json({ success: false, error: 'Invalid config format' });
  }
});

// Client management endpoints
app.get('/api/clients', (req, res) => {
  const clients = clientManager.getAllClientsWithStatus();
  res.json(clients);
});

app.post('/api/clients/:clientId/approve', (req, res) => {
  const { clientId } = req.params;
  const success = clientManager.approveClient(clientId);
  if (success) {
    broadcastActiveClients();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Client not found' });
  }
});

app.post('/api/clients/:clientId/deny', (req, res) => {
  const { clientId } = req.params;
  const success = clientManager.denyClient(clientId);
  if (success) {
    broadcastActiveClients();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Client not found' });
  }
});

app.post('/api/clients/:clientId/role', (req, res) => {
  const { clientId } = req.params;
  const { role } = req.body;

  if (!['viewer', 'controller', 'moderator', 'editor'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }

  const success = clientManager.updateRole(clientId, role);
  if (success) {
    broadcastActiveClients();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Client not found' });
  }
});

app.post('/api/clients/:clientId/nickname', (req, res) => {
  const { clientId } = req.params;
  const { nickname } = req.body;

  const success = clientManager.updateNickname(clientId, nickname);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Client not found' });
  }
});

app.delete('/api/clients/:clientId', (req, res) => {
  const { clientId} = req.params;
  const success = clientManager.removeClient(clientId);
  if (success) {
    broadcastActiveClients();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Client not found' });
  }
});

// ===== DASHBOARD ACCESS API ENDPOINTS =====

// Get all clients with access to specific dashboard
app.get('/api/dashboards/:dashboardId/clients', (req, res) => {
  const { dashboardId } = req.params;
  const clients = clientManager.getClientsForDashboard(dashboardId);
  res.json(clients);
});

// Set user's role for specific dashboard
app.post('/api/dashboards/:dashboardId/clients/:clientId/role', (req, res) => {
  const { dashboardId, clientId } = req.params;
  const { role } = req.body;

  // Validate role
  if (!['viewer', 'controller', 'moderator', 'editor'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }

  // Check if requester has permission to manage users for this dashboard
  // TODO: Get requester's clientId from session/auth
  // For now, skip permission check (will be added when we implement proper auth)

  const success = clientManager.setDashboardRole(clientId, dashboardId, role);
  if (success) {
    broadcastActiveClients();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Client not found' });
  }
});

// Remove user from dashboard
app.delete('/api/dashboards/:dashboardId/clients/:clientId', (req, res) => {
  const { dashboardId, clientId } = req.params;

  // Check if requester has permission to manage users for this dashboard
  // TODO: Get requester's clientId from session/auth

  const success = clientManager.removeDashboardAccess(clientId, dashboardId);
  if (success) {
    broadcastActiveClients();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Client not found or no access to remove' });
  }
});

// Approve client for specific dashboard (promote to controller)
app.post('/api/dashboards/:dashboardId/clients/:clientId/approve', (req, res) => {
  const { dashboardId, clientId } = req.params;
  const success = clientManager.approveClient(clientId, dashboardId);
  if (success) {
    broadcastActiveClients();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Client not found' });
  }
});

// Deny client access request for specific dashboard
app.post('/api/dashboards/:dashboardId/clients/:clientId/deny', (req, res) => {
  const { dashboardId, clientId } = req.params;
  const success = clientManager.denyDashboardRequest(clientId, dashboardId);
  if (success) {
    broadcastActiveClients();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Client not found' });
  }
});

// Get accessible dashboards for current client
// Note: This endpoint will need client authentication to determine which client is making the request
// For now, it returns all dashboards with their access control settings
app.get('/api/dashboards/accessible', (req, res) => {
  const { clientId } = req.query;

  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required' });
  }

  const reqIp = req.socket.remoteAddress || req.connection.remoteAddress;
  console.log(`[/api/dashboards/accessible] clientId: ${clientId.substring(0, 6)}, IP: ${reqIp}`);

  const cfg = config.get();
  const dashboards = (cfg.showLayouts || []).map(layout => {
    // Get the user's actual role for this dashboard
    // NOTE: Don't pass req here because React dev proxy makes all requests appear as localhost
    const userRole = clientManager.getDashboardRole(clientId, layout.id);
    const hasAccess = clientManager.canAccessDashboard(clientId, layout.id);

    return {
      id: layout.id,
      name: layout.name,
      urlSlug: layout.urlSlug,
      backgroundColor: layout.backgroundColor,
      logo: layout.logo,
      role: userRole,  // User's actual role for this dashboard
      hasAccess: hasAccess,
      accessControl: layout.accessControl || { defaultRole: 'viewer', requireExplicitAccess: false }
    };
  }).filter(dashboard => dashboard.hasAccess);  // Only return dashboards user can access

  res.json(dashboards);
});

// Get global access matrix (all users x all dashboards)
app.get('/api/access-matrix', (req, res) => {
  // TODO: Check if requester is editor on any dashboard

  const cfg = config.get();
  const clients = clientManager.getAllClientsWithStatus();
  const dashboards = (cfg.showLayouts || []).map(layout => ({
    id: layout.id,
    name: layout.name,
    urlSlug: layout.urlSlug
  }));

  // Build matrix: { clientId: { dashboardId: role } }
  const matrix = {};
  clients.forEach(client => {
    matrix[client.id] = {};
    dashboards.forEach(dashboard => {
      const role = clientManager.getDashboardRole(client.id, dashboard.id);
      const hasAccess = clientManager.canAccessDashboard(client.id, dashboard.id);
      matrix[client.id][dashboard.id] = hasAccess ? role : null;
    });
  });

  res.json({ clients, dashboards, matrix });
});

// ===== DASHBOARD MANAGEMENT API ENDPOINTS =====

// Update dashboard access control settings
app.post('/api/dashboards/:dashboardId/access-settings', (req, res) => {
  const { dashboardId } = req.params;
  const { defaultRole, requireExplicitAccess } = req.body;

  // TODO: Check if requester is editor for this dashboard

  const cfg = config.get();
  const layout = cfg.showLayouts?.find(l => l.id === dashboardId);

  if (!layout) {
    return res.status(404).json({ success: false, error: 'Dashboard not found' });
  }

  // Validate defaultRole if provided
  if (defaultRole !== undefined && !['viewer', 'controller', 'moderator', 'editor'].includes(defaultRole)) {
    return res.status(400).json({ success: false, error: 'Invalid defaultRole' });
  }

  // Update access control settings
  if (!layout.accessControl) {
    layout.accessControl = {};
  }

  if (defaultRole !== undefined) {
    layout.accessControl.defaultRole = defaultRole;
  }

  if (requireExplicitAccess !== undefined) {
    layout.accessControl.requireExplicitAccess = requireExplicitAccess;
  }

  const success = config.update(cfg);
  if (success) {
    broadcastConfigUpdated();
    res.json({ success: true, accessControl: layout.accessControl });
  } else {
    res.status(500).json({ success: false, error: 'Failed to update access settings' });
  }
});

// Update dashboard visibility/UI settings
app.post('/api/dashboards/:dashboardId/settings', (req, res) => {
  const { dashboardId } = req.params;
  const { showReturnToMenuButton, showSettingsButton, showConnectedUsers, showBlackoutButton } = req.body;

  // TODO: Check if requester is editor for this dashboard

  const cfg = config.get();
  const layout = cfg.showLayouts?.find(l => l.id === dashboardId);

  if (!layout) {
    return res.status(404).json({ success: false, error: 'Dashboard not found' });
  }

  // Update visibility settings
  if (showReturnToMenuButton !== undefined) {
    layout.showReturnToMenuButton = showReturnToMenuButton;
  }

  if (showSettingsButton !== undefined) {
    layout.showSettingsButton = showSettingsButton;
  }

  if (showConnectedUsers !== undefined) {
    layout.showConnectedUsers = showConnectedUsers;
  }

  if (showBlackoutButton !== undefined) {
    layout.showBlackoutButton = showBlackoutButton;
  }

  const success = config.update(cfg);
  if (success) {
    broadcastConfigUpdated();
    res.json({ success: true, layout });
  } else {
    res.status(500).json({ success: false, error: 'Failed to update dashboard settings' });
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
  broadcastConfigUpdated();
  res.json({ success: true, look });
});

// Serve React app for all other routes (in production)
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

// WebSocket handling
wss.on('connection', (ws, req) => {
  console.log('Client connected via WebSocket');

  let clientId = null;
  let clientRole = 'viewer';

  // Send current state immediately
  ws.send(JSON.stringify({
    type: 'state',
    data: state.get()
  }));

  // Handle messages from client
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      // Authentication handshake
      if (msg.type === 'auth') {
        clientId = msg.clientId;

        if (!clientId) {
          ws.send(JSON.stringify({
            type: 'authError',
            message: 'Invalid clientId'
          }));
          return;
        }

        // Get or create client entry
        const client = clientManager.getOrCreateClient(clientId, req);
        clientRole = client.role;

        // Mark as active
        const ip = req.socket.remoteAddress || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'] || 'Unknown';
        clientManager.setActive(clientId, ws, ip, userAgent);

        // Send auth response
        ws.send(JSON.stringify({
          type: 'authResult',
          role: clientRole,
          clientId: clientId,
          shortId: clientId.substring(0, 6).toUpperCase(),
          dashboardAccess: client.dashboardAccess || {},  // NEW: Per-dashboard role assignments
          isEditorAnywhere: clientManager.isEditorAnywhere(clientId)  // NEW: Check if editor on any dashboard
        }));

        console.log(`Client authenticated: ${clientId.substring(0, 6)} as ${clientRole}`);

        // Broadcast active clients update to all
        broadcastActiveClients();
        return;
      }

      // Request access (viewer requesting controller for specific dashboard)
      if (msg.type === 'requestAccess') {
        const dashboardId = msg.dashboardId;
        if (clientId && clientRole === 'viewer' && dashboardId) {
          clientManager.requestDashboardAccess(clientId, dashboardId);
          console.log(`Access requested by ${clientId.substring(0, 6)} for dashboard ${dashboardId}`);

          // Broadcast to notify settings page
          broadcastActiveClients();
        }
        return;
      }

      // State update - check permissions
      if (msg.type === 'update') {
        const dashboardId = msg.dashboardId;
        // Check if client has permission to edit
        if (!clientId || !clientManager.hasPermission(clientId, 'edit', dashboardId)) {
          ws.send(JSON.stringify({
            type: 'permissionDenied',
            message: 'You do not have permission to edit. Request access from the host.'
          }));
          return;
        }

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
    if (clientId) {
      clientManager.setInactive(clientId);
      console.log(`Client disconnected: ${clientId.substring(0, 6)}`);
      broadcastActiveClients();
    } else {
      console.log('Client disconnected');
    }
  });
});

// Helper to broadcast active clients list
function broadcastActiveClients() {
  const activeClients = clientManager.getActiveClients();
  const currentConfig = config.get();
  let didUpdateConfig = false;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'activeClients',
        clients: activeClients.map(id => {
          const clientData = currentConfig.clients.find(c => c.id === id);
          const activeConnection = clientManager.getActive(id);
          const activeIp = activeConnection?.ip;
          const isLocalhost = activeIp === '127.0.0.1' ||
            activeIp === '::1' ||
            activeIp === '::ffff:127.0.0.1' ||
            clientData?.nickname === 'Server';
          if (isLocalhost && clientData && clientData.role !== 'editor') {
            clientData.role = 'editor';
            didUpdateConfig = true;
          }
          return {
            id,
            shortId: id.substring(0, 6).toUpperCase(),
            role: isLocalhost ? 'editor' : (clientData?.role || 'viewer'),
            nickname: clientData?.nickname || '',
            dashboardAccess: clientData?.dashboardAccess || {}
          };
        }),
        showConnectedUsers: currentConfig.webServer?.showConnectedUsers !== false
      }));
    }
  });

  if (didUpdateConfig) {
    config.update(currentConfig);
    broadcastConfigUpdated();
  }
}

function broadcastConfigUpdated() {
  const version = Date.now();
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'configUpdated',
        version
      }));
    }
  });
}

const broadcastState = (currentState) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'state',
        data: currentState
      }));
    }
  });
};

// Listen for state changes and broadcast to all WebSocket clients
state.addListener((newState) => {
  broadcastState(newState);
});

// Periodic state sync to prevent missed updates on slower clients
setInterval(() => {
  if (wss.clients.size === 0) return;
  broadcastState(state.get());
}, 1000);

// Periodic active clients sync to prevent stale role/status in UI
setInterval(() => {
  if (wss.clients.size === 0) return;
  broadcastActiveClients();
}, 3000);

// Run migrations before starting
console.log('[Server] Running migrations...');
const fs = require('fs');
const configPath = process.env.DMX_CONFIG_PATH || path.join(__dirname, 'config.json');
const ensureConfigDir = () => {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Create backup before migration
const cfg = config.get();
if (!cfg.migrationVersion || cfg.migrationVersion < 1) {
  console.log('[Server] Creating backup before migration...');
  ensureConfigDir();
  const backupPath = `${configPath}.backup`;
  fs.writeFileSync(backupPath, JSON.stringify(cfg, null, 2));
  console.log(`[Server] Backup created at ${backupPath}`);

  // Run migrations
  const migratedConfig = runMigrations(cfg);

  // Save migrated config
  console.log('[Server] Saving migrated config...');
  fs.writeFileSync(configPath, JSON.stringify(migratedConfig, null, 2));
  console.log('[Server] Config saved successfully');

  // Reload config
  delete require.cache[require.resolve('./config')];
  const newConfig = require('./config');
  console.log('[Server] Config reloaded');
} else {
  console.log('[Server] No migration needed');
}

// Start output engine
outputEngine.start();

// Get server configuration
const serverCfg = config.get();
const serverPort = process.env.DMX_SERVER_PORT || process.env.PORT || serverCfg.server?.port || PORT;
const serverBindAddress = serverCfg.server?.bindAddress || '0.0.0.0';

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
