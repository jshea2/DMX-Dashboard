import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import DashboardMenu from './pages/DashboardMenu';
import SettingsPage from './pages/SettingsPage';
import DmxOutputPage from './pages/DmxOutputPage';
import FixtureDetail from './pages/FixtureDetail';
import AccessRequestNotification from './components/AccessRequestNotification';
import { WebSocketProvider, useWebSocketContext } from './contexts/WebSocketContext';
import './App.css';

function RootRedirect() {
  const [targetPath, setTargetPath] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        const layouts = data?.showLayouts || [];
        const activeLayout = layouts.find(l => l.id === data?.activeLayoutId) || layouts[0];
        if (activeLayout?.urlSlug) {
          setTargetPath(`/dashboard/${activeLayout.urlSlug}`);
        } else {
          setTargetPath('/dashboard');
        }
      })
      .catch(() => {
        if (!cancelled) setTargetPath('/dashboard');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!targetPath) return null;
  return <Navigate to={targetPath} replace />;
}

function AppContent() {
  const { role } = useWebSocketContext();
  const [pendingRequests, setPendingRequests] = useState([]);
  const [dashboards, setDashboards] = useState([]);

  // Poll for pending requests if user is an editor or moderator
  useEffect(() => {
    if (role !== 'editor' && role !== 'moderator') return;

    const fetchPendingRequests = () => {
      // Fetch both clients and config to get dashboard names
      Promise.all([
        fetch('/api/clients').then(res => res.json()),
        fetch('/api/config').then(res => res.json())
      ])
        .then(([clients, config]) => {
          setDashboards(config.showLayouts || []);

          // Flatten dashboard pending requests into individual notification items
          const pending = [];
          clients.forEach(client => {
            // Global pending request
            if (client.pendingRequest === true) {
              pending.push({
                clientId: client.id,
                clientNickname: client.nickname,
                shortId: client.id.substring(0, 6).toUpperCase(),
                type: 'global'
              });
            }
            // Per-dashboard pending requests
            if (client.dashboardPendingRequests) {
              Object.keys(client.dashboardPendingRequests).forEach(dashboardId => {
                const dashboard = config.showLayouts?.find(d => d.id === dashboardId);
                if (dashboard) {
                  pending.push({
                    clientId: client.id,
                    clientNickname: client.nickname,
                    shortId: client.id.substring(0, 6).toUpperCase(),
                    type: 'dashboard',
                    dashboardId: dashboardId,
                    dashboardName: dashboard.name
                  });
                }
              });
            }
          });
          setPendingRequests(pending);
        })
        .catch(err => console.error('Failed to fetch pending requests:', err));
    };

    fetchPendingRequests();
    const interval = setInterval(fetchPendingRequests, 3000);
    return () => clearInterval(interval);
  }, [role]);

  const handleApprove = (clientId, dashboardId = null) => {
    const url = dashboardId
      ? `/api/dashboards/${dashboardId}/clients/${clientId}/approve`
      : `/api/clients/${clientId}/approve`;

    fetch(url, { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        // Remove this specific request from the list
        setPendingRequests(prev => prev.filter(req =>
          !(req.clientId === clientId && req.dashboardId === dashboardId && req.type === (dashboardId ? 'dashboard' : 'global'))
        ));
      })
      .catch(err => console.error('Failed to approve client:', err));
  };

  const handleDeny = (clientId, dashboardId = null) => {
    const url = dashboardId
      ? `/api/dashboards/${dashboardId}/clients/${clientId}/deny`
      : `/api/clients/${clientId}/deny`;

    fetch(url, { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        // Remove this specific request from the list
        setPendingRequests(prev => prev.filter(req =>
          !(req.clientId === clientId && req.dashboardId === dashboardId && req.type === (dashboardId ? 'dashboard' : 'global'))
        ));
      })
      .catch(err => console.error('Failed to deny client:', err));
  };

  return (
    <>
      <AccessRequestNotification
        pendingRequests={pendingRequests}
        onApprove={handleApprove}
        onDeny={handleDeny}
      />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/dashboard" element={<DashboardMenu />} />
        <Route path="/dashboard/:urlSlug" element={<Dashboard />} />
        <Route path="/fixture/:fixtureId" element={<FixtureDetail />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/dmx-output" element={<DmxOutputPage />} />
      </Routes>
    </>
  );
}

function App() {
  return (
    <Router>
      <WebSocketProvider>
        <AppContent />
      </WebSocketProvider>
    </Router>
  );
}

export default App;
