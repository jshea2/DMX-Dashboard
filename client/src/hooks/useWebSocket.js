import { useEffect, useRef, useState, useCallback } from 'react';
import { getClientId } from '../utils/clientIdentity';

const useWebSocket = () => {
  const [state, setState] = useState({
    blackout: false,
    looks: {
      look1: 0,
      look2: 0,
      look3: 0
    },
    fixtures: {
      panel1: { hue: 0, brightness: 0 },
      panel2: { hue: 0, brightness: 0 },
      par1: { intensity: 0 },
      par2: { intensity: 0 }
    }
  });

  const [connected, setConnected] = useState(false);
  const [role, setRole] = useState('viewer'); // viewer or editor
  const [shortId, setShortId] = useState('');
  const [activeClients, setActiveClients] = useState([]);
  const [showConnectedUsers, setShowConnectedUsers] = useState(true);
  const [dashboardAccess, setDashboardAccess] = useState({}); // Per-dashboard role assignments
  const [isEditorAnywhere, setIsEditorAnywhere] = useState(false); // True if editor on any dashboard

  const ws = useRef(null);
  const reconnectTimeout = useRef(null);
  const authenticated = useRef(false);

  const connect = useCallback(() => {
    // Close existing connection if it exists
    if (ws.current) {
      try {
        ws.current.close();
      } catch (e) {
        console.warn('Error closing existing WebSocket:', e);
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In dev mode, React runs on 3001 but backend/WebSocket is on 2996
    const wsPort = process.env.NODE_ENV === 'development' ? 2996 : (window.location.port || 2996);
    const wsUrl = `${protocol}//${window.location.hostname}:${wsPort}`;

    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
      authenticated.current = false;

      // Send authentication
      const clientId = getClientId();
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'auth',
          clientId: clientId
        }));
      }
    };

    ws.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'state') {
          setState(message.data);
        } else if (message.type === 'authResult') {
          authenticated.current = true;
          setRole(message.role);
          setShortId(message.shortId);
          setDashboardAccess(message.dashboardAccess || {});
          setIsEditorAnywhere(message.isEditorAnywhere || false);
          console.log(`Authenticated as ${message.role} (${message.shortId})`);
        } else if (message.type === 'dashboardRoleUpdate') {
          console.log(`[WebSocket] Dashboard role update: ${message.role} for dashboard ${message.dashboardId}`);
          setDashboardAccess(prev => ({
            ...prev,
            [message.dashboardId]: message.role
          }));
        } else if (message.type === 'roleUpdate') {
          console.log(`[WebSocket] Role update received: ${message.role}`);
          setRole(message.role);
          // Force a page reload to ensure all UI elements update with new permissions
          console.log('[WebSocket] Reloading page to apply new permissions');
          setTimeout(() => window.location.reload(), 500);
        } else if (message.type === 'activeClients') {
          setActiveClients(message.clients || []);
          setShowConnectedUsers(message.showConnectedUsers !== false);
        } else if (message.type === 'permissionDenied') {
          console.warn('Permission denied:', message.message);
          alert(message.message);
        } else if (message.type === 'accessDenied') {
          console.warn('Access denied:', message.message);
          alert(message.message);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.current.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
      authenticated.current = false;

      // Attempt to reconnect after 2 seconds
      reconnectTimeout.current = setTimeout(() => {
        console.log('Attempting to reconnect...');
        connect();
      }, 2000);
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, []);

  useEffect(() => {
    console.log('[useWebSocket] Effect running - calling connect()');
    connect();

    // Handle page visibility changes (e.g., computer waking from sleep)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Check if connection is stale when page becomes visible
        if (ws.current && ws.current.readyState !== WebSocket.OPEN && ws.current.readyState !== WebSocket.CONNECTING) {
          console.log('Page visible and WebSocket not open, reconnecting...');
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('[useWebSocket] Cleanup running - closing WebSocket');
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (ws.current) {
        ws.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const sendUpdate = useCallback((updates) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      try {
        ws.current.send(JSON.stringify({
          type: 'update',
          data: updates
        }));
      } catch (error) {
        console.warn('Failed to send update, reconnecting...', error);
        connect();
      }
    } else {
      console.warn('WebSocket not ready, cannot send update. State:', ws.current?.readyState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // connect is accessed via closure, no need to include it as dependency

  const requestAccess = useCallback((dashboardId) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      try {
        ws.current.send(JSON.stringify({
          type: 'requestAccess',
          dashboardId: dashboardId
        }));
      } catch (error) {
        console.warn('Failed to send access request, reconnecting...', error);
        connect();
      }
    } else {
      console.warn('WebSocket not ready, cannot request access. State:', ws.current?.readyState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // connect is accessed via closure, no need to include it as dependency

  const getDashboardRole = useCallback((dashboardId) => {
    // Return dashboard-specific role if available, otherwise fall back to global role
    return dashboardAccess[dashboardId] || role || 'viewer';
  }, [dashboardAccess, role]);

  return {
    state,
    sendUpdate,
    connected,
    role,
    shortId,
    requestAccess,
    activeClients,
    showConnectedUsers,
    dashboardAccess,
    isEditorAnywhere,
    getDashboardRole
  };
};

export default useWebSocket;
