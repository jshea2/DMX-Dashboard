import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import DashboardMenu from './pages/DashboardMenu';
import SettingsPage from './pages/SettingsPage';
import DmxOutputPage from './pages/DmxOutputPage';
import AccessRequestNotification from './components/AccessRequestNotification';
import useWebSocket from './hooks/useWebSocket';
import './App.css';

function App() {
  const { role } = useWebSocket();
  const [pendingRequests, setPendingRequests] = useState([]);

  // Poll for pending requests if user is an editor or moderator
  useEffect(() => {
    if (role !== 'editor' && role !== 'moderator') return;

    const fetchPendingRequests = () => {
      fetch('/api/clients')
        .then(res => res.json())
        .then(clients => {
          const pending = clients.filter(c => c.pendingRequest === true);
          setPendingRequests(pending);
        })
        .catch(err => console.error('Failed to fetch pending requests:', err));
    };

    fetchPendingRequests();
    const interval = setInterval(fetchPendingRequests, 3000);
    return () => clearInterval(interval);
  }, [role]);

  const handleApprove = (clientId) => {
    fetch(`/api/clients/${clientId}/approve`, {
      method: 'POST'
    })
      .then(res => res.json())
      .then(() => {
        setPendingRequests(prev => prev.filter(c => c.id !== clientId));
      })
      .catch(err => console.error('Failed to approve client:', err));
  };

  const handleDeny = (clientId) => {
    fetch(`/api/clients/${clientId}/deny`, {
      method: 'POST'
    })
      .then(res => res.json())
      .then(() => {
        setPendingRequests(prev => prev.filter(c => c.id !== clientId));
      })
      .catch(err => console.error('Failed to deny client:', err));
  };

  return (
    <Router>
      <AccessRequestNotification
        pendingRequests={pendingRequests}
        onApprove={handleApprove}
        onDeny={handleDeny}
      />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardMenu />} />
        <Route path="/dashboard/:urlSlug" element={<Dashboard />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/dmx-output" element={<DmxOutputPage />} />
      </Routes>
    </Router>
  );
}

export default App;
