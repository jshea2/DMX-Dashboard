import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClientId } from '../utils/clientIdentity';
import useWebSocket from '../hooks/useWebSocket';
import './DashboardMenu.css';

function DashboardMenu() {
  const navigate = useNavigate();
  const { isEditorAnywhere } = useWebSocket();
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Fetch accessible dashboards
    const clientId = getClientId();
    fetch(`/api/dashboards/accessible?clientId=${clientId}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch dashboards');
        return res.json();
      })
      .then(data => {
        setDashboards(data);
        setLoading(false);

        // Auto-redirect based on number of dashboards
        if (data.length === 0) {
          // No dashboards - redirect to settings so editor can create one
          navigate('/settings', { replace: true });
        } else if (data.length === 1) {
          // Only one dashboard - go directly to it
          navigate(`/dashboard/${data[0].urlSlug}`, { replace: true });
        }
      })
      .catch(err => {
        console.error('Error fetching dashboards:', err);
        setError(err.message);
        setLoading(false);
      });
  }, [navigate]);

  const getRoleBadge = (role) => {
    const badges = {
      editor: { label: 'Editor', color: '#4ae24a', bg: '#2a4a2a' },
      moderator: { label: 'Moderator', color: '#e24ae2', bg: '#4a2a4a' },
      controller: { label: 'Controller', color: '#e2904a', bg: '#4a3a2a' },
      viewer: { label: 'Viewer', color: '#4a90e2', bg: '#2a2a4a' }
    };
    return badges[role] || badges.viewer;
  };

  if (loading) {
    return (
      <div className="dashboard-menu">
        <div className="menu-loading">
          <div className="spinner"></div>
          <p>Loading dashboards...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-menu">
        <div className="menu-error">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (dashboards.length === 0) {
    return (
      <div className="dashboard-menu">
        <div className="menu-empty">
          <h2>No Dashboards Available</h2>
          <p>You don't have access to any dashboards yet.</p>
          <p>Please contact an administrator to request access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-menu">
      {isEditorAnywhere && (
        <button
          className="settings-btn"
          onClick={() => navigate('/settings')}
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: '#4a90e2',
            color: 'white',
            border: 'none',
            fontSize: '28px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            transition: 'background 0.2s, transform 0.1s',
            zIndex: 1000
          }}
          onMouseEnter={(e) => e.target.style.background = '#357abd'}
          onMouseLeave={(e) => e.target.style.background = '#4a90e2'}
          onMouseDown={(e) => e.target.style.transform = 'scale(0.95)'}
          onMouseUp={(e) => e.target.style.transform = 'scale(1)'}
        >
          ⚙
        </button>
      )}

      <div className="menu-header">
        <h1>Select Dashboard</h1>
        <p className="menu-subtitle">Choose a dashboard to view</p>
      </div>

      <div className="dashboard-grid">
        {dashboards.map(dashboard => {
          const badge = getRoleBadge(dashboard.role);

          return (
            <div
              key={dashboard.id}
              className="dashboard-card"
              onClick={() => navigate(`/dashboard/${dashboard.urlSlug}`)}
            >
              <div className="card-header" style={{ backgroundColor: dashboard.backgroundColor || '#1a1a2e' }}>
                {dashboard.logo ? (
                  <img src={dashboard.logo} alt={dashboard.name} className="card-logo" />
                ) : (
                  <div className="card-icon">📊</div>
                )}
              </div>

              <div className="card-body">
                <h3 className="card-title">{dashboard.name}</h3>

                <div className="card-role-badge" style={{ backgroundColor: badge.bg, color: badge.color }}>
                  {badge.label}
                </div>

                <button className="card-open-btn">
                  Open Dashboard →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DashboardMenu;
