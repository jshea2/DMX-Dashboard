import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import Slider from '../components/Slider';
import ColorWheel from '../components/ColorWheel';
import ConnectedUsers from '../components/ConnectedUsers';
import { rgbToHsv, hsvToRgb } from '../utils/color';

const LOOK_COLOR_MAP = {
  purple: '#9b4ae2',
  orange: '#e2904a',
  cyan: '#4ae2e2',
  pink: '#e24a90',
  yellow: '#e2e24a',
  blue: '#4a90e2',
  red: '#e24a4a',
  green: '#4ae24a'
};
const PROFILE_LINK_STORAGE_KEY = 'fixture-profile-link-map:v1';

const cloneLinkPayloadValue = (value) => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return [...value];
  if (typeof value === 'object') return { ...value };
  return value;
};

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
  const { state, sendUpdate, connected, role, shortId, requestAccess, activeClients, getDashboardRole, isEditorAnywhere, configVersion, hsvCache, setFixtureHsv, resetFixtureHsv } = useWebSocketContext();
  const [config, setConfig] = useState(null);
  const [activeLayout, setActiveLayout] = useState(null);
  const [recordingLook, setRecordingLook] = useState(null);
  const [channelOverrides, setChannelOverrides] = useState({});
  const [manuallyAdjusted, setManuallyAdjusted] = useState({});  // Tracks channels manually touched
  const [frozenChannels, setFrozenChannels] = useState({});  // Tracks frozen values after recording {key: frozenValue}
  const [accessDenied, setAccessDenied] = useState(false);
  const [dashboardRole, setDashboardRole] = useState('viewer');
  const [showFixtureEditor, setShowFixtureEditor] = useState(false);
  const [fixtureEditorSectionId, setFixtureEditorSectionId] = useState(null);
  const [fixtureEditorSectionName, setFixtureEditorSectionName] = useState('Fixtures');
  const [fixtureEditorDraft, setFixtureEditorDraft] = useState([]);
  const [fixtureEditorSaving, setFixtureEditorSaving] = useState(false);
  const [fixtureEditorError, setFixtureEditorError] = useState('');
  const [showLookEditor, setShowLookEditor] = useState(false);
  const [lookEditorSectionId, setLookEditorSectionId] = useState(null);
  const [lookEditorSectionName, setLookEditorSectionName] = useState('Looks');
  const [lookEditorDraft, setLookEditorDraft] = useState([]);
  const [lookEditorSaving, setLookEditorSaving] = useState(false);
  const [lookEditorError, setLookEditorError] = useState('');
  const [profileLinkMap, setProfileLinkMap] = useState({});
  const lastRgbByFixtureRef = useRef({});
  const lastHsvByFixtureRef = useRef({});
  const lastToggleOnBrightnessRef = useRef({});
  const pendingClearRef = useRef(new Set());
  const canEditSectionLayout = dashboardRole === 'editor' || role === 'editor' || isEditorAnywhere;
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

  const persistProfileLinkMap = useCallback((nextMap) => {
    setProfileLinkMap(nextMap);
    try {
      window.localStorage.setItem(PROFILE_LINK_STORAGE_KEY, JSON.stringify(nextMap));
    } catch (err) {
      console.warn('Failed to write profile link map:', err);
    }
  }, []);

  const toggleFixtureProfileLink = useCallback((profileId) => {
    if (!profileId) return;
    const nextMap = { ...profileLinkMap };
    const willEnable = !nextMap[profileId];
    if (willEnable) {
      nextMap[profileId] = true;
    } else {
      delete nextMap[profileId];
    }
    persistProfileLinkMap(nextMap);
  }, [profileLinkMap, persistProfileLinkMap]);

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

  const sendDashboardUpdate = useCallback((data) => {
    const hasLinkedProfiles = Object.keys(profileLinkMap).length > 0;
    const fixtures = (config?.fixtures || []).filter(Boolean);

    if (!hasLinkedProfiles || fixtures.length === 0) {
      sendUpdate(data, activeLayout?.id);
      return;
    }

    const fixtureById = fixtures.reduce((acc, fixture) => {
      acc[fixture.id] = fixture;
      return acc;
    }, {});

    const linkedTargetCache = {};
    const getLinkedTargets = (sourceFixtureId) => {
      if (Object.prototype.hasOwnProperty.call(linkedTargetCache, sourceFixtureId)) {
        return linkedTargetCache[sourceFixtureId];
      }

      const sourceFixture = fixtureById[sourceFixtureId];
      const profileId = sourceFixture?.profileId;
      if (!profileId || !profileLinkMap[profileId]) {
        linkedTargetCache[sourceFixtureId] = [];
        return [];
      }

      const targets = fixtures
        .filter(fixture => fixture?.id !== sourceFixtureId && fixture?.profileId === profileId)
        .map(fixture => fixture.id);

      linkedTargetCache[sourceFixtureId] = targets;
      return targets;
    };

    const payload = { ...data };
    const mirrorField = (fieldName) => {
      const sourceMap = data[fieldName];
      if (!sourceMap || typeof sourceMap !== 'object') return;

      const nextMap = { ...sourceMap };
      let hasChanges = false;

      Object.entries(sourceMap).forEach(([sourceFixtureId, sourceValue]) => {
        const targets = getLinkedTargets(sourceFixtureId);
        if (targets.length === 0) return;

        targets.forEach(targetId => {
          if (Object.prototype.hasOwnProperty.call(sourceMap, targetId)) return;
          nextMap[targetId] = cloneLinkPayloadValue(sourceValue);
          hasChanges = true;
        });
      });

      if (hasChanges) {
        payload[fieldName] = nextMap;
      }
    };

    mirrorField('fixtures');
    mirrorField('fixtureHsv');
    mirrorField('overriddenFixtures');

    sendUpdate(payload, activeLayout?.id);
  }, [sendUpdate, activeLayout?.id, profileLinkMap, config?.fixtures]);
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
  }, []);

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
        sendDashboardUpdate({ fixtures: fixturesToClear });
      }
    }
  }, [channelsToRelease, sendDashboardUpdate]);

  const fetchConfigData = useCallback(async () => {
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
  }, [urlSlug, navigate, getDashboardRole, role]);

  useEffect(() => {
    if (urlSlug) {
      fetchConfigData();
    }
  }, [urlSlug, fetchConfigData]);

  useEffect(() => {
    if (urlSlug) {
      fetchConfigData();
    }
  }, [configVersion, urlSlug, fetchConfigData]);

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
    sendDashboardUpdate({ blackout: !state.blackout });
  };

  const closeFixtureSectionEditor = useCallback(() => {
    if (fixtureEditorSaving) return;
    setShowFixtureEditor(false);
    setFixtureEditorSectionId(null);
    setFixtureEditorError('');
  }, [fixtureEditorSaving]);

  const openFixtureSectionEditor = useCallback((section) => {
    if (!section || !config || !canEditSectionLayout) return;

    const orderedFixtureItems = (section.items || [])
      .filter(item => item.type === 'fixture')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const draft = orderedFixtureItems
      .map(item => (config.fixtures || []).find(f => f && f.id === item.id))
      .filter(Boolean)
      .map(fixture => ({
        id: fixture.id,
        name: fixture.name || ''
      }));

    setFixtureEditorSectionId(section.id);
    setFixtureEditorSectionName(section.name || 'Fixtures');
    setFixtureEditorDraft(draft);
    setFixtureEditorError('');
    setShowFixtureEditor(true);
  }, [config, canEditSectionLayout]);

  const updateFixtureDraftName = useCallback((fixtureId, value) => {
    setFixtureEditorDraft(prev =>
      prev.map(item => (item.id === fixtureId ? { ...item, name: value } : item))
    );
  }, []);

  const moveFixtureDraftItem = useCallback((index, direction) => {
    setFixtureEditorDraft(prev => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }, []);

  const saveFixtureSectionEditor = useCallback(async () => {
    if (!config || !activeLayout || !fixtureEditorSectionId) return;

    setFixtureEditorSaving(true);
    setFixtureEditorError('');

    try {
      const nextConfig = JSON.parse(JSON.stringify(config));
      const layout = (nextConfig.showLayouts || []).find(l => l.id === activeLayout.id);
      if (!layout) {
        throw new Error('Could not find the active dashboard layout.');
      }

      const section = (layout.sections || []).find(s => s.id === fixtureEditorSectionId);
      if (!section) {
        throw new Error('Could not find the fixture section.');
      }

      const namesByFixtureId = new Map(
        fixtureEditorDraft.map(item => [item.id, (item.name || '').trim()])
      );

      (nextConfig.fixtures || []).forEach(fixture => {
        const nextName = namesByFixtureId.get(fixture.id);
        if (typeof nextName === 'string' && nextName.length > 0) {
          fixture.name = nextName;
        }
      });

      const orderByFixtureId = new Map(
        fixtureEditorDraft.map((item, index) => [item.id, index])
      );

      const reorderedItems = [...(section.items || [])].sort((a, b) => {
        const aOrder = (a.type === 'fixture' && orderByFixtureId.has(a.id))
          ? orderByFixtureId.get(a.id)
          : Number.MAX_SAFE_INTEGER + (a.order ?? 0);
        const bOrder = (b.type === 'fixture' && orderByFixtureId.has(b.id))
          ? orderByFixtureId.get(b.id)
          : Number.MAX_SAFE_INTEGER + (b.order ?? 0);
        return aOrder - bOrder;
      });

      reorderedItems.forEach((item, index) => {
        item.order = index;
      });
      section.items = reorderedItems;

      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig)
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to save fixture edits.');
      }

      const updatedConfig = result.config || nextConfig;
      setConfig(updatedConfig);
      const updatedLayout = updatedConfig.showLayouts?.find(l => l.id === activeLayout.id);
      if (updatedLayout) {
        setActiveLayout(updatedLayout);
      }

      setShowFixtureEditor(false);
      setFixtureEditorSectionId(null);
      setFixtureEditorError('');
    } catch (error) {
      console.error('Failed to save fixture section edits:', error);
      setFixtureEditorError(error.message || 'Failed to save fixture edits.');
    } finally {
      setFixtureEditorSaving(false);
    }
  }, [config, activeLayout, fixtureEditorSectionId, fixtureEditorDraft]);

  const closeLookSectionEditor = useCallback(() => {
    if (lookEditorSaving) return;
    setShowLookEditor(false);
    setLookEditorSectionId(null);
    setLookEditorError('');
  }, [lookEditorSaving]);

  const openLookSectionEditor = useCallback((section) => {
    if (!section || !config || !canEditSectionLayout) return;

    const orderedLookItems = (section.items || [])
      .filter(item => item.type === 'look')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const draft = orderedLookItems
      .map(item => (config.looks || []).find(l => l && l.id === item.id))
      .filter(Boolean)
      .map(look => ({
        id: look.id,
        name: look.name || ''
      }));

    setLookEditorSectionId(section.id);
    setLookEditorSectionName(section.name || 'Looks');
    setLookEditorDraft(draft);
    setLookEditorError('');
    setShowLookEditor(true);
  }, [config, canEditSectionLayout]);

  const updateLookDraftName = useCallback((lookId, value) => {
    setLookEditorDraft(prev =>
      prev.map(item => (item.id === lookId ? { ...item, name: value } : item))
    );
  }, []);

  const moveLookDraftItem = useCallback((index, direction) => {
    setLookEditorDraft(prev => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }, []);

  const saveLookSectionEditor = useCallback(async () => {
    if (!config || !activeLayout || !lookEditorSectionId) return;

    setLookEditorSaving(true);
    setLookEditorError('');

    try {
      const nextConfig = JSON.parse(JSON.stringify(config));
      const layout = (nextConfig.showLayouts || []).find(l => l.id === activeLayout.id);
      if (!layout) {
        throw new Error('Could not find the active dashboard layout.');
      }

      const section = (layout.sections || []).find(s => s.id === lookEditorSectionId);
      if (!section) {
        throw new Error('Could not find the looks section.');
      }

      const namesByLookId = new Map(
        lookEditorDraft.map(item => [item.id, (item.name || '').trim()])
      );

      (nextConfig.looks || []).forEach(look => {
        const nextName = namesByLookId.get(look.id);
        if (typeof nextName === 'string' && nextName.length > 0) {
          look.name = nextName;
        }
      });

      const orderByLookId = new Map(
        lookEditorDraft.map((item, index) => [item.id, index])
      );

      const reorderedItems = [...(section.items || [])].sort((a, b) => {
        const aOrder = (a.type === 'look' && orderByLookId.has(a.id))
          ? orderByLookId.get(a.id)
          : Number.MAX_SAFE_INTEGER + (a.order ?? 0);
        const bOrder = (b.type === 'look' && orderByLookId.has(b.id))
          ? orderByLookId.get(b.id)
          : Number.MAX_SAFE_INTEGER + (b.order ?? 0);
        return aOrder - bOrder;
      });

      reorderedItems.forEach((item, index) => {
        item.order = index;
      });
      section.items = reorderedItems;

      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig)
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to save look edits.');
      }

      const updatedConfig = result.config || nextConfig;
      setConfig(updatedConfig);
      const updatedLayout = updatedConfig.showLayouts?.find(l => l.id === activeLayout.id);
      if (updatedLayout) {
        setActiveLayout(updatedLayout);
      }

      setShowLookEditor(false);
      setLookEditorSectionId(null);
      setLookEditorError('');
    } catch (error) {
      console.error('Failed to save look section edits:', error);
      setLookEditorError(error.message || 'Failed to save look edits.');
    } finally {
      setLookEditorSaving(false);
    }
  }, [config, activeLayout, lookEditorSectionId, lookEditorDraft]);

  const handleLookChange = (lookId, value) => {
    sendDashboardUpdate({
      looks: {
        [lookId]: value / 100
      }
    });
  };

  const radioLookIds = useMemo(() => {
    if (!activeLayout?.sections) return [];
    const seen = new Set();
    const ids = [];
    (activeLayout.sections || []).forEach(section => {
      (section.items || []).forEach(item => {
        if (item?.type !== 'look') return;
        const mode = item.lookUiMode || 'slider';
        if (mode !== 'radio') return;
        if (seen.has(item.id)) return;
        seen.add(item.id);
        ids.push(item.id);
      });
    });
    return ids;
  }, [activeLayout]);

  const handleLookToggleButton = useCallback((lookId, currentLevel) => {
    sendDashboardUpdate({
      looks: {
        [lookId]: currentLevel > 0.001 ? 0 : 1
      }
    });
  }, [sendDashboardUpdate]);

  const handleLookRadioButton = useCallback((lookId, currentLevel) => {
    const updates = {};
    if (currentLevel > 0.001) {
      updates[lookId] = 0;
    } else {
      radioLookIds.forEach(id => {
        updates[id] = id === lookId ? 1 : 0;
      });
      if (!Object.prototype.hasOwnProperty.call(updates, lookId)) {
        updates[lookId] = 1;
      }
    }
    sendDashboardUpdate({ looks: updates });
  }, [radioLookIds, sendDashboardUpdate]);

  const handleFixtureChange = useCallback((fixtureId, property, value) => {
    sendDashboardUpdate({
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
  }, [sendDashboardUpdate]);

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
          sendDashboardUpdate({ overriddenFixtures: overridesToClear });
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

    sendDashboardUpdate({
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

  const getFixtureChannelNames = useCallback((profile) => {
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
  }, []);

  const getFixtureProfile = useCallback((fixtureId) => {
    const fixture = (config?.fixtures || []).find(f => f.id === fixtureId);
    if (!fixture) return null;
    return (config?.fixtureProfiles || []).find(p => p.id === fixture.profileId) || null;
  }, [config?.fixtures, config?.fixtureProfiles]);

  const clearTrackingForFixtures = useCallback((fixtureIds = []) => {
    if (!Array.isArray(fixtureIds) || fixtureIds.length === 0) return;

    const keysToClear = new Set();
    fixtureIds.forEach(fixtureId => {
      const profile = getFixtureProfile(fixtureId);
      if (!profile) return;
      getFixtureChannelNames(profile).forEach(channelName => {
        keysToClear.add(`${fixtureId}.${channelName}`);
      });
    });

    if (keysToClear.size === 0) return;

    const deleteKeys = (prev) => {
      const updated = { ...prev };
      keysToClear.forEach(key => delete updated[key]);
      return updated;
    };

    setChannelOverrides(deleteKeys);
    setManuallyAdjusted(deleteKeys);
    setFrozenChannels(deleteKeys);
  }, [getFixtureChannelNames, getFixtureProfile]);

  const buildOverrideFixtureSnapshot = useCallback((fixtureId, profile, channelUpdates = {}) => {
    const snapshot = {};
    const channelNames = getFixtureChannelNames(profile);
    channelNames.forEach(channelName => {
      const key = `${fixtureId}.${channelName}`;
      const metaValue = htpMetadataRef.current?.[key]?.displayValue;
      const directValue = state.fixtures?.[fixtureId]?.[channelName];
      snapshot[channelName] = metaValue ?? directValue ?? 0;
    });
    return { ...snapshot, ...channelUpdates };
  }, [getFixtureChannelNames, state.fixtures]);

  const getActiveLooksForFixture = useCallback((fixtureId) => {
    const profile = getFixtureProfile(fixtureId);
    if (!profile) return [];

    const activeById = {};
    const channelNames = getFixtureChannelNames(profile);

    channelNames.forEach(channelName => {
      const key = `${fixtureId}.${channelName}`;
      const contributors = htpMetadata?.[key]?.contributors || [];
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
  }, [getFixtureProfile, getFixtureChannelNames, htpMetadata, state.looks]);

  const hasActiveLookForFixture = useCallback((fixtureId) => {
    return getActiveLooksForFixture(fixtureId).length > 0;
  }, [getActiveLooksForFixture]);

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

  const handleClearAllFixtures = (fixtureIds = null) => {
    const clearedFixtures = {};
    const overridesToClear = {};
    const fixtureHsvUpdates = {};
    const fixturesToClear = (config.fixtures || [])
      .filter(f => f)
      .filter(fixture => !fixtureIds || fixtureIds.includes(fixture.id));

    fixturesToClear.forEach(fixture => {
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

        // Keep fixture color UI in sync with clear/default result
        if (profile.controls && Array.isArray(profile.controls)) {
          const rgbControl = profile.controls.find(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
          if (rgbControl?.components) {
            const redComp = rgbControl.components.find(c => c.type === 'red');
            const greenComp = rgbControl.components.find(c => c.type === 'green');
            const blueComp = rgbControl.components.find(c => c.type === 'blue');
            if (redComp && greenComp && blueComp) {
              const nextR = Number(clearedFixtures[fixture.id][redComp.name] ?? 0);
              const nextG = Number(clearedFixtures[fixture.id][greenComp.name] ?? 0);
              const nextB = Number(clearedFixtures[fixture.id][blueComp.name] ?? 0);
              const nextHsv = rgbToHsv(nextR, nextG, nextB);
              fixtureHsvUpdates[fixture.id] = nextHsv;
              setFixtureHsv(fixture.id, nextHsv);
              lastRgbByFixtureRef.current[fixture.id] = { r: nextR, g: nextG, b: nextB };
              lastHsvByFixtureRef.current[fixture.id] = nextHsv;
            }
          }
        }

        // Ensure we don't keep stale "pending clear" flags after explicit clear/home
        pendingClearRef.current.delete(fixture.id);
      }
    });
    if (Object.keys(clearedFixtures).length === 0) return;
    console.log('[Dashboard] Clear button clicked - applying defaults:', clearedFixtures);
    sendDashboardUpdate({
      fixtures: clearedFixtures,
      overriddenFixtures: overridesToClear,
      fixtureHsv: Object.keys(fixtureHsvUpdates).length > 0 ? fixtureHsvUpdates : undefined
    });
    clearTrackingForFixtures(fixturesToClear.map(f => f.id));
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ margin: 0 }}>{section.name}</h2>
                {canEditSectionLayout && isFixturesOnly && (
                  <button
                    className="fixture-card-action btn btn-small"
                    onClick={() => openFixtureSectionEditor(section)}
                    style={{
                      padding: '5px 8px',
                      fontSize: '12px',
                      background: '#2d2d2d',
                      border: '1px solid #555',
                      color: '#ddd',
                      lineHeight: 1,
                      cursor: 'pointer'
                    }}
                    title="Edit fixture names and order"
                    aria-label="Edit fixture names and order"
                  >
                    ✎
                  </button>
                )}
                {canEditSectionLayout && isLooksOnly && (
                  <button
                    className="fixture-card-action btn btn-small"
                    onClick={() => openLookSectionEditor(section)}
                    style={{
                      padding: '5px 8px',
                      fontSize: '12px',
                      background: '#2d2d2d',
                      border: '1px solid #555',
                      color: '#ddd',
                      lineHeight: 1,
                      cursor: 'pointer'
                    }}
                    title="Edit look names and order"
                    aria-label="Edit look names and order"
                  >
                    ✎
                  </button>
                )}
              </div>
              {section.showClearButton && (() => {
                const fixtureItems = visibleItems.filter(item => item.type === 'fixture');

                return (
                  <button
                    className="btn btn-small"
                    onClick={() => {
                      if (isLooksOnly) {
                        handleClearAllLooks();
                      } else if (isFixturesOnly) {
                        handleClearAllFixtures(fixtureItems.map(item => item.id));
                      }
                    }}
                    style={{ padding: '6px 12px', fontSize: '12px', background: '#555', border: '1px solid #666' }}
                  >
                    {isFixturesOnly ? 'Clear All' : 'Clear'}
                  </button>
                );
              })()}
            </div>

            {visibleItems.map(item => {
              if (item.type === 'look') {
                const look = (config.looks || []).find(l => l && l.id === item.id);
                if (!look) return null;
                const lookLevel = state.looks[look.id] || 0;
                const lookPercent = Math.round(lookLevel * 100);
                const lookUiMode = item.lookUiMode || 'slider';
                const lookIsActive = lookLevel > 0.001;
                const lookAccent = LOOK_COLOR_MAP[look.color] || '#4a90e2';
                const isViewer = dashboardRole === 'viewer';

                return (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      {lookUiMode === 'slider' ? (
                        <Slider
                          label={look.name}
                          value={lookLevel * 100}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(value) => handleLookChange(look.id, value)}
                          unit="%"
                          color={look.color || 'blue'}
                          disabled={isViewer}
                        />
                      ) : (
                        <button
                          className="btn"
                          onClick={() => {
                            if (lookUiMode === 'radio') {
                              handleLookRadioButton(look.id, lookLevel);
                            } else {
                              handleLookToggleButton(look.id, lookLevel);
                            }
                          }}
                          disabled={isViewer}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '10px',
                            padding: '12px 14px',
                            borderRadius: '10px',
                            border: `2px solid ${lookIsActive ? lookAccent : '#555'}`,
                            background: lookIsActive ? `${lookAccent}22` : '#2b2b2b',
                            color: '#f0f0f0',
                            cursor: isViewer ? 'not-allowed' : 'pointer',
                            opacity: isViewer ? 0.5 : 1
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600 }}>
                            {lookUiMode === 'radio' && (
                              <span
                                style={{
                                  width: '11px',
                                  height: '11px',
                                  borderRadius: '50%',
                                  background: lookIsActive ? lookAccent : 'transparent',
                                  border: `2px solid ${lookAccent}`,
                                  flexShrink: 0
                                }}
                              />
                            )}
                            {look.name}
                          </span>
                          <span style={{ fontSize: '13px', color: '#ddd', whiteSpace: 'nowrap' }}>
                            {lookUiMode === 'radio'
                              ? (lookIsActive ? 'Selected' : 'Off')
                              : (lookIsActive ? 'On' : 'Off')} {lookPercent > 0 ? `(${lookPercent}%)` : ''}
                          </span>
                        </button>
                      )}
                    </div>
                    {lookUiMode === 'slider' && (
                      <button
                        className="btn btn-small"
                        onClick={() => handleLookToggleButton(look.id, lookLevel)}
                        disabled={isViewer}
                        style={{
                          padding: '6px 10px',
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                          minWidth: '56px',
                          background: lookIsActive ? `${lookAccent}33` : '#3a3a3a',
                          border: `1px solid ${lookIsActive ? lookAccent : '#666'}`,
                          color: '#f0f0f0',
                          opacity: isViewer ? 0.5 : 1,
                          cursor: isViewer ? 'not-allowed' : 'pointer'
                        }}
                        title={lookIsActive ? 'Turn look off' : 'Turn look on to 100%'}
                      >
                        {lookIsActive ? 'On' : 'Off'}
                      </button>
                    )}
                    {look.showRecordButton && (
                      <button
                        className={`btn btn-small record-btn ${recordingLook === look.id ? 'recording' : ''}`}
                        onClick={() => handleRecordLook(look.id)}
                        disabled={isViewer}
                        style={{
                          padding: '6px 10px',
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                          background: '#444',
                          border: '1px solid #666',
                          opacity: isViewer ? 0.5 : 1,
                          cursor: isViewer ? 'not-allowed' : 'pointer'
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
                      // Avoid render-loop writes: only seed cache when missing.
                      // When looks are active we still use live HTP HSV (rgbHsv) for display/override behavior.
                      if (!cachedHsv) {
                        setFixtureHsv(fixture.id, { ...displayHsv, v: brightnessValue });
                      }
                    }
                  }
                }

                if (brightnessValue > 0.01) {
                  lastToggleOnBrightnessRef.current[fixture.id] = brightnessValue;
                }

                // Toggle handler
                const handleToggle = (e) => {
                  e.stopPropagation(); // Prevent navigation to detail page
                  if (toggleComponents.length === 0 || dashboardRole === 'viewer') return;

                  const activeLooksForFixture = getActiveLooksForFixture(fixture.id);
                  const hasActiveLooks = activeLooksForFixture.length > 0;
                  const isFixtureAlreadyOverridden = Boolean(state.overriddenFixtures?.[fixture.id]?.active);
                  const turningOff = brightnessValue > 0;

                  // If looks are active, toggle-on should return this fixture to look control
                  // (instead of restoring stale manual override color/state).
                  if (!turningOff && hasActiveLooks) {
                    const releaseValues = {};
                    const fixtureChannelKeys = [];
                    getFixtureChannelNames(profile).forEach(channelName => {
                      releaseValues[channelName] = 0;
                      fixtureChannelKeys.push(`${fixture.id}.${channelName}`);
                    });

                    setChannelOverrides(prev => {
                      const updated = { ...prev };
                      fixtureChannelKeys.forEach(key => delete updated[key]);
                      return updated;
                    });
                    setFrozenChannels(prev => {
                      const updated = { ...prev };
                      fixtureChannelKeys.forEach(key => delete updated[key]);
                      return updated;
                    });

                    sendDashboardUpdate({
                      fixtures: {
                        [fixture.id]: releaseValues
                      },
                      overriddenFixtures: {
                        [fixture.id]: null
                      }
                    });
                    return;
                  }

                  if (turningOff && brightnessValue > 0.01) {
                    lastToggleOnBrightnessRef.current[fixture.id] = brightnessValue;
                  }
                  const restoreBrightness = Math.max(
                    1,
                    Math.min(100, Number(lastToggleOnBrightnessRef.current[fixture.id]) || 100)
                  );
                  const updates = {};
                  let fixtureHsvPayload;

                  if (intensityChannelName) {
                    const newValue = turningOff ? 0 : restoreBrightness;
                    toggleComponents.forEach(comp => {
                      updates[comp.name] = newValue;
                    });

                    // Strict Dimmer+RGB: turning on with no active looks should seed RGB defaults
                    const rgbControlCount = (profile.controls || []).filter(c => c.controlType === 'RGB' || c.controlType === 'RGBW').length;
                    const intensityControlCount = (profile.controls || []).filter(c => c.controlType === 'Intensity').length;
                    const isLegacyDimmerRgbProfile = intensityControlCount === 1 && rgbControlCount === 1 && (profile.controls || []).length === 2;
                    const isStrictDimmerColor = Boolean(rgbControl?.brightnessDrivenByIntensity) || isLegacyDimmerRgbProfile;
                    if (!turningOff && !hasActiveLooks && isStrictDimmerColor && redComp && greenComp && blueComp) {
                      const fixtureState = state.fixtures?.[fixture.id] || {};
                      const currentRed = fixtureState[redComp.name] ?? 0;
                      const currentGreen = fixtureState[greenComp.name] ?? 0;
                      const currentBlue = fixtureState[blueComp.name] ?? 0;
                      const displayedRed = htpMetadata[`${fixture.id}.${redComp.name}`]?.displayValue ?? 0;
                      const displayedGreen = htpMetadata[`${fixture.id}.${greenComp.name}`]?.displayValue ?? 0;
                      const displayedBlue = htpMetadata[`${fixture.id}.${blueComp.name}`]?.displayValue ?? 0;
                      const isCurrentlyBlack =
                        Math.max(currentRed, currentGreen, currentBlue, displayedRed, displayedGreen, displayedBlue) <= 0.01;
                      if (isCurrentlyBlack) {
                        const dv = rgbControl?.defaultValue;
                        const hasRgbDefault = dv?.type === 'rgb' || dv?.type === 'rgbw';
                        const isRgbDefaultBlack = hasRgbDefault && Number(dv.r ?? 0) === 0 && Number(dv.g ?? 0) === 0 && Number(dv.b ?? 0) === 0;
                        const defaultRgb = (hasRgbDefault && !isRgbDefaultBlack)
                          ? {
                              r: (dv.r ?? 1) * 100,
                              g: (dv.g ?? 1) * 100,
                              b: (dv.b ?? 1) * 100
                            }
                          : { r: 100, g: 100, b: 100 };
                        updates[redComp.name] = defaultRgb.r;
                        updates[greenComp.name] = defaultRgb.g;
                        updates[blueComp.name] = defaultRgb.b;
                      }
                    }
                  } else if (rgbControl && redComp && greenComp && blueComp) {
                    if (turningOff) {
                      toggleComponents.forEach(comp => {
                        updates[comp.name] = 0;
                      });
                    } else {
                      const cached = hsvCache?.[fixture.id] || rgbHsv || lastHsvByFixtureRef.current[fixture.id];
                      const hsv = cached || { h: 0, s: 0, v: 100 };
                      const restoredV = hsv.v > 0 ? hsv.v : restoreBrightness;
                      const rgb = hsvToRgb(hsv.h, hsv.s, restoredV);
                      updates[redComp.name] = rgb.r || 0;
                      updates[greenComp.name] = rgb.g || 0;
                      updates[blueComp.name] = rgb.b || 0;
                      toggleComponents.forEach(comp => {
                        if (comp.type === 'white') {
                          updates[comp.name] = 0;
                        }
                      });
                      setFixtureHsv(fixture.id, { h: hsv.h, s: hsv.s, v: restoredV });
                      fixtureHsvPayload = { [fixture.id]: { h: hsv.h, s: hsv.s, v: restoredV } };
                    }
                  }

                  const fixtureValues = (hasActiveLooks && !isFixtureAlreadyOverridden)
                    ? buildOverrideFixtureSnapshot(fixture.id, profile, updates)
                    : updates;

                  sendDashboardUpdate({
                    fixtures: {
                      [fixture.id]: fixtureValues
                    },
                    fixtureHsv: fixtureHsvPayload,
                    overriddenFixtures: hasActiveLooks ? {
                      [fixture.id]: {
                        active: true,
                        looks: activeLooksForFixture.map(look => ({ id: look.id, color: look.color }))
                      }
                    } : undefined
                  });
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

                const sliderAvailable = Boolean(intensityChannelName) || Boolean(rgbControl);
                const showToggle = toggleComponents.length > 0;
                const isProfileLinked = Boolean(profile?.id && profileLinkMap[profile.id]);

                const handleFixtureCardClick = (e) => {
                  const target = e.target;
                  if (target && target.closest) {
                    if (target.closest('input[type="range"]')) return;
                    if (target.closest('.fixture-card-action')) return;
                  }
                  navigate(`/fixture/${fixture.id}`, { state: { dashboardId: activeLayout?.id } });
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
                                  background: isFixtureOverridden ? '#666' : (LOOK_COLOR_MAP[contributor.color] || '#4a90e2'),
                                  opacity: isFixtureOverridden ? 0.7 : (0.5 + ((contributor.value || 0) / 100) * 0.5),
                                  flexShrink: 0
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (dashboardRole === 'viewer') return;
                            toggleFixtureProfileLink(profile?.id);
                          }}
                          disabled={dashboardRole === 'viewer' || !profile?.id}
                          className="fixture-card-action btn btn-small"
                          style={{
                            width: '36px',
                            height: '32px',
                            padding: 0,
                            fontSize: '18px',
                            lineHeight: 1,
                            background: isProfileLinked ? '#2f6a45' : '#555',
                            color: isProfileLinked ? '#c9ffd9' : '#ddd',
                            border: `1px solid ${isProfileLinked ? '#4ec178' : '#666'}`,
                            opacity: (dashboardRole === 'viewer' || !profile?.id) ? 0.5 : 1,
                            cursor: (dashboardRole === 'viewer' || !profile?.id) ? 'not-allowed' : 'pointer',
                            flexShrink: 0
                          }}
                          title={isProfileLinked
                            ? '↯ Linked to fixtures with this profile'
                            : '↯ Link fixtures with this profile'}
                        >
                          ↯
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (dashboardRole === 'viewer') return;
                            handleClearAllFixtures([fixture.id]);
                          }}
                          disabled={dashboardRole === 'viewer'}
                          className="fixture-card-action btn btn-small"
                          style={{
                            padding: '5px 10px',
                            fontSize: '11px',
                            background: '#555',
                            border: '1px solid #666',
                            opacity: dashboardRole === 'viewer' ? 0.5 : 1,
                            cursor: dashboardRole === 'viewer' ? 'not-allowed' : 'pointer',
                            flexShrink: 0
                          }}
                          title="Clear this fixture"
                        >
                          Clear
                        </button>

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
                              const isFixtureAlreadyOverridden = Boolean(state.overriddenFixtures?.[fixture.id]?.active);

                              if (pendingClearRef.current.has(fixture.id)) {
                                pendingClearRef.current.delete(fixture.id);
                              }
                              if (value > 0.01) {
                                lastToggleOnBrightnessRef.current[fixture.id] = value;
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

                              const rgbControlCount = (profile.controls || []).filter(c => c.controlType === 'RGB' || c.controlType === 'RGBW').length;
                              const intensityControlCount = (profile.controls || []).filter(c => c.controlType === 'Intensity').length;
                              const isLegacyDimmerRgbProfile = intensityControlCount === 1 && rgbControlCount === 1 && (profile.controls || []).length === 2;
                              const isStrictDimmerColor = Boolean(rgbControl?.brightnessDrivenByIntensity) || isLegacyDimmerRgbProfile;
                              const seededRgbChannels = {};
                              if (!hasActiveLooks && isStrictDimmerColor && value > 0 && redComp && greenComp && blueComp) {
                                const fixtureState = state.fixtures?.[fixture.id] || {};
                                const currentRed = fixtureState[redComp.name] ?? 0;
                                const currentGreen = fixtureState[greenComp.name] ?? 0;
                                const currentBlue = fixtureState[blueComp.name] ?? 0;
                                const displayedRed = htpMetadata[`${fixture.id}.${redComp.name}`]?.displayValue ?? 0;
                                const displayedGreen = htpMetadata[`${fixture.id}.${greenComp.name}`]?.displayValue ?? 0;
                                const displayedBlue = htpMetadata[`${fixture.id}.${blueComp.name}`]?.displayValue ?? 0;
                                const isCurrentlyBlack =
                                  Math.max(currentRed, currentGreen, currentBlue, displayedRed, displayedGreen, displayedBlue) <= 0.01;
                                if (isCurrentlyBlack) {
                                  const dv = rgbControl?.defaultValue;
                                  const hasRgbDefault = dv?.type === 'rgb' || dv?.type === 'rgbw';
                                  const isRgbDefaultBlack = hasRgbDefault && Number(dv.r ?? 0) === 0 && Number(dv.g ?? 0) === 0 && Number(dv.b ?? 0) === 0;
                                  const defaultRgb = (hasRgbDefault && !isRgbDefaultBlack)
                                    ? {
                                        r: (dv.r ?? 1) * 100,
                                        g: (dv.g ?? 1) * 100,
                                        b: (dv.b ?? 1) * 100
                                      }
                                    : { r: 100, g: 100, b: 100 };
                                  seededRgbChannels[redComp.name] = defaultRgb.r;
                                  seededRgbChannels[greenComp.name] = defaultRgb.g;
                                  seededRgbChannels[blueComp.name] = defaultRgb.b;
                                }
                              }

                              const fixtureValues = (hasActiveLooks && !isFixtureAlreadyOverridden)
                                ? buildOverrideFixtureSnapshot(fixture.id, profile, { [intensityChannelName]: value, ...seededRgbChannels })
                                : { [intensityChannelName]: value, ...seededRgbChannels };

                              sendDashboardUpdate({
                                fixtures: {
                                  [fixture.id]: fixtureValues
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
                              const activeLooksForFixture = getActiveLooksForFixture(fixture.id);
                              const hasActiveLooks = activeLooksForFixture.length > 0;
                              const isFixtureAlreadyOverridden = Boolean(state.overriddenFixtures?.[fixture.id]?.active);

                              // Always preserve hue/saturation from the live displayed color on the card.
                              // Dashboard brightness override should only change V.
                              const hsvSource = rgbHsv || hsvCache?.[fixture.id];
                              const nextH = hsvSource?.h ?? h;
                              const nextS = hsvSource?.s ?? s;
                              setFixtureHsv(fixture.id, { h: nextH, s: nextS, v });
                              if (v > 0.01) {
                                lastToggleOnBrightnessRef.current[fixture.id] = v;
                              }
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

                              if (hasActiveLooks) {
                                setChannelOverrides(prev => ({
                                  ...prev,
                                  [redComp.name]: true,
                                  [greenComp.name]: true,
                                  [blueComp.name]: true
                                }));
                              }

                              const rgbChannelUpdates = {
                                [redComp.name]: nextRgb.r || 0,
                                [greenComp.name]: nextRgb.g || 0,
                                [blueComp.name]: nextRgb.b || 0
                              };
                              const fixtureValues = (hasActiveLooks && !isFixtureAlreadyOverridden)
                                ? buildOverrideFixtureSnapshot(fixture.id, profile, rgbChannelUpdates)
                                : rgbChannelUpdates;

                              sendDashboardUpdate({
                                fixtures: {
                                  [fixture.id]: fixtureValues
                                },
                                fixtureHsv: {
                                  [fixture.id]: { h: nextH, s: nextS, v }
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

      {showFixtureEditor && (
        <div
          onClick={closeFixtureSectionEditor}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2200,
            padding: '20px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '680px',
              maxHeight: '85vh',
              overflowY: 'auto',
              background: '#222',
              border: '1px solid #444',
              borderRadius: '12px',
              padding: '18px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0 }}>Edit {fixtureEditorSectionName}</h3>
              <button
                className="btn btn-small"
                onClick={closeFixtureSectionEditor}
                disabled={fixtureEditorSaving}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  background: '#444',
                  border: '1px solid #666',
                  cursor: fixtureEditorSaving ? 'not-allowed' : 'pointer',
                  opacity: fixtureEditorSaving ? 0.5 : 1
                }}
              >
                Close
              </button>
            </div>

            <p style={{ margin: '0 0 14px 0', color: '#aaa', fontSize: '13px' }}>
              Rename fixture cards and change their order for this dashboard section.
            </p>

            {fixtureEditorError && (
              <div
                style={{
                  marginBottom: '12px',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #a33',
                  background: '#3a1f1f',
                  color: '#ffb3b3',
                  fontSize: '13px'
                }}
              >
                {fixtureEditorError}
              </div>
            )}

            {fixtureEditorDraft.length === 0 ? (
              <div style={{ padding: '10px', border: '1px solid #444', borderRadius: '6px', color: '#aaa', fontSize: '13px' }}>
                No fixtures found in this section.
              </div>
            ) : (
              fixtureEditorDraft.map((fixtureItem, index) => (
                <div
                  key={fixtureItem.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '36px 1fr 84px',
                    gap: '8px',
                    alignItems: 'center',
                    padding: '8px',
                    border: '1px solid #3d3d3d',
                    borderRadius: '6px',
                    marginBottom: '8px',
                    background: '#1e1e1e'
                  }}
                >
                  <div style={{ textAlign: 'center', color: '#888', fontSize: '12px' }}>
                    {index + 1}
                  </div>
                  <input
                    type="text"
                    value={fixtureItem.name}
                    onChange={(e) => updateFixtureDraftName(fixtureItem.id, e.target.value)}
                    disabled={fixtureEditorSaving}
                    style={{
                      width: '100%',
                      background: '#111b35',
                      border: '1px solid #3a4d76',
                      borderRadius: '4px',
                      color: '#f0f0f0',
                      padding: '8px 10px',
                      fontSize: '14px'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-small"
                      onClick={() => moveFixtureDraftItem(index, -1)}
                      disabled={fixtureEditorSaving || index === 0}
                      style={{
                        width: '36px',
                        padding: '4px 0',
                        fontSize: '12px',
                        background: '#2f2f2f',
                        border: '1px solid #555',
                        opacity: (fixtureEditorSaving || index === 0) ? 0.4 : 1,
                        cursor: (fixtureEditorSaving || index === 0) ? 'not-allowed' : 'pointer'
                      }}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => moveFixtureDraftItem(index, 1)}
                      disabled={fixtureEditorSaving || index === fixtureEditorDraft.length - 1}
                      style={{
                        width: '36px',
                        padding: '4px 0',
                        fontSize: '12px',
                        background: '#2f2f2f',
                        border: '1px solid #555',
                        opacity: (fixtureEditorSaving || index === fixtureEditorDraft.length - 1) ? 0.4 : 1,
                        cursor: (fixtureEditorSaving || index === fixtureEditorDraft.length - 1) ? 'not-allowed' : 'pointer'
                      }}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <button
                className="btn btn-small"
                onClick={closeFixtureSectionEditor}
                disabled={fixtureEditorSaving}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  background: '#444',
                  border: '1px solid #666',
                  opacity: fixtureEditorSaving ? 0.5 : 1,
                  cursor: fixtureEditorSaving ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-small btn-primary"
                onClick={saveFixtureSectionEditor}
                disabled={fixtureEditorSaving}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  opacity: fixtureEditorSaving ? 0.5 : 1,
                  cursor: fixtureEditorSaving ? 'not-allowed' : 'pointer'
                }}
              >
                {fixtureEditorSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLookEditor && (
        <div
          onClick={closeLookSectionEditor}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2200,
            padding: '20px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '680px',
              maxHeight: '85vh',
              overflowY: 'auto',
              background: '#222',
              border: '1px solid #444',
              borderRadius: '12px',
              padding: '18px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0 }}>Edit {lookEditorSectionName}</h3>
              <button
                className="btn btn-small"
                onClick={closeLookSectionEditor}
                disabled={lookEditorSaving}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  background: '#444',
                  border: '1px solid #666',
                  cursor: lookEditorSaving ? 'not-allowed' : 'pointer',
                  opacity: lookEditorSaving ? 0.5 : 1
                }}
              >
                Close
              </button>
            </div>

            <p style={{ margin: '0 0 14px 0', color: '#aaa', fontSize: '13px' }}>
              Rename looks and change their order for this dashboard section.
            </p>

            {lookEditorError && (
              <div
                style={{
                  marginBottom: '12px',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #a33',
                  background: '#3a1f1f',
                  color: '#ffb3b3',
                  fontSize: '13px'
                }}
              >
                {lookEditorError}
              </div>
            )}

            {lookEditorDraft.length === 0 ? (
              <div style={{ padding: '10px', border: '1px solid #444', borderRadius: '6px', color: '#aaa', fontSize: '13px' }}>
                No looks found in this section.
              </div>
            ) : (
              lookEditorDraft.map((lookItem, index) => (
                <div
                  key={lookItem.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '36px 1fr 84px',
                    gap: '8px',
                    alignItems: 'center',
                    padding: '8px',
                    border: '1px solid #3d3d3d',
                    borderRadius: '6px',
                    marginBottom: '8px',
                    background: '#1e1e1e'
                  }}
                >
                  <div style={{ textAlign: 'center', color: '#888', fontSize: '12px' }}>
                    {index + 1}
                  </div>
                  <input
                    type="text"
                    value={lookItem.name}
                    onChange={(e) => updateLookDraftName(lookItem.id, e.target.value)}
                    disabled={lookEditorSaving}
                    style={{
                      width: '100%',
                      background: '#111b35',
                      border: '1px solid #3a4d76',
                      borderRadius: '4px',
                      color: '#f0f0f0',
                      padding: '8px 10px',
                      fontSize: '14px'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-small"
                      onClick={() => moveLookDraftItem(index, -1)}
                      disabled={lookEditorSaving || index === 0}
                      style={{
                        width: '36px',
                        padding: '4px 0',
                        fontSize: '12px',
                        background: '#2f2f2f',
                        border: '1px solid #555',
                        opacity: (lookEditorSaving || index === 0) ? 0.4 : 1,
                        cursor: (lookEditorSaving || index === 0) ? 'not-allowed' : 'pointer'
                      }}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => moveLookDraftItem(index, 1)}
                      disabled={lookEditorSaving || index === lookEditorDraft.length - 1}
                      style={{
                        width: '36px',
                        padding: '4px 0',
                        fontSize: '12px',
                        background: '#2f2f2f',
                        border: '1px solid #555',
                        opacity: (lookEditorSaving || index === lookEditorDraft.length - 1) ? 0.4 : 1,
                        cursor: (lookEditorSaving || index === lookEditorDraft.length - 1) ? 'not-allowed' : 'pointer'
                      }}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
              <button
                className="btn btn-small"
                onClick={closeLookSectionEditor}
                disabled={lookEditorSaving}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  background: '#444',
                  border: '1px solid #666',
                  opacity: lookEditorSaving ? 0.5 : 1,
                  cursor: lookEditorSaving ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-small btn-primary"
                onClick={saveLookSectionEditor}
                disabled={lookEditorSaving}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  opacity: lookEditorSaving ? 0.5 : 1,
                  cursor: lookEditorSaving ? 'not-allowed' : 'pointer'
                }}
              >
                {lookEditorSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      <ConnectedUsers
        activeClients={activeClients}
        show={activeLayout?.showConnectedUsers !== false}
        dashboardId={activeLayout?.id}
        defaultRole={activeLayout?.accessControl?.defaultRole}
      />
    </div>
  );
};

export default Dashboard;
