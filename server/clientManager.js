// Client authentication and authorization manager
const config = require('./config');

class ClientManager {
  constructor() {
    this.activeConnections = new Map(); // clientId -> { ws, lastSeen, ip, userAgent }
  }

  // Check if connection is from localhost
  isLocalhost(req) {
    const ip = req.socket.remoteAddress || req.connection.remoteAddress;
    const hostname = req.hostname;

    // Check for IPv4 and IPv6 localhost
    const isLoopback = ip === '127.0.0.1' ||
                       ip === '::1' ||
                       ip === '::ffff:127.0.0.1';

    const isLocalhostHostname = hostname === 'localhost' ||
                                hostname === '127.0.0.1' ||
                                hostname === '::1';

    return isLoopback || isLocalhostHostname;
  }

  // Get or create client entry
  getOrCreateClient(clientId, req) {
    const currentConfig = config.get();

    if (!currentConfig.clients) {
      currentConfig.clients = [];
    }

    let client = currentConfig.clients.find(c => c.id === clientId);

    const ip = req.socket.remoteAddress || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const now = Date.now();
    const isLocalhost = this.isLocalhost(req);

    if (!client) {
      // New client - create entry with default role from config
      const defaultRole = currentConfig.webServer?.defaultClientRole || 'viewer';
      client = {
        id: clientId,
        role: defaultRole,
        nickname: isLocalhost ? 'Server' : '', // Default nickname for localhost
        pendingRequest: false,
        firstSeen: now,
        lastSeen: now,
        lastIp: ip,
        userAgent: userAgent,
        dashboardAccess: {}  // NEW: Per-dashboard role assignments
      };

      currentConfig.clients.push(client);
      config.update(currentConfig);
      console.log(`New client registered: ${clientId.substring(0, 6)} from ${ip} with role ${defaultRole}`);
    } else {
      // Update existing client
      client.lastSeen = now;
      client.lastIp = ip;
      client.userAgent = userAgent;

      // Migration: Add dashboardAccess if missing
      if (!client.dashboardAccess) {
        client.dashboardAccess = {};
      }

      config.update(currentConfig);
    }

    // Override to editor if localhost
    if (isLocalhost) {
      client.role = 'editor';
      console.log(`Localhost detected: ${clientId.substring(0, 6)} auto-promoted to editor`);
    }

    return client;
  }

  // Mark connection as active
  setActive(clientId, ws, ip, userAgent) {
    this.activeConnections.set(clientId, {
      ws,
      lastSeen: Date.now(),
      ip,
      userAgent
    });
  }

  // Remove active connection
  setInactive(clientId) {
    this.activeConnections.delete(clientId);
  }

  // Get active connection
  getActive(clientId) {
    return this.activeConnections.get(clientId);
  }

  // Check if client is currently connected
  isActive(clientId) {
    return this.activeConnections.has(clientId);
  }

  // Get all active clients
  getActiveClients() {
    return Array.from(this.activeConnections.keys());
  }

  // Request editor access (legacy - kept for compatibility)
  requestAccess(clientId) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (client && client.role === 'viewer') {
      client.pendingRequest = true;
      config.update(currentConfig);
      console.log(`Access requested by: ${clientId.substring(0, 6)}`);
      return true;
    }

