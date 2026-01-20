import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import Slider from '../components/Slider';
import ColorWheel from '../components/ColorWheel';
import ConnectedUsers from '../components/ConnectedUsers';
import { rgbToHsv, hsvToRgb } from '../utils/color';

// HTP Metadata Hook - computes which looks control which channels
const useHTPMetadata = (state, config, channelOverrides, frozenChannels = {}) => {
  return useMemo(() => {
    const metadata = {}; // { 'fixtureId.channelName': { winners: [], contributors: [] } }
    const channelsToRelease = []; // Track channels that should be released from frozen state

    if (!state || !config) return { metadata, channelsToRelease };

    // Filter out any undefined/null fixtures before processing
    const fixtures = (config.fixtures || []).filter(f => f);

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

    fixtures.forEach(fixture => {
      const fixtureId = fixture?.id;
      if (!fixtureId) return;

      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (!profile) return;

      const defaultValues = {};
      if (profile.controls && Array.isArray(profile.controls)) {
        profile.controls.forEach(control => {
          if (control.components && Array.isArray(control.components)) {
            control.components.forEach(comp => {
              defaultValues[comp.name] = getDefaultValueForComponent(control, comp);
            });
          }
        });
      }

      // Get channel names from Control Blocks
      let channelsToProcess = [];

      if (profile.controls && Array.isArray(profile.controls)) {
        // New Control Blocks schema
        profile.controls.forEach(control => {
          if (control.components && Array.isArray(control.components)) {
            control.components.forEach(comp => {
              channelsToProcess.push(comp.name);
            });
          }
        });
      } else if (profile.channels && Array.isArray(profile.channels)) {
        // Legacy fallback
        channelsToProcess = profile.channels.map(ch => ch.name);
      }

      channelsToProcess.forEach(channelName => {
        const key = `${fixtureId}.${channelName}`;

        // Get fixture state once at the beginning
        const fixtureState = state.fixtures?.[fixtureId];

        // Check for server-side override (persists across navigation)
        const serverOverride = state.overriddenFixtures?.[fixtureId];

        // Skip if channel is overridden (local or server-side)
        if (channelOverrides[key] || serverOverride?.active) {
          // Get contributors from server override for grey dot display
          const overrideContributors = serverOverride?.looks?.map(l => ({
            lookId: l.id,
            color: l.color,
            value: 100
          })) || [];

          metadata[key] = {
            overridden: true,
            frozen: false,
            winners: [],
            contributors: overrideContributors,
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
              }
            }
          }
        });

        // Check if channel is frozen
        const frozenValue = frozenChannels[key];
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
          const winners = sources.filter(s => s.value === maxValue && s.type === 'look' && s.lookLevel > 0);
          const contributors = sources.filter(s => s.type === 'look' && s.lookLevel > 0 && s.targetValue !== undefined);

          // Find highest look intensity for opacity
          const lookIntensities = sources
            .filter(s => s.type === 'look' && s.lookLevel > 0)
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
  const { urlSlug } = useParams();
  const { state, sendUpdate, connected, role, shortId, requestAccess, activeClients, getDashboardRole, isEditorAnywhere, hsvCache, setFixtureHsv, resetFixtureHsv } = useWebSocketContext();
  const [config, setConfig] = useState(null);
  const [activeLayout, setActiveLayout] = useState(null);
  const [recordingLook, setRecordingLook] = useState(null);
  const [channelOverrides, setChannelOverrides] = useState({});
  const [manuallyAdjusted, setManuallyAdjusted] = useState({});  // Tracks channels manually touched
  const [frozenChannels, setFrozenChannels] = useState({});  // Tracks frozen values after recording {key: frozenValue}
  const [accessDenied, setAccessDenied] = useState(false);
  const [dashboardRole, setDashboardRole] = useState('viewer');
  const lastRgbByFixtureRef = useRef({});
  const lastHsvByFixtureRef = useRef({});
  const pendingClearRef = useRef(new Set());
  const resetFixtureColorCache = useCallback((fixtureIds) => {
    fixtureIds.forEach(fixtureId => {
      lastRgbByFixtureRef.current[fixtureId] = { r: 0, g: 0, b: 0 };
      lastHsvByFixtureRef.current[fixtureId] = { h: 0, s: 0, v: 0 };
      pendingClearRef.current.add(fixtureId);
    });
    resetFixtureHsv(fixtureIds);
  }, [resetFixtureHsv]);

  const applyDashboardClearDefaults = useCallback((profile, fixtureId, updates) => {
    if (!profile?.controls) return;

    const rgbControl = profile.controls.find(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
    if (!rgbControl || !Array.isArray(rgbControl.components)) return;

    const intensityControl = profile.controls.find(c => c.controlType === 'Intensity');
    const hasIntensity = intensityControl && Array.isArray(intensityControl.components);

    const rgbComponents = rgbControl.components.filter(c => c.type === 'red' || c.type === 'green' || c.type === 'blue');
    if (rgbComponents.length === 0) return;

    if (hasIntensity) {
      const dv = rgbControl.defaultValue;
      const defaultRgb = (dv?.type === 'rgb' || dv?.type === 'rgbw')
        ? { r: dv.r ?? 1, g: dv.g ?? 1, b: dv.b ?? 1 }
        : { r: 1, g: 1, b: 1 };
      rgbComponents.forEach(comp => {
        if (comp.type === 'red') updates[comp.name] = defaultRgb.r * 100;
        if (comp.type === 'green') updates[comp.name] = defaultRgb.g * 100;
        if (comp.type === 'blue') updates[comp.name] = defaultRgb.b * 100;
      });
    } else {
      rgbComponents.forEach(comp => {
        updates[comp.name] = 0;
      });
    }

    resetFixtureColorCache([fixtureId]);
  }, [resetFixtureColorCache]);

  // Compute HTP metadata
  const { metadata: htpMetadata, channelsToRelease } = useHTPMetadata(state, config, channelOverrides, frozenChannels);

  // Store latest htpMetadata in a ref so it can be accessed in callbacks without causing re-creation
  const htpMetadataRef = useRef(htpMetadata);
  useEffect(() => {
    htpMetadataRef.current = htpMetadata;
  }, [htpMetadata]);

  // Store RGB change handlers in a ref to prevent recreation on every render
  const rgbHandlersRef = useRef(new Map());

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
    const fetchConfigData = async () => {
      try {
        // Fetch config to get layout and other data
        const configRes = await fetch('/api/config');
        const data = await configRes.json();

        // Ensure data has required structure
        if (!data) {
          console.error('[Dashboard] Config fetch returned null/undefined');
          return;
        }
        if (!data.fixtureProfiles) {
          console.error('[Dashboard] Config missing fixtureProfiles');
          data.fixtureProfiles = [];
        }
        if (!data.fixtures) {
          console.error('[Dashboard] Config missing fixtures');
          data.fixtures = [];
        }

        setConfig(data);

        // Find layout by urlSlug
        let layout = data.showLayouts?.find(l => l.urlSlug === urlSlug);

        if (!layout) {
          // Dashboard not found - redirect to menu
          console.error(`Dashboard with slug '${urlSlug}' not found`);
          setAccessDenied(true);
          navigate('/dashboard', { replace: true });
          return;
        }

        // Get user's role for this specific dashboard
        const userDashboardRole = getDashboardRole ? getDashboardRole(layout.id) : role;
        setDashboardRole(userDashboardRole);

        // Check access based on dashboard's access control settings
        const accessControl = layout.accessControl || { requireExplicitAccess: false };

        // If dashboard requires explicit access, check if user has dashboard-specific role
        if (accessControl.requireExplicitAccess && getDashboardRole) {
          const hasExplicitAccess = getDashboardRole(layout.id) != null;
          if (!hasExplicitAccess) {
            console.warn(`Access denied: Dashboard '${layout.name}' requires explicit access`);
            alert(`You don't have access to this dashboard. Please request access from an administrator.`);
            setAccessDenied(true);
            navigate('/dashboard', { replace: true });
            return;
          }
        }

        setActiveLayout(layout);
      } catch (err) {
        console.error('Failed to fetch config:', err);
        setAccessDenied(true);
      }
    };

    if (urlSlug) {
      fetchConfigData();
    }
  }, [urlSlug, navigate, getDashboardRole, role]);

  // Update dashboard role when getDashboardRole changes (e.g., when role is updated via WebSocket)
  useEffect(() => {
    if (activeLayout && getDashboardRole) {
      const updatedRole = getDashboardRole(activeLayout.id);
      console.log(`[Dashboard] Role updated for dashboard ${activeLayout.id}: ${updatedRole}`);
      setDashboardRole(updatedRole);
    }
  }, [getDashboardRole, activeLayout]);

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

  const handleFixtureChange = useCallback((fixtureId, property, value) => {
    sendUpdate({
      fixtures: {
        [fixtureId]: {
          [property]: value
        }
      }
    });
    if (pendingClearRef.current.has(fixtureId)) {
      pendingClearRef.current.delete(fixtureId);
    }

    const key = `${fixtureId}.${property}`;
    const meta = htpMetadataRef.current[key];

    // Mark as manually adjusted whenever user touches slider
    setManuallyAdjusted(prev => ({ ...prev, [key]: true }));

    // If channel was frozen, release it when user manually moves it
    setFrozenChannels(prev => {
      if (prev[key] !== undefined) {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      }
      return prev;
    });

    // Detect override: mark if any look is contributing to this channel
    if (meta?.contributors?.length > 0) {
      setChannelOverrides(prev => ({ ...prev, [key]: true }));
    }
  }, [sendUpdate]);

  // Get or create a stable RGB change handler for a specific fixture
  const getRGBChangeHandler = useCallback((fixtureId, redChannel, greenChannel, blueChannel) => {
    const key = `${fixtureId}-${redChannel}-${greenChannel}-${blueChannel}`;

    if (!rgbHandlersRef.current.has(key)) {
      const handler = (r, g, b) => {
        handleFixtureChange(fixtureId, redChannel, r);
        handleFixtureChange(fixtureId, greenChannel, g);
        handleFixtureChange(fixtureId, blueChannel, b);
      };
      rgbHandlersRef.current.set(key, handler);
    }

    return rgbHandlersRef.current.get(key);
  }, [handleFixtureChange]);


  const handleRecordLook = (lookId) => {
    setRecordingLook(lookId);

    // Collect current displayed values from HTP metadata (what you see on sliders)
    const capturedTargets = {};
    (config.fixtures || []).filter(f => f).forEach(fixture => {
      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (!profile) return;

      capturedTargets[fixture.id] = {};

      // Record channel values from Control Blocks
      let channelsToRecord = [];
      if (profile.controls && Array.isArray(profile.controls)) {
        profile.controls.forEach(control => {
          if (control.components && Array.isArray(control.components)) {
            control.components.forEach(comp => {
              channelsToRecord.push({ name: comp.name });
            });
          }
        });
      } else if (profile.channels) {
        channelsToRecord = profile.channels;
      }

      channelsToRecord.forEach(channel => {
        const key = `${fixture.id}.${channel.name}`;
        const meta = htpMetadata[key];
        const displayValue = meta?.displayValue || 0;

        // Record all values (including zero)
        capturedTargets[fixture.id][channel.name] = Math.round(displayValue * 100) / 100;
      });
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
        // Clear all overrides when recording (both local and server-side)
        setChannelOverrides({});
        
        // Clear all server-side overriddenFixtures
        const overridesToClear = {};
        Object.keys(state.overriddenFixtures || {}).forEach(fixtureId => {
          overridesToClear[fixtureId] = null; // null clears the override
        });
        if (Object.keys(overridesToClear).length > 0) {
          sendUpdate({ overriddenFixtures: overridesToClear });
        }
        
        // Convert ALL current displayed values to frozen channels (grey outline)
        // All channels stay at their values until a look matches them
        const newFrozenChannels = {};
        (config.fixtures || []).filter(f => f).forEach(fixture => {
          const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
          if (!profile) return;

          // Get channels from Control Blocks
          let channelsToFreeze = [];
          if (profile.controls && Array.isArray(profile.controls)) {
            profile.controls.forEach(control => {
              if (control.components && Array.isArray(control.components)) {
                control.components.forEach(comp => {
                  channelsToFreeze.push({ name: comp.name });
                });
              }
            });
          } else if (profile.channels) {
            channelsToFreeze = profile.channels;
          }

          // Freeze all channels with non-zero values
          channelsToFreeze.forEach(channel => {
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
    (config.looks || []).filter(l => l).forEach(look => {
      clearedLooks[look.id] = 0;
    });

    // Clear all server-side overriddenFixtures
    const overridesToClear = {};
    Object.keys(state.overriddenFixtures || {}).forEach(fixtureId => {
      overridesToClear[fixtureId] = null;
    });

    sendUpdate({
      looks: clearedLooks,
      overriddenFixtures: Object.keys(overridesToClear).length > 0 ? overridesToClear : undefined
    });

    // Clear local overrides, manual adjustments, and frozen channels
    setChannelOverrides({});
    setManuallyAdjusted({});
    setFrozenChannels({});
  };

  // Helper function to apply default values from a control block
  const applyControlDefaults = (control, fixtureState) => {
    if (!control.defaultValue) {
      // No default value defined - use safe fallback defaults
      control.components.forEach(comp => {
        if (comp.type === 'intensity') {
          fixtureState[comp.name] = 0; // Intensity off
        } else if (comp.type === 'red' || comp.type === 'green' || comp.type === 'blue') {
          fixtureState[comp.name] = 100; // White (RGB 100,100,100)
        } else if (comp.type === 'white' || comp.type === 'amber') {
          fixtureState[comp.name] = 100; // Full white/amber
        } else {
          fixtureState[comp.name] = 0; // Generic channels off
        }
      });
    } else {
      // Apply profile-defined default values
      const defaultVal = control.defaultValue;

      if (defaultVal.type === 'rgb') {
        // RGB color default (normalized 0-1, convert to 0-100)
        control.components.forEach(comp => {
          if (comp.type === 'red') fixtureState[comp.name] = (defaultVal.r || 0) * 100;
          else if (comp.type === 'green') fixtureState[comp.name] = (defaultVal.g || 0) * 100;
          else if (comp.type === 'blue') fixtureState[comp.name] = (defaultVal.b || 0) * 100;
        });
      } else if (defaultVal.type === 'rgbw') {
        // RGBW color default
        control.components.forEach(comp => {
          if (comp.type === 'red') fixtureState[comp.name] = (defaultVal.r || 0) * 100;
          else if (comp.type === 'green') fixtureState[comp.name] = (defaultVal.g || 0) * 100;
          else if (comp.type === 'blue') fixtureState[comp.name] = (defaultVal.b || 0) * 100;
          else if (comp.type === 'white') fixtureState[comp.name] = (defaultVal.w || 0) * 100;
        });
      } else if (defaultVal.type === 'scalar') {
        // Single scalar value (normalized 0-1, convert to 0-100)
        control.components.forEach(comp => {
          fixtureState[comp.name] = (defaultVal.v || 0) * 100;
        });
      } else if (defaultVal.type === 'xy') {
        // XY position (for pan/tilt, normalized 0-1, convert to 0-100)
        control.components.forEach(comp => {
          if (comp.type === 'pan') fixtureState[comp.name] = (defaultVal.x || 0.5) * 100;
          else if (comp.type === 'tilt') fixtureState[comp.name] = (defaultVal.y || 0.5) * 100;
        });
      }
    }
  };

  const hasActiveLookForFixture = useCallback((fixtureId) => {
    return (config?.looks || []).some(look => {
      const level = state.looks?.[look.id] ?? 0;
      return level > 0 && look.targets?.[fixtureId];
    });
  }, [config?.looks, state.looks]);

  const getActiveLooksForFixture = useCallback((fixtureId) => {
    const activeLooks = [];
    (config?.looks || []).forEach(look => {
      const lookLevel = state.looks?.[look.id] ?? 0;
      if (lookLevel > 0 && look.targets?.[fixtureId]) {
        activeLooks.push({ id: look.id, color: look.color || 'blue', level: lookLevel });
      }
    });
    return activeLooks;
  }, [config?.looks, state.looks]);

  const setFixtureChannelsToZero = (profile, fixtureState) => {
    if (profile.controls && Array.isArray(profile.controls)) {
      profile.controls.forEach(control => {
        if (control.components && Array.isArray(control.components)) {
          control.components.forEach(comp => {
            fixtureState[comp.name] = 0;
          });
        }
      });
    } else if (profile.channels) {
      profile.channels.forEach(ch => {
        fixtureState[ch.name] = 0;
      });
    }
  };

  const handleClearAllFixtures = () => {
    const clearedFixtures = {};
    const overridesToClear = {};
    (config.fixtures || []).filter(f => f).forEach(fixture => {
      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (profile) {
        clearedFixtures[fixture.id] = {};
        overridesToClear[fixture.id] = null;

        const hasActiveLook = hasActiveLookForFixture(fixture.id);
        if (hasActiveLook) {
          setFixtureChannelsToZero(profile, clearedFixtures[fixture.id]);
        } else {
          // Apply defaults from Control Blocks
          if (profile.controls && Array.isArray(profile.controls)) {
            profile.controls.forEach(control => {
              if (control.components && Array.isArray(control.components)) {
                applyControlDefaults(control, clearedFixtures[fixture.id]);
              }
            });
            applyDashboardClearDefaults(profile, fixture.id, clearedFixtures[fixture.id]);
          } else if (profile.channels) {
            // Legacy fallback - set all to 0
            profile.channels.forEach(ch => {
              clearedFixtures[fixture.id][ch.name] = 0;
            });
            resetFixtureColorCache([fixture.id]);
          }
        }
      }
    });
    console.log('[Dashboard] Clear button clicked - applying defaults:', clearedFixtures);
    sendUpdate({ fixtures: clearedFixtures, overriddenFixtures: overridesToClear });
    // Clear overrides, manual adjustments, and frozen channels
    setChannelOverrides({});
    setManuallyAdjusted({});
    setFrozenChannels({});
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

    // Check if profile has RGB or intensity from Control Blocks
    let hasRgb = false;
    let hasIntensity = false;

    if (profile.controls && Array.isArray(profile.controls)) {
      profile.controls.forEach(control => {
        if (control.components && Array.isArray(control.components)) {
          control.components.forEach(comp => {
            if (comp.type === 'red' || comp.type === 'green' || comp.type === 'blue') hasRgb = true;
            if (comp.type === 'intensity') hasIntensity = true;
          });
        }
      });
    } else if (profile.channels) {
      hasRgb = profile.channels.some(ch => ch.name === 'red');
      hasIntensity = profile.channels.some(ch => ch.name === 'intensity');
    }

    if (hasRgb) {
      // RGB mode: Get RGB values directly
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
    .sort((a, b) => a.order - b.order);

  return (
    <div className="app">
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
        {activeLayout.showName && (
          <h1>{activeLayout.name}</h1>
        )}
        {activeLayout.showBlackoutButton !== false && (
          <button
            className={`blackout-btn ${state.blackout ? 'active' : ''}`}
            onClick={handleBlackout}
            disabled={dashboardRole === 'viewer'}
            style={{
              opacity: dashboardRole === 'viewer' ? 0.5 : 1,
              cursor: dashboardRole === 'viewer' ? 'not-allowed' : 'pointer'
            }}
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

      {dashboardRole === 'viewer' && (
        <div className="card" style={{ background: '#2a2a4a', marginBottom: '16px', border: '2px solid #4a90e2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
            <div>
              <p style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#4a90e2' }}>
                Viewing Only
              </p>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#888' }}>
                User ID: {shortId}
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => requestAccess(activeLayout?.id)}
              style={{
                background: '#4a90e2',
                color: '#fff',
                padding: '10px 20px',
                whiteSpace: 'nowrap'
              }}
            >
              Request Access
            </button>
          </div>
        </div>
      )}

      {visibleSections.map(section => {
        // Get visible items from this section
        const visibleItems = section.items
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
                  const fixture = (config.fixtures || []).find(f => f && f.id === item.id);
                  if (!fixture) return false;
                  const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
                  if (!profile) return false;
                  // Check if any channels have overrides (works with both control blocks and legacy)
                  if (profile.controls && Array.isArray(profile.controls)) {
                    return profile.controls.some(control =>
                      control.components && control.components.some(comp => channelOverrides[`${fixture.id}.${comp.name}`])
                    );
                  }
                  return profile.channels && profile.channels.some(ch => channelOverrides[`${fixture.id}.${ch.name}`]);
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
                          const fixturesToClear = {};
                          fixtureItems.forEach(item => {
                            const fixture = (config.fixtures || []).find(f => f && f.id === item.id);
                            if (fixture) {
                              const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
                              if (profile) {
                                // Clear overrides and apply defaults from Control Blocks
                                fixturesToClear[fixture.id] = {};
                                if (profile.controls && Array.isArray(profile.controls)) {
                                  profile.controls.forEach(control => {
                                    if (control.components && Array.isArray(control.components)) {
                                      // Clear overrides for this control's channels
                                      control.components.forEach(comp => {
                                        delete newOverrides[`${fixture.id}.${comp.name}`];
                                      });
                                      // Apply defaults for this control
                                      applyControlDefaults(control, fixturesToClear[fixture.id]);
                                    }
                                  });
                                  const hasActiveLook = hasActiveLookForFixture(fixture.id);
                                  if (hasActiveLook) {
                                    setFixtureChannelsToZero(profile, fixturesToClear[fixture.id]);
                                  } else {
                                    applyDashboardClearDefaults(profile, fixture.id, fixturesToClear[fixture.id]);
                                  }
                                } else if (profile.channels) {
                                  // Legacy fallback
                                  profile.channels.forEach(ch => {
                                    delete newOverrides[`${fixture.id}.${ch.name}`];
                                    fixturesToClear[fixture.id][ch.name] = 0;
                                  });
                                  if (!hasActiveLookForFixture(fixture.id)) {
                                    resetFixtureColorCache([fixture.id]);
                                  }
                                }
                              }
                            }
                          });
                          console.log('[Dashboard] Clear Overrides clicked - sending fixture resets:', fixturesToClear);
                          setChannelOverrides(newOverrides);
                          if (Object.keys(fixturesToClear).length > 0) {
                            sendUpdate({ fixtures: fixturesToClear });
                            resetFixtureColorCache(Object.keys(fixturesToClear));
                          }
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
                const look = (config.looks || []).find(l => l && l.id === item.id);
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
                        disabled={dashboardRole === 'viewer'}
                      />
                    </div>
                    {look.showRecordButton && (
                      <button
                        className={`btn btn-small record-btn ${recordingLook === look.id ? 'recording' : ''}`}
                        onClick={() => handleRecordLook(look.id)}
                        disabled={dashboardRole === 'viewer'}
                        style={{
                          padding: '6px 10px',
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                          background: '#444',
                          border: '1px solid #666',
                          opacity: dashboardRole === 'viewer' ? 0.5 : 1,
                          cursor: dashboardRole === 'viewer' ? 'not-allowed' : 'pointer'
                        }}
                        title="Record current fixture values to this look"
                      >
                        ● Rec
                      </button>
                    )}
                  </div>
                );
              } else if (item.type === 'fixture') {
                const fixture = (config.fixtures || []).find(f => f && f.id === item.id);
                if (!fixture) return null;

                const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
                if (!profile) return null;

                // Get color preview for RGB fixtures (using HTP-computed values)
                let colorPreview = null;
                let rgbControl = null;
                let rgbComponents = null;
                let redComp = null;
                let greenComp = null;
                let blueComp = null;
                if (profile.controls && Array.isArray(profile.controls)) {
                  // Find RGB control block
                  rgbControl = profile.controls.find(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
                  if (rgbControl) {
                    rgbComponents = rgbControl.components || [];
                    redComp = rgbComponents.find(c => c.type === 'red');
                    greenComp = rgbComponents.find(c => c.type === 'green');
                    blueComp = rgbComponents.find(c => c.type === 'blue');

                    if (redComp && greenComp && blueComp) {
                      // Use HTP metadata for actual displayed color
                      const redMeta = htpMetadata[`${fixture.id}.${redComp.name}`];
                      const greenMeta = htpMetadata[`${fixture.id}.${greenComp.name}`];
                      const blueMeta = htpMetadata[`${fixture.id}.${blueComp.name}`];

                      const r = Math.round((redMeta?.displayValue || 0) * 2.55);
                      const g = Math.round((greenMeta?.displayValue || 0) * 2.55);
                      const b = Math.round((blueMeta?.displayValue || 0) * 2.55);
                      colorPreview = `rgb(${r}, ${g}, ${b})`;
                    }
                  }
                }

                // Get intensity or brightness for toggle behavior (using HTP-computed values)
                let toggleComponents = [];
                let brightnessValue = 0;
                let lookContributors = []; // Track which looks are contributing
                let intensityChannelName = null;
                let intensityDisplayValue = 0;
                let rgbChannelNames = [];
                let directRgb = null;
                let rgbChannelMap = null;
                let rgbHsv = null;
                let htpRgb = null;

                if (profile.controls && Array.isArray(profile.controls)) {
                  // Check for dedicated Intensity control first
                  const intensityControl = profile.controls.find(c => c.controlType === 'Intensity');
                  if (intensityControl && intensityControl.components && intensityControl.components.length > 0) {
                    toggleComponents = intensityControl.components;
                    intensityChannelName = intensityControl.components[0].name;
                    const meta = htpMetadata[`${fixture.id}.${intensityChannelName}`];
                    brightnessValue = meta?.displayValue || 0;
                    intensityDisplayValue = meta?.displayValue || 0;
                    lookContributors = meta?.contributors || [];
                  } else {
                    // No intensity control - check for RGB/RGBW and use those for brightness toggle
                    if (rgbControl && rgbComponents) {
                      if (!redComp || !greenComp || !blueComp) {
                        return null;
                      }

                      rgbChannelMap = {
                        red: redComp.name,
                        green: greenComp.name,
                        blue: blueComp.name
                      };
                      toggleComponents = rgbControl.components;
                      // Calculate brightness as max of RGB HTP values
                      rgbChannelNames = [rgbChannelMap.red, rgbChannelMap.green, rgbChannelMap.blue];

                      const redMeta = htpMetadata[`${fixture.id}.${rgbChannelMap.red}`] || { displayValue: 0, contributors: [] };
                      const greenMeta = htpMetadata[`${fixture.id}.${rgbChannelMap.green}`] || { displayValue: 0, contributors: [] };
                      const blueMeta = htpMetadata[`${fixture.id}.${rgbChannelMap.blue}`] || { displayValue: 0, contributors: [] };
                      const rgbMetas = [redMeta, greenMeta, blueMeta];

                      const fixtureState = state.fixtures?.[fixture.id] || {};
                      directRgb = {
                        r: fixtureState[rgbChannelMap.red] ?? 0,
                        g: fixtureState[rgbChannelMap.green] ?? 0,
                        b: fixtureState[rgbChannelMap.blue] ?? 0
                      };
                      const directMax = Math.max(directRgb.r, directRgb.g, directRgb.b, 0);

                      htpRgb = {
                        r: redMeta.displayValue || 0,
                        g: greenMeta.displayValue || 0,
                        b: blueMeta.displayValue || 0
                      };
                      const displayBrightness = Math.max(htpRgb.r, htpRgb.g, htpRgb.b);
                      brightnessValue = displayBrightness;
                      if (pendingClearRef.current.has(fixture.id)) {
                        brightnessValue = 0;
                      }
                      intensityDisplayValue = brightnessValue;

                      if (pendingClearRef.current.has(fixture.id)) {
                        if (directMax === 0) {
                          pendingClearRef.current.delete(fixture.id);
                        }
                      } else if (directMax > 0) {
                        lastRgbByFixtureRef.current[fixture.id] = directRgb;
                        lastHsvByFixtureRef.current[fixture.id] = rgbToHsv(directRgb.r, directRgb.g, directRgb.b);
                      }

                      const cachedHsv = hsvCache?.[fixture.id];
                      const htpHsv = rgbToHsv(htpRgb.r, htpRgb.g, htpRgb.b);
                      const useHtpHsv = lookContributors.length > 0 && displayBrightness > 0;
                      const seedHsv = useHtpHsv ? htpHsv : rgbToHsv(directRgb.r, directRgb.g, directRgb.b);
                      const displayHsv = useHtpHsv ? htpHsv : (cachedHsv || seedHsv);
                      rgbHsv = { ...displayHsv, v: brightnessValue };
                      if (!cachedHsv || useHtpHsv) {
                        setFixtureHsv(fixture.id, { ...displayHsv, v: brightnessValue });
                      }

                      // Combine contributors from all RGB channels
                      const allContributors = rgbMetas.flatMap(m => m.contributors || []);
                      const contributorMap = {};
                      allContributors.forEach(c => {
                        if (!contributorMap[c.color]) {
                          contributorMap[c.color] = { color: c.color, value: c.value };
                        } else {
                          contributorMap[c.color].value = Math.max(contributorMap[c.color].value, c.value);
                        }
                      });
                      lookContributors = Object.values(contributorMap);
                    }
                  }
                }

                // Toggle handler
                const handleToggle = (e) => {
                  e.stopPropagation(); // Prevent navigation to detail page
                  if (toggleComponents.length === 0 || dashboardRole === 'viewer') return;

                  const newValue = brightnessValue > 0 ? 0 : 100;
                  const updates = {};
                  toggleComponents.forEach(comp => {
                    updates[comp.name] = newValue;
                  });

                  sendUpdate({
                    fixtures: {
                      [fixture.id]: updates
                    }
                  });
                };

                // Color map for look indicator dots
                const colorMap = {
                  purple: '#9b4ae2', orange: '#e2904a', cyan: '#4ae2e2',
                  pink: '#e24a90', yellow: '#e2e24a', blue: '#4a90e2',
                  red: '#e24a4a', green: '#4ae24a'
                };

                // Check if fixture is in override mode (from server state)
                const isFixtureOverridden = state.overriddenFixtures?.[fixture.id]?.active;

                // Border/glow based on intensity
                let borderColor = '#3a3a3a'; // Default border
                let boxShadow = 'none';

                if (brightnessValue > 0) {
                  const intensity = brightnessValue / 100; // 0-1
                  // Use white glow that scales with intensity
                  const glowColor = colorPreview || `rgba(255, 255, 255, ${intensity})`;
                  borderColor = colorPreview || `rgba(255, 255, 255, ${0.5 + intensity * 0.5})`;
                  boxShadow = `0 0 ${12 * intensity}px ${glowColor}`;
                }

                const sliderAvailable = (item.controlMode === 'slider') && (Boolean(intensityChannelName) || Boolean(rgbControl));
                const showToggle = !sliderAvailable;
                const isPendingClear = pendingClearRef.current.has(fixture.id);
                const rgbValues = directRgb;

                const handleFixtureCardClick = (e) => {
                  const target = e.target;
                  if (target && target.closest) {
                    if (target.closest('input[type="range"]')) return;
                    if (target.closest('.fixture-card-action')) return;
                  }
                  navigate(`/fixture/${fixture.id}`);
                };

                return (
                  <div
                    key={item.id}
                    className="fixture-list-item"
                    onClick={handleFixtureCardClick}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      padding: '16px',
                      background: '#2a2a2a',
                      borderRadius: '12px',
                      marginBottom: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      border: `2px solid ${borderColor}`,
                      boxShadow: boxShadow,
                      userSelect: 'none'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#333333'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#2a2a2a'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                        {/* Fixture name */}
                        <span style={{ fontSize: '16px', fontWeight: '500', color: '#fff' }}>
                          {fixture.name || fixture.id}
                        </span>
                        {/* Look indicator dots - grey when fixture is overridden */}
                        {lookContributors.length > 0 && (
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {lookContributors.slice(0, 3).map((contributor, idx) => (
                              <div
                                key={idx}
                                style={{
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  background: isFixtureOverridden ? '#666' : (colorMap[contributor.color] || '#4a90e2'),
                                  opacity: isFixtureOverridden ? 0.7 : (0.5 + ((contributor.value || 0) / 100) * 0.5),
                                  flexShrink: 0
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Toggle button - RGB color for color fixtures, grey for dimmer-only */}
                      {showToggle && toggleComponents.length > 0 && (
                        <button
                          onClick={handleToggle}
                          disabled={dashboardRole === 'viewer'}
                          className="fixture-card-action"
                          style={{
                            width: '56px',
                            height: '32px',
                            borderRadius: '16px',
                            background: brightnessValue > 0 
                              ? (colorPreview || `rgb(${Math.round(85 + (brightnessValue / 100) * 85)}, ${Math.round(85 + (brightnessValue / 100) * 85)}, ${Math.round(85 + (brightnessValue / 100) * 85)})`)
                              : '#333',
                            border: 'none',
                            cursor: dashboardRole === 'viewer' ? 'not-allowed' : 'pointer',
                            position: 'relative',
                            transition: 'background 0.2s',
                            opacity: dashboardRole === 'viewer' ? 0.5 : 1,
                            flexShrink: 0
                          }}
                        >
                          <div
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              background: '#fff',
                              position: 'absolute',
                              top: '4px',
                              left: brightnessValue > 0 ? '28px' : '4px',
                              transition: 'left 0.2s',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                            }}
                          />
                        </button>
                      )}
                    </div>

                    {sliderAvailable && (
                      <div
                        className="fixture-slider-area"
                        style={{ marginTop: '10px' }}
                      >
                        {intensityChannelName && (
                          <Slider
                            label=""
                            value={intensityDisplayValue}
                            min={0}
                            max={100}
                            step={1}
                            unit="%"
                            onChange={(value) => {
                              const activeLooksForFixture = getActiveLooksForFixture(fixture.id);
                              const hasActiveLooks = activeLooksForFixture.length > 0;

                              if (pendingClearRef.current.has(fixture.id)) {
                                pendingClearRef.current.delete(fixture.id);
                              }

                              setFrozenChannels(prev => {
                                if (prev[intensityChannelName] !== undefined) {
                                  const updated = { ...prev };
                                  delete updated[intensityChannelName];
                                  return updated;
                                }
                                return prev;
                              });

                              if (hasActiveLooks) {
                                setChannelOverrides(prev => ({ ...prev, [intensityChannelName]: true }));
                              }

                              sendUpdate({
                                fixtures: {
                                  [fixture.id]: {
                                    [intensityChannelName]: value
                                  }
                                },
                                overriddenFixtures: hasActiveLooks ? {
                                  [fixture.id]: {
                                    active: true,
                                    looks: activeLooksForFixture.map(look => ({ id: look.id, color: look.color }))
                                  }
                                } : undefined
                              });
                            }}
                            color="intensity"
                            disabled={dashboardRole === 'viewer'}
                          />
                        )}
                        {!intensityChannelName && rgbControl && redComp && greenComp && blueComp && rgbHsv && (
                          <ColorWheel
                            mode="hsv"
                            hue={rgbHsv.h}
                            sat={rgbHsv.s}
                            brightness={rgbHsv.v}
                            lockHueSat={true}
                            onChange={(h, s, v) => {
                              const cached = hsvCache?.[fixture.id] || rgbHsv;
                              const nextH = cached?.h ?? h;
                              const nextS = cached?.s ?? s;
                              setFixtureHsv(fixture.id, { h: nextH, s: nextS, v });
                              const nextRgb = hsvToRgb(nextH, nextS, v);

                              if (pendingClearRef.current.has(fixture.id)) {
                                pendingClearRef.current.delete(fixture.id);
                              }

                              setFrozenChannels(prev => {
                                const updated = { ...prev };
                                delete updated[redComp.name];
                                delete updated[greenComp.name];
                                delete updated[blueComp.name];
                                return updated;
                              });

                              const activeLooksForFixture = getActiveLooksForFixture(fixture.id);
                              const hasActiveLooks = activeLooksForFixture.length > 0;
                              if (hasActiveLooks) {
                                setChannelOverrides(prev => ({
                                  ...prev,
                                  [redComp.name]: true,
                                  [greenComp.name]: true,
                                  [blueComp.name]: true
                                }));
                              }

                              sendUpdate({
                                fixtures: {
                                  [fixture.id]: {
                                    [redComp.name]: nextRgb.r || 0,
                                    [greenComp.name]: nextRgb.g || 0,
                                    [blueComp.name]: nextRgb.b || 0
                                  }
                                },
                                overriddenFixtures: hasActiveLooks ? {
                                  [fixture.id]: {
                                    active: true,
                                    looks: activeLooksForFixture.map(look => ({ id: look.id, color: look.color }))
                                  }
                                } : undefined
                              });
                            }}
                            disabled={dashboardRole === 'viewer'}
                            showWheel={false}
                            sliderMaxWidth="100%"
                            customTrackGradient={
                              htpRgb
                                ? `linear-gradient(to right, #111 0%, rgb(${Math.round(htpRgb.r * 2.55)}, ${Math.round(htpRgb.g * 2.55)}, ${Math.round(htpRgb.b * 2.55)}) 100%)`
                                : undefined
                            }
                            customThumbColor={
                              htpRgb
                                ? `rgb(${Math.round(htpRgb.r * 2.55)}, ${Math.round(htpRgb.g * 2.55)}, ${Math.round(htpRgb.b * 2.55)})`
                                : undefined
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })}
          </div>
        );
      })}

      {activeLayout.showReturnToMenuButton !== false && (
        <button className="menu-btn" onClick={() => navigate('/dashboard')} title="Return to Menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
            <rect x="3" y="3" width="5" height="5" rx="1"/>
            <rect x="10" y="3" width="5" height="5" rx="1"/>
            <rect x="17" y="3" width="5" height="5" rx="1"/>
            <rect x="3" y="10" width="5" height="5" rx="1"/>
            <rect x="10" y="10" width="5" height="5" rx="1"/>
            <rect x="17" y="10" width="5" height="5" rx="1"/>
            <rect x="3" y="17" width="5" height="5" rx="1"/>
            <rect x="10" y="17" width="5" height="5" rx="1"/>
            <rect x="17" y="17" width="5" height="5" rx="1"/>
          </svg>
        </button>
      )}

      {activeLayout.showSettingsButton !== false && isEditorAnywhere && (
        <button className="settings-btn" onClick={() => navigate('/settings', { state: { fromDashboard: urlSlug } })}>
          ⚙
        </button>
      )}

      {!isEditorAnywhere && (dashboardRole === 'moderator' || role === 'moderator') && (
        <button className="settings-btn" onClick={() => navigate('/settings?tab=users', { state: { fromDashboard: urlSlug } })} title="Users and Access">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
        </button>
      )}

      <ConnectedUsers activeClients={activeClients} show={activeLayout?.showConnectedUsers !== false} />
    </div>
  );
};

export default Dashboard;
