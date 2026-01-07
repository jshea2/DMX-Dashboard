import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useWebSocket from '../hooks/useWebSocket';
import Slider from '../components/Slider';

const HomePage = ({ layoutSlug }) => {
  const navigate = useNavigate();
  const { state, sendUpdate, connected } = useWebSocket();
  const [config, setConfig] = useState(null);
  const [activeLayout, setActiveLayout] = useState(null);
  const [recordingLook, setRecordingLook] = useState(null);

  useEffect(() => {
    // Fetch config to get layout and other data
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setConfig(data);
        // Find layout by slug or isHome flag
        let layout;
        if (layoutSlug === 'home') {
          layout = data.showLayouts?.find(l => l.isHome);
        } else {
          layout = data.showLayouts?.find(l => l.urlSlug === layoutSlug);
        }
        // Fallback to creating a default layout if none found
        if (!layout) {
          layout = {
            id: 'default',
            name: 'Default Layout',
            urlSlug: 'home',
            isHome: true,
            showName: false,
            backgroundColor: '#1a1a2e',
            logo: null,
            title: 'Lighting',
            showBlackoutButton: true,
            sections: []
          };
        }
        setActiveLayout(layout);
      })
      .catch(err => console.error('Failed to fetch config:', err));
  }, [layoutSlug]);

  const handleBlackout = () => {
    sendUpdate({ blackout: !state.blackout });
  };

  const handleLookChange = (lookId, value) => {
    sendUpdate({
      looks: {
        [lookId]: value / 100
      }
    });
  };

  const handleFixtureChange = (fixtureId, property, value) => {
    sendUpdate({
      fixtures: {
        [fixtureId]: {
          [property]: value
        }
      }
    });
  };

  const handleRecordLook = (lookId) => {
    setRecordingLook(lookId);
    fetch(`/api/looks/${lookId}/capture`, { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        // Refresh config to get updated targets
        fetch('/api/config')
          .then(res => res.json())
          .then(data => setConfig(data));
        // Clear recording state after fade (500ms)
        setTimeout(() => setRecordingLook(null), 500);
      })
      .catch(err => {
        console.error('Failed to record look:', err);
        setRecordingLook(null);
      });
  };

  const handleClearAllLooks = () => {
    const clearedLooks = {};
    config.looks.forEach(look => {
      clearedLooks[look.id] = 0;
    });
    sendUpdate({ looks: clearedLooks });
  };

  const handleClearAllFixtures = () => {
    const clearedFixtures = {};
    config.fixtures.forEach(fixture => {
      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (profile) {
        clearedFixtures[fixture.id] = {};
        profile.channels.forEach(ch => {
          clearedFixtures[fixture.id][ch.name] = 0;
        });
      }
    });
    sendUpdate({ fixtures: clearedFixtures });
  };

  // Get color for slider based on channel name
  const getSliderColor = (channelName) => {
    const name = channelName.toLowerCase();
    if (name === 'red') return 'red';
    if (name === 'green') return 'green';
    if (name === 'blue') return 'blue';
    if (name === 'white') return 'white';
    if (name === 'intensity') return 'intensity';
    return null;
  };

  // Calculate fixture glow color based on channel values
  const getFixtureGlow = (fixtureState, profile) => {
    if (!fixtureState || !profile) return 'none';
    
    const hasRgb = profile.channels?.some(ch => ch.name === 'red');
    const hasIntensity = profile.channels?.some(ch => ch.name === 'intensity');
    
    if (hasRgb) {
      const r = Math.round((fixtureState.red || 0) * 2.55);
      const g = Math.round((fixtureState.green || 0) * 2.55);
      const b = Math.round((fixtureState.blue || 0) * 2.55);
      if (r === 0 && g === 0 && b === 0) return 'none';
      return `0 0 20px rgba(${r}, ${g}, ${b}, 0.6), 0 0 40px rgba(${r}, ${g}, ${b}, 0.3)`;
    } else if (hasIntensity) {
      const intensity = fixtureState.intensity || 0;
      if (intensity === 0) return 'none';
      const alpha = intensity / 100 * 0.5;
      return `0 0 20px rgba(255, 255, 255, ${alpha}), 0 0 40px rgba(255, 255, 255, ${alpha * 0.5})`;
    }
    return 'none';
  };

  if (!config || !activeLayout) {
    return (
      <div className="app" style={{ background: '#1a1a2e' }}>
        <div className="header">
          <h1>Loading...</h1>
        </div>
      </div>
    );
  }

  // Get visible sections from active layout
  const visibleSections = (activeLayout.sections || [])
    .filter(section => section.visible !== false)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="app" style={{ background: activeLayout.backgroundColor || '#1a1a2e' }}>
      <div className="header">
        {activeLayout.logo && (
          <div style={{ marginBottom: '12px', textAlign: 'center' }}>
            <img
              src={activeLayout.logo}
              alt="Logo"
              style={{ maxWidth: '100%', maxHeight: '120px', borderRadius: '8px' }}
            />
          </div>
        )}
        <h1>{activeLayout.title || 'Lighting'}</h1>
        {activeLayout.showName && (
          <p style={{ fontSize: '14px', color: '#888', marginTop: '4px', marginBottom: '8px' }}>
            {activeLayout.name}
          </p>
        )}
        {activeLayout.showBlackoutButton !== false && (
          <button
            className={`blackout-btn ${state.blackout ? 'active' : ''}`}
            onClick={handleBlackout}
          >
            {state.blackout ? 'Restore' : 'Blackout'}
          </button>
        )}
      </div>

      {!connected && (
        <div className="card" style={{ background: '#6c4a00', marginBottom: '16px' }}>
          <p style={{ margin: 0, fontSize: '16px' }}>⚠ Disconnected - Reconnecting...</p>
        </div>
      )}

      {visibleSections.map(section => {
        // Get visible items from this section
        const visibleItems = section.items
          .filter(item => item.visible !== false)
          .sort((a, b) => a.order - b.order);

        if (visibleItems.length === 0) return null;

        // Determine if this is a looks-only or fixtures-only section
        const hasLooks = visibleItems.some(item => item.type === 'look');
        const hasFixtures = visibleItems.some(item => item.type === 'fixture');
        const isLooksOnly = hasLooks && !hasFixtures;
        const isFixturesOnly = hasFixtures && !hasLooks;

        return (
          <div key={section.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0 }}>{section.name}</h2>
              {section.showClearButton && (
                <button
                  className="btn btn-small"
                  onClick={() => {
                    if (isLooksOnly) {
                      handleClearAllLooks();
                    } else if (isFixturesOnly) {
                      handleClearAllFixtures();
                    }
                  }}
                  style={{ padding: '6px 12px', fontSize: '12px', background: '#555', border: '1px solid #666' }}
                >
                  Clear
                </button>
              )}
            </div>

            {visibleItems.map(item => {
              if (item.type === 'look') {
                const look = config.looks.find(l => l.id === item.id);
                if (!look) return null;

                return (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <Slider
                        label={look.name}
                        value={(state.looks[look.id] || 0) * 100}
                        min={0}
                        max={100}
                        step={1}
                        onChange={(value) => handleLookChange(look.id, value)}
                        unit="%"
                        color={look.color || 'blue'}
                      />
                    </div>
                    {look.showRecordButton && (
                      <button
                        className={`btn btn-small record-btn ${recordingLook === look.id ? 'recording' : ''}`}
                        onClick={() => handleRecordLook(look.id)}
                        style={{
                          padding: '6px 10px',
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                          background: '#444',
                          border: '1px solid #666'
                        }}
                        title="Record current fixture values to this look"
                      >
                        ● Rec
                      </button>
                    )}
                  </div>
                );
              } else if (item.type === 'fixture') {
                const fixture = config.fixtures.find(f => f.id === item.id);
                if (!fixture) return null;

                const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
                if (!profile) return null;

                const fixtureState = state.fixtures[fixture.id] || {};
                const glowStyle = getFixtureGlow(fixtureState, profile);

                return (
                  <div
                    key={item.id}
                    className="fixture-row"
                    style={{
                      boxShadow: glowStyle,
                      transition: 'box-shadow 0.3s ease'
                    }}
                  >
                    <h3>{fixture.name} <span style={{ fontSize: '12px', color: '#888', fontWeight: 'normal' }}>({fixture.id})</span></h3>
                    <div className="fixture-controls">
                      {profile.channels?.map(channel => (
                        <Slider
                          key={channel.name}
                          label={channel.name.charAt(0).toUpperCase() + channel.name.slice(1)}
                          value={fixtureState[channel.name] || 0}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(value) => handleFixtureChange(fixture.id, channel.name, value)}
                          unit="%"
                          color={getSliderColor(channel.name)}
                        />
                      ))}
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        );
      })}

      <button className="settings-btn" onClick={() => navigate('/settings')}>
        ⚙
      </button>
    </div>
  );
};

export default HomePage;
