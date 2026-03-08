import React from 'react';

const ConnectedUsers = ({
  activeClients,
  show,
  dashboardId,
  defaultRole,
  bottomOffset = 16,
  inline = false,
  compact = false,
  className = ''
}) => {
  if (!show || !activeClients || activeClients.length === 0) {
    return null;
  }

  const containerStyle = inline ? {
    position: 'relative',
    bottom: 'auto',
    left: 'auto',
    background: 'rgba(22, 34, 63, 0.94)',
    border: '1px solid rgba(102, 130, 174, 0.5)',
    borderRadius: '12px',
    padding: compact ? '8px 10px' : '10px 12px',
    zIndex: 'auto',
    minWidth: compact ? '150px' : '180px',
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)'
  } : {
    position: 'fixed',
    bottom: `${Math.max(0, Number(bottomOffset) || 0)}px`,
    left: '16px',
    background: '#1a1a2e',
    border: '2px solid #333',
    borderRadius: '8px',
    padding: '12px',
    zIndex: 1000,
    minWidth: '180px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
  };

  return (
    <div
      className={className}
      style={{
        ...containerStyle
      }}
    >
      <div style={{
        marginBottom: compact ? '6px' : '8px',
        fontSize: compact ? '11px' : '12px',
        fontWeight: '600',
        color: '#90a5c8',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        Connected Users
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '4px' : '6px' }}>
        {activeClients.map((client) => {
          let effectiveRole = client.role;
          if (client.role === 'editor') {
            effectiveRole = 'editor';
          } else if (dashboardId && client.dashboardAccess && client.dashboardAccess[dashboardId]) {
            effectiveRole = client.dashboardAccess[dashboardId];
          } else if (client.role !== 'viewer') {
            effectiveRole = client.role;
          } else if (dashboardId && defaultRole) {
            effectiveRole = defaultRole;
          }
          return (
          <div
            key={client.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: compact ? '12px' : '13px'
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#4ae24a',
                flexShrink: 0
              }}
            />
            <span style={{ fontWeight: '500', color: '#f0f0f0' }}>
              {client.nickname || client.shortId}
            </span>
            <span
              style={{
                fontSize: '10px',
                padding: compact ? '2px 4px' : '2px 4px',
                borderRadius: '3px',
                background: effectiveRole === 'editor' ? '#2a4a2a' :
                           effectiveRole === 'moderator' ? '#4a2a4a' :
                           effectiveRole === 'controller' ? '#4a3a2a' : '#2a2a4a',
                color: effectiveRole === 'editor' ? '#4ae24a' :
                       effectiveRole === 'moderator' ? '#e24ae2' :
                       effectiveRole === 'controller' ? '#e2904a' : '#4a90e2',
                textTransform: 'uppercase',
                fontWeight: '600'
              }}
            >
              {effectiveRole === 'editor' ? 'E' :
               effectiveRole === 'moderator' ? 'M' :
               effectiveRole === 'controller' ? 'C' : 'V'}
            </span>
          </div>
        );})}
      </div>
    </div>
  );
};

export default ConnectedUsers;
