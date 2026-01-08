import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useWebSocket from '../hooks/useWebSocket';
import Slider from '../components/Slider';

// HTP Metadata Hook - computes which looks control which channels
const useHTPMetadata = (state, config, channelOverrides, frozenChannels = {}) => {
  return useMemo(() => {
    const metadata = {}; // { 'fixtureId.channelName': { winners: [], contributors: [] } }
    const channelsToRelease = []; // Track channels that should be released from frozen state

    if (!state || !config) return { metadata, channelsToRelease };

    config.fixtures?.forEach(fixture => {
      const fixtureId = fixture.id;
      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (!profile) return;

      profile.channels.forEach(channel => {
        const channelName = channel.name;
        const key = `${fixtureId}.${channelName}`;

        // Get fixture state once at the beginning
        const fixtureState = state.fixtures?.[fixtureId];

        // Skip if channel is overridden
        if (channelOverrides[key]) {
          metadata[key] = {
            overridden: true,
            frozen: false,
            winners: [],
            contributors: [],
            displayValue: fixtureState?.[channelName] || 0,
            lookIntensity: 0
          };
          return;
        }

        // Collect all sources for this channel
        const sources = [];

        // Source 1: Direct fixture control
        if (fixtureState && fixtureState[channelName] > 0) {
          sources.push({
            type: 'fixture',
            value: fixtureState[channelName],
            lookId: null,
            color: null
          });
        }

        // Source 2+: Each active look
        config.looks?.forEach(look => {
          const lookLevel = state.looks?.[look.id] || 0;
          if (lookLevel > 0 && look.targets?.[fixtureId]) {
            const target = look.targets[fixtureId];
            const targetValue = target[channelName];
            if (targetValue !== undefined && targetValue > 0) {
              const effectiveValue = targetValue * lookLevel;
              sources.push({
                type: 'look',
                value: effectiveValue,
                lookId: look.id,
                color: look.color || 'blue'
              });
            }
          }
        });

        // Check if channel is frozen
        const frozenValue = frozenChannels[key];
        const isFrozen = frozenValue !== undefined;

        if (isFrozen) {
          const lookSources = sources.filter(s => s.type === 'look');
          
          // Check if any look controlling this channel is at 100%
          let hasLookAt100 = false;
          config.looks?.forEach(look => {
            const lookLevel = state.looks?.[look.id] || 0;
            if (lookLevel >= 1 && look.targets?.[fixtureId]) {
              const targetValue = look.targets[fixtureId][channelName];
              if (targetValue !== undefined && targetValue > 0) {
                hasLookAt100 = true;
              }
            }
          });
          
          if (hasLookAt100) {
            // Release this channel - a look controlling it is at 100%
            channelsToRelease.push(key);
            // Fall through to normal HTP computation below
          } else {
            // Stay frozen - show frozen value with grey outline
            metadata[key] = {
              frozen: true,
              overridden: false,
              winners: [],
              contributors: lookSources.map(c => ({ lookId: c.lookId, color: c.color, value: c.value })),
              displayValue: frozenValue,
              lookIntensity: 0
            };
            return;
          }
        }

        // Determine winners and contributors (normal HTP)
        if (sources.length === 0) {
          metadata[key] = { winners: [], contributors: [], frozen: false, displayValue: fixtureState?.[channelName] || 0, lookIntensity: 0 };
        } else {
          const maxValue = Math.max(...sources.map(s => s.value));
          const winners = sources.filter(s => s.value === maxValue && s.type === 'look');
          const contributors = sources.filter(s => s.type === 'look' && s.value > 0);

          // Find highest look intensity for opacity
          const lookIntensities = sources
            .filter(s => s.type === 'look')
            .map(s => state.looks?.[s.lookId] || 0);
          const maxLookIntensity = lookIntensities.length > 0 ? Math.max(...lookIntensities) : 0;

          metadata[key] = {
            frozen: false,
            winners: winners.map(w => ({ lookId: w.lookId, color: w.color })),
            contributors: contributors.map(c => ({ lookId: c.lookId, color: c.color, value: c.value })),
            displayValue: maxValue,
            lookIntensity: maxLookIntensity
          };
        }
      });
    });

    return { metadata, channelsToRelease };
  }, [state, config, channelOverrides, frozenChannels]);
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { state, sendUpdate, connected } = useWebSocket();
  const [config, setConfig] = useState(null);
  const [activeLayout, setActiveLayout] = useState(null);
  const [recordingLook, setRecordingLook] = useState(null);
  const [channelOverrides, setChannelOverrides] = useState({});
  const [manuallyAdjusted, setManuallyAdjusted] = useState({});  // Tracks channels manually touched
  const [frozenChannels, setFrozenChannels] = useState({});  // Tracks frozen values after recording {key: frozenValue}

  // Compute HTP metadata
  const { metadata: htpMetadata, channelsToRelease } = useHTPMetadata(state, config, channelOverrides, frozenChannels);

  // Release frozen channels when look values match
  useEffect(() => {
    if (channelsToRelease && channelsToRelease.length > 0) {
      // Remove from frozen state
      setFrozenChannels(prev => {
        const updated = { ...prev };
        channelsToRelease.forEach(key => delete updated[key]);
        return updated;
      });
      
      // Clear direct fixture values so the look can control the thumb
      const fixturesToClear = {};
      channelsToRelease.forEach(key => {
        const [fixtureId, channelName] = key.split('.');
        if (!fixturesToClear[fixtureId]) {
          fixturesToClear[fixtureId] = {};
        }
        fixturesToClear[fixtureId][channelName] = 0;
      });
      
      if (Object.keys(fixturesToClear).length > 0) {
        sendUpdate({ fixtures: fixturesToClear });
      }
    }
  }, [channelsToRelease, sendUpdate]);

  useEffect(() => {
    // Fetch config to get layout and other data
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setConfig(data);
        // Find active layout by activeLayoutId or fall back to first layout
        let layout;
        if (data.activeLayoutId) {
          layout = data.showLayouts?.find(l => l.id === data.activeLayoutId);
        }
        // If no active layout set or not found, use first available layout
        if (!layout && data.showLayouts?.length > 0) {
          layout = data.showLayouts[0];
          // Set it as active layout on server
          fetch('/api/config/active-layout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activeLayoutId: layout.id })
          }).catch(err => console.error('Failed to set active layout:', err));
        }
        // Fallback to creating a default layout if none found
        if (!layout) {
          layout = {
            id: 'default',
            name: 'Default Layout',
            showName: false,
            backgroundColor: '#1a1a2e',
            showBlackoutButton: true,
            showLayoutSelector: true,
            showSettingsButton: true,
            sections: []
          };
        }
        setActiveLayout(layout);
      })
      .catch(err => console.error('Failed to fetch config:', err));
  }, []);

  // Apply background color to body element for full-width background
  useEffect(() => {
    if (activeLayout?.backgroundColor) {
      document.body.style.backgroundColor = activeLayout.backgroundColor;
    }
    // Cleanup: reset to default when component unmounts
    return () => {
      document.body.style.backgroundColor = '';
    };
  }, [activeLayout?.backgroundColor]);

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

    const key = `${fixtureId}.${property}`;
    const meta = htpMetadata[key];

    // Mark as manually adjusted whenever user touches slider
    setManuallyAdjusted(prev => ({ ...prev, [key]: true }));

    // If channel was frozen, release it when user manually moves it
    if (frozenChannels[key] !== undefined) {
      setFrozenChannels(prev => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
    }

    // Detect override: mark if any look is contributing to this channel
    if ((meta?.contributors?.length > 0) || channelOverrides[key]) {
      setChannelOverrides(prev => ({ ...prev, [key]: true }));
    }
  };

  const handleRecordLook = (lookId) => {
    setRecordingLook(lookId);
    
    // Collect current displayed values from HTP metadata (what you see on sliders)
    const capturedTargets = {};
    config.fixtures?.forEach(fixture => {
      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (!profile) return;
      
      capturedTargets[fixture.id] = {};
      profile.channels?.forEach(channel => {
        const key = `${fixture.id}.${channel.name}`;
        const meta = htpMetadata[key];
        const displayValue = meta?.displayValue || 0;
        
        // Record all non-zero values
        if (displayValue > 0) {
          capturedTargets[fixture.id][channel.name] = Math.round(displayValue * 100) / 100;
        }
      });
      
      // Remove empty fixture entries
      if (Object.keys(capturedTargets[fixture.id]).length === 0) {
        delete capturedTargets[fixture.id];
      }
    });
    
    // Send captured values to server
    fetch(`/api/looks/${lookId}/capture`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: capturedTargets })
    })
      .then(res => res.json())
      .then(() => {
        // Refresh config to get updated targets
        fetch('/api/config')
          .then(res => res.json())
          .then(data => setConfig(data));
        // Clear all overrides when recording
        setChannelOverrides({});
        // Convert ALL current displayed values to frozen channels (grey outline)
        // All channels stay at their values until a look matches them
        const newFrozenChannels = {};
        config.fixtures?.forEach(fixture => {
          const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
          if (!profile) return;
          profile.channels?.forEach(channel => {
            const key = `${fixture.id}.${channel.name}`;
            const meta = htpMetadata[key];
            const displayValue = meta?.displayValue || 0;
            if (displayValue > 0) {
              newFrozenChannels[key] = displayValue;
            }
          });
        });
        setFrozenChannels(newFrozenChannels);
        setManuallyAdjusted({});
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
    // Clear overrides, manual adjustments, and frozen channels
    setChannelOverrides({});
    setManuallyAdjusted({});
    setFrozenChannels({});
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
    // Clear overrides, manual adjustments, and frozen channels
    setChannelOverrides({});
    setManuallyAdjusted({});
    setFrozenChannels({});
  };

  // Change active layout - zeros out all DMX values
  const handleLayoutChange = (layoutId) => {
    const newLayout = config.showLayouts?.find(l => l.id === layoutId);
    if (!newLayout) return;
    
    // Zero out all looks
    const clearedLooks = {};
    config.looks?.forEach(look => {
      clearedLooks[look.id] = 0;
    });
    
    // Zero out all fixtures
    const clearedFixtures = {};
    config.fixtures?.forEach(fixture => {
      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (profile) {
        clearedFixtures[fixture.id] = {};
        profile.channels.forEach(ch => {
          clearedFixtures[fixture.id][ch.name] = 0;
        });
      }
    });
    
    // Send the zeroed state
    sendUpdate({ looks: clearedLooks, fixtures: clearedFixtures, blackout: false });
    
    // Clear local state
    setChannelOverrides({});
    setManuallyAdjusted({});
    setFrozenChannels({});
    
    // Update active layout in config
    fetch('/api/config/active-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeLayoutId: layoutId })
    }).catch(err => console.error('Failed to save active layout:', err));
    
    // Set the new layout
    setActiveLayout(newLayout);
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

  // Calculate fixture glow color based on HTP-computed channel values
  const getFixtureGlow = (fixtureId, profile) => {
    if (!profile) return 'none';

    const hasRgb = profile.channels?.some(ch => ch.name === 'red');
    const hasIntensity = profile.channels?.some(ch => ch.name === 'intensity');

    if (hasRgb) {
      // Get HTP-computed values for RGB channels
      const redMeta = htpMetadata[`${fixtureId}.red`] || { displayValue: 0 };
      const greenMeta = htpMetadata[`${fixtureId}.green`] || { displayValue: 0 };
      const blueMeta = htpMetadata[`${fixtureId}.blue`] || { displayValue: 0 };

      const r = Math.round((redMeta.displayValue || 0) * 2.55);
      const g = Math.round((greenMeta.displayValue || 0) * 2.55);
      const b = Math.round((blueMeta.displayValue || 0) * 2.55);

      if (r === 0 && g === 0 && b === 0) return 'none';
      return `0 0 20px rgba(${r}, ${g}, ${b}, 0.6), 0 0 40px rgba(${r}, ${g}, ${b}, 0.3)`;
    } else if (hasIntensity) {
      // Get HTP-computed value for intensity channel
      const intensityMeta = htpMetadata[`${fixtureId}.intensity`] || { displayValue: 0 };
      const intensity = intensityMeta.displayValue || 0;

      if (intensity === 0) return 'none';
      const alpha = intensity / 100 * 0.5;
      return `0 0 20px rgba(255, 255, 255, ${alpha}), 0 0 40px rgba(255, 255, 255, ${alpha * 0.5})`;
    }
    return 'none';
  };

  if (!config || !activeLayout) {
    return (
      <div className="app">
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
    <div className="app">
      <div className="header">
        {/* Layout Selector Dropdown */}
        {activeLayout.showLayoutSelector !== false && (
          <div style={{ marginBottom: '12px' }}>
            <select
              value={activeLayout.id}
              onChange={(e) => handleLayoutChange(e.target.value)}
              style={{
                background: '#2a2a3e',
                border: '1px solid #444',
                borderRadius: '6px',
                padding: '8px 12px',
                color: '#f0f0f0',
                fontSize: '14px',
                cursor: 'pointer',
                minWidth: '150px'
              }}
            >
              {config.showLayouts.map(layout => (
                <option key={layout.id} value={layout.id}>
                  {layout.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {activeLayout.logo && (
          <div style={{ marginBottom: '12px', textAlign: 'center' }}>
            <img
              src={activeLayout.logo}
              alt="Logo"
              style={{ maxWidth: '100%', maxHeight: '120px', borderRadius: '8px' }}
            />
          </div>
        )}
        {activeLayout.showName && (
          <h1>{activeLayout.name}</h1>
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
              {section.showClearButton && (() => {
                // Check if any fixtures in this section have overrides
                const fixtureItems = visibleItems.filter(item => item.type === 'fixture');
                const hasOverrides = fixtureItems.some(item => {
                  const fixture = config.fixtures.find(f => f.id === item.id);
                  if (!fixture) return false;
                  const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
                  if (!profile) return false;
                  return profile.channels.some(ch => channelOverrides[`${fixture.id}.${ch.name}`]);
                });

                return (
                  <button
                    className="btn btn-small"
                    onClick={() => {
                      if (isLooksOnly) {
                        handleClearAllLooks();
                      } else if (isFixturesOnly) {
                        if (hasOverrides) {
                          // Clear only overrides for fixtures in this section
                          const newOverrides = { ...channelOverrides };
                          fixtureItems.forEach(item => {
                            const fixture = config.fixtures.find(f => f.id === item.id);
                            if (fixture) {
                              const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
                              if (profile) {
                                profile.channels.forEach(ch => {
                                  delete newOverrides[`${fixture.id}.${ch.name}`];
                                });
                              }
                            }
                          });
                          setChannelOverrides(newOverrides);
                        } else {
                          handleClearAllFixtures();
                        }
                      }
                    }}
                    style={{ padding: '6px 12px', fontSize: '12px', background: '#555', border: '1px solid #666' }}
                  >
                    {isFixturesOnly && hasOverrides ? 'Clear Overrides' : 'Clear'}
                  </button>
                );
              })()}
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
                const glowStyle = getFixtureGlow(fixture.id, profile);

                return (
                  <div
                    key={item.id}
                    className="fixture-row"
                    style={{
                      boxShadow: glowStyle,
                      transition: 'box-shadow 0.3s ease'
                    }}
                  >
                    <h3>{fixture.name}</h3>
                    <div className="fixture-controls">
                      {profile.channels?.map(channel => {
                        const key = `${fixture.id}.${channel.name}`;
                        const meta = htpMetadata[key] || {
                          winners: [],
                          contributors: [],
                          overridden: false,
                          displayValue: fixtureState[channel.name] || 0,
                          lookIntensity: 0
                        };
                        // Show all contributors for gradient (not just winners)
                        const lookColors = meta.contributors.map(c => c.color);

                        return (
                          <Slider
                            key={channel.name}
                            label={channel.name.charAt(0).toUpperCase() + channel.name.slice(1)}
                            value={meta.displayValue}
                            min={0}
                            max={100}
                            step={1}
                            onChange={(value) => handleFixtureChange(fixture.id, channel.name, value)}
                            unit="%"
                            color={getSliderColor(channel.name)}
                            lookColors={lookColors}
                            isOverridden={meta.overridden || false}
                            isFrozen={meta.frozen || false}
                            lookIntensity={meta.lookIntensity}
                            hasManualValue={manuallyAdjusted[key] || false}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        );
      })}

      {activeLayout.showSettingsButton !== false && (
        <button className="settings-btn" onClick={() => navigate('/settings')}>
          ⚙
        </button>
      )}
    </div>
  );
};

export default Dashboard;
