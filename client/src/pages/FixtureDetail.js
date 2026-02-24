import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import { rgbToHsv, hsvToRgb } from '../utils/color';
import ColorWheel from '../components/ColorWheel';
import Slider from '../components/Slider';
import './FixtureDetail.css';

const COLOR_EDIT_MODES = ['wheel', 'hsv', 'rgb'];
const ATTRIBUTE_CLIPBOARD_STORAGE_KEY = 'fixture-attribute-clipboard:v1';
const PROFILE_LINK_STORAGE_KEY = 'fixture-profile-link-map:v1';

const isValidColorEditMode = (mode) => COLOR_EDIT_MODES.includes(mode);

const getColorEditModeStorageKey = (fixtureId, controlId) =>
  `fixture-color-edit-mode:${fixtureId}:${controlId}`;

function FixtureDetail() {
  const { fixtureId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dashboardId = location.state?.dashboardId;
  const { state, sendUpdate, setFixtureHsv, hsvCache, configVersion } = useWebSocketContext();
  const [config, setConfig] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [colorEditModeByControl, setColorEditModeByControl] = useState({});
  const [manuallyAdjusted, setManuallyAdjusted] = useState({}); // Tracks channels manually touched
  const [channelOverrides, setChannelOverrides] = useState({}); // Tracks override state (white outline)
  const [frozenChannels, setFrozenChannels] = useState({}); // Tracks frozen values after recording (grey outline)
  const [overriddenLooks, setOverriddenLooks] = useState([]); // Tracks which looks were active when override happened
  const [attributeClipboard, setAttributeClipboard] = useState(null);
  const [copyPasteStatus, setCopyPasteStatus] = useState('');
  const [profileLinkMap, setProfileLinkMap] = useState({});

  const fetchConfig = useCallback(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch config:', err));
  }, []);

  // Fetch config
  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    fetchConfig();
  }, [configVersion, fetchConfig]);

  // Find the fixture in config
  const fixture = config?.fixtures?.find(f => f.id === fixtureId);
  const profile = config?.fixtureProfiles?.find(p => p.id === fixture?.profileId);
  const fixtureState = useMemo(() => state?.fixtures?.[fixtureId] || {}, [state?.fixtures, fixtureId]);
  const isProfileLinked = Boolean(profile?.id && profileLinkMap[profile.id]);
  const linkedFixtureIds = useMemo(() => {
    if (!isProfileLinked || !profile?.id) return [];
    return (config?.fixtures || [])
      .filter(f => f && f.profileId === profile.id && f.id !== fixtureId)
      .map(f => f.id);
  }, [isProfileLinked, profile?.id, config?.fixtures, fixtureId]);

  const persistProfileLinkMap = useCallback((nextMap) => {
    setProfileLinkMap(nextMap);
    try {
      window.localStorage.setItem(PROFILE_LINK_STORAGE_KEY, JSON.stringify(nextMap));
    } catch (err) {
      console.warn('Failed to write profile link map:', err);
    }
  }, []);

  const toggleProfileLink = useCallback(() => {
    if (!profile?.id) return;
    const willEnable = !profileLinkMap[profile.id];
    const nextMap = { ...profileLinkMap };
    nextMap[profile.id] = willEnable;
    persistProfileLinkMap(nextMap);

    const totalSameProfile = (config?.fixtures || []).filter(f => f?.profileId === profile.id).length;
    if (willEnable) {
      setCopyPasteStatus(`↯ Link enabled (${totalSameProfile} fixtures)`);
    } else {
      setCopyPasteStatus('↯ Link disabled');
    }
  }, [profile?.id, profileLinkMap, persistProfileLinkMap, config?.fixtures]);

  const sendFixtureUpdate = useCallback((data) => {
    if (!isProfileLinked || !profile?.id || linkedFixtureIds.length === 0) {
      sendUpdate(data, dashboardId);
      return;
    }

    const payload = { ...data };

    if (data.fixtures && data.fixtures[fixtureId]) {
      const sourceFixtureUpdate = data.fixtures[fixtureId];
      payload.fixtures = { ...data.fixtures };
      linkedFixtureIds.forEach(targetId => {
        payload.fixtures[targetId] = {
          ...(payload.fixtures[targetId] || {}),
          ...sourceFixtureUpdate
        };
      });
    }

    if (data.fixtureHsv && data.fixtureHsv[fixtureId]) {
      const sourceHsv = data.fixtureHsv[fixtureId];
      payload.fixtureHsv = { ...data.fixtureHsv };
      linkedFixtureIds.forEach(targetId => {
        payload.fixtureHsv[targetId] = { ...sourceHsv };
      });
    }

    if (data.overriddenFixtures && Object.prototype.hasOwnProperty.call(data.overriddenFixtures, fixtureId)) {
      const sourceOverride = data.overriddenFixtures[fixtureId];
      payload.overriddenFixtures = { ...data.overriddenFixtures };
      linkedFixtureIds.forEach(targetId => {
        payload.overriddenFixtures[targetId] = sourceOverride === null ? null : { ...sourceOverride };
      });
    }

    sendUpdate(payload, dashboardId);
  }, [isProfileLinked, profile?.id, linkedFixtureIds, sendUpdate, dashboardId, fixtureId]);

  useEffect(() => {
    if (!fixtureId || !Array.isArray(profile?.controls)) return;

    const rgbControls = profile.controls.filter(
      control => control?.controlType === 'RGB' || control?.controlType === 'RGBW'
    );
    if (rgbControls.length === 0) return;

    setColorEditModeByControl(prev => {
      const next = { ...prev };
      let changed = false;

      rgbControls.forEach(control => {
        if (!control?.id || next[control.id]) return;

        let savedMode = 'wheel';
        try {
          const raw = window.localStorage.getItem(getColorEditModeStorageKey(fixtureId, control.id));
          if (isValidColorEditMode(raw)) {
            savedMode = raw;
          }
        } catch (err) {
          console.warn('Failed to read color edit mode from localStorage:', err);
        }

        next[control.id] = savedMode;
        changed = true;
      });

      return changed ? next : prev;
    });
  }, [fixtureId, profile?.controls]);

  const updateColorEditMode = useCallback((controlId, mode) => {
    if (!controlId || !isValidColorEditMode(mode)) return;

    setColorEditModeByControl(prev => ({
      ...prev,
      [controlId]: mode
    }));

    try {
      window.localStorage.setItem(getColorEditModeStorageKey(fixtureId, controlId), mode);
    } catch (err) {
      console.warn('Failed to write color edit mode to localStorage:', err);
    }
  }, [fixtureId]);

  const readAttributeClipboard = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(ATTRIBUTE_CLIPBOARD_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.components)) {
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn('Failed to parse attribute clipboard:', err);
      return null;
    }
  }, []);

  const refreshAttributeClipboard = useCallback(() => {
    setAttributeClipboard(readAttributeClipboard());
  }, [readAttributeClipboard]);

  useEffect(() => {
    refreshAttributeClipboard();
    const handleStorage = (event) => {
      if (event.key === ATTRIBUTE_CLIPBOARD_STORAGE_KEY) {
        refreshAttributeClipboard();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [refreshAttributeClipboard]);

  useEffect(() => {
    if (!copyPasteStatus) return;
    const timeout = setTimeout(() => setCopyPasteStatus(''), 2200);
    return () => clearTimeout(timeout);
  }, [copyPasteStatus]);

  const readProfileLinkMap = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(PROFILE_LINK_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch (err) {
      console.warn('Failed to parse profile link map:', err);
      return {};
    }
  }, []);

  useEffect(() => {
    setProfileLinkMap(readProfileLinkMap());
    const handleStorage = (event) => {
      if (event.key === PROFILE_LINK_STORAGE_KEY) {
        setProfileLinkMap(readProfileLinkMap());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [readProfileLinkMap]);

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
  }, [profile, state, config, channelOverrides, frozenChannels, overriddenLooks, manuallyAdjusted, fixtureId, fixtureState]);

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
      sendFixtureUpdate({ fixtures: { [fixtureId]: fixtureUpdates } });
    }
  }, [channelsToRelease, fixtureId, sendFixtureUpdate]);

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

  const getAllFixtureChannelNames = useCallback(() => {
    const channelNames = [];
    if (profile?.controls && Array.isArray(profile.controls)) {
      profile.controls.forEach(control => {
        if (control.components && Array.isArray(control.components)) {
          control.components.forEach(comp => channelNames.push(comp.name));
        }
      });
    } else if (profile?.channels && Array.isArray(profile.channels)) {
      profile.channels.forEach(channel => channelNames.push(channel.name));
    }
    return channelNames;
  }, [profile]);

  const buildOverrideFixtureValues = useCallback((channelUpdates = {}) => {
    const snapshot = {};
    getAllFixtureChannelNames().forEach(channelName => {
      const metaValue = htpMetadata[channelName]?.displayValue;
      const directValue = fixtureState?.[channelName];
      snapshot[channelName] = metaValue ?? directValue ?? 0;
    });
    return { ...snapshot, ...channelUpdates };
  }, [getAllFixtureChannelNames, htpMetadata, fixtureState]);

  const getStrictDimmerRgbSeed = useCallback((nextIntensityValue) => {
    if (nextIntensityValue <= 0 || !Array.isArray(profile?.controls)) return null;

    const intensityControls = profile.controls.filter(c => c.controlType === 'Intensity');
    const rgbControls = profile.controls.filter(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
    if (intensityControls.length !== 1 || rgbControls.length !== 1) return null;

    const rgbControl = rgbControls[0];
    const isLegacyDimmerRgbProfile = profile.controls.length === 2;
    const isStrictDimmerColor = Boolean(rgbControl.brightnessDrivenByIntensity) || isLegacyDimmerRgbProfile;
    if (!isStrictDimmerColor) return null;

    const redComp = rgbControl.components?.find(c => c.type === 'red');
    const greenComp = rgbControl.components?.find(c => c.type === 'green');
    const blueComp = rgbControl.components?.find(c => c.type === 'blue');
    if (!redComp || !greenComp || !blueComp) return null;

    const currentRed = fixtureState?.[redComp.name] ?? 0;
    const currentGreen = fixtureState?.[greenComp.name] ?? 0;
    const currentBlue = fixtureState?.[blueComp.name] ?? 0;
    const displayedRed = htpMetadata?.[redComp.name]?.displayValue ?? 0;
    const displayedGreen = htpMetadata?.[greenComp.name]?.displayValue ?? 0;
    const displayedBlue = htpMetadata?.[blueComp.name]?.displayValue ?? 0;
    if (Math.max(currentRed, currentGreen, currentBlue, displayedRed, displayedGreen, displayedBlue) > 0.01) return null;

    const dv = rgbControl.defaultValue;
    const hasRgbDefault = dv?.type === 'rgb' || dv?.type === 'rgbw';
    const isRgbDefaultBlack = hasRgbDefault && Number(dv.r ?? 0) === 0 && Number(dv.g ?? 0) === 0 && Number(dv.b ?? 0) === 0;
    const defaultRgb = (hasRgbDefault && !isRgbDefaultBlack)
      ? {
          r: (dv.r ?? 1) * 100,
          g: (dv.g ?? 1) * 100,
          b: (dv.b ?? 1) * 100
        }
      : { r: 100, g: 100, b: 100 };

    return {
      [redComp.name]: defaultRgb.r,
      [greenComp.name]: defaultRgb.g,
      [blueComp.name]: defaultRgb.b
    };
  }, [profile, fixtureState, htpMetadata]);

  const getActiveLooksForFixture = useCallback(() => {
    const activeById = {};
    Object.values(htpMetadata || {}).forEach(meta => {
      const contributors = meta?.contributors || [];
      contributors.forEach(contributor => {
        if (!contributor?.lookId) return;
        const level = state.looks?.[contributor.lookId] ?? 0;
        if (level <= 0) return;
        const existing = activeById[contributor.lookId];
        if (!existing || level > existing.level) {
          activeById[contributor.lookId] = {
            id: contributor.lookId,
            color: contributor.color || 'blue',
            level
          };
        }
      });
    });
    return Object.values(activeById);
  }, [htpMetadata, state.looks]);

  const buildAttributeClipboardPayload = useCallback(() => {
    if (!profile?.controls) return null;

    const components = [];
    const channelsByName = {};
    const channelsByNameLower = {};
    const valuesByType = {};

    profile.controls.forEach((control, controlIndex) => {
      (control.components || []).forEach((comp, componentIndex) => {
        const value = Number(
          htpMetadata?.[comp.name]?.displayValue ??
          fixtureState?.[comp.name] ??
          0
        );

        const componentEntry = {
          controlType: control.controlType || 'Generic',
          controlLabel: control.label || control.id || `Control ${controlIndex + 1}`,
          controlId: control.id || null,
          controlIndex,
          componentIndex,
          channelName: comp.name,
          componentType: comp.type || comp.name || 'generic',
          value
        };
        components.push(componentEntry);

        channelsByName[comp.name] = value;
        channelsByNameLower[(comp.name || '').toLowerCase()] = value;

        const typeKey = comp.type || '';
        if (typeKey) {
          if (!Array.isArray(valuesByType[typeKey])) valuesByType[typeKey] = [];
          valuesByType[typeKey].push(value);
        }
      });
    });

    const payload = {
      version: 1,
      copiedAt: Date.now(),
      sourceFixtureId: fixtureId,
      sourceFixtureName: fixture?.name || fixtureId,
      sourceProfileId: profile?.id || null,
      sourceProfileName: profile?.name || null,
      components,
      channelsByName,
      channelsByNameLower,
      valuesByType
    };

    const rgbControl = profile.controls.find(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
    const redComp = rgbControl?.components?.find(c => c.type === 'red');
    const greenComp = rgbControl?.components?.find(c => c.type === 'green');
    const blueComp = rgbControl?.components?.find(c => c.type === 'blue');
    if (redComp && greenComp && blueComp) {
      const r = Number(channelsByName[redComp.name] ?? 0);
      const g = Number(channelsByName[greenComp.name] ?? 0);
      const b = Number(channelsByName[blueComp.name] ?? 0);
      payload.rgbHsv = rgbToHsv(r, g, b);
    }

    return payload;
  }, [profile, htpMetadata, fixtureState, fixtureId, fixture]);

  const handleCopyAttributes = useCallback(() => {
    const payload = buildAttributeClipboardPayload();
    if (!payload) {
      setCopyPasteStatus('Nothing to copy');
      return;
    }

    try {
      window.localStorage.setItem(ATTRIBUTE_CLIPBOARD_STORAGE_KEY, JSON.stringify(payload));
      setAttributeClipboard(payload);
      setCopyPasteStatus(`Copied ${payload.sourceFixtureName}`);
    } catch (err) {
      console.error('Failed to write attribute clipboard:', err);
      setCopyPasteStatus('Copy failed');
    }
  }, [buildAttributeClipboardPayload]);

  const applyAttributePaste = useCallback((clipboard) => {
    if (!clipboard || !profile?.controls) return;

    const sourceChannels = clipboard.channelsByName || {};
    const sourceChannelsLower = clipboard.channelsByNameLower || {};
    const sourceValuesByType = clipboard.valuesByType || {};
    const typeCursor = {};
    const updates = {};

    profile.controls.forEach((control) => {
      (control.components || []).forEach((comp) => {
        let value;

        if (Object.prototype.hasOwnProperty.call(sourceChannels, comp.name)) {
          value = sourceChannels[comp.name];
        } else {
          const lowerName = (comp.name || '').toLowerCase();
          if (Object.prototype.hasOwnProperty.call(sourceChannelsLower, lowerName)) {
            value = sourceChannelsLower[lowerName];
          }
        }

        if (value === undefined && comp.type && Array.isArray(sourceValuesByType[comp.type])) {
          const idx = typeCursor[comp.type] || 0;
          if (idx < sourceValuesByType[comp.type].length) {
            value = sourceValuesByType[comp.type][idx];
            typeCursor[comp.type] = idx + 1;
          }
        }

        if (value !== undefined) {
          updates[comp.name] = Number(Math.max(0, Math.min(100, value)));
        }
      });
    });

    const updateKeys = Object.keys(updates);
    if (updateKeys.length === 0) {
      setCopyPasteStatus('No matching attributes to paste');
      return;
    }

    setManuallyAdjusted(prev => {
      const next = { ...prev };
      updateKeys.forEach(key => {
        next[key] = true;
      });
      return next;
    });

    setFrozenChannels(prev => {
      const next = { ...prev };
      updateKeys.forEach(key => {
        delete next[key];
      });
      return next;
    });

    const activeLooksForFixture = getActiveLooksForFixture();
    const hasActiveLooks = activeLooksForFixture.length > 0;
    const isFixtureAlreadyOverridden = Boolean(state?.overriddenFixtures?.[fixtureId]?.active);
    const fixtureValues = (hasActiveLooks && !isFixtureAlreadyOverridden)
      ? buildOverrideFixtureValues(updates)
      : updates;

    let fixtureHsvPayload;
    const rgbControl = profile.controls.find(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
    const redComp = rgbControl?.components?.find(c => c.type === 'red');
    const greenComp = rgbControl?.components?.find(c => c.type === 'green');
    const blueComp = rgbControl?.components?.find(c => c.type === 'blue');
    if (redComp && greenComp && blueComp) {
      const nextR = Number(updates[redComp.name] ?? htpMetadata?.[redComp.name]?.displayValue ?? fixtureState?.[redComp.name] ?? 0);
      const nextG = Number(updates[greenComp.name] ?? htpMetadata?.[greenComp.name]?.displayValue ?? fixtureState?.[greenComp.name] ?? 0);
      const nextB = Number(updates[blueComp.name] ?? htpMetadata?.[blueComp.name]?.displayValue ?? fixtureState?.[blueComp.name] ?? 0);
      const nextHsv = rgbToHsv(nextR, nextG, nextB);
      setFixtureHsv(fixtureId, nextHsv);
      fixtureHsvPayload = { [fixtureId]: nextHsv };
    }

    if (hasActiveLooks) {
      setChannelOverrides(prev => {
        const next = { ...prev };
        updateKeys.forEach(key => {
          next[key] = true;
        });
        return next;
      });
      setOverriddenLooks(activeLooksForFixture);
    }

    sendFixtureUpdate({
      fixtures: {
        [fixtureId]: fixtureValues
      },
      ...(fixtureHsvPayload ? { fixtureHsv: fixtureHsvPayload } : {}),
      ...(hasActiveLooks ? {
        overriddenFixtures: {
          [fixtureId]: {
            active: true,
            looks: activeLooksForFixture.map(l => ({ id: l.id, color: l.color }))
          }
        }
      } : {})
    });

    setCopyPasteStatus(`Pasted to ${fixture?.name || fixtureId}`);
  }, [profile, getActiveLooksForFixture, state?.overriddenFixtures, fixtureId, buildOverrideFixtureValues, htpMetadata, fixtureState, setFixtureHsv, sendFixtureUpdate, fixture]);

  const handlePasteAttributes = useCallback(() => {
    const clipboard = attributeClipboard || readAttributeClipboard();
    if (!clipboard) {
      setCopyPasteStatus('Clipboard is empty');
      return;
    }
    applyAttributePaste(clipboard);
  }, [attributeClipboard, readAttributeClipboard, applyAttributePaste]);

  const canPasteAttributes = Boolean(attributeClipboard && Array.isArray(attributeClipboard.components) && attributeClipboard.components.length > 0);

  const handleClear = () => {
    if (!profile) return;

    const hasActiveLook = getActiveLooksForFixture().length > 0;

    const updates = {};
    if (hasActiveLook) {
      // Allow looks to take control by zeroing direct values
      if (profile.controls) {
        profile.controls.forEach(control => {
          control.components?.forEach(comp => {
            updates[comp.name] = 0;
          });
        });
      }
    } else {
      // Apply default values from profile controls
      profile.controls.forEach(control => {
        if (control.components) {
          applyControlDefaults(control, updates);
        }
      });
    }

    sendFixtureUpdate({
      fixtures: { [fixtureId]: updates },
      fixtureHsv: { [fixtureId]: { h: 0, s: 0, v: 100 } },
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
      const hasIntensityControl = profile?.controls?.some(c => c.controlType === 'Intensity');
      const isLegacyDimmerRgbProfile = Boolean(
        hasIntensityControl &&
        Array.isArray(profile?.controls) &&
        profile.controls.length === 2 &&
        profile.controls.filter(c => c.controlType === 'RGB' || c.controlType === 'RGBW').length === 1
      );
      const isStrictDimmerColor = Boolean(control.brightnessDrivenByIntensity) || isLegacyDimmerRgbProfile;

      // Find RGB components
      const redComp = control.components.find(c => c.type === 'red');
      const greenComp = control.components.find(c => c.type === 'green');
      const blueComp = control.components.find(c => c.type === 'blue');
      if (!redComp || !greenComp || !blueComp) return null;

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

      const selectedColorMode = colorEditModeByControl[control.id] || 'wheel';
      const cachedHsv = hsvCache?.[fixtureId];
      const htpHsv = rgbToHsv(redMeta.displayValue || 0, greenMeta.displayValue || 0, blueMeta.displayValue || 0);
      const displayHue = cachedHsv?.h ?? htpHsv.h;
      const displaySat = cachedHsv?.s ?? htpHsv.s;
      const displayBrightness = isStrictDimmerColor ? 100 : htpHsv.v;
      const hueTrack = 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)';
      const satStart = hsvToRgb(displayHue, 0, Math.max(displayBrightness, 1));
      const satEnd = hsvToRgb(displayHue, 100, Math.max(displayBrightness, 1));
      const satTrack = `linear-gradient(to right, rgb(${Math.round(satStart.r * 2.55)}, ${Math.round(satStart.g * 2.55)}, ${Math.round(satStart.b * 2.55)}) 0%, rgb(${Math.round(satEnd.r * 2.55)}, ${Math.round(satEnd.g * 2.55)}, ${Math.round(satEnd.b * 2.55)}) 100%)`;
      const valEnd = hsvToRgb(displayHue, displaySat, 100);
      const valTrack = `linear-gradient(to right, #000 0%, rgb(${Math.round(valEnd.r * 2.55)}, ${Math.round(valEnd.g * 2.55)}, ${Math.round(valEnd.b * 2.55)}) 100%)`;

      const applyRgbChannels = (nextRgb, hsvOverride = null) => {
        const normalizedRgb = {
          r: Math.max(0, Math.min(100, nextRgb.r ?? 0)),
          g: Math.max(0, Math.min(100, nextRgb.g ?? 0)),
          b: Math.max(0, Math.min(100, nextRgb.b ?? 0))
        };

        const hsvValue = hsvOverride || rgbToHsv(normalizedRgb.r, normalizedRgb.g, normalizedRgb.b);
        setFixtureHsv(fixtureId, hsvValue);

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

        const activeLooksForFixture = getActiveLooksForFixture();
        const hasActiveLooks = activeLooksForFixture.length > 0;
        const isFixtureAlreadyOverridden = Boolean(state?.overriddenFixtures?.[fixtureId]?.active);
        const rgbChannelUpdates = {
          [redComp.name]: normalizedRgb.r,
          [greenComp.name]: normalizedRgb.g,
          [blueComp.name]: normalizedRgb.b
        };
        const fixtureValues = (hasActiveLooks && !isFixtureAlreadyOverridden)
          ? buildOverrideFixtureValues(rgbChannelUpdates)
          : rgbChannelUpdates;

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
          sendFixtureUpdate({
            fixtures: {
              [fixtureId]: fixtureValues
            },
            fixtureHsv: {
              [fixtureId]: hsvValue
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
          sendFixtureUpdate({
            fixtures: {
              [fixtureId]: fixtureValues
            },
            fixtureHsv: {
              [fixtureId]: hsvValue
            }
          });
        }
      };

      const applyHsvChange = (h, s, v) => {
        const nextH = Math.max(0, Math.min(360, h ?? 0));
        const nextS = Math.max(0, Math.min(100, s ?? 0));
        const nextV = Math.max(0, Math.min(100, v ?? 0));
        const effectiveV = isStrictDimmerColor ? 100 : nextV;
        const hsvValue = { h: nextH, s: nextS, v: effectiveV };
        const rgb = hsvToRgb(nextH, nextS, effectiveV);
        applyRgbChannels(rgb, hsvValue);
      };

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
          <div className="color-edit-mode-switch">
            <button
              type="button"
              className={`color-edit-mode-btn ${selectedColorMode === 'wheel' ? 'active' : ''}`}
              onClick={() => updateColorEditMode(control.id, 'wheel')}
            >
              Wheel
            </button>
            <button
              type="button"
              className={`color-edit-mode-btn ${selectedColorMode === 'hsv' ? 'active' : ''}`}
              onClick={() => updateColorEditMode(control.id, 'hsv')}
            >
              HSV
            </button>
            <button
              type="button"
              className={`color-edit-mode-btn ${selectedColorMode === 'rgb' ? 'active' : ''}`}
              onClick={() => updateColorEditMode(control.id, 'rgb')}
            >
              RGB
            </button>
          </div>

          {selectedColorMode === 'wheel' && (
            <ColorWheel
              mode="hsv"
              hue={displayHue}
              sat={displaySat}
              brightness={displayBrightness}
              showBrightnessSlider={!isStrictDimmerColor}
              hasManualValue={hasOverrides || isActiveControl}
              initialHsv={cachedHsv}
              onChange={(h, s, v) => applyHsvChange(h, s, v)}
              isOverridden={false}
              isFrozen={false}
              lookContributors={[]}
              lookIntensity={0}
            />
          )}

          {selectedColorMode === 'hsv' && (
            <div className="color-edit-sliders">
              <Slider
                label="Hue"
                value={displayHue}
                min={0}
                max={360}
                step={1}
                unit="°"
                onChange={(val) => applyHsvChange(val, displaySat, displayBrightness)}
                color="intensity"
                lookContributors={[]}
                hasManualValue={false}
                isOverridden={false}
                isFrozen={false}
                lookIntensity={0}
                customTrackGradient={hueTrack}
              />
              <Slider
                label="Saturation"
                value={displaySat}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(val) => applyHsvChange(displayHue, val, displayBrightness)}
                color="intensity"
                lookContributors={[]}
                hasManualValue={false}
                isOverridden={false}
                isFrozen={false}
                lookIntensity={0}
                customTrackGradient={satTrack}
              />
              {!isStrictDimmerColor && (
                <Slider
                  label="Brightness"
                  value={displayBrightness}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  onChange={(val) => applyHsvChange(displayHue, displaySat, val)}
                  color="intensity"
                  lookContributors={[]}
                  hasManualValue={false}
                  isOverridden={false}
                  isFrozen={false}
                  lookIntensity={0}
                  customTrackGradient={valTrack}
                />
              )}
              {isStrictDimmerColor && (
                <div className="color-edit-note">Brightness is controlled by Dimmer.</div>
              )}
            </div>
          )}

          {selectedColorMode === 'rgb' && (
            <div className="color-edit-sliders">
              <Slider
                label="Red"
                value={redMeta.displayValue || 0}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(val) => {
                  applyRgbChannels({
                    r: val,
                    g: greenMeta.displayValue || 0,
                    b: blueMeta.displayValue || 0
                  });
                }}
                color="red"
                lookContributors={[]}
                hasManualValue={false}
                isOverridden={false}
                isFrozen={false}
                lookIntensity={0}
              />
              <Slider
                label="Green"
                value={greenMeta.displayValue || 0}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(val) => {
                  applyRgbChannels({
                    r: redMeta.displayValue || 0,
                    g: val,
                    b: blueMeta.displayValue || 0
                  });
                }}
                color="green"
                lookContributors={[]}
                hasManualValue={false}
                isOverridden={false}
                isFrozen={false}
                lookIntensity={0}
              />
              <Slider
                label="Blue"
                value={blueMeta.displayValue || 0}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(val) => {
                  applyRgbChannels({
                    r: redMeta.displayValue || 0,
                    g: greenMeta.displayValue || 0,
                    b: val
                  });
                }}
                color="blue"
                lookContributors={[]}
                hasManualValue={false}
                isOverridden={false}
                isFrozen={false}
                lookIntensity={0}
              />
            </div>
          )}
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

              const activeLooksForFixture = getActiveLooksForFixture();

              const hasActiveLooks = activeLooksForFixture.length > 0;
              const isFixtureAlreadyOverridden = Boolean(state?.overriddenFixtures?.[fixtureId]?.active);
              const seededRgbChannels = (!hasActiveLooks && control.controlType === 'Intensity')
                ? (getStrictDimmerRgbSeed(val) || {})
                : {};
              const fixtureValues = (hasActiveLooks && !isFixtureAlreadyOverridden)
                ? buildOverrideFixtureValues({ [comp.name]: val, ...seededRgbChannels })
                : { [comp.name]: val, ...seededRgbChannels };

              if (hasActiveLooks) {
                setChannelOverrides(prev => ({ ...prev, [comp.name]: true }));

                // Save the contributing looks for grey dot display
                setOverriddenLooks(activeLooksForFixture);

                // Don't zero out looks - just mark fixture as overridden
                sendFixtureUpdate({
                  fixtures: {
                    [fixtureId]: fixtureValues
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
                sendFixtureUpdate({
                  fixtures: {
                    [fixtureId]: fixtureValues
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

              const activeLooksForFixture = getActiveLooksForFixture();

              const hasActiveLooks = activeLooksForFixture.length > 0;
              const isFixtureAlreadyOverridden = Boolean(state?.overriddenFixtures?.[fixtureId]?.active);
              const fixtureValues = (hasActiveLooks && !isFixtureAlreadyOverridden)
                ? buildOverrideFixtureValues({ [comp.name]: scaledValue })
                : { [comp.name]: scaledValue };

              if (hasActiveLooks) {
                setChannelOverrides(prev => ({ ...prev, [comp.name]: true }));

                // Save the contributing looks for grey dot display
                setOverriddenLooks(activeLooksForFixture);

                // Don't zero out looks - just mark fixture as overridden
                sendFixtureUpdate({
                  fixtures: {
                    [fixtureId]: fixtureValues
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
                sendFixtureUpdate({
                  fixtures: {
                    [fixtureId]: fixtureValues
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

              const activeLooksForFixture = getActiveLooksForFixture();

              const hasActiveLooks = activeLooksForFixture.length > 0;
              const isFixtureAlreadyOverridden = Boolean(state?.overriddenFixtures?.[fixtureId]?.active);
              const fixtureValues = (hasActiveLooks && !isFixtureAlreadyOverridden)
                ? buildOverrideFixtureValues({ [comp.name]: scaledValue })
                : { [comp.name]: scaledValue };

              if (hasActiveLooks) {
                setChannelOverrides(prev => ({ ...prev, [comp.name]: true }));

                // Save the contributing looks for grey dot display
                setOverriddenLooks(activeLooksForFixture);

                // Don't zero out looks - just mark fixture as overridden
                sendFixtureUpdate({
                  fixtures: {
                    [fixtureId]: fixtureValues
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
                sendFixtureUpdate({
                  fixtures: {
                    [fixtureId]: fixtureValues
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

                  const activeLooksForFixture = getActiveLooksForFixture();

                  const hasActiveLooks = activeLooksForFixture.length > 0;
                  const isFixtureAlreadyOverridden = Boolean(state?.overriddenFixtures?.[fixtureId]?.active);
                  const fixtureValues = (hasActiveLooks && !isFixtureAlreadyOverridden)
                    ? buildOverrideFixtureValues({ [comp.name]: val })
                    : { [comp.name]: val };

                  if (hasActiveLooks) {
                    setChannelOverrides(prev => ({ ...prev, [comp.name]: true }));

                    // Save the contributing looks for grey dot display
                    setOverriddenLooks(activeLooksForFixture);

                    // Don't zero out looks - just mark fixture as overridden
                    sendFixtureUpdate({
                      fixtures: {
                        [fixtureId]: fixtureValues
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
                    sendFixtureUpdate({
                      fixtures: {
                        [fixtureId]: fixtureValues
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
        <div className="fixture-detail-actions">
          <button
            className={`link-toggle-button ${isProfileLinked ? 'active' : ''}`}
            onClick={toggleProfileLink}
            title={isProfileLinked
              ? `↯ Linked to ${linkedFixtureIds.length + 1} fixtures with this profile`
              : '↯ Link fixtures with this profile'}
          >
            <span className="link-toggle-icon">↯</span>
          </button>
          <button className="copy-button" onClick={handleCopyAttributes} title="Copy attributes from this fixture">
            Copy
          </button>
          <button
            className="paste-button"
            onClick={handlePasteAttributes}
            disabled={!canPasteAttributes}
            title={canPasteAttributes
              ? `Paste attributes from ${attributeClipboard?.sourceFixtureName || 'clipboard'}`
              : 'No copied attributes available'}
          >
            Paste
          </button>
          <button className="clear-button" onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>
      {copyPasteStatus && (
        <div className="fixture-copy-paste-status">{copyPasteStatus}</div>
      )}

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