    return false;
  }

  // Request access for specific dashboard
  requestDashboardAccess(clientId, dashboardId) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (client) {
      // Initialize dashboardPendingRequests if missing
      if (!client.dashboardPendingRequests) {
        client.dashboardPendingRequests = {};
      }

      client.dashboardPendingRequests[dashboardId] = true;
      config.update(currentConfig);
      console.log(`Dashboard access requested by: ${clientId.substring(0, 6)} for dashboard ${dashboardId}`);
      return true;
    }

    return false;
  }

  // Approve client (promote to controller) - can be global or per-dashboard
  approveClient(clientId, dashboardId = null) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (client) {
      if (dashboardId) {
        // Per-dashboard approval
        if (!client.dashboardAccess) {
          client.dashboardAccess = {};
        }
        client.dashboardAccess[dashboardId] = 'controller';

        // Clear pending request for this dashboard
        if (client.dashboardPendingRequests) {
          delete client.dashboardPendingRequests[dashboardId];
        }

        console.log(`Client approved: ${clientId.substring(0, 6)} promoted to controller on dashboard ${dashboardId}`);

        // Notify the client if they're connected
        const connection = this.getActive(clientId);
        if (connection && connection.ws) {
          connection.ws.send(JSON.stringify({
            type: 'dashboardRoleUpdate',
            dashboardId: dashboardId,
            role: 'controller'
          }));
        }
      } else {
        // Global approval (legacy)
        client.role = 'controller';
        client.pendingRequest = false;
        console.log(`Client approved: ${clientId.substring(0, 6)} promoted to controller globally`);

        // Notify the client if they're connected
        const connection = this.getActive(clientId);
        if (connection && connection.ws) {
          connection.ws.send(JSON.stringify({
            type: 'roleUpdate',
            role: 'controller'
          }));
        }
      }

      config.update(currentConfig);
      return true;
    }

    return false;
  }

  // Deny client access request
  denyClient(clientId) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (client) {
      client.pendingRequest = false;
      config.update(currentConfig);
      console.log(`Client denied: ${clientId.substring(0, 6)} access request rejected`);

      // Notify the client if they're connected
      const connection = this.getActive(clientId);
      if (connection && connection.ws) {
        connection.ws.send(JSON.stringify({
          type: 'accessDenied',
          message: 'Your access request was denied'
        }));
      }

      return true;
    }

    return false;
  }

  // Deny dashboard-specific access request
  denyDashboardRequest(clientId, dashboardId) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (client && client.dashboardPendingRequests) {
      delete client.dashboardPendingRequests[dashboardId];
      config.update(currentConfig);
      console.log(`Client denied: ${clientId.substring(0, 6)} access request rejected for dashboard ${dashboardId}`);

      // Notify the client if they're connected
      const connection = this.getActive(clientId);
      if (connection && connection.ws) {
        connection.ws.send(JSON.stringify({
          type: 'dashboardAccessDenied',
          dashboardId: dashboardId,
          message: 'Your access request was denied for this dashboard'
        }));
      }

      return true;
    }

    return false;
  }

  // Update client role
  updateRole(clientId, role) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (client) {
      client.role = role;
      if (role === 'controller' || role === 'moderator' || role === 'editor') {
        client.pendingRequest = false;
      }
      config.update(currentConfig);

      // Notify the client if they're connected
      const connection = this.getActive(clientId);
      if (connection && connection.ws) {
        connection.ws.send(JSON.stringify({
          type: 'roleUpdate',
          role: role
        }));
      }

      return true;
    }

    return false;
  }

  // Update client nickname
  updateNickname(clientId, nickname) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (client) {
      client.nickname = nickname;
      config.update(currentConfig);
      return true;
    }

    return false;
  }

  // Check if client has permission for an action
  hasPermission(clientId, action = 'edit', dashboardId = null) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (!client) {
      return false; // Unknown client
    }

    // Determine which role to check (dashboard-specific or global)
    let roleToCheck = client.role;

    if (dashboardId && client.dashboardAccess && client.dashboardAccess[dashboardId]) {
      // Use dashboard-specific role if available
      roleToCheck = client.dashboardAccess[dashboardId];
    }

    if (action === 'edit') {
      // Controller, moderator, and editor can edit lights/looks
      return roleToCheck === 'controller' || roleToCheck === 'moderator' || roleToCheck === 'editor';
    }

    if (action === 'settings') {
      // Only editor can access full settings (check if editor anywhere)
      return this.isEditorAnywhere(clientId);
    }

    if (action === 'manageUsers') {
      if (dashboardId) {
        // Check per-dashboard moderator/editor status
        return roleToCheck === 'moderator' || roleToCheck === 'editor';
      }
      // For global user management, must be editor
      return client.role === 'editor';
    }

    // Viewers can view
    return true;
  }

  // Get all clients with connection status
  getAllClientsWithStatus() {
    const currentConfig = config.get();
    const clients = currentConfig.clients || [];

    return clients.map(client => ({
      ...client,
      isActive: this.isActive(client.id),
      shortId: client.id.substring(0, 6).toUpperCase()
    }));
  }

  // Remove a client
  removeClient(clientId) {
    const currentConfig = config.get();
    currentConfig.clients = currentConfig.clients.filter(c => c.id !== clientId);
    config.update(currentConfig);

    // Disconnect if active
    const connection = this.getActive(clientId);
    if (connection && connection.ws) {
      connection.ws.close();
    }
    this.setInactive(clientId);

    return true;
  }

  // ===== PER-DASHBOARD PERMISSION METHODS =====

  // Get user's role for specific dashboard
  getDashboardRole(clientId, dashboardId, req = null) {
    // Localhost is always editor
    if (req && this.isLocalhost(req)) {
      console.log(`[getDashboardRole] ${clientId.substring(0, 6)} detected as localhost -> editor`);
      return 'editor';
    }

    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (!client) return 'viewer';

    // Check per-dashboard role first
    if (client.dashboardAccess && client.dashboardAccess[dashboardId]) {
      return client.dashboardAccess[dashboardId];
    }

    // Fallback to global role
    return client.role || 'viewer';
  }

  // Set user's role for specific dashboard
  setDashboardRole(clientId, dashboardId, role) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (!client) return false;

    // Initialize dashboardAccess if missing
    if (!client.dashboardAccess) {
      client.dashboardAccess = {};
    }

    client.dashboardAccess[dashboardId] = role;
    config.update(currentConfig);

    // Notify the client if they're connected
    const connection = this.getActive(clientId);
    if (connection && connection.ws) {
      connection.ws.send(JSON.stringify({
        type: 'dashboardRoleUpdate',
        dashboardId: dashboardId,
        role: role
      }));
    }

    console.log(`Dashboard access updated: ${clientId.substring(0, 6)} → ${role} for dashboard ${dashboardId.substring(0, 8)}`);
    return true;
  }

  // Remove user's access from specific dashboard
  removeDashboardAccess(clientId, dashboardId) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (!client || !client.dashboardAccess) return false;

    delete client.dashboardAccess[dashboardId];
    config.update(currentConfig);

    console.log(`Dashboard access removed: ${clientId.substring(0, 6)} from dashboard ${dashboardId.substring(0, 8)}`);
    return true;
  }

  // Check if user can access a dashboard
  canAccessDashboard(clientId, dashboardId, req = null) {
    // Localhost can access everything
    if (req && this.isLocalhost(req)) return true;

    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (!client) return false;

    // Check if user has explicit dashboard access
    if (client.dashboardAccess && client.dashboardAccess[dashboardId]) {
      return true;
    }

    // Check if dashboard allows fallback to global role
    const layout = currentConfig.showLayouts?.find(l => l.id === dashboardId);
    if (layout && layout.accessControl && !layout.accessControl.requireExplicitAccess) {
      // Dashboard allows global role access
      return true;
    }

    return false;
  }

  // Check if user is editor on ANY dashboard
  isEditorAnywhere(clientId, req = null) {
    // Localhost is always editor
    if (req && this.isLocalhost(req)) return true;

    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (!client) return false;

    // Check global role
    if (client.role === 'editor') return true;

    // Check any dashboard role
    if (client.dashboardAccess) {
      return Object.values(client.dashboardAccess).includes('editor');
    }

    return false;
  }

  // Get all dashboards user has access to
  getDashboardsForClient(clientId) {
    const currentConfig = config.get();
    const client = currentConfig.clients.find(c => c.id === clientId);

    if (!client) return [];

    const dashboards = [];

    // Add dashboards with explicit access
    if (client.dashboardAccess) {
      Object.keys(client.dashboardAccess).forEach(dashboardId => {
        const layout = currentConfig.showLayouts?.find(l => l.id === dashboardId);
        if (layout) {
          dashboards.push({
            id: layout.id,
            name: layout.name,
            urlSlug: layout.urlSlug,
            role: client.dashboardAccess[dashboardId]
          });
        }
      });
    }

    // Add dashboards that allow global role access
    currentConfig.showLayouts?.forEach(layout => {
      if (layout.accessControl && !layout.accessControl.requireExplicitAccess) {
        // Check if not already added
        if (!dashboards.find(d => d.id === layout.id)) {
          dashboards.push({
            id: layout.id,
            name: layout.name,
            urlSlug: layout.urlSlug,
            role: client.role || 'viewer'
          });
        }
      }
    });

    return dashboards;
  }

  // Get all clients with access to specific dashboard
  getClientsForDashboard(dashboardId) {
    const currentConfig = config.get();
    const clients = currentConfig.clients || [];

    return clients
      .filter(client => {
        // Check explicit dashboard access
        if (client.dashboardAccess && client.dashboardAccess[dashboardId]) {
          return true;
        }

        // Check if dashboard allows global role access
        const layout = currentConfig.showLayouts?.find(l => l.id === dashboardId);
        if (layout && layout.accessControl && !layout.accessControl.requireExplicitAccess) {
          return true;
        }

        return false;
      })
      .map(client => ({
        ...client,
        isActive: this.isActive(client.id),
        shortId: client.id.substring(0, 6).toUpperCase(),
        dashboardRole: this.getDashboardRole(client.id, dashboardId)
      }));
  }
}

module.exports = new ClientManager();
