import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import SettingsPage from './pages/SettingsPage';
import DmxOutputPage from './pages/DmxOutputPage';
import './App.css';

function App() {
  const [showLayouts, setShowLayouts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setShowLayouts(data.showLayouts || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch config:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="app" style={{ background: '#1a1a2e', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>Loading...</div>;
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomePage layoutSlug="home" />} />
        {showLayouts.map(layout => (
          <Route
            key={layout.id}
            path={`/${layout.urlSlug}`}
            element={<HomePage layoutSlug={layout.urlSlug} />}
          />
        ))}
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/dmx-output" element={<DmxOutputPage />} />
      </Routes>
    </Router>
  );
}

export default App;
