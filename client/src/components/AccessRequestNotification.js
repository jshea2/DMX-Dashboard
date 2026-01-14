import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const AccessRequestNotification = ({ pendingRequests, onApprove, onDeny }) => {
  const navigate = useNavigate();
  const location = useLocation();

  if (!pendingRequests || pendingRequests.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '16px',
        right: '16px',
        background: '#4a3a2a',
        border: '2px solid #e2904a',
        borderRadius: '8px',
        padding: '16px',
        zIndex: 2000,
        minWidth: '320px',
        maxWidth: '400px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
      }}
    >
      <div style={{ marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#e2904a' }}>
          🔔 Access Request{pendingRequests.length > 1 ? 's' : ''}
        </p>
        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#888' }}>
          {pendingRequests.length} user{pendingRequests.length > 1 ? 's' : ''} requesting controller access
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {pendingRequests.map((request, idx) => (
          <div
            key={`${request.clientId}-${request.dashboardId || 'global'}-${idx}`}
            style={{
              padding: '12px',
              background: '#2a2a2a',
              borderRadius: '4px'
            }}
          >
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontWeight: '500', color: '#f0f0f0', fontSize: '14px' }}>
                User {request.clientNickname || request.shortId} is requesting Controller access
                {request.type === 'dashboard' && (
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                    for dashboard: <span style={{ color: '#4a90e2' }}>{request.dashboardName}</span>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                onClick={() => onApprove(request.clientId, request.dashboardId)}
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: '600',
                  background: '#2a4a2a',
                  color: '#4ae24a',
                  border: '1px solid #4ae24a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.target.style.background = '#3a5a3a';
                }}
                onMouseOut={(e) => {
                  e.target.style.background = '#2a4a2a';
                }}
              >
                Approve
              </button>
              <button
                onClick={() => onDeny(request.clientId, request.dashboardId)}
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: '600',
                  background: '#4a2a2a',
                  color: '#e24a4a',
                  border: '1px solid #e24a4a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.target.style.background = '#5a3a3a';
                }}
                onMouseOut={(e) => {
                  e.target.style.background = '#4a2a2a';
                }}
              >
                Deny
              </button>
              <button
                onClick={() => {
                  if (location.pathname === '/settings') {
                    // Already on settings page, just change the tab
                    window.history.pushState({}, '', '/settings?tab=users');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  } else {
                    navigate('/settings?tab=users');
                  }
                }}
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: '600',
                  background: '#252538',
                  color: '#e2904a',
                  border: '1px solid #e2904a',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.target.style.background = '#2a2a4a';
                }}
                onMouseOut={(e) => {
                  e.target.style.background = '#252538';
                }}
              >
                Go to Settings
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AccessRequestNotification;
