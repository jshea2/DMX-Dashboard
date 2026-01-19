import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import { rgbToHsv } from '../utils/color';
import ColorWheel from '../components/ColorWheel';
import Slider from '../components/Slider';
import './FixtureDetail.css';

function FixtureDetail() {
  const { fixtureId } = useParams();
  const navigate = useNavigate();
  const { state, sendUpdate, setFixtureHsv, hsvCache } = useWebSocketContext();
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
  const { metadata: htpMetadata, channelsToRelease } = useMemo(() => {
    const metadata = {}; // { channelName: { contributors: [], displayValue: number, isOverridden, isFrozen } }
    const channelsToRelease = [];

    if (!profile || !state || !config) return { metadata, channelsToRelease };

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

    const getDefaultValueForComponent = (control, component) => {
      const defaultVal = control.defaultValue;
      if (!defaultVal) {
        if (component.type === 'intensity') return 0;
        if (component.type === 'red' || component.type === 'green' || component.type === 'blue') return 100;
        if (component.type === 'white' || component.type === 'amber') return 100;
        return 0;
      }

      if (defaultVal.type === 'rgb') {
        if (component.type === 'red') return (defaultVal.r || 0) * 100;
        if (component.type === 'green') return (defaultVal.g || 0) * 100;
        if (component.type === 'blue') return (defaultVal.b || 0) * 100;
      } else if (defaultVal.type === 'rgbw') {
        if (component.type === 'red') return (defaultVal.r || 0) * 100;
        if (component.type === 'green') return (defaultVal.g || 0) * 100;
        if (component.type === 'blue') return (defaultVal.b || 0) * 100;
        if (component.type === 'white') return (defaultVal.w || 0) * 100;
      } else if (defaultVal.type === 'scalar') {
        return (defaultVal.v || 0) * 100;
      } else if (defaultVal.type === 'xy') {
        if (component.type === 'pan') return (defaultVal.x || 0.5) * 100;
        if (component.type === 'tilt') return (defaultVal.y || 0.5) * 100;
      }

      return 0;
    };

    const defaultValues = {};
    if (profile?.controls) {
      profile.controls.forEach(control => {
        if (control.components && Array.isArray(control.components)) {
          control.components.forEach(comp => {
            defaultValues[comp.name] = getDefaultValueForComponent(control, comp);
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

      // Source 2+: Each look (blend from default to snapshot)
      config.looks?.forEach(look => {
        const lookLevel = state.looks?.[look.id] ?? 0;
        if (look.targets?.[fixtureId]) {
          const target = look.targets[fixtureId];
          const targetValue = target[channelName];
          if (targetValue !== undefined) {
            const defaultValue = defaultValues[channelName] ?? 0;
            const diff = Math.abs(targetValue - defaultValue);
            if (lookLevel > 0 && diff > 0.01) {
              const effectiveValue = defaultValue + (targetValue - defaultValue) * lookLevel;
              sources.push({
                type: 'look',
                value: effectiveValue,
                lookId: look.id,
                color: look.color || 'blue',
                lookLevel,
                targetValue
              });
              lookContributors.push({
                lookId: look.id,
                color: look.color || 'blue',
                value: effectiveValue
              });
            }
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
        const lookSources = sources.filter(s => s.type === 'look' && s.lookLevel > 0);

        // Check if any look controlling this channel is at 100%
        let hasLookAt100 = false;
        config.looks?.forEach(look => {
          const lookLevel = state.looks?.[look.id] ?? 0;
          if (lookLevel >= 1 && look.targets?.[fixtureId]) {
            const targetValue = look.targets[fixtureId][channelName];
            const defaultValue = defaultValues[channelName] ?? 0;
            if (targetValue !== undefined && Math.abs(targetValue - defaultValue) > 0.01) {
              hasLookAt100 = true;
            }
          }
        });

        if (hasLookAt100) {
          // Release this channel - a look controlling it is at 100%
          channelsToRelease.push(channelName);
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
        .filter(s => s.type === 'look' && s.lookLevel > 0)
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

    return { metadata, channelsToRelease };
  }, [profile, state, config, channelOverrides, frozenChannels, overriddenLooks, manuallyAdjusted, fixtureId]);

  // Keep HSV cache in sync with current RGB display (looks/HTP) when not manually adjusted
  useEffect(() => {
    if (!profile || !fixtureId) return;
    if (manuallyAdjusted && Object.keys(manuallyAdjusted).length > 0) return;

    const rgbControl = profile.controls?.find(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
    if (!rgbControl?.components) return;
    const redComp = rgbControl.components.find(c => c.type === 'red');
    const greenComp = rgbControl.components.find(c => c.type === 'green');
    const blueComp = rgbControl.components.find(c => c.type === 'blue');
    if (!redComp || !greenComp || !blueComp) return;

    const redMeta = htpMetadata[redComp.name];
    const greenMeta = htpMetadata[greenComp.name];
    const blueMeta = htpMetadata[blueComp.name];
    const r = redMeta?.displayValue ?? 0;
    const g = greenMeta?.displayValue ?? 0;
    const b = blueMeta?.displayValue ?? 0;

    if (r > 0 || g > 0 || b > 0) {
      setFixtureHsv(fixtureId, rgbToHsv(r, g, b));
    }
  }, [profile, fixtureId, htpMetadata, manuallyAdjusted, setFixtureHsv]);

  // Release frozen channels when look values match
  useEffect(() => {
    if (!channelsToRelease || channelsToRelease.length === 0) return;

    setFrozenChannels(prev => {
      const updated = { ...prev };
      channelsToRelease.forEach(channelName => {
        delete updated[channelName];
      });
      return updated;
    });

    const fixtureUpdates = {};
    channelsToRelease.forEach(channelName => {
      fixtureUpdates[channelName] = 0;
    });

    if (Object.keys(fixtureUpdates).length > 0) {
      sendUpdate({ fixtures: { [fixtureId]: fixtureUpdates } });
    }
  }, [channelsToRelease, fixtureId, sendUpdate]);

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
    setFixtureHsv(fixtureId, { h: 0, s: 0, v: 100 });
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
            syncHueSatFromProps={!hasOverrides && !isActiveControl}
            initialHsv={hsvCache?.[fixtureId]}
            onChange={(r, g, b) => {
              setFixtureHsv(fixtureId, rgbToHsv(r, g, b));
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
    } else if (control.controlType === 'CCT' || control.controlType === 'Tint') {
      // Single slider (0-255 display, stored as 0-100)
      const comp = control.components[0];
      const meta = htpMetadata[comp?.name] || { contributors: [], displayValue: 0, hasManualValue: false };
      const displayValue = Math.round((meta.displayValue || 0) * 2.55);
      const trackGradient = control.controlType === 'CCT'
        ? 'linear-gradient(to right, #ffb36a 0%, #b9dfff 100%)'
        : 'linear-gradient(to right, #ff7ab6 0%, #7dffb2 100%)';

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
            color="intensity"
            lookContributors={[]}
            hasManualValue={false}
            isOverridden={false}
            isFrozen={false}
            lookIntensity={0}
            customTrackGradient={trackGradient}
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
