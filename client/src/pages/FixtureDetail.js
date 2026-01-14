import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import ColorWheel from '../components/ColorWheel';
import Slider from '../components/Slider';
import './FixtureDetail.css';

function FixtureDetail() {
  const { fixtureId } = useParams();
  const navigate = useNavigate();
  const { state, sendUpdate } = useWebSocketContext();
  const [config, setConfig] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [manuallyAdjusted, setManuallyAdjusted] = useState({}); // Tracks channels manually touched
  const [channelOverrides, setChannelOverrides] = useState({}); // Tracks override state (white outline)
  const [frozenChannels, setFrozenChannels] = useState({}); // Tracks frozen values after recording (grey outline)
  const [overriddenLooks, setOverriddenLooks] = useState([]); // Tracks which looks were active when override happened

  // Fetch config
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch config:', err));
  }, []);

  // Find the fixture in config
  const fixture = config?.fixtures?.find(f => f.id === fixtureId);
  const profile = config?.fixtureProfiles?.find(p => p.id === fixture?.profileId);
  const fixtureState = state?.fixtures?.[fixtureId] || {};

  // Sync local override state with server's overriddenFixtures on load
  useEffect(() => {
    const serverOverride = state?.overriddenFixtures?.[fixtureId];
    if (serverOverride?.active && serverOverride.looks) {
      // Restore local state from server
      setOverriddenLooks(serverOverride.looks);
      // Mark all channels as overridden
      if (profile?.controls) {
        const overrides = {};
        profile.controls.forEach(control => {
          control.components?.forEach(comp => {
            overrides[comp.name] = true;
          });
        });
        setChannelOverrides(overrides);
      }
    }
  }, [state?.overriddenFixtures, fixtureId, profile]);

  // Compute HTP metadata for this fixture's channels
  const computeHTPMetadata = () => {
    const metadata = {}; // { channelName: { contributors: [], displayValue: number, isOverridden, isFrozen } }

    if (!profile || !state || !config) return metadata;

    // Get all channel names from profile
    const channelNames = [];
    if (profile.controls && Array.isArray(profile.controls)) {
      profile.controls.forEach(control => {
        if (control.components && Array.isArray(control.components)) {
          control.components.forEach(comp => {
            channelNames.push(comp.name);
          });
        }
      });
    }

    // For each channel, compute display value
    channelNames.forEach(channelName => {
      const sources = [];
      const lookContributors = [];

      // Source 1: Direct fixture control
      if (fixtureState && fixtureState[channelName] > 0) {
        sources.push({
          type: 'fixture',
          value: fixtureState[channelName],
          lookId: null,
          color: null
        });
      }

      // Source 2+: Each active look (always collect for contributor tracking)
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
            lookContributors.push({
              lookId: look.id,
              color: look.color || 'blue',
              value: effectiveValue
            });
          }
        }
      });

      // Check if this channel is overridden (user manually adjusted while look active)
      if (channelOverrides[channelName]) {
        // Override mode: use direct fixture value
        // For contributors, use overriddenLooks if current lookContributors is empty
        // (because looks were zeroed out when entering override mode)
        let overrideContributors = lookContributors;
        if (lookContributors.length === 0 && overriddenLooks.length > 0) {
          // Use saved overriddenLooks for grey dot display
          overrideContributors = overriddenLooks.map(look => ({
            lookId: look.id,
            color: look.color,
            value: 100
          }));
        }
        
        metadata[channelName] = {
          overridden: true,
          frozen: false,
          contributors: overrideContributors, // Use saved or current contributors for grey dots
          displayValue: fixtureState?.[channelName] || 0,
          hasManualValue: true,
          lookIntensity: 0
        };
        return;
      }

      // Check if channel is frozen
      const frozenValue = frozenChannels[channelName];
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
          setFrozenChannels(prev => {
            const updated = { ...prev };
            delete updated[channelName];
            return updated;
          });
          // Fall through to normal HTP computation below
        } else {
          // Stay frozen - show frozen value with grey outline
          metadata[channelName] = {
            frozen: true,
            overridden: false,
            contributors: lookSources.map(c => ({ lookId: c.lookId, color: c.color, value: c.value })),
            displayValue: frozenValue,
            hasManualValue: false,
            lookIntensity: 0
          };
          return;
        }
      }

      // HTP: Highest value wins
      const maxValue = sources.length > 0 ? Math.max(...sources.map(s => s.value)) : 0;

      // Find highest look intensity for opacity
      const lookIntensities = sources
        .filter(s => s.type === 'look')
        .map(s => state.looks?.[s.lookId] || 0);
      const maxLookIntensity = lookIntensities.length > 0 ? Math.max(...lookIntensities) : 0;

      metadata[channelName] = {
        frozen: false,
        overridden: false,
        contributors: lookContributors,
        displayValue: maxValue,
        hasManualValue: manuallyAdjusted[channelName] || false,
        lookIntensity: maxLookIntensity
      };
    });

    return metadata;
  };

  const htpMetadata = computeHTPMetadata();

  // If fixture not found, redirect back to dashboard
  useEffect(() => {
    if (config && !fixture) {
      navigate('/dashboard');
    }
  }, [config, fixture, navigate]);

  // Group controls by domain for tabs
  const controlsByDomain = {};
  if (profile?.controls) {
    profile.controls.forEach(control => {
      const domain = control.domain || 'Other';
      if (!controlsByDomain[domain]) {
        controlsByDomain[domain] = [];
      }
      controlsByDomain[domain].push(control);
    });
  }
  const allControls = profile?.controls || [];

  // Set initial active tab to All or first domain
  useEffect(() => {
    if (!activeTab && Object.keys(controlsByDomain).length > 0) {
      setActiveTab('All');
    }
  }, [controlsByDomain, activeTab]);

  // Helper: Apply default values from profile
  const applyControlDefaults = (control, updates) => {
    if (!control.defaultValue) {
      // No default value defined - use safe fallback defaults
      control.components.forEach(comp => {
        if (comp.type === 'intensity') {
          updates[comp.name] = 0; // Intensity off
        } else if (comp.type === 'red' || comp.type === 'green' || comp.type === 'blue') {
          updates[comp.name] = 100; // White (RGB 100,100,100)
        } else if (comp.type === 'white' || comp.type === 'amber') {
          updates[comp.name] = 100; // Full white/amber
        } else {
          updates[comp.name] = 0; // Generic channels off
        }
      });
    } else {
      // Apply profile-defined default values
      const defaultVal = control.defaultValue;

      if (defaultVal.type === 'rgb') {
        control.components.forEach(comp => {
          if (comp.type === 'red') updates[comp.name] = (defaultVal.r || 0) * 100;
          else if (comp.type === 'green') updates[comp.name] = (defaultVal.g || 0) * 100;
          else if (comp.type === 'blue') updates[comp.name] = (defaultVal.b || 0) * 100;
        });
      } else if (defaultVal.type === 'rgbw') {
        control.components.forEach(comp => {
          if (comp.type === 'red') updates[comp.name] = (defaultVal.r || 0) * 100;
          else if (comp.type === 'green') updates[comp.name] = (defaultVal.g || 0) * 100;
          else if (comp.type === 'blue') updates[comp.name] = (defaultVal.b || 0) * 100;
          else if (comp.type === 'white') updates[comp.name] = (defaultVal.w || 0) * 100;
        });
      } else if (defaultVal.type === 'scalar') {
        control.components.forEach(comp => {
          updates[comp.name] = (defaultVal.v || 0) * 100;
        });
      } else if (defaultVal.type === 'xy') {
        control.components.forEach(comp => {
          if (comp.type === 'pan') updates[comp.name] = (defaultVal.x || 0.5) * 100;
          else if (comp.type === 'tilt') updates[comp.name] = (defaultVal.y || 0.5) * 100;
        });
      }
    }
  };

  const handleClear = () => {
    if (!profile) return;

    // Apply default values from profile controls
    const updates = {};
    profile.controls.forEach(control => {
      if (control.components) {
        applyControlDefaults(control, updates);
      }
    });

    sendUpdate({
      fixtures: { [fixtureId]: updates },
      overriddenFixtures: { [fixtureId]: null } // Clear the override
    });

    // Clear overrides, manual adjustments, frozen channels, and overridden looks
    setChannelOverrides({});
    setManuallyAdjusted({});
    setFrozenChannels({});
    setOverriddenLooks([]);
  };

  // Color map for look indicators
  const colorMap = {
    purple: '#9b4ae2',
    orange: '#e2904a',
    cyan: '#4ae2e2',
    pink: '#e24a90',
    yellow: '#e2e24a',
    blue: '#4a90e2',
    red: '#e24a4a',
    green: '#4ae24a'
  };

  // Render control based on type
  const renderControl = (control) => {
    if (control.controlType === 'RGB' || control.controlType === 'RGBW') {
      // Find RGB components
      const redComp = control.components.find(c => c.type === 'red');
      const greenComp = control.components.find(c => c.type === 'green');
      const blueComp = control.components.find(c => c.type === 'blue');

      const redMeta = htpMetadata[redComp?.name] || { contributors: [], displayValue: 0, hasManualValue: false };
      const greenMeta = htpMetadata[greenComp?.name] || { contributors: [], displayValue: 0, hasManualValue: false };
      const blueMeta = htpMetadata[blueComp?.name] || { contributors: [], displayValue: 0, hasManualValue: false };

      // Combine contributors from all three channels (deduplicate by color)
      const allContributors = [...redMeta.contributors, ...greenMeta.contributors, ...blueMeta.contributors];
      const contributorMap = {};
      allContributors.forEach(c => {
        if (!contributorMap[c.color]) {
          contributorMap[c.color] = { color: c.color, value: c.value };
        } else {
          contributorMap[c.color].value = Math.max(contributorMap[c.color].value, c.value);
        }
      });
      let uniqueContributors = Object.values(contributorMap);

      // Check if any RGB channel is overridden (use metadata for consistency)
      const hasOverrides = redMeta.overridden || greenMeta.overridden || blueMeta.overridden;

      // Check if any RGB channel has been manually adjusted (active control)
      const isActiveControl = manuallyAdjusted[redComp?.name] || manuallyAdjusted[greenComp?.name] || manuallyAdjusted[blueComp?.name];

      // If in override mode but no current contributors (looks were zeroed), use saved overriddenLooks
      if (hasOverrides && uniqueContributors.length === 0 && overriddenLooks.length > 0) {
        uniqueContributors = overriddenLooks.map(look => ({ color: look.color, value: 100 }));
      }

      return (
        <div key={control.id} className="control-block">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>{control.label}</h3>
            {/* Look indicator dots - turn grey when overriding */}
            {uniqueContributors.length > 0 && (
              <div style={{ display: 'flex', gap: '4px' }}>
                {uniqueContributors.slice(0, 3).map((contributor, idx) => (
                  <div
                    key={idx}
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: hasOverrides ? '#666' : (colorMap[contributor.color] || '#4a90e2'),
                      opacity: hasOverrides ? 0.7 : (0.5 + ((contributor.value || 0) / 100) * 0.5),
                      flexShrink: 0
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <ColorWheel
            mode="rgb"
            red={redMeta.displayValue}
            green={greenMeta.displayValue}
            blue={blueMeta.displayValue}
            hasManualValue={hasOverrides || isActiveControl}
            onChange={(r, g, b) => {
              // Mark channels as manually adjusted
              setManuallyAdjusted(prev => ({
                ...prev,
                [redComp.name]: true,
                [greenComp.name]: true,
                [blueComp.name]: true
              }));

              // If channel was frozen, release it when user manually moves it
              setFrozenChannels(prev => {
                const updated = { ...prev };
                delete updated[redComp.name];
                delete updated[greenComp.name];
                delete updated[blueComp.name];
                return updated;
              });

              // Detect override: check if ANY look with level > 0 targets this fixture
              // (more robust than checking specific channel contributors which may be 0)
              const activeLooksForFixture = [];
              config.looks?.forEach(look => {
                const lookLevel = state.looks?.[look.id] || 0;
                if (lookLevel > 0 && look.targets?.[fixtureId]) {
                  activeLooksForFixture.push({ id: look.id, color: look.color || 'blue', level: lookLevel });
                }
              });

              const hasActiveLooks = activeLooksForFixture.length > 0;

              if (hasActiveLooks) {
                setChannelOverrides(prev => ({
                  ...prev,
                  [redComp.name]: true,
                  [greenComp.name]: true,
                  [blueComp.name]: true
                }));

                // Save the contributing looks for grey dot display
                setOverriddenLooks(activeLooksForFixture);

                // Don't zero out looks - just mark fixture as overridden
                // The override state will make HTP ignore looks for this fixture
                sendUpdate({
                  fixtures: {
                    [fixtureId]: {
                      [redComp.name]: r,
                      [greenComp.name]: g,
                      [blueComp.name]: b
                    }
                  },
                  overriddenFixtures: {
                    [fixtureId]: {
                      active: true,
                      looks: activeLooksForFixture.map(l => ({ id: l.id, color: l.color }))
                    }
                  }
                });
              } else {
                // No override - normal update
                sendUpdate({
                  fixtures: {
                    [fixtureId]: {
                      [redComp.name]: r,
                      [greenComp.name]: g,
                      [blueComp.name]: b
                    }
                  }
                });
              }
            }}
            isOverridden={false} // No grey outline on controls
            isFrozen={false} // No frozen outline on controls
            lookContributors={[]} // No colored outline from looks
            lookIntensity={0} // No look intensity indicator
          />
        </div>
      );
    } else if (control.controlType === 'Intensity' || control.controlType === 'Generic') {
      // Single slider
      const comp = control.components[0];
      const meta = htpMetadata[comp?.name] || { contributors: [], displayValue: 0, hasManualValue: false };

      return (
        <div key={control.id} className="control-block">
          <h3>{control.label}</h3>
          <Slider
            value={meta.displayValue}
            onChange={(val) => {
              // Mark channel as manually adjusted
              setManuallyAdjusted(prev => ({
                ...prev,
                [comp.name]: true
              }));

              // If channel was frozen, release it when user manually moves it
              setFrozenChannels(prev => {
                if (prev[comp.name] !== undefined) {
                  const updated = { ...prev };
                  delete updated[comp.name];
                  return updated;
                }
                return prev;
              });

              // Detect override: check if ANY look with level > 0 targets this fixture
              const activeLooksForFixture = [];
              config.looks?.forEach(look => {
                const lookLevel = state.looks?.[look.id] || 0;
                if (lookLevel > 0 && look.targets?.[fixtureId]) {
                  activeLooksForFixture.push({ id: look.id, color: look.color || 'blue', level: lookLevel });
                }
              });

              const hasActiveLooks = activeLooksForFixture.length > 0;

              if (hasActiveLooks) {
                setChannelOverrides(prev => ({ ...prev, [comp.name]: true }));

                // Save the contributing looks for grey dot display
                setOverriddenLooks(activeLooksForFixture);

                // Don't zero out looks - just mark fixture as overridden
                sendUpdate({
                  fixtures: {
                    [fixtureId]: {
                      [comp.name]: val
                    }
                  },
                  overriddenFixtures: {
                    [fixtureId]: {
                      active: true,
                      looks: activeLooksForFixture.map(l => ({ id: l.id, color: l.color }))
                    }
                  }
                });
              } else {
                // No override - normal update
                sendUpdate({
                  fixtures: {
                    [fixtureId]: {
                      [comp.name]: val
                    }
                  }
                });
              }
            }}
            label=""
            color="intensity"
            lookContributors={[]} // No colored outline from looks
            hasManualValue={false} // No manual value indicator on controls
            isOverridden={false} // No grey outline on controls
            isFrozen={false} // No frozen outline on controls
            lookIntensity={0} // No look intensity indicator
          />
        </div>
      );
    } else if (control.controlType === 'Zoom') {
      // Single slider (0-255 display, stored as 0-100)
      const comp = control.components[0];
      const meta = htpMetadata[comp?.name] || { contributors: [], displayValue: 0, hasManualValue: false };
      const displayValue = Math.round((meta.displayValue || 0) * 2.55);

      return (
        <div key={control.id} className="control-block">
          <h3>{control.label}</h3>
          <Slider
            value={displayValue}
            min={0}
            max={255}
            step={1}
            unit=""
            onChange={(val) => {
              const scaledValue = Math.max(0, Math.min(255, val)) / 2.55;
              // Mark channel as manually adjusted
              setManuallyAdjusted(prev => ({
                ...prev,
                [comp.name]: true
              }));

              // If channel was frozen, release it when user manually moves it
              setFrozenChannels(prev => {
                if (prev[comp.name] !== undefined) {
                  const updated = { ...prev };
                  delete updated[comp.name];
                  return updated;
                }
                return prev;
              });

              // Detect override: check if ANY look with level > 0 targets this fixture
              const activeLooksForFixture = [];
              config.looks?.forEach(look => {
                const lookLevel = state.looks?.[look.id] || 0;
                if (lookLevel > 0 && look.targets?.[fixtureId]) {
                  activeLooksForFixture.push({ id: look.id, color: look.color || 'blue', level: lookLevel });
                }
              });

              const hasActiveLooks = activeLooksForFixture.length > 0;

              if (hasActiveLooks) {
                setChannelOverrides(prev => ({ ...prev, [comp.name]: true }));

                // Save the contributing looks for grey dot display
                setOverriddenLooks(activeLooksForFixture);

                // Don't zero out looks - just mark fixture as overridden
                sendUpdate({
                  fixtures: {
                    [fixtureId]: {
                      [comp.name]: scaledValue
                    }
                  },
                  overriddenFixtures: {
                    [fixtureId]: {
                      active: true,
                      looks: activeLooksForFixture.map(l => ({ id: l.id, color: l.color }))
                    }
                  }
                });
              } else {
                // No override - normal update
                sendUpdate({
                  fixtures: {
                    [fixtureId]: {
                      [comp.name]: scaledValue
                    }
                  }
                });
              }
            }}
            label=""
            lookContributors={[]} // No colored outline from looks
            hasManualValue={false} // No manual value indicator on controls
            isOverridden={false} // No grey outline on controls
            isFrozen={false} // No frozen outline on controls
            lookIntensity={0} // No look intensity indicator
          />
        </div>
      );
    } else {
      // Generic fallback - render all components as sliders
      return (
        <div key={control.id} className="control-block">
          <h3>{control.label}</h3>
          {control.components.map((comp, idx) => {
            const meta = htpMetadata[comp.name] || { contributors: [], displayValue: 0, hasManualValue: false };
            return (
              <Slider
                key={idx}
                value={meta.displayValue}
                onChange={(val) => {
                  // Mark channel as manually adjusted
                  setManuallyAdjusted(prev => ({
                    ...prev,
                    [comp.name]: true
                  }));

                  // If channel was frozen, release it when user manually moves it
                  setFrozenChannels(prev => {
                    if (prev[comp.name] !== undefined) {
                      const updated = { ...prev };
                      delete updated[comp.name];
                      return updated;
                    }
                    return prev;
                  });

                  // Detect override: check if ANY look with level > 0 targets this fixture
                  const activeLooksForFixture = [];
                  config.looks?.forEach(look => {
                    const lookLevel = state.looks?.[look.id] || 0;
                    if (lookLevel > 0 && look.targets?.[fixtureId]) {
                      activeLooksForFixture.push({ id: look.id, color: look.color || 'blue', level: lookLevel });
                    }
                  });

                  const hasActiveLooks = activeLooksForFixture.length > 0;

                  if (hasActiveLooks) {
                    setChannelOverrides(prev => ({ ...prev, [comp.name]: true }));

                    // Save the contributing looks for grey dot display
                    setOverriddenLooks(activeLooksForFixture);

                    // Don't zero out looks - just mark fixture as overridden
                    sendUpdate({
                      fixtures: {
                        [fixtureId]: {
                          [comp.name]: val
                        }
                      },
                      overriddenFixtures: {
                        [fixtureId]: {
                          active: true,
                          looks: activeLooksForFixture.map(l => ({ id: l.id, color: l.color }))
                        }
                      }
                    });
                  } else {
                    // No override - normal update
                    sendUpdate({
                      fixtures: {
                        [fixtureId]: {
                          [comp.name]: val
                        }
                      }
                    });
                  }
                }}
                label={comp.name}
                lookContributors={[]} // No colored outline from looks
                hasManualValue={false} // No manual value indicator on controls
                isOverridden={false} // No grey outline on controls
                isFrozen={false} // No frozen outline on controls
                lookIntensity={0} // No look intensity indicator
              />
            );
          })}
        </div>
      );
    }
  };

  // Show loading state while waiting for config
  if (!config) {
    return (
      <div className="fixture-detail">
        <div className="fixture-detail-header">
          <button className="back-button" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1>Loading...</h1>
        </div>
      </div>
    );
  }

  // If config loaded but fixture not found, we'll redirect (handled by useEffect above)
  if (!fixture || !profile) {
    return (
      <div className="fixture-detail">
        <div className="fixture-detail-header">
          <button className="back-button" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1>Fixture not found</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="fixture-detail">
      {/* Header */}
      <div className="fixture-detail-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h1>{fixture.name || fixture.id}</h1>
        <button className="clear-button" onClick={handleClear}>
          Clear
        </button>
      </div>

      {/* Tabs */}
      <div className="fixture-detail-tabs">
        <button
          key="All"
          className={`tab ${activeTab === 'All' ? 'active' : ''}`}
          onClick={() => setActiveTab('All')}
        >
          All
        </button>
        {Object.keys(controlsByDomain).map(domain => (
          <button
            key={domain}
            className={`tab ${activeTab === domain ? 'active' : ''}`}
            onClick={() => setActiveTab(domain)}
          >
            {domain}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="fixture-detail-content">
        {activeTab === 'All'
          ? allControls.map(control => renderControl(control))
          : controlsByDomain[activeTab]?.map(control => renderControl(control))}
      </div>
    </div>
  );
}

export default FixtureDetail;
