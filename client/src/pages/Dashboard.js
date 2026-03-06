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
const LOOK_COLORS = [
  { id: 'blue', name: 'Blue', hex: '#4a90e2' },
  { id: 'red', name: 'Red', hex: '#e24a4a' },
  { id: 'green', name: 'Green', hex: '#4ae24a' },
  { id: 'yellow', name: 'Yellow', hex: '#e2e24a' },
  { id: 'purple', name: 'Purple', hex: '#9b4ae2' },
  { id: 'orange', name: 'Orange', hex: '#e2904a' },
  { id: 'cyan', name: 'Cyan', hex: '#4ae2e2' },
  { id: 'pink', name: 'Pink', hex: '#e24a90' }
];
const PROFILE_LINK_STORAGE_KEY = 'fixture-profile-link-map:v1';
const CUE_ACCENT_COLOR = '#7bb7ff';

const parseCueNumberForSort = (rawValue) => {
  const value = String(rawValue ?? '').trim();
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return parsed;
};

const compareCueByNumber = (a, b) => {
  const aNum = parseCueNumberForSort(a?.number);
  const bNum = parseCueNumberForSort(b?.number);
  if (aNum !== bNum) return aNum - bNum;
  const aName = String(a?.name || '');
  const bName = String(b?.name || '');
  return aName.localeCompare(bName);
};

const formatCueNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  const rounded = Math.round(numeric * 1000) / 1000;
  return String(rounded)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
};

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

    const activeCueSnapshots = [];
    const nowMs = Date.now();
    const cuePlaybackByDashboard = state?.cuePlayback || {};
    const cueLists = config?.cueLists || [];
    const layoutsById = new Map((config?.showLayouts || []).map(layout => [layout.id, layout]));

    const toPercent = (value) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return null;
      return Math.max(0, Math.min(100, numericValue));
    };

    Object.entries(cuePlaybackByDashboard).forEach(([dashboardId, playback]) => {
      if (!playback) return;
      if (playback.status === 'stopped') return;
      const layout = layoutsById.get(dashboardId);
      const cueListId = playback.cueListId || layout?.cueListId;
      if (!cueListId) return;
      const cueList = cueLists.find(list => list.id === cueListId);
      if (!cueList || !Array.isArray(cueList.cues) || cueList.cues.length === 0) return;

      let cue = null;
      if (playback.cueId) {
        cue = cueList.cues.find(item => item.id === playback.cueId) || null;
      }
      if (!cue && Number.isInteger(playback.cueIndex) && playback.cueIndex >= 0 && playback.cueIndex < cueList.cues.length) {
        cue = cueList.cues[playback.cueIndex];
      }
      if (!cue) return;

      let transition = null;
      if (playback.transition && typeof playback.transition === 'object') {
        const durationMs = Number(playback.transition.durationMs);
        if (Number.isFinite(durationMs) && durationMs > 0) {
          const startedAtMs = Number.isFinite(Number(playback.transition.startedAtMs))
            ? Number(playback.transition.startedAtMs)
            : nowMs;
          let progress = 0;
          if (playback.status === 'paused') {
            if (Number.isFinite(Number(playback.transition.pausedProgress))) {
              progress = Number(playback.transition.pausedProgress);
            } else {
              const pausedAtMs = Number.isFinite(Number(playback.transition.pausedAtMs))
                ? Number(playback.transition.pausedAtMs)
                : nowMs;
              progress = (pausedAtMs - startedAtMs) / durationMs;
            }
          } else {
            progress = (nowMs - startedAtMs) / durationMs;
          }

          transition = {
            fromTargets: playback.transition.fromTargets || {},
            toTargets: playback.transition.toTargets || cue.targets || {},
            progress: Math.max(0, Math.min(1, progress))
          };
        }
      }

      activeCueSnapshots.push({
        dashboardId,
        cueListId,
        cueId: cue.id,
        targets: cue.targets || {},
        transition
      });
    });

    const getCueChannelValue = (snapshot, fixtureId, channelName) => {
      if (!snapshot) return null;

      if (snapshot.transition) {
        const fromFixtureTargets = snapshot.transition.fromTargets?.[fixtureId];
        const toFixtureTargets = snapshot.transition.toTargets?.[fixtureId]
          || snapshot.targets?.[fixtureId];
        const fromValue = toPercent(fromFixtureTargets?.[channelName]);
        const toValue = toPercent(toFixtureTargets?.[channelName]);
        if (fromValue === null && toValue === null) return null;
        const startValue = fromValue !== null ? fromValue : (toValue ?? 0);
        const endValue = toValue !== null ? toValue : startValue;
        return startValue + (endValue - startValue) * snapshot.transition.progress;
      }

      const cueFixtureTargets = snapshot.targets?.[fixtureId];
      if (!cueFixtureTargets) return null;
      return toPercent(cueFixtureTargets[channelName]);
    };

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
        const hasPanFine = control.components?.some(comp => comp.type === 'panFine');
        const hasTiltFine = control.components?.some(comp => comp.type === 'tiltFine');
        const panNormalized = defaultVal.x || 0.5;
        const tiltNormalized = defaultVal.y || 0.5;

        if (component.type === 'pan') {
          if (hasPanFine) {
            const raw = Math.round(Math.max(0, Math.min(1, panNormalized)) * 65535);
            return ((raw >> 8) / 255) * 100;
          }
          return panNormalized * 100;
        }
        if (component.type === 'panFine') {
          const raw = Math.round(Math.max(0, Math.min(1, panNormalized)) * 65535);
          return ((raw & 0xff) / 255) * 100;
        }
        if (component.type === 'tilt') {
          if (hasTiltFine) {
            const raw = Math.round(Math.max(0, Math.min(1, tiltNormalized)) * 65535);
            return ((raw >> 8) / 255) * 100;
          }
          return tiltNormalized * 100;
        }
        if (component.type === 'tiltFine') {
          const raw = Math.round(Math.max(0, Math.min(1, tiltNormalized)) * 65535);
          return ((raw & 0xff) / 255) * 100;
        }
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

        // Check for server-side look/cue overrides (persist across navigation)
        const serverOverride = state.overriddenFixtures?.[fixtureId];
        const cueOverride = state.cueOverrides?.[fixtureId];

        // Skip if channel is overridden (local, look override, or cue override)
        if (channelOverrides[key] || serverOverride?.active || cueOverride?.active) {
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

        // Source N+: Active cues
        activeCueSnapshots.forEach(snapshot => {
          const cueValue = getCueChannelValue(snapshot, fixtureId, channelName);
          if (cueValue === null) return;
          sources.push({
            type: 'cue',
            value: cueValue,
            cueId: snapshot.cueId,
            color: 'cue'
          });
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
  const [recordingCueId, setRecordingCueId] = useState(null);
  const [selectedCueId, setSelectedCueId] = useState(null);
  const [cueNumberDrafts, setCueNumberDrafts] = useState({});
  const [cueNameDrafts, setCueNameDrafts] = useState({});
  const [cueFadeDrafts, setCueFadeDrafts] = useState({});
  const [goToCueInput, setGoToCueInput] = useState('');
  const [addCueNumberInput, setAddCueNumberInput] = useState('');
  const [addCueNameInput, setAddCueNameInput] = useState('');
  const [showGoToCueModal, setShowGoToCueModal] = useState(false);
  const [showAddCueModal, setShowAddCueModal] = useState(false);
  const [editingCueId, setEditingCueId] = useState(null);
  const [cueUiError, setCueUiError] = useState('');
  const [cueTransitioning, setCueTransitioning] = useState(false);
  const [cueTransitionProgress, setCueTransitionProgress] = useState(0);
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
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth : 1280
  ));
  const [profileLinkMap, setProfileLinkMap] = useState({});
  const lastLookToggleOnLevelRef = useRef({});
  const lastRgbByFixtureRef = useRef({});
  const lastHsvByFixtureRef = useRef({});
  const lastToggleOnBrightnessRef = useRef({});
  const pendingClearRef = useRef(new Set());
  const cueTransitionTimerRef = useRef(null);
  const cueProgressFrameRef = useRef(null);
  const cueTransitionStartRef = useRef(0);
  const cueTransitionDurationRef = useRef(0);
  const cueListScrollContainerRef = useRef(null);
  const cueRowRefsRef = useRef(new Map());
  const cueListScrollFrameRef = useRef(null);
  const cueListScrollRetryRef = useRef([]);
  const lockEditsEnabled = activeLayout?.lockEdits === true;
  const editLockedForRole = lockEditsEnabled && (dashboardRole === 'controller' || dashboardRole === 'viewer');
  const canEditSectionLayout = !editLockedForRole && (dashboardRole === 'editor' || role === 'editor' || isEditorAnywhere);
  const canRecordLooks = dashboardRole !== 'viewer' && !editLockedForRole;
  const canControlCues = dashboardRole !== 'viewer';
  const canRecordCues = dashboardRole !== 'viewer' && !editLockedForRole;
  const isCompactCueLayout = viewportWidth <= 1100;
  const isMobileCueLayout = viewportWidth <= 700;

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeCueList = useMemo(() => {
    if (!config || !activeLayout) return null;
    const cueLists = config.cueLists || [];
    if (cueLists.length === 0) return null;
    const sourceCueList = cueLists.find(list => list.id === activeLayout.cueListId) || cueLists[0];
    if (!sourceCueList) return null;
    return {
      ...sourceCueList,
      cues: [...(sourceCueList.cues || [])].sort(compareCueByNumber)
    };
  }, [config, activeLayout]);

  const cuePlayback = useMemo(() => {
    const fallback = {
      cueListId: activeCueList?.id || null,
      cueId: null,
      cueIndex: -1,
      status: 'stopped',
      transition: null
    };
    if (!activeLayout?.id) return fallback;
    const fromState = state?.cuePlayback?.[activeLayout.id];
    if (!fromState) return fallback;
    return { ...fallback, ...fromState };
  }, [state?.cuePlayback, activeLayout?.id, activeCueList?.id]);

  const activeCueIndex = useMemo(() => {
    if (!activeCueList || !Array.isArray(activeCueList.cues)) return -1;
    if (cuePlayback?.cueId) {
      const idx = activeCueList.cues.findIndex(cue => cue.id === cuePlayback.cueId);
      if (idx >= 0) return idx;
    }
    if (Number.isInteger(cuePlayback?.cueIndex) &&
      cuePlayback.cueIndex >= 0 &&
      cuePlayback.cueIndex < activeCueList.cues.length) {
      return cuePlayback.cueIndex;
    }
    return -1;
  }, [activeCueList, cuePlayback?.cueId, cuePlayback?.cueIndex]);

  const activeCue = useMemo(() => {
    if (!activeCueList || activeCueIndex < 0) return null;
    return activeCueList.cues[activeCueIndex] || null;
  }, [activeCueList, activeCueIndex]);

  const selectedCueIndex = useMemo(() => {
    if (!activeCueList || !Array.isArray(activeCueList.cues) || activeCueList.cues.length === 0) return -1;
    if (selectedCueId) {
      const selectedIndex = activeCueList.cues.findIndex(cue => cue.id === selectedCueId);
      if (selectedIndex >= 0) return selectedIndex;
    }
    if (activeCueIndex >= 0) return activeCueIndex;
    return 0;
  }, [activeCueList, selectedCueId, activeCueIndex]);

  const selectedCue = useMemo(() => {
    if (!activeCueList || selectedCueIndex < 0) return null;
    return activeCueList.cues[selectedCueIndex] || null;
  }, [activeCueList, selectedCueIndex]);

  const activeCueOverriddenFixtureIds = useMemo(() => {
    if (!activeCue || !activeCueList || !activeLayout?.id) return [];
    const cueTargets = activeCue.targets || {};
    const cueTargetFixtureIds = new Set(Object.keys(cueTargets));
    if (cueTargetFixtureIds.size === 0) return [];

    const overrides = state?.cueOverrides || {};
    return Object.entries(overrides)
      .filter(([fixtureId, override]) => {
        if (!override?.active) return false;
        if (!cueTargetFixtureIds.has(fixtureId)) return false;

        const matchesDashboard = !override.dashboardId || override.dashboardId === activeLayout.id;
        const matchesCueList = !override.cueListId || override.cueListId === activeCueList.id;
        const matchesCue = !override.cueId || override.cueId === activeCue.id;
        return matchesDashboard && matchesCueList && matchesCue;
      })
      .map(([fixtureId]) => fixtureId);
  }, [activeCue, activeCueList, activeLayout?.id, state?.cueOverrides]);

  const hasActiveCueOverrides = activeCueOverriddenFixtureIds.length > 0;

  const cueShortcutSettings = useMemo(() => {
    const shortcuts = activeCueList?.shortcuts || {};
    return {
      enableSpacebarGo: shortcuts.enableSpacebarGo !== false,
      enableShiftSpacebarFastGo: shortcuts.enableShiftSpacebarFastGo === true,
      enableOptionSpacebarBackPause: shortcuts.enableOptionSpacebarBackPause === true
    };
  }, [activeCueList?.shortcuts]);

  const stopCueTransitionAnimation = useCallback((resetProgress = false) => {
    if (cueTransitionTimerRef.current) {
      clearTimeout(cueTransitionTimerRef.current);
      cueTransitionTimerRef.current = null;
    }
    if (cueProgressFrameRef.current) {
      cancelAnimationFrame(cueProgressFrameRef.current);
      cueProgressFrameRef.current = null;
    }
    cueTransitionStartRef.current = 0;
    cueTransitionDurationRef.current = 0;
    setCueTransitioning(false);
    if (resetProgress) {
      setCueTransitionProgress(0);
    }
  }, []);

  const clearCueTransitionTimer = useCallback(() => {
    stopCueTransitionAnimation(true);
  }, [stopCueTransitionAnimation]);

  const pauseCueTransitionAnimation = useCallback(() => {
    stopCueTransitionAnimation(false);
  }, [stopCueTransitionAnimation]);

  const startCueTransitionWindow = useCallback((fadeTimeSeconds, options = {}) => {
    const startProgress = Number.isFinite(Number(options.startProgress))
      ? Math.max(0, Math.min(1, Number(options.startProgress)))
      : 0;
    const durationOverrideMs = Number.isFinite(Number(options.durationMs))
      ? Math.max(1, Number(options.durationMs))
      : null;
    if (!durationOverrideMs && (!Number.isFinite(Number(fadeTimeSeconds)) || Number(fadeTimeSeconds) <= 0)) {
      clearCueTransitionTimer();
      return;
    }
    clearCueTransitionTimer();
    const durationMs = durationOverrideMs || Math.max(1, Number(fadeTimeSeconds) * 1000);
    cueTransitionDurationRef.current = durationMs;
    setCueTransitioning(true);
    setCueTransitionProgress(startProgress);

    const animateProgress = (timestamp) => {
      if (!cueTransitionStartRef.current) {
        cueTransitionStartRef.current = timestamp;
      }
      const elapsedMs = timestamp - cueTransitionStartRef.current;
      const progress = Math.min(1, startProgress + (elapsedMs / cueTransitionDurationRef.current));
      setCueTransitionProgress(progress);

      if (progress >= 1) {
        cueProgressFrameRef.current = null;
        cueTransitionStartRef.current = 0;
        setCueTransitioning(false);
        setCueTransitionProgress(0);
        return;
      }

      cueProgressFrameRef.current = requestAnimationFrame(animateProgress);
    };

    cueProgressFrameRef.current = requestAnimationFrame(animateProgress);
  }, [clearCueTransitionTimer]);

  const isCueTransitioning = cuePlayback.status === 'playing' && cueTransitioning;
  const cueGoButtonLabel = cuePlayback.status === 'paused' ? 'Resume' : 'GO';

  const setCueRowRef = useCallback((cueId, node) => {
    if (!cueId) return;
    if (node) {
      cueRowRefsRef.current.set(cueId, node);
    } else {
      cueRowRefsRef.current.delete(cueId);
    }
  }, []);

  const animateCueListScrollTo = useCallback((targetTop, durationMs = 1000) => {
    const container = cueListScrollContainerRef.current;
    if (!container) return;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const clampedTarget = Math.max(0, Math.min(maxScroll, targetTop));
    const startTop = container.scrollTop;
    const delta = clampedTarget - startTop;
    if (Math.abs(delta) < 1) {
      container.scrollTop = clampedTarget;
      return;
    }

    if (cueListScrollFrameRef.current) {
      cancelAnimationFrame(cueListScrollFrameRef.current);
      cueListScrollFrameRef.current = null;
    }

    const easeInOutCubic = (t) => (
      t < 0.5
        ? 4 * t * t * t
        : 1 - (Math.pow(-2 * t + 2, 3) / 2)
    );

    let startTime = 0;
    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.max(0, Math.min(1, elapsed / Math.max(1, durationMs)));
      const eased = easeInOutCubic(progress);
      container.scrollTop = startTop + (delta * eased);

      if (progress < 1) {
        cueListScrollFrameRef.current = requestAnimationFrame(animate);
      } else {
        cueListScrollFrameRef.current = null;
      }
    };

    cueListScrollFrameRef.current = requestAnimationFrame(animate);
  }, []);

  const scrollCueWindowForGo = useCallback((activeCueId, selectedNextCueId) => {
    const container = cueListScrollContainerRef.current;
    if (!container) return;
    const activeRow = activeCueId ? cueRowRefsRef.current.get(activeCueId) : null;
    const selectedRow = selectedNextCueId ? cueRowRefsRef.current.get(selectedNextCueId) : null;
    if (!activeRow && !selectedRow) return;

    const containerHeight = container.clientHeight || 0;
    if (containerHeight <= 0) return;

    const primaryRow = activeRow || selectedRow;
    const secondaryRow = selectedRow || activeRow;
    const primaryTop = primaryRow?.offsetTop || 0;
    const primaryBottom = primaryTop + (primaryRow?.offsetHeight || 0);
    const secondaryTop = secondaryRow?.offsetTop ?? primaryTop;
    const secondaryBottom = secondaryTop + (secondaryRow?.offsetHeight || 0);

    // Keep active cue in view with space, while ensuring selected-next cue is visible too.
    let targetTop = primaryTop - Math.max(14, containerHeight * 0.18);
    const desiredBottom = Math.max(primaryBottom, secondaryBottom) + 12;
    if (targetTop + containerHeight < desiredBottom) {
      targetTop = desiredBottom - containerHeight;
    }
    const desiredTop = Math.min(primaryTop, secondaryTop) - 12;
    if (desiredTop < targetTop) {
      targetTop = desiredTop;
    }

    animateCueListScrollTo(targetTop, 1000);
  }, [animateCueListScrollTo]);

  const requestCueWindowScroll = useCallback((activeCueId, selectedNextCueId) => {
    cueListScrollRetryRef.current.forEach(timeoutId => clearTimeout(timeoutId));
    cueListScrollRetryRef.current = [];

    requestAnimationFrame(() => {
      scrollCueWindowForGo(activeCueId, selectedNextCueId);
    });

    // Retry after render/state settles to catch loop-around jumps (last -> first cue).
    const retryShort = setTimeout(() => {
      scrollCueWindowForGo(activeCueId, selectedNextCueId);
    }, 120);
    const retryLong = setTimeout(() => {
      scrollCueWindowForGo(activeCueId, selectedNextCueId);
    }, 320);
    cueListScrollRetryRef.current = [retryShort, retryLong];
  }, [scrollCueWindowForGo]);

  useEffect(() => () => {
    if (cueTransitionTimerRef.current) {
      clearTimeout(cueTransitionTimerRef.current);
      cueTransitionTimerRef.current = null;
    }
    if (cueProgressFrameRef.current) {
      cancelAnimationFrame(cueProgressFrameRef.current);
      cueProgressFrameRef.current = null;
    }
    if (cueListScrollFrameRef.current) {
      cancelAnimationFrame(cueListScrollFrameRef.current);
      cueListScrollFrameRef.current = null;
    }
    cueListScrollRetryRef.current.forEach(timeoutId => clearTimeout(timeoutId));
    cueListScrollRetryRef.current = [];
  }, []);

  useEffect(() => {
    if (!activeCueList || !Array.isArray(activeCueList.cues)) {
      setSelectedCueId(null);
      setCueNumberDrafts({});
      setCueNameDrafts({});
      setCueFadeDrafts({});
      setEditingCueId(null);
      return;
    }

    const cueIds = new Set(activeCueList.cues.map(cue => cue.id));
    setSelectedCueId(prevSelectedId => {
      if (prevSelectedId && cueIds.has(prevSelectedId)) return prevSelectedId;
      if (activeCue?.id && cueIds.has(activeCue.id)) return activeCue.id;
      return activeCueList.cues[0]?.id || null;
    });

    setCueNumberDrafts(prev => {
      const next = {};
      activeCueList.cues.forEach(cue => {
        next[cue.id] = Object.prototype.hasOwnProperty.call(prev, cue.id)
          ? prev[cue.id]
          : String(cue.number ?? '');
      });
      return next;
    });

    setCueNameDrafts(prev => {
      const next = {};
      activeCueList.cues.forEach(cue => {
        next[cue.id] = Object.prototype.hasOwnProperty.call(prev, cue.id)
          ? prev[cue.id]
          : String(cue.name ?? '');
      });
      return next;
    });

    setCueFadeDrafts(prev => {
      const next = {};
      activeCueList.cues.forEach(cue => {
        next[cue.id] = Object.prototype.hasOwnProperty.call(prev, cue.id)
          ? prev[cue.id]
          : String(Number.isFinite(Number(cue.fadeTime)) ? cue.fadeTime : 0);
      });
      return next;
    });
  }, [activeCueList, activeCue?.id]);

  useEffect(() => {
    if (cuePlayback.status === 'paused') {
      pauseCueTransitionAnimation();
      return;
    }
    if (cuePlayback.status === 'stopped') {
      clearCueTransitionTimer();
    }
  }, [cuePlayback.status, clearCueTransitionTimer, pauseCueTransitionAnimation]);

  const normalizeCueNumber = useCallback((rawValue) => {
    const value = String(rawValue ?? '').trim();
    if (!value) return null;
    if (!/^\d+(\.\d+)?$/.test(value)) return null;
    return value;
  }, []);

  const isCueNumberUnique = useCallback((cueList, cueId, cueNumber) => {
    if (!cueList || !Array.isArray(cueList.cues)) return true;
    return !cueList.cues.some(cue => {
      if (!cue || cue.id === cueId) return false;
      const normalized = normalizeCueNumber(cue.number);
      return normalized === cueNumber;
    });
  }, [normalizeCueNumber]);

  const getActiveCueForFixture = useCallback((fixtureId) => {
    if (!fixtureId || !activeCue || !activeCueList || !activeLayout?.id) return null;
    if (!activeCue.targets || !activeCue.targets[fixtureId]) return null;
    return {
      dashboardId: activeLayout.id,
      cueListId: activeCueList.id,
      cueId: activeCue.id,
      cueIndex: activeCueIndex,
      targets: activeCue.targets[fixtureId]
    };
  }, [activeCue, activeCueList, activeLayout?.id, activeCueIndex]);
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
    mirrorField('cueOverrides');

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

  const getCueTransitionChannelValue = useCallback((fixtureId, channelName, fallbackValue = 0) => {
    const clampPercent = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 0;
      return Math.max(0, Math.min(100, numeric));
    };
    const clampProgress = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 0;
      return Math.max(0, Math.min(1, numeric));
    };

    const safeFallback = clampPercent(fallbackValue);
    if (!cuePlayback || cuePlayback.status === 'stopped') return safeFallback;
    const isCueOutPlayback = !cuePlayback.cueId && (
      !Number.isInteger(cuePlayback.cueIndex) || cuePlayback.cueIndex < 0
    );

    // If this fixture is manually overriding an active cue, always show the
    // direct/HTP fallback value and ignore cue playback interpolation/targets.
    if (state?.cueOverrides?.[fixtureId]?.active) {
      return safeFallback;
    }

    const transition = cuePlayback.transition;
    const cueTargetsForFixture = activeCue?.targets?.[fixtureId];
    if (!transition || !Number.isFinite(Number(transition.durationMs)) || Number(transition.durationMs) <= 0) {
      const activeCueValue = cueTargetsForFixture?.[channelName];
      if (Number.isFinite(Number(activeCueValue))) {
        return clampPercent(activeCueValue);
      }
      return safeFallback;
    }

    const transitionFromValue = transition.fromTargets?.[fixtureId]?.[channelName];
    const transitionToValue = transition.toTargets?.[fixtureId]?.[channelName];
    const cueTargetValue = cueTargetsForFixture?.[channelName];

    const hasFrom = Number.isFinite(Number(transitionFromValue));
    const hasTo = Number.isFinite(Number(transitionToValue));
    const hasCueTarget = Number.isFinite(Number(cueTargetValue));

    if (!hasFrom && !hasTo && !hasCueTarget) {
      return safeFallback;
    }

    const startValue = hasFrom ? clampPercent(transitionFromValue) : safeFallback;
    const endValue = hasTo
      ? clampPercent(transitionToValue)
      : (hasCueTarget ? clampPercent(cueTargetValue) : startValue);

    let progress = cueTransitionProgress;
    if (cuePlayback.status === 'paused') {
      if (Number.isFinite(Number(transition.pausedProgress))) {
        progress = Number(transition.pausedProgress);
      }
    } else if (!Number.isFinite(Number(progress)) || Number(progress) <= 0) {
      const startedAtMs = Number.isFinite(Number(transition.startedAtMs))
        ? Number(transition.startedAtMs)
        : Date.now();
      const durationMs = Math.max(1, Number(transition.durationMs));
      progress = (Date.now() - startedAtMs) / durationMs;
    }
    const clampedProgress = clampProgress(progress);

    // Cue Out has no active cue target. Once its transition has completed, stop
    // forcing the transition's end-state and fall back to live HTP display data.
    if (isCueOutPlayback && clampedProgress >= 1) {
      return safeFallback;
    }

    return startValue + (endValue - startValue) * clampedProgress;
  }, [
    cuePlayback,
    cueTransitionProgress,
    activeCue?.targets,
    state?.cueOverrides
  ]);

  const getDisplayedChannelValue = useCallback((fixtureId, channelName) => {
    if (!fixtureId || !channelName) return 0;
    const metaValue = htpMetadata[`${fixtureId}.${channelName}`]?.displayValue;
    const fallback = Number.isFinite(Number(metaValue)) ? Number(metaValue) : 0;
    return getCueTransitionChannelValue(fixtureId, channelName, fallback);
  }, [htpMetadata, getCueTransitionChannelValue]);

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

  const goToSettingsTab = useCallback((tabId) => {
    const safeTab = tabId || 'showlayout';
    navigate(`/settings?tab=${safeTab}`, {
      state: { fromDashboard: urlSlug }
    });
  }, [navigate, urlSlug]);

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

  const getFixtureChannelDefinitions = useCallback((profile) => {
    if (!profile) return [];
    if (Array.isArray(profile.controls)) {
      const channels = [];
      profile.controls.forEach(control => {
        if (Array.isArray(control.components)) {
          control.components.forEach(comp => {
            if (comp?.name) {
              channels.push({
                name: comp.name,
                label: comp.name.charAt(0).toUpperCase() + comp.name.slice(1)
              });
            }
          });
        }
      });
      return channels;
    }
    if (Array.isArray(profile.channels)) {
      return profile.channels
        .filter(channel => channel?.name)
        .map(channel => ({
          name: channel.name,
          label: channel.name.charAt(0).toUpperCase() + channel.name.slice(1)
        }));
    }
    return [];
  }, []);

  const getLayoutFixtureDefinitions = useCallback((layout, sourceConfig) => {
    const fixtureIdsInLayout = new Set();
    (layout?.sections || []).forEach(section => {
      (section.items || []).forEach(item => {
        if (item?.type === 'fixture' && item.id) {
          fixtureIdsInLayout.add(item.id);
        }
      });
    });

    return (sourceConfig?.fixtures || [])
      .filter(Boolean)
      .filter(fixture => {
        if (fixtureIdsInLayout.size === 0) return true;
        return fixtureIdsInLayout.has(fixture.id);
      })
      .map(fixture => {
        const profile = (sourceConfig?.fixtureProfiles || []).find(p => p.id === fixture.profileId);
        if (!profile) return null;
        return {
          fixtureId: fixture.id,
          fixtureName: fixture.name || fixture.id,
          channels: getFixtureChannelDefinitions(profile)
        };
      })
      .filter(Boolean);
  }, [getFixtureChannelDefinitions]);

  const buildLookTargetsTemplate = useCallback((layout, sourceConfig) => {
    const targets = {};
    getLayoutFixtureDefinitions(layout, sourceConfig).forEach(definition => {
      targets[definition.fixtureId] = {};
      definition.channels.forEach(channel => {
        targets[definition.fixtureId][channel.name] = 0;
      });
    });
    return targets;
  }, [getLayoutFixtureDefinitions]);

  const lookEditorFixtureDefinitions = useMemo(() => {
    return getLayoutFixtureDefinitions(activeLayout, config);
  }, [activeLayout, config, getLayoutFixtureDefinitions]);

  const openLookSectionEditor = useCallback((section) => {
    if (!section || !config || !canEditSectionLayout) return;
    const layout = activeLayout;
    if (!layout) return;
    const fixtureDefinitions = getLayoutFixtureDefinitions(layout, config);

    const normalizeTargets = (sourceTargets = {}) => {
      const normalized = {};
      fixtureDefinitions.forEach(definition => {
        const sourceFixtureTargets = sourceTargets?.[definition.fixtureId] || {};
        const fixtureTargets = {};
        definition.channels.forEach(channel => {
          const numericValue = Number(sourceFixtureTargets[channel.name]);
          fixtureTargets[channel.name] = Number.isFinite(numericValue)
            ? Math.max(0, Math.min(100, numericValue))
            : 0;
        });
        normalized[definition.fixtureId] = fixtureTargets;
      });
      return normalized;
    };

    const orderedLookItems = (section.items || [])
      .filter(item => item.type === 'look')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const draft = orderedLookItems
      .map(item => {
        const look = (config.looks || []).find(l => l && l.id === item.id && (!l.dashboardId || l.dashboardId === layout.id));
        if (!look) return null;
        return {
          id: look.id,
          name: look.name || '',
          color: look.color || 'blue',
          lookUiMode: item.lookUiMode || 'slider',
          showRecordButton: look.showRecordButton === true,
          targets: normalizeTargets(look.targets),
          tags: Array.isArray(look.tags) ? [...look.tags] : [],
          expanded: false
        };
      })
      .filter(Boolean);

    // Include any dashboard-owned looks not currently referenced in section items.
    const draftIds = new Set(draft.map(item => item.id));
    (config.looks || [])
      .filter(look => look?.dashboardId === layout.id && !draftIds.has(look.id))
      .forEach(look => {
        draft.push({
          id: look.id,
          name: look.name || '',
          color: look.color || 'blue',
          lookUiMode: 'slider',
          showRecordButton: look.showRecordButton === true,
          targets: normalizeTargets(look.targets),
          tags: Array.isArray(look.tags) ? [...look.tags] : [],
          expanded: false
        });
      });

    setLookEditorSectionId(section.id);
    setLookEditorSectionName(section.name || 'Looks');
    setLookEditorDraft(draft);
    setLookEditorError('');
    setShowLookEditor(true);
  }, [config, canEditSectionLayout, activeLayout, getLayoutFixtureDefinitions]);

  const updateLookDraftField = useCallback((lookId, field, value) => {
    setLookEditorDraft(prev =>
      prev.map(item => (item.id === lookId ? { ...item, [field]: value } : item))
    );
  }, []);

  const updateLookDraftTarget = useCallback((lookId, fixtureId, channelName, value) => {
    const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    const clampedValue = Math.max(0, Math.min(100, numericValue));
    setLookEditorDraft(prev =>
      prev.map(item => {
        if (item.id !== lookId) return item;
        const nextTargets = { ...(item.targets || {}) };
        const fixtureTargets = { ...(nextTargets[fixtureId] || {}) };
        fixtureTargets[channelName] = clampedValue;
        nextTargets[fixtureId] = fixtureTargets;
        return { ...item, targets: nextTargets };
      })
    );
  }, []);

  const toggleLookDraftExpanded = useCallback((lookId) => {
    setLookEditorDraft(prev =>
      prev.map(item => (item.id === lookId ? { ...item, expanded: !item.expanded } : item))
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

  const addLookToEditor = useCallback(() => {
    if (!config || !activeLayout) return;
    const timestamp = Date.now();
    const nextLookId = `look-${timestamp}`;
    const existingNames = new Set(lookEditorDraft.map(look => (look.name || '').trim()));
    let baseName = 'New Look';
    let suffix = 2;
    while (existingNames.has(baseName)) {
      baseName = `New Look ${suffix}`;
      suffix += 1;
    }

    setLookEditorDraft(prev => ([
      ...prev,
      {
        id: nextLookId,
        name: baseName,
        color: 'blue',
        lookUiMode: 'slider',
        showRecordButton: true,
        targets: buildLookTargetsTemplate(activeLayout, config),
        tags: [],
        expanded: true
      }
    ]));
  }, [config, activeLayout, lookEditorDraft, buildLookTargetsTemplate]);

  const removeLookFromEditor = useCallback((lookId) => {
    setLookEditorDraft(prev => prev.filter(item => item.id !== lookId));
  }, []);

  const captureLookFromEditor = useCallback(async (lookId) => {
    if (!lookId) return;
    try {
      setLookEditorError('');
      const persistedLook = (config?.looks || []).find(look => look.id === lookId);
      if (!persistedLook) {
        throw new Error('Save this look first, then record it.');
      }
      const response = await fetch(`/api/looks/${lookId}/capture`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to capture look.');
      }

      const refreshedResponse = await fetch('/api/config');
      const refreshedConfig = await refreshedResponse.json();
      setConfig(refreshedConfig);
      setLookEditorDraft(prev => prev.map(item => {
        if (item.id !== lookId) return item;
        const refreshedLook = (refreshedConfig.looks || []).find(look => look.id === lookId && (!look.dashboardId || look.dashboardId === activeLayout?.id));
        if (!refreshedLook) return item;
        return {
          ...item,
          targets: refreshedLook.targets ? JSON.parse(JSON.stringify(refreshedLook.targets)) : buildLookTargetsTemplate(activeLayout, refreshedConfig)
        };
      }));
    } catch (error) {
      console.error('Failed to capture look from editor:', error);
      setLookEditorError(error.message || 'Failed to record look.');
    }
  }, [config?.looks, activeLayout, buildLookTargetsTemplate]);

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

      const draftById = new Map(
        lookEditorDraft.map(item => [item.id, item])
      );
      const removedDashboardLookIds = (nextConfig.looks || [])
        .filter(look => look?.dashboardId === layout.id && !draftById.has(look.id))
        .map(look => look.id);
      const fixtureDefinitions = getLayoutFixtureDefinitions(layout, nextConfig);
      const sanitizeTargets = (rawTargets = {}) => {
        const normalized = {};
        fixtureDefinitions.forEach(definition => {
          const sourceFixtureTargets = rawTargets?.[definition.fixtureId] || {};
          const fixtureTargets = {};
          definition.channels.forEach(channel => {
            const numericValue = Number(sourceFixtureTargets[channel.name]);
            fixtureTargets[channel.name] = Number.isFinite(numericValue)
              ? Math.max(0, Math.min(100, numericValue))
              : 0;
          });
          normalized[definition.fixtureId] = fixtureTargets;
        });
        return normalized;
      };

      // Remove any looks owned by this dashboard that are no longer in draft.
      nextConfig.looks = (nextConfig.looks || []).filter(look => {
        if (look.dashboardId !== layout.id) return true;
        return draftById.has(look.id);
      });

      // Upsert dashboard-owned looks from draft.
      lookEditorDraft.forEach(draftLook => {
        const existingLook = nextConfig.looks.find(look => look.id === draftLook.id);
        const payload = {
          id: draftLook.id,
          name: (draftLook.name || '').trim() || 'New Look',
          color: draftLook.color || 'blue',
          showRecordButton: draftLook.showRecordButton === true,
          targets: sanitizeTargets(draftLook.targets || {}),
          tags: Array.isArray(draftLook.tags) ? [...draftLook.tags] : [],
          dashboardId: layout.id
        };

        if (existingLook) {
          Object.assign(existingLook, payload);
        } else {
          nextConfig.looks.push(payload);
        }
      });

      const orderByLookId = new Map(
        lookEditorDraft.map((item, index) => [item.id, index])
      );

      const lookItems = [...(section.items || [])].filter(item => item.type === 'look');
      const reorderedItems = [...lookItems].sort((a, b) => {
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

      const existingItemByLookId = new Map(reorderedItems.map(item => [item.id, item]));
      const nextLookItems = lookEditorDraft.map((item, index) => {
        const existingItem = existingItemByLookId.get(item.id);
        return {
          ...(existingItem || {}),
          type: 'look',
          id: item.id,
          visible: existingItem?.visible !== false,
          order: index,
          lookUiMode: item.lookUiMode || existingItem?.lookUiMode || 'slider'
        };
      });

      const nonLookItems = (section.items || []).filter(item => item.type !== 'look');
      section.items = [...nextLookItems, ...nonLookItems];
      section.items.forEach((item, index) => {
        item.order = index;
      });

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
      if (removedDashboardLookIds.length > 0) {
        const clearedRemovedLooks = {};
        removedDashboardLookIds.forEach(lookId => {
          clearedRemovedLooks[lookId] = 0;
        });
        sendDashboardUpdate({ looks: clearedRemovedLooks });
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
  }, [config, activeLayout, lookEditorSectionId, lookEditorDraft, getLayoutFixtureDefinitions, sendDashboardUpdate]);

  const handleLookChange = (lookId, value) => {
    const normalized = Math.max(0, Math.min(1, value / 100));
    if (normalized > 0.001) {
      lastLookToggleOnLevelRef.current[lookId] = normalized;
    } else {
      delete lastLookToggleOnLevelRef.current[lookId];
    }
    sendDashboardUpdate({
      looks: {
        [lookId]: normalized
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
    const level = Number(currentLevel) || 0;
    if (level > 0.001) {
      lastLookToggleOnLevelRef.current[lookId] = level;
      sendDashboardUpdate({
        looks: {
          [lookId]: 0
        }
      });
      return;
    }

    const savedLevel = Number(lastLookToggleOnLevelRef.current[lookId]) || 0;
    const restoreLevel = savedLevel > 0.001 ? savedLevel : 1;

    sendDashboardUpdate({
      looks: {
        [lookId]: restoreLevel
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
    const targetFixtureDefinitions = getLayoutFixtureDefinitions(activeLayout, config);

    // Collect current displayed values from HTP metadata (what you see on sliders)
    const capturedTargets = {};
    targetFixtureDefinitions.forEach(definition => {
      capturedTargets[definition.fixtureId] = {};
      definition.channels.forEach(channel => {
        const key = `${definition.fixtureId}.${channel.name}`;
        const meta = htpMetadata[key];
        const displayValue = meta?.displayValue || 0;

        // Record all values (including zero)
        capturedTargets[definition.fixtureId][channel.name] = Math.round(displayValue * 100) / 100;
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
        targetFixtureDefinitions.forEach(definition => {
          definition.channels.forEach(channel => {
            const key = `${definition.fixtureId}.${channel.name}`;
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

  const handleClearAllLooks = (lookIds = null) => {
    const clearedLooks = {};
    const targetLookIds = Array.isArray(lookIds) && lookIds.length > 0
      ? lookIds
      : (activeLayout?.sections || [])
        .flatMap(section => (section.items || []))
        .filter(item => item?.type === 'look' && item.id)
        .map(item => item.id);

    targetLookIds.forEach(lookId => {
      clearedLooks[lookId] = 0;
    });
    if (Object.keys(clearedLooks).length === 0) return;

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
        // XY position (pan/tilt, normalized 0-1)
        const hasPanFine = control.components?.some(comp => comp.type === 'panFine');
        const hasTiltFine = control.components?.some(comp => comp.type === 'tiltFine');
        const panNormalized = defaultVal.x || 0.5;
        const tiltNormalized = defaultVal.y || 0.5;
        const panRaw = Math.round(Math.max(0, Math.min(1, panNormalized)) * 65535);
        const tiltRaw = Math.round(Math.max(0, Math.min(1, tiltNormalized)) * 65535);

        control.components.forEach(comp => {
          if (comp.type === 'pan') {
            fixtureState[comp.name] = hasPanFine ? (((panRaw >> 8) / 255) * 100) : (panNormalized * 100);
          } else if (comp.type === 'panFine') {
            fixtureState[comp.name] = ((panRaw & 0xff) / 255) * 100;
          } else if (comp.type === 'tilt') {
            fixtureState[comp.name] = hasTiltFine ? (((tiltRaw >> 8) / 255) * 100) : (tiltNormalized * 100);
          } else if (comp.type === 'tiltFine') {
            fixtureState[comp.name] = ((tiltRaw & 0xff) / 255) * 100;
          }
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
    const cueOverridesToClear = {};
    const fixtureHsvUpdates = {};
    const fixturesToClear = (config.fixtures || [])
      .filter(f => f)
      .filter(fixture => !fixtureIds || fixtureIds.includes(fixture.id));

    fixturesToClear.forEach(fixture => {
      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (profile) {
        clearedFixtures[fixture.id] = {};
        overridesToClear[fixture.id] = null;
        cueOverridesToClear[fixture.id] = null;

        const hasActiveLook = hasActiveLookForFixture(fixture.id);
        const activeCueForFixture = getActiveCueForFixture(fixture.id);
        const hasActiveCue = Boolean(activeCueForFixture);

        if (hasActiveCue) {
          // Release direct channel values so active cue can fully take control again.
          setFixtureChannelsToZero(profile, clearedFixtures[fixture.id]);
        } else if (hasActiveLook) {
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
              const cueTargets = activeCueForFixture?.targets || null;
              const nextR = Number(cueTargets?.[redComp.name] ?? clearedFixtures[fixture.id][redComp.name] ?? 0);
              const nextG = Number(cueTargets?.[greenComp.name] ?? clearedFixtures[fixture.id][greenComp.name] ?? 0);
              const nextB = Number(cueTargets?.[blueComp.name] ?? clearedFixtures[fixture.id][blueComp.name] ?? 0);
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
      cueOverrides: cueOverridesToClear,
      fixtureHsv: Object.keys(fixtureHsvUpdates).length > 0 ? fixtureHsvUpdates : undefined
    });
    clearTrackingForFixtures(fixturesToClear.map(f => f.id));
  };

  const buildLookOverrideClearPayload = useCallback(() => {
    const payload = {};
    Object.keys(state.overriddenFixtures || {}).forEach(fixtureId => {
      payload[fixtureId] = null;
    });
    return payload;
  }, [state.overriddenFixtures]);

  const buildCueOverrideClearPayload = useCallback(() => {
    const payload = {};
    Object.keys(state.cueOverrides || {}).forEach(fixtureId => {
      payload[fixtureId] = null;
    });
    return payload;
  }, [state.cueOverrides]);

  const buildHomeStateForFixtures = useCallback((fixtureIds = []) => {
    const fixtureUpdates = {};
    const fixtureHsvUpdates = {};

    fixtureIds.forEach((fixtureId) => {
      const fixture = (config.fixtures || []).find(f => f?.id === fixtureId);
      if (!fixture) return;
      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (!profile) return;

      fixtureUpdates[fixture.id] = {};
      if (profile.controls && Array.isArray(profile.controls)) {
        profile.controls.forEach(control => {
          if (control.components && Array.isArray(control.components)) {
            applyControlDefaults(control, fixtureUpdates[fixture.id]);
          }
        });
        applyDashboardClearDefaults(profile, fixture.id, fixtureUpdates[fixture.id]);
      } else if (profile.channels) {
        profile.channels.forEach(ch => {
          fixtureUpdates[fixture.id][ch.name] = 0;
        });
      }

      const rgbControl = profile.controls?.find(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
      if (rgbControl?.components) {
        const redComp = rgbControl.components.find(c => c.type === 'red');
        const greenComp = rgbControl.components.find(c => c.type === 'green');
        const blueComp = rgbControl.components.find(c => c.type === 'blue');
        if (redComp && greenComp && blueComp) {
          const r = Number(fixtureUpdates[fixture.id][redComp.name] ?? 0);
          const g = Number(fixtureUpdates[fixture.id][greenComp.name] ?? 0);
          const b = Number(fixtureUpdates[fixture.id][blueComp.name] ?? 0);
          const hsv = rgbToHsv(r, g, b);
          fixtureHsvUpdates[fixture.id] = hsv;
        }
      }
    });

    return { fixtureUpdates, fixtureHsvUpdates };
  }, [config?.fixtures, config?.fixtureProfiles, applyDashboardClearDefaults]);

  const setCuePlaybackState = useCallback((nextPlayback) => {
    if (!activeLayout?.id) return;
    sendDashboardUpdate({
      cuePlayback: {
        [activeLayout.id]: nextPlayback
      }
    });
  }, [activeLayout?.id, sendDashboardUpdate]);

  const persistCueListUpdate = useCallback(async (mutateCueList) => {
    if (!activeCueList || !config) return { success: false };
    try {
      const nextConfig = JSON.parse(JSON.stringify(config));
      const cueList = (nextConfig.cueLists || []).find(list => list.id === activeCueList.id);
      if (!cueList) throw new Error('Cue list not found.');
      const mutateResult = mutateCueList(cueList);
      if (mutateResult === false) return { success: false, skipped: true };
      if (Array.isArray(cueList.cues)) {
        cueList.cues.sort(compareCueByNumber);
      }

      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig)
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to update cue list.');
      }

      const updatedConfig = result.config || nextConfig;
      setConfig(updatedConfig);
      const updatedLayout = updatedConfig.showLayouts?.find(layout => layout.id === activeLayout?.id);
      if (updatedLayout) {
        setActiveLayout(updatedLayout);
      }
      return { success: true, config: updatedConfig };
    } catch (error) {
      console.error('Failed to update cue list:', error);
      setCueUiError(error.message || 'Failed to update cue list.');
      return { success: false, error };
    }
  }, [activeCueList, config, activeLayout?.id]);

  const goCueHome = useCallback(() => {
    if (!activeLayout || !config) return;
    const fixtureIds = getLayoutFixtureDefinitions(activeLayout, config).map(def => def.fixtureId);
    const { fixtureUpdates, fixtureHsvUpdates } = buildHomeStateForFixtures(fixtureIds);
    const clearedLookOverrides = buildLookOverrideClearPayload();
    const clearedCueOverrides = buildCueOverrideClearPayload();

    sendDashboardUpdate({
      cuePlayback: {
        [activeLayout.id]: {
          cueListId: activeCueList?.id || activeLayout.cueListId || null,
          cueId: null,
          cueIndex: -1,
          status: 'stopped',
          transition: null
        }
      },
      fixtures: fixtureUpdates,
      fixtureHsv: Object.keys(fixtureHsvUpdates).length > 0 ? fixtureHsvUpdates : undefined,
      overriddenFixtures: Object.keys(clearedLookOverrides).length > 0 ? clearedLookOverrides : undefined,
      cueOverrides: Object.keys(clearedCueOverrides).length > 0 ? clearedCueOverrides : undefined
    });

    clearTrackingForFixtures(fixtureIds);
    clearCueTransitionTimer();
  }, [
    activeLayout,
    config,
    getLayoutFixtureDefinitions,
    buildHomeStateForFixtures,
    buildLookOverrideClearPayload,
    buildCueOverrideClearPayload,
    sendDashboardUpdate,
    activeCueList?.id,
    clearTrackingForFixtures,
    clearCueTransitionTimer
  ]);

  const activateCueAtIndex = useCallback((cueIndex, options = {}) => {
    if (!activeLayout || !activeCueList || !Array.isArray(activeCueList.cues)) return;
    if (cueIndex < 0 || cueIndex >= activeCueList.cues.length) return;

    const cue = activeCueList.cues[cueIndex];
    if (!cue) return;
    const transitionSecondsRaw = options.transitionSeconds;
    const transitionSeconds = Number.isFinite(Number(transitionSecondsRaw))
      ? Math.max(0, Number(transitionSecondsRaw))
      : Math.max(0, Number(cue.fadeTime ?? 0));
    const transitionDurationMs = Math.round(transitionSeconds * 1000);
    const transitionFromTargets = {};
    const transitionToTargets = JSON.parse(JSON.stringify(cue.targets || {}));

    const clearedLookOverrides = buildLookOverrideClearPayload();
    const clearedCueOverrides = buildCueOverrideClearPayload();
    const fixtureReleaseUpdates = {};
    const fixtureIds = [];
    const fixtureHsvUpdates = {};

    Object.entries(cue.targets || {}).forEach(([fixtureId, channelTargets]) => {
      if (!channelTargets || typeof channelTargets !== 'object') return;
      fixtureReleaseUpdates[fixtureId] = {};
      fixtureIds.push(fixtureId);
      Object.keys(channelTargets).forEach(channelName => {
        fixtureReleaseUpdates[fixtureId][channelName] = 0;
        if (transitionDurationMs > 0) {
          if (!transitionFromTargets[fixtureId]) {
            transitionFromTargets[fixtureId] = {};
          }
          const channelKey = `${fixtureId}.${channelName}`;
          const currentDisplayValue = Number(htpMetadataRef.current?.[channelKey]?.displayValue);
          transitionFromTargets[fixtureId][channelName] = Number.isFinite(currentDisplayValue)
            ? Math.max(0, Math.min(100, currentDisplayValue))
            : 0;
        }
      });

      const fixture = (config.fixtures || []).find(f => f?.id === fixtureId);
      const profile = config.fixtureProfiles?.find(p => p.id === fixture?.profileId);
      const rgbControl = profile?.controls?.find(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
      if (!rgbControl?.components) return;
      const redComp = rgbControl.components.find(c => c.type === 'red');
      const greenComp = rgbControl.components.find(c => c.type === 'green');
      const blueComp = rgbControl.components.find(c => c.type === 'blue');
      if (!(redComp && greenComp && blueComp)) return;
      const r = Number(channelTargets[redComp.name] ?? 0);
      const g = Number(channelTargets[greenComp.name] ?? 0);
      const b = Number(channelTargets[blueComp.name] ?? 0);
      fixtureHsvUpdates[fixtureId] = rgbToHsv(r, g, b);
    });

    sendDashboardUpdate({
      cuePlayback: {
        [activeLayout.id]: {
          cueListId: activeCueList.id,
          cueId: cue.id,
          cueIndex,
          status: 'playing',
          transition: transitionDurationMs > 0 ? {
            startedAtMs: Date.now(),
            durationMs: transitionDurationMs,
            fromTargets: transitionFromTargets,
            toTargets: transitionToTargets,
            pausedAtMs: null,
            pausedProgress: null
          } : null
        }
      },
      fixtures: Object.keys(fixtureReleaseUpdates).length > 0 ? fixtureReleaseUpdates : undefined,
      fixtureHsv: Object.keys(fixtureHsvUpdates).length > 0 ? fixtureHsvUpdates : undefined,
      overriddenFixtures: Object.keys(clearedLookOverrides).length > 0 ? clearedLookOverrides : undefined,
      cueOverrides: Object.keys(clearedCueOverrides).length > 0 ? clearedCueOverrides : undefined
    });

    clearTrackingForFixtures(fixtureIds);
  }, [
    activeLayout,
    activeCueList,
    config?.fixtures,
    config?.fixtureProfiles,
    buildLookOverrideClearPayload,
    buildCueOverrideClearPayload,
    sendDashboardUpdate,
    htpMetadataRef,
    clearTrackingForFixtures
  ]);

  const handleCueGo = useCallback((options = {}) => {
    if (!activeCueList || !Array.isArray(activeCueList.cues) || activeCueList.cues.length === 0) return;

    if (
      cuePlayback?.status === 'paused'
      && activeCueIndex >= 0
      && cuePlayback?.transition
      && Number.isFinite(Number(cuePlayback.transition.durationMs))
      && Number(cuePlayback.transition.durationMs) > 0
    ) {
      const durationMs = Math.max(1, Number(cuePlayback.transition.durationMs));
      const pausedProgressRaw = Number(cuePlayback.transition.pausedProgress);
      const pausedProgress = Number.isFinite(pausedProgressRaw)
        ? Math.max(0, Math.min(1, pausedProgressRaw))
        : Math.max(0, Math.min(1, cueTransitionProgress || 0));
      const resumedStartedAtMs = Date.now() - (pausedProgress * durationMs);

      setCuePlaybackState({
        cueListId: activeCueList.id,
        cueId: activeCue?.id || activeCueList.cues[activeCueIndex]?.id || null,
        cueIndex: activeCueIndex,
        status: 'playing',
        transition: {
          ...cuePlayback.transition,
          startedAtMs: resumedStartedAtMs,
          pausedAtMs: null,
          pausedProgress: null
        }
      });

      startCueTransitionWindow(durationMs / 1000, {
        durationMs,
        startProgress: pausedProgress
      });
      const resumedCueId = activeCue?.id || activeCueList.cues[activeCueIndex]?.id || null;
      const resumedNextCueId = selectedCueId
        || activeCueList.cues[(activeCueIndex + 1) % activeCueList.cues.length]?.id
        || resumedCueId;
      requestCueWindowScroll(resumedCueId, resumedNextCueId);
      setCueUiError('');
      return;
    }

    const fastGo = options.fastGo === true;
    const cueCount = activeCueList.cues.length;
    let cueIndex = 0;

    // If a different cue is selected, GO starts there once.
    if (selectedCueIndex >= 0 && activeCueIndex >= 0 && selectedCueIndex !== activeCueIndex) {
      cueIndex = selectedCueIndex;
    } else if (selectedCueIndex >= 0 && activeCueIndex < 0) {
      cueIndex = selectedCueIndex;
    } else if (activeCueIndex >= 0) {
      // Repeated GO steps forward through the list.
      cueIndex = (activeCueIndex + 1) % cueCount;
    }

    const activatedCue = activeCueList.cues[cueIndex];
    const transitionSeconds = fastGo ? 0 : Number(activatedCue?.fadeTime ?? 0);
    activateCueAtIndex(cueIndex, { transitionSeconds });
    startCueTransitionWindow(transitionSeconds);
    const nextCueId = activeCueList.cues[(cueIndex + 1) % cueCount]?.id || activatedCue?.id || null;
    setSelectedCueId(nextCueId);
    requestCueWindowScroll(activatedCue?.id || null, nextCueId);
    setCueUiError('');
  }, [
    activeCueList,
    selectedCueIndex,
    activeCueIndex,
    activeCue?.id,
    selectedCueId,
    cuePlayback?.status,
    cuePlayback?.transition,
    cueTransitionProgress,
    activateCueAtIndex,
    startCueTransitionWindow,
    setCuePlaybackState,
    requestCueWindowScroll
  ]);

  const handleCuePauseOrBack = useCallback(() => {
    if (!activeCueList || !Array.isArray(activeCueList.cues) || activeCueList.cues.length === 0) return;

    if (isCueTransitioning) {
      const nowMs = Date.now();
      const existingTransition = cuePlayback?.transition;
      let pausedProgress = Math.max(0, Math.min(1, cueTransitionProgress));
      if (existingTransition && Number.isFinite(Number(existingTransition.durationMs)) && Number(existingTransition.durationMs) > 0) {
        const startedAtMs = Number.isFinite(Number(existingTransition.startedAtMs))
          ? Number(existingTransition.startedAtMs)
          : nowMs;
        pausedProgress = Math.max(
          0,
          Math.min(1, (nowMs - startedAtMs) / Number(existingTransition.durationMs))
        );
      }
      setCuePlaybackState({
        cueListId: activeCueList.id,
        cueId: activeCue?.id || null,
        cueIndex: activeCueIndex,
        status: 'paused',
        transition: existingTransition ? {
          ...existingTransition,
          pausedAtMs: nowMs,
          pausedProgress
        } : null
      });
      pauseCueTransitionAnimation();
      return;
    }

    const currentIndex = activeCueIndex >= 0 ? activeCueIndex : selectedCueIndex;

    if (currentIndex > 0) {
      const backIndex = currentIndex - 1;
      setSelectedCueId(activeCueList.cues[backIndex]?.id || null);
      const transitionSeconds = 0;
      activateCueAtIndex(backIndex, { transitionSeconds });
      startCueTransitionWindow(transitionSeconds);
      return;
    }

    goCueHome();
  }, [
    activeCueList,
    isCueTransitioning,
    activeCue?.id,
    activeCueIndex,
    cuePlayback?.transition,
    cueTransitionProgress,
    setCuePlaybackState,
    selectedCueIndex,
    activateCueAtIndex,
    goCueHome,
    startCueTransitionWindow,
    pauseCueTransitionAnimation
  ]);

  const getNextCueNumber = useCallback(() => {
    if (!activeCueList || !Array.isArray(activeCueList.cues)) return '1';
    const existingNumbers = new Set(
      activeCueList.cues
        .map(cue => normalizeCueNumber(cue.number))
        .filter(Boolean)
    );
    let cueNumber = 1;
    while (existingNumbers.has(String(cueNumber))) {
      cueNumber += 1;
    }
    return String(cueNumber);
  }, [activeCueList, normalizeCueNumber]);

  const getCueNumberAfterSelection = useCallback(() => {
    if (!activeCueList || !Array.isArray(activeCueList.cues) || activeCueList.cues.length === 0) {
      return getNextCueNumber();
    }

    const anchorIndex = selectedCueIndex >= 0 ? selectedCueIndex : activeCueIndex;
    if (anchorIndex < 0 || anchorIndex >= activeCueList.cues.length) {
      return getNextCueNumber();
    }

    const existingNumbers = new Set(
      activeCueList.cues
        .map(cue => normalizeCueNumber(cue.number))
        .filter(Boolean)
    );

    const anchorNumber = Number(normalizeCueNumber(activeCueList.cues[anchorIndex]?.number));
    if (!Number.isFinite(anchorNumber)) {
      return getNextCueNumber();
    }

    const nextCue = activeCueList.cues[anchorIndex + 1];
    const nextCueNumber = Number(normalizeCueNumber(nextCue?.number));

    if (Number.isFinite(nextCueNumber) && nextCueNumber > anchorNumber) {
      let lower = anchorNumber;
      let upper = nextCueNumber;
      for (let idx = 0; idx < 24; idx += 1) {
        const candidate = lower + ((upper - lower) / 2);
        const candidateNumber = normalizeCueNumber(formatCueNumber(candidate));
        if (candidateNumber && !existingNumbers.has(candidateNumber)) {
          return candidateNumber;
        }
        upper = candidate;
      }
    }

    let candidate = anchorNumber + 1;
    for (let idx = 0; idx < 1000; idx += 1) {
      const candidateNumber = normalizeCueNumber(formatCueNumber(candidate));
      if (candidateNumber && !existingNumbers.has(candidateNumber)) {
        return candidateNumber;
      }
      candidate += 1;
    }

    return getNextCueNumber();
  }, [activeCueList, selectedCueIndex, activeCueIndex, normalizeCueNumber, getNextCueNumber]);

  const openGoToCueModal = useCallback(() => {
    setCueUiError('');
    setGoToCueInput('');
    setShowGoToCueModal(true);
  }, []);

  const openAddCueModal = useCallback(() => {
    setCueUiError('');
    setAddCueNumberInput(getCueNumberAfterSelection());
    setAddCueNameInput('');
    setShowAddCueModal(true);
  }, [getCueNumberAfterSelection]);

  const captureCurrentCueTargets = useCallback(() => {
    const fixtureDefs = getLayoutFixtureDefinitions(activeLayout, config);
    const capturedTargets = {};
    fixtureDefs.forEach(definition => {
      capturedTargets[definition.fixtureId] = {};
      definition.channels.forEach(channel => {
        const key = `${definition.fixtureId}.${channel.name}`;
        const displayValue = htpMetadataRef.current?.[key]?.displayValue ?? 0;
        capturedTargets[definition.fixtureId][channel.name] = Math.round(displayValue * 100) / 100;
      });
    });
    return capturedTargets;
  }, [activeLayout, config, getLayoutFixtureDefinitions]);

  const goToCueByNumber = useCallback((overrideNumber) => {
    if (!activeCueList || !Array.isArray(activeCueList.cues) || activeCueList.cues.length === 0) return;
    const normalizedInput = normalizeCueNumber(overrideNumber ?? goToCueInput);
    if (!normalizedInput) {
      setCueUiError('Cue number must be numeric (point cues like 1.5 are allowed).');
      return;
    }
    const cueIndex = activeCueList.cues.findIndex(cue => normalizeCueNumber(cue.number) === normalizedInput);
    if (cueIndex < 0) {
      setCueUiError(`Cue ${normalizedInput} not found in this cue list.`);
      return;
    }
    setCueUiError('');
    setSelectedCueId(activeCueList.cues[cueIndex]?.id || null);
    const transitionSeconds = Number(activeCueList.cues[cueIndex]?.fadeTime ?? 0);
    activateCueAtIndex(cueIndex, { transitionSeconds });
    startCueTransitionWindow(transitionSeconds);
    setGoToCueInput('');
    setShowGoToCueModal(false);
  }, [activeCueList, goToCueInput, normalizeCueNumber, activateCueAtIndex, startCueTransitionWindow]);

  const recordCue = useCallback(async (cueId) => {
    if (!activeCueList || !cueId) return false;
    const cue = activeCueList.cues.find(item => item.id === cueId);
    if (!cue) return false;

    try {
      setRecordingCueId(cue.id);
      const capturedTargets = captureCurrentCueTargets();

      await persistCueListUpdate((cueList) => {
        const cueInConfig = (cueList.cues || []).find(item => item.id === cueId);
        if (!cueInConfig) return false;
        cueInConfig.targets = capturedTargets;
        return true;
      });
      setCueUiError('');
      return true;
    } catch (error) {
      console.error('Failed to record cue:', error);
      setCueUiError(error.message || 'Failed to record cue.');
      return false;
    } finally {
      setTimeout(() => setRecordingCueId(null), 400);
    }
  }, [activeCueList, captureCurrentCueTargets, persistCueListUpdate]);

  const updateActiveCue = useCallback(async () => {
    if (!activeCue || !hasActiveCueOverrides) return;

    const saved = await recordCue(activeCue.id);
    if (!saved) return;

    const fixturesToRelease = {};
    const cueOverridesToClear = {};
    const fixtureHsvUpdates = {};
    const releasedFixtureIds = [];

    activeCueOverriddenFixtureIds.forEach((fixtureId) => {
      const cueTargets = activeCue.targets?.[fixtureId];
      if (!cueTargets || typeof cueTargets !== 'object') return;

      const releaseChannels = Object.keys(cueTargets);
      if (releaseChannels.length === 0) return;

      fixturesToRelease[fixtureId] = {};
      releaseChannels.forEach((channelName) => {
        fixturesToRelease[fixtureId][channelName] = 0;
      });
      cueOverridesToClear[fixtureId] = null;
      releasedFixtureIds.push(fixtureId);

      const fixture = (config?.fixtures || []).find(f => f?.id === fixtureId);
      const profile = (config?.fixtureProfiles || []).find(p => p.id === fixture?.profileId);
      const rgbControl = profile?.controls?.find(c => c.controlType === 'RGB' || c.controlType === 'RGBW');
      if (!rgbControl?.components) return;
      const redComp = rgbControl.components.find(c => c.type === 'red');
      const greenComp = rgbControl.components.find(c => c.type === 'green');
      const blueComp = rgbControl.components.find(c => c.type === 'blue');
      if (!(redComp && greenComp && blueComp)) return;

      const r = Number(cueTargets?.[redComp.name] ?? 0);
      const g = Number(cueTargets?.[greenComp.name] ?? 0);
      const b = Number(cueTargets?.[blueComp.name] ?? 0);
      fixtureHsvUpdates[fixtureId] = rgbToHsv(r, g, b);
    });

    if (Object.keys(cueOverridesToClear).length === 0) return;

    sendDashboardUpdate({
      fixtures: Object.keys(fixturesToRelease).length > 0 ? fixturesToRelease : undefined,
      cueOverrides: cueOverridesToClear,
      fixtureHsv: Object.keys(fixtureHsvUpdates).length > 0 ? fixtureHsvUpdates : undefined
    });

    clearTrackingForFixtures(releasedFixtureIds);
    setCueUiError('');
  }, [
    activeCue,
    hasActiveCueOverrides,
    recordCue,
    activeCueOverriddenFixtureIds,
    config?.fixtures,
    config?.fixtureProfiles,
    sendDashboardUpdate,
    clearTrackingForFixtures
  ]);

  const addCueToActiveList = useCallback(async () => {
    if (!activeCueList || !config || !activeLayout) return;
    const normalizedCueNumber = normalizeCueNumber(addCueNumberInput);
    if (!normalizedCueNumber) {
      setCueUiError('Cue number must be numeric (point cues like 1.5 are allowed).');
      return;
    }
    if (!isCueNumberUnique(activeCueList, null, normalizedCueNumber)) {
      setCueUiError(`Cue ${normalizedCueNumber} already exists in this cue list.`);
      return;
    }

    try {
      const capturedTargets = captureCurrentCueTargets();
      const cueId = `cue-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const cueName = (addCueNameInput || `Cue ${normalizedCueNumber}`).trim();
      const defaultTransitionTime = Number.isFinite(Number(activeCueList.defaultNewCueTransitionTime))
        ? Math.max(0, Number(activeCueList.defaultNewCueTransitionTime))
        : 5;

      const result = await persistCueListUpdate((cueList) => {
        if (!Array.isArray(cueList.cues)) cueList.cues = [];
        cueList.cues.push({
          id: cueId,
          number: normalizedCueNumber,
          name: cueName,
          fadeTime: defaultTransitionTime,
          targets: capturedTargets
        });
        return true;
      });
      if (result.success) {
        setSelectedCueId(cueId);
        setEditingCueId(cueId);
        setShowAddCueModal(false);
        setAddCueNumberInput('');
        setAddCueNameInput('');
        setCueUiError('');
      }
    } catch (error) {
      console.error('Failed to add cue:', error);
    }
  }, [
    activeCueList,
    config,
    activeLayout,
    addCueNumberInput,
    addCueNameInput,
    normalizeCueNumber,
    isCueNumberUnique,
    captureCurrentCueTargets,
    persistCueListUpdate
  ]);

  const saveCueEdits = useCallback(async (cueId) => {
    if (!activeCueList || !cueId) return;
    const rawNumber = cueNumberDrafts[cueId];
    const normalizedValue = normalizeCueNumber(rawNumber);
    if (!normalizedValue) {
      setCueUiError('Cue number must be numeric (point cues like 1.5 are allowed).');
      const cue = activeCueList.cues?.find(item => item.id === cueId);
      setCueNumberDrafts(prev => ({ ...prev, [cueId]: String(cue?.number ?? '') }));
      return;
    }

    if (!isCueNumberUnique(activeCueList, cueId, normalizedValue)) {
      setCueUiError(`Cue ${normalizedValue} already exists in this cue list.`);
      const cue = activeCueList.cues?.find(item => item.id === cueId);
      setCueNumberDrafts(prev => ({ ...prev, [cueId]: String(cue?.number ?? '') }));
      return;
    }

    const cueName = String(cueNameDrafts[cueId] ?? '').trim();
    if (!cueName) {
      setCueUiError('Cue name cannot be empty.');
      const cue = activeCueList.cues?.find(item => item.id === cueId);
      setCueNameDrafts(prev => ({ ...prev, [cueId]: String(cue?.name ?? '') }));
      return;
    }

    const rawFadeValue = cueFadeDrafts[cueId];
    const numericFade = Number(rawFadeValue);
    if (!Number.isFinite(numericFade) || numericFade < 0) {
      setCueUiError('Cue time must be 0 or greater.');
      const cue = activeCueList.cues?.find(item => item.id === cueId);
      setCueFadeDrafts(prev => ({ ...prev, [cueId]: String(Number.isFinite(Number(cue?.fadeTime)) ? cue.fadeTime : 0) }));
      return;
    }
    const clampedFade = Math.round(Math.max(0, numericFade) * 1000) / 1000;

    const cue = activeCueList.cues?.find(item => item.id === cueId);
    if (!cue) return;
    if (
      normalizeCueNumber(cue.number) === normalizedValue
      && String(cue.name ?? '').trim() === cueName
      && Number(cue.fadeTime || 0) === clampedFade
    ) {
      setCueUiError('');
      setEditingCueId(null);
      return;
    }

    const result = await persistCueListUpdate((cueList) => {
      const cueInConfig = (cueList.cues || []).find(item => item.id === cueId);
      if (!cueInConfig) return false;
      cueInConfig.number = normalizedValue;
      cueInConfig.name = cueName;
      cueInConfig.fadeTime = clampedFade;
      return true;
    });

    if (result.success) {
      setCueUiError('');
      setCueNumberDrafts(prev => ({ ...prev, [cueId]: normalizedValue }));
      setCueNameDrafts(prev => ({ ...prev, [cueId]: cueName }));
      setCueFadeDrafts(prev => ({ ...prev, [cueId]: String(clampedFade) }));
      setEditingCueId(null);
    }
  }, [
    activeCueList,
    cueNumberDrafts,
    cueNameDrafts,
    cueFadeDrafts,
    normalizeCueNumber,
    isCueNumberUnique,
    persistCueListUpdate
  ]);

  const deleteCue = useCallback(async (cueId) => {
    if (!activeCueList || !cueId) return;
    const cue = activeCueList.cues?.find(item => item.id === cueId);
    if (!cue) return;
    const wasActive = activeCue?.id === cueId;

    const result = await persistCueListUpdate((cueList) => {
      cueList.cues = (cueList.cues || []).filter(item => item.id !== cueId);
      return true;
    });

    if (result.success) {
      setCueNumberDrafts(prev => {
        const next = { ...prev };
        delete next[cueId];
        return next;
      });
      setCueNameDrafts(prev => {
        const next = { ...prev };
        delete next[cueId];
        return next;
      });
      setCueFadeDrafts(prev => {
        const next = { ...prev };
        delete next[cueId];
        return next;
      });
      if (selectedCueId === cueId) {
        setSelectedCueId(null);
      }
      setEditingCueId(null);
      setCueUiError('');
      if (wasActive) {
        goCueHome();
      }
    }
  }, [activeCueList, activeCue?.id, selectedCueId, persistCueListUpdate, goCueHome]);

  useEffect(() => {
    if (!canControlCues || !activeCueList || !Array.isArray(activeCueList.cues) || activeCueList.cues.length === 0) {
      return undefined;
    }

    const handleCueHotkeys = (event) => {
      const isSpace = event.code === 'Space' || event.key === ' ';
      if (!isSpace) return;

      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      const isTextInputContext =
        target?.isContentEditable
        || tagName === 'input'
        || tagName === 'textarea'
        || tagName === 'select'
        || Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
      if (isTextInputContext) return;
      if (showGoToCueModal || showAddCueModal || showFixtureEditor || showLookEditor) return;

      if (event.altKey && cueShortcutSettings.enableOptionSpacebarBackPause) {
        event.preventDefault();
        handleCuePauseOrBack();
        return;
      }

      if (event.shiftKey && cueShortcutSettings.enableShiftSpacebarFastGo) {
        event.preventDefault();
        handleCueGo({ fastGo: true });
        return;
      }

      if (cueShortcutSettings.enableSpacebarGo) {
        event.preventDefault();
        handleCueGo();
      }
    };

    window.addEventListener('keydown', handleCueHotkeys);
    return () => window.removeEventListener('keydown', handleCueHotkeys);
  }, [
    canControlCues,
    activeCueList,
    cueShortcutSettings.enableSpacebarGo,
    cueShortcutSettings.enableShiftSpacebarFastGo,
    cueShortcutSettings.enableOptionSpacebarBackPause,
    handleCueGo,
    handleCuePauseOrBack,
    showGoToCueModal,
    showAddCueModal,
    showFixtureEditor,
    showLookEditor
  ]);

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
        const visibleItems = (section.items || [])
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const isCueSection = section.type === 'static' && section.staticType === 'cues';

        if (!isCueSection && visibleItems.length === 0) return null;

        // Determine if this is a looks-only, fixtures-only, or cues section
        const hasLooks = visibleItems.some(item => item.type === 'look');
        const hasFixtures = visibleItems.some(item => item.type === 'fixture');
        const isLooksOnly = hasLooks && !hasFixtures;
        const isFixturesOnly = hasFixtures && !hasLooks;
        const cueList = activeCueList;

        return (
          <div key={section.id} className="card">
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: isCueSection && isCompactCueLayout ? 'flex-start' : 'center',
              flexWrap: isCueSection ? 'wrap' : 'nowrap',
              gap: isCueSection && isCompactCueLayout ? '10px' : '0',
              marginBottom: '16px'
            }}>
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
                    title="Edit looks"
                    aria-label="Edit looks"
                  >
                    ✎
                  </button>
                )}
              </div>
              {isCueSection ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  width: isCompactCueLayout ? '100%' : 'auto',
                  justifyContent: isCompactCueLayout ? 'flex-start' : 'flex-end'
                }}>
                  <button
                    className="btn btn-small"
                    onClick={handleCuePauseOrBack}
                    disabled={!canControlCues || !cueList || cueList.cues.length === 0}
                    style={{
                      padding: '10px 14px',
                      fontSize: '13px',
                      background: '#2f2f2f',
                      border: '1px solid #555',
                      opacity: (!canControlCues || !cueList || cueList.cues.length === 0) ? 0.5 : 1,
                      cursor: (!canControlCues || !cueList || cueList.cues.length === 0) ? 'not-allowed' : 'pointer',
                      minWidth: isMobileCueLayout ? '96px' : '110px'
                    }}
                  >
                    {isCueTransitioning ? '⏸ Pause' : '◀ Back'}
                  </button>
                  <button
                    className="btn btn-small"
                    onClick={handleCueGo}
                    disabled={!canControlCues || !cueList || cueList.cues.length === 0}
                    style={{
                      padding: '10px 20px',
                      fontSize: '18px',
                      fontWeight: 700,
                      letterSpacing: '0.5px',
                      background: '#3f7f3f',
                      border: '1px solid #6bcf6b',
                      color: '#f4fff4',
                      opacity: (!canControlCues || !cueList || cueList.cues.length === 0) ? 0.5 : 1,
                      cursor: (!canControlCues || !cueList || cueList.cues.length === 0) ? 'not-allowed' : 'pointer',
                      minWidth: isMobileCueLayout ? '104px' : '120px'
                    }}
                  >
                    {cueGoButtonLabel}
                  </button>
                </div>
              ) : section.showClearButton && (() => {
                const fixtureItems = visibleItems.filter(item => item.type === 'fixture');
                const lookItems = visibleItems.filter(item => item.type === 'look');

                return (
                  <button
                    className="btn btn-small"
                    onClick={() => {
                      if (isLooksOnly) {
                        handleClearAllLooks(lookItems.map(item => item.id));
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

            {isCueSection ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {!cueList && (
                  <div style={{ padding: '12px', border: '1px solid #444', borderRadius: '8px', color: '#aaa', fontSize: '13px' }}>
                    No cue list is assigned to this dashboard.
                  </div>
                )}
                {cueList && (
                  <>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: isCompactCueLayout ? 'flex-start' : 'flex-end',
                      flexDirection: isCompactCueLayout ? 'column' : 'row',
                      gap: '10px',
                      flexWrap: 'wrap'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: '#dce9ff' }}>{cueList.name}</div>
                        <div style={{ fontSize: '12px', color: activeCue && cuePlayback.status !== 'stopped' ? '#7de89a' : '#8a919e' }}>
                          {activeCue && cuePlayback.status !== 'stopped'
                            ? `Active Cue: ${activeCue.number || activeCueIndex + 1} | ${activeCue.name || `Cue ${activeCueIndex + 1}`}`
                            : 'Active Cue: Cue Out'}
                        </div>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                        width: isCompactCueLayout ? '100%' : 'auto',
                        justifyContent: isCompactCueLayout ? 'flex-start' : 'flex-end'
                      }}>
                        <button
                          className="btn btn-small"
                          onClick={goCueHome}
                          disabled={!canControlCues}
                          style={{
                            padding: '6px 10px',
                            fontSize: '12px',
                            background: '#7a2424',
                            border: '1px solid #bf5555',
                            color: '#ffe9e9',
                            opacity: !canControlCues ? 0.5 : 1,
                            cursor: !canControlCues ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Cue Out
                        </button>
                        <button
                          className="btn btn-small"
                          onClick={openGoToCueModal}
                          disabled={!canControlCues || cueList.cues.length === 0}
                          style={{
                            padding: '6px 10px',
                            fontSize: '12px',
                            background: '#2f2f2f',
                            border: '1px solid #555',
                            opacity: (!canControlCues || cueList.cues.length === 0) ? 0.5 : 1,
                            cursor: (!canControlCues || cueList.cues.length === 0) ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Go to Cue
                        </button>
                        <button
                          className="btn btn-small"
                          onClick={updateActiveCue}
                          disabled={!canRecordCues || !activeCue || !hasActiveCueOverrides}
                          style={{
                            padding: '6px 10px',
                            fontSize: '12px',
                            background: (canRecordCues && activeCue && hasActiveCueOverrides) ? '#2f5f8f' : '#3a3a3a',
                            border: (canRecordCues && activeCue && hasActiveCueOverrides) ? '1px solid #5a89bf' : '1px solid #666',
                            color: (canRecordCues && activeCue && hasActiveCueOverrides) ? '#e5f1ff' : '#9ca3ad',
                            opacity: (!canRecordCues || !activeCue || !hasActiveCueOverrides) ? 0.5 : 1,
                            cursor: (!canRecordCues || !activeCue || !hasActiveCueOverrides) ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Update Active Cue
                        </button>
                        <button
                          className="btn btn-small"
                          onClick={openAddCueModal}
                          disabled={!canRecordCues}
                          style={{
                            padding: '6px 10px',
                            fontSize: '12px',
                            background: '#2f4f2f',
                            border: '1px solid #4a7',
                            color: '#d7ffd7',
                            opacity: !canRecordCues ? 0.5 : 1,
                            cursor: !canRecordCues ? 'not-allowed' : 'pointer'
                          }}
                        >
                          + Add Cue
                        </button>
                      </div>
                    </div>
                    {cueUiError && (
                      <div
                        style={{
                          padding: '9px 10px',
                          borderRadius: '8px',
                          border: '1px solid #8a3a3a',
                          background: '#321a1a',
                          color: '#ffbfbf',
                          fontSize: '12px'
                        }}
                      >
                        {cueUiError}
                      </div>
                    )}

                    {cueList.cues.length === 0 ? (
                      <div style={{ padding: '12px', border: '1px solid #444', borderRadius: '8px', color: '#aaa', fontSize: '13px' }}>
                        No cues yet. Add a cue and record values.
                      </div>
                    ) : (
                      <div
                        style={{
                          border: '1px solid #444',
                          borderRadius: '10px',
                          background: '#1f1f1f',
                          padding: '8px'
                        }}
                      >
                        <div
                          ref={cueListScrollContainerRef}
                          style={{
                            height: isCompactCueLayout
                              ? (isMobileCueLayout ? 'clamp(240px, 42vh, 330px)' : 'clamp(300px, 46vh, 390px)')
                              : '430px',
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            paddingRight: '4px'
                          }}
                        >
                          {cueList.cues.map((cue, cueIndex) => {
                          const isActiveCue = activeCueIndex === cueIndex && cuePlayback.status !== 'stopped';
                          const isSelectedCue = selectedCue?.id === cue.id;
                          const isPausedCue = isActiveCue && cuePlayback.status === 'paused';
                          const canEditCue = canRecordCues;
                          const isEditingCue = editingCueId === cue.id;
                          const cueNumberValue = Object.prototype.hasOwnProperty.call(cueNumberDrafts, cue.id)
                            ? cueNumberDrafts[cue.id]
                            : String(cue.number ?? '');
                          const cueNameValue = Object.prototype.hasOwnProperty.call(cueNameDrafts, cue.id)
                            ? cueNameDrafts[cue.id]
                            : String(cue.name ?? '');
                          const cueFadeValue = Object.prototype.hasOwnProperty.call(cueFadeDrafts, cue.id)
                            ? cueFadeDrafts[cue.id]
                            : String(Number.isFinite(Number(cue.fadeTime)) ? cue.fadeTime : 0);
                          const showTransitionFill = isActiveCue
                            && cueTransitionProgress > 0
                            && (isCueTransitioning || isPausedCue);
                          const cueStatusLabel = isActiveCue
                            ? (cuePlayback.status === 'paused' ? 'PAUSED' : (isCueTransitioning ? 'TRANSITIONING' : 'ACTIVE'))
                            : (isSelectedCue ? 'SELECTED' : '');

                          return (
                            <div
                              key={cue.id}
                              ref={(node) => setCueRowRef(cue.id, node)}
                              onClick={() => setSelectedCueId(cue.id)}
                              style={{
                                position: 'relative',
                                overflow: 'hidden',
                                padding: isMobileCueLayout ? '8px' : '8px 10px',
                                flexShrink: 0,
                                borderRadius: '10px',
                                border: `2px solid ${isActiveCue ? CUE_ACCENT_COLOR : (isSelectedCue ? '#f0f0f0' : '#444')}`,
                                background: isActiveCue ? '#2a3f5a' : '#262626',
                                cursor: 'pointer'
                              }}
                            >
                              {showTransitionFill && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    bottom: 0,
                                    width: `${Math.max(0, Math.min(1, cueTransitionProgress)) * 100}%`,
                                    background: 'linear-gradient(90deg, rgba(123,183,255,0.16), rgba(123,183,255,0.35))',
                                    animation: isCueTransitioning ? 'cueTransitionFillPulse 1s ease-in-out infinite' : 'none',
                                    pointerEvents: 'none'
                                  }}
                                />
                              )}

                              <div
                                style={{
                                  position: 'relative',
                                  zIndex: 1,
                                  display: 'grid',
                                  gridTemplateColumns: isCompactCueLayout
                                    ? `${isMobileCueLayout ? '74px' : '84px'} minmax(0, 1fr)`
                                    : '84px minmax(140px, 1fr) 86px 150px auto',
                                  gridTemplateAreas: isCompactCueLayout
                                    ? '"number name" "status time" "actions actions"'
                                    : 'none',
                                  alignItems: 'center',
                                  gap: '8px'
                                }}
                              >
                                {isEditingCue ? (
                                  <input
                                    type="text"
                                    value={cueNumberValue}
                                    onChange={(e) => setCueNumberDrafts(prev => ({ ...prev, [cue.id]: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        saveCueEdits(cue.id);
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    disabled={!canEditCue}
                                    style={{
                                      width: isMobileCueLayout ? '74px' : '84px',
                                      gridArea: isCompactCueLayout ? 'number' : undefined,
                                      background: '#111b35',
                                      border: '1px solid #3a4d76',
                                      borderRadius: '4px',
                                      color: '#e7f0ff',
                                      padding: '6px 8px',
                                      fontSize: '13px',
                                      opacity: canEditCue ? 1 : 0.6
                                    }}
                                  />
                                ) : (
                                  <span style={{
                                    display: 'inline-block',
                                    width: isMobileCueLayout ? '74px' : '84px',
                                    gridArea: isCompactCueLayout ? 'number' : undefined,
                                    background: '#111b35',
                                    border: '1px solid #3a4d76',
                                    borderRadius: '4px',
                                    color: '#e7f0ff',
                                    padding: '6px 8px',
                                    fontSize: '13px',
                                    boxSizing: 'border-box'
                                  }}>
                                    {cue.number || cueIndex + 1}
                                  </span>
                                )}

                                {isEditingCue ? (
                                  <input
                                    type="text"
                                    value={cueNameValue}
                                    onChange={(e) => setCueNameDrafts(prev => ({ ...prev, [cue.id]: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        saveCueEdits(cue.id);
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    disabled={!canEditCue}
                                    style={{
                                      width: '100%',
                                      gridArea: isCompactCueLayout ? 'name' : undefined,
                                      background: '#111b35',
                                      border: '1px solid #3a4d76',
                                      borderRadius: '4px',
                                      color: '#f0f0f0',
                                      padding: '6px 8px',
                                      fontSize: '14px',
                                      opacity: canEditCue ? 1 : 0.6
                                    }}
                                  />
                                ) : (
                                  <span style={{
                                    gridArea: isCompactCueLayout ? 'name' : undefined,
                                    fontSize: '14px',
                                    color: '#f0f0f0',
                                    minWidth: 0,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}>
                                    {cue.name || `Cue ${cueIndex + 1}`}
                                  </span>
                                )}

                                <span style={{
                                  gridArea: isCompactCueLayout ? 'status' : undefined,
                                  fontSize: '11px',
                                  color: '#d2e7ff',
                                  letterSpacing: '0.5px',
                                  textAlign: isCompactCueLayout ? 'left' : 'center'
                                }}>
                                  {cueStatusLabel}
                                </span>

                                {isEditingCue ? (
                                  <div style={{
                                    gridArea: isCompactCueLayout ? 'time' : undefined,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: isCompactCueLayout ? 'flex-start' : 'flex-start',
                                    gap: '6px',
                                    minWidth: 0
                                  }}>
                                    <span style={{ fontSize: '12px', color: '#9fb5cf' }}>Time</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.1"
                                      value={cueFadeValue}
                                      onChange={(e) => setCueFadeDrafts(prev => ({ ...prev, [cue.id]: e.target.value }))}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          saveCueEdits(cue.id);
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      disabled={!canEditCue}
                                      style={{
                                        width: '70px',
                                        background: '#111b35',
                                        border: '1px solid #3a4d76',
                                        borderRadius: '4px',
                                        color: '#e7f0ff',
                                        padding: '6px 8px',
                                        fontSize: '13px',
                                        opacity: canEditCue ? 1 : 0.6
                                      }}
                                    />
                                    <span style={{ fontSize: '12px', color: '#9fb5cf' }}>s</span>
                                  </div>
                                ) : (
                                  <div style={{
                                    gridArea: isCompactCueLayout ? 'time' : undefined,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: isCompactCueLayout ? 'flex-start' : 'flex-start',
                                    gap: '6px',
                                    minWidth: 0
                                  }}>
                                    <span style={{ fontSize: '12px', color: '#9fb5cf' }}>Time</span>
                                    <span style={{ fontSize: '13px', color: '#e7f0ff' }}>{cueFadeValue}</span>
                                    <span style={{ fontSize: '12px', color: '#9fb5cf' }}>s</span>
                                  </div>
                                )}

                                <div style={{
                                  gridArea: isCompactCueLayout ? 'actions' : undefined,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: isCompactCueLayout ? 'flex-start' : 'flex-start',
                                  flexWrap: 'wrap',
                                  gap: '6px',
                                  justifySelf: isCompactCueLayout ? 'stretch' : 'end'
                                }}>
                                  {isEditingCue ? (
                                    <>
                                      <button
                                        className={`btn btn-small record-btn ${recordingCueId === cue.id ? 'recording' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          recordCue(cue.id);
                                        }}
                                        disabled={!canEditCue}
                                        style={{
                                          padding: '6px 10px',
                                          fontSize: '12px',
                                          background: '#444',
                                          border: '1px solid #666',
                                          opacity: canEditCue ? 1 : 0.5,
                                          cursor: canEditCue ? 'pointer' : 'not-allowed'
                                        }}
                                      >
                                        ● Rec
                                      </button>
                                      <button
                                        className="btn btn-small"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          saveCueEdits(cue.id);
                                        }}
                                        disabled={!canEditCue}
                                        style={{
                                          padding: '6px 8px',
                                          fontSize: '11px',
                                          background: '#2f5f8f',
                                          border: '1px solid #5a89bf',
                                          opacity: canEditCue ? 1 : 0.5,
                                          cursor: canEditCue ? 'pointer' : 'not-allowed'
                                        }}
                                      >
                                        Save
                                      </button>
                                      <button
                                        className="btn btn-small"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          deleteCue(cue.id);
                                        }}
                                        disabled={!canEditCue}
                                        style={{
                                          padding: '6px 8px',
                                          fontSize: '11px',
                                          background: '#7a2424',
                                          border: '1px solid #bf5555',
                                          color: '#ffe9e9',
                                          opacity: canEditCue ? 1 : 0.5,
                                          cursor: canEditCue ? 'pointer' : 'not-allowed'
                                        }}
                                      >
                                        Del
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="btn btn-small"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!canEditCue) return;
                                        setEditingCueId(cue.id);
                                      }}
                                      disabled={!canEditCue}
                                      style={{
                                        padding: '6px 8px',
                                        fontSize: '11px',
                                        background: '#2f2f2f',
                                        border: '1px solid #555',
                                        opacity: canEditCue ? 1 : 0.5,
                                        cursor: canEditCue ? 'pointer' : 'not-allowed'
                                      }}
                                      >
                                        Edit
                                      </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : visibleItems.map(item => {
              if (item.type === 'look') {
                const look = (config.looks || []).find(l => l && l.id === item.id);
                if (!look) return null;
                if (look.dashboardId && look.dashboardId !== activeLayout.id) return null;
                const lookLevel = state.looks[look.id] || 0;
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
                            {lookIsActive ? 'On' : 'Off'}
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
                          width: '56px',
                          height: '32px',
                          borderRadius: '16px',
                          border: 'none',
                          position: 'relative',
                          padding: 0,
                          background: lookIsActive ? lookAccent : '#333',
                          opacity: isViewer ? 0.5 : 1,
                          cursor: isViewer ? 'not-allowed' : 'pointer',
                          flexShrink: 0,
                          alignSelf: 'flex-end',
                          marginBottom: '6px',
                          transition: 'background 0.2s'
                        }}
                        title={lookIsActive ? 'Turn look off' : 'Turn look on'}
                        aria-label={lookIsActive ? 'On' : 'Off'}
                      >
                        <div
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: '#fff',
                            position: 'absolute',
                            top: '4px',
                            left: lookIsActive ? '28px' : '4px',
                            transition: 'left 0.2s',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.25)'
                          }}
                        />
                      </button>
                    )}
                    {look.showRecordButton && (
                      <button
                        className={`btn btn-small record-btn ${recordingLook === look.id ? 'recording' : ''}`}
                        onClick={() => handleRecordLook(look.id)}
                        disabled={!canRecordLooks}
                        style={{
                          padding: '6px 10px',
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                          background: '#444',
                          border: '1px solid #666',
                          opacity: canRecordLooks ? 1 : 0.5,
                          cursor: canRecordLooks ? 'pointer' : 'not-allowed'
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
                      const r = Math.round(getDisplayedChannelValue(fixture.id, redComp.name) * 2.55);
                      const g = Math.round(getDisplayedChannelValue(fixture.id, greenComp.name) * 2.55);
                      const b = Math.round(getDisplayedChannelValue(fixture.id, blueComp.name) * 2.55);
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
                    const displayedIntensity = getDisplayedChannelValue(fixture.id, intensityChannelName);
                    brightnessValue = displayedIntensity;
                    intensityDisplayValue = displayedIntensity;
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
                        r: getDisplayedChannelValue(fixture.id, rgbChannelMap.red),
                        g: getDisplayedChannelValue(fixture.id, rgbChannelMap.green),
                        b: getDisplayedChannelValue(fixture.id, rgbChannelMap.blue)
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
                  const hasActiveCue = Boolean(activeCueForFixture);
                  const isCueAlreadyOverridden = Boolean(state.cueOverrides?.[fixture.id]?.active);
                  const turningOff = brightnessValue > 0;

                  // If looks/cues are active, toggle-on should return this fixture to automation control.
                  if (!turningOff && (hasActiveLooks || hasActiveCue)) {
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
                      },
                      cueOverrides: {
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
                    if (!turningOff && !hasActiveLooks && !hasActiveCue && isStrictDimmerColor && redComp && greenComp && blueComp) {
                      const fixtureState = state.fixtures?.[fixture.id] || {};
                      const currentRed = fixtureState[redComp.name] ?? 0;
                      const currentGreen = fixtureState[greenComp.name] ?? 0;
                      const currentBlue = fixtureState[blueComp.name] ?? 0;
                      const displayedRed = getDisplayedChannelValue(fixture.id, redComp.name);
                      const displayedGreen = getDisplayedChannelValue(fixture.id, greenComp.name);
                      const displayedBlue = getDisplayedChannelValue(fixture.id, blueComp.name);
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

                  const shouldSnapshotForLook = hasActiveLooks && !isFixtureAlreadyOverridden;
                  const shouldSnapshotForCue = hasActiveCue && !isCueAlreadyOverridden;
                  const fixtureValues = (shouldSnapshotForLook || shouldSnapshotForCue)
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
                    } : undefined,
                    cueOverrides: hasActiveCue ? {
                      [fixture.id]: {
                        active: true,
                        dashboardId: activeCueForFixture.dashboardId,
                        cueListId: activeCueForFixture.cueListId,
                        cueId: activeCueForFixture.cueId
                      }
                    } : undefined
                  });
                };

                // Check if fixture is in override mode (from server state)
                const isFixtureOverridden = state.overriddenFixtures?.[fixture.id]?.active;
                const activeCueForFixture = getActiveCueForFixture(fixture.id);
                const hasActiveCueForFixture = Boolean(activeCueForFixture);
                const isCueOverridden = state.cueOverrides?.[fixture.id]?.active;
                const isAnyOverrideActive = Boolean(isFixtureOverridden || isCueOverridden);

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
                                  background: isAnyOverrideActive ? '#666' : (LOOK_COLOR_MAP[contributor.color] || '#4a90e2'),
                                  opacity: isAnyOverrideActive ? 0.7 : (0.5 + ((contributor.value || 0) / 100) * 0.5),
                                  flexShrink: 0
                                }}
                              />
                            ))}
                          </div>
                        )}
                        {hasActiveCueForFixture && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minWidth: '16px',
                              height: '16px',
                              borderRadius: '6px',
                              padding: '0 4px',
                              fontSize: '10px',
                              fontWeight: 700,
                              letterSpacing: '0.4px',
                              color: isCueOverridden ? '#ddd' : '#081a33',
                              background: isCueOverridden ? '#666' : CUE_ACCENT_COLOR,
                              border: `1px solid ${isCueOverridden ? '#777' : '#b6d8ff'}`,
                              flexShrink: 0
                            }}
                            title={isCueOverridden ? 'Cue overridden' : 'Cue active'}
                          >
                            C
                          </span>
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
                              const hasActiveCue = Boolean(activeCueForFixture);
                              const isCueAlreadyOverridden = Boolean(state.cueOverrides?.[fixture.id]?.active);

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

                              if (hasActiveLooks || hasActiveCue) {
                                setChannelOverrides(prev => ({ ...prev, [intensityChannelName]: true }));
                              }

                              const rgbControlCount = (profile.controls || []).filter(c => c.controlType === 'RGB' || c.controlType === 'RGBW').length;
                              const intensityControlCount = (profile.controls || []).filter(c => c.controlType === 'Intensity').length;
                              const isLegacyDimmerRgbProfile = intensityControlCount === 1 && rgbControlCount === 1 && (profile.controls || []).length === 2;
                              const isStrictDimmerColor = Boolean(rgbControl?.brightnessDrivenByIntensity) || isLegacyDimmerRgbProfile;
                              const seededRgbChannels = {};
                              if (!hasActiveLooks && !hasActiveCue && isStrictDimmerColor && value > 0 && redComp && greenComp && blueComp) {
                                const fixtureState = state.fixtures?.[fixture.id] || {};
                                const currentRed = fixtureState[redComp.name] ?? 0;
                                const currentGreen = fixtureState[greenComp.name] ?? 0;
                                const currentBlue = fixtureState[blueComp.name] ?? 0;
                                const displayedRed = getDisplayedChannelValue(fixture.id, redComp.name);
                                const displayedGreen = getDisplayedChannelValue(fixture.id, greenComp.name);
                                const displayedBlue = getDisplayedChannelValue(fixture.id, blueComp.name);
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

                              const shouldSnapshotForLook = hasActiveLooks && !isFixtureAlreadyOverridden;
                              const shouldSnapshotForCue = hasActiveCue && !isCueAlreadyOverridden;
                              const fixtureValues = (shouldSnapshotForLook || shouldSnapshotForCue)
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
                                } : undefined,
                                cueOverrides: hasActiveCue ? {
                                  [fixture.id]: {
                                    active: true,
                                    dashboardId: activeCueForFixture.dashboardId,
                                    cueListId: activeCueForFixture.cueListId,
                                    cueId: activeCueForFixture.cueId
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
                              const hasActiveCue = Boolean(activeCueForFixture);
                              const isCueAlreadyOverridden = Boolean(state.cueOverrides?.[fixture.id]?.active);

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

                              if (hasActiveLooks || hasActiveCue) {
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
                              const shouldSnapshotForLook = hasActiveLooks && !isFixtureAlreadyOverridden;
                              const shouldSnapshotForCue = hasActiveCue && !isCueAlreadyOverridden;
                              const fixtureValues = (shouldSnapshotForLook || shouldSnapshotForCue)
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
                                } : undefined,
                                cueOverrides: hasActiveCue ? {
                                  [fixture.id]: {
                                    active: true,
                                    dashboardId: activeCueForFixture.dashboardId,
                                    cueListId: activeCueForFixture.cueListId,
                                    cueId: activeCueForFixture.cueId
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

      {showGoToCueModal && (
        <div
          onClick={() => setShowGoToCueModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2300,
            padding: '20px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '420px',
              background: '#222',
              border: '1px solid #444',
              borderRadius: '12px',
              padding: '16px'
            }}
          >
            <h3 style={{ margin: '0 0 10px 0' }}>Go to Cue</h3>
            <p style={{ margin: '0 0 12px 0', color: '#aaa', fontSize: '13px' }}>
              Enter a cue number (point cues like 5.5 are supported).
            </p>
            <input
              type="text"
              value={goToCueInput}
              onChange={(e) => setGoToCueInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  goToCueByNumber();
                }
              }}
              autoFocus
              style={{
                width: '100%',
                background: '#111b35',
                border: '1px solid #3a4d76',
                borderRadius: '6px',
                color: '#e7f0ff',
                padding: '10px',
                fontSize: '14px',
                marginBottom: '14px'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                className="btn btn-small"
                onClick={() => setShowGoToCueModal(false)}
                style={{ padding: '6px 12px', fontSize: '12px', background: '#444', border: '1px solid #666' }}
              >
                Cancel
              </button>
              <button
                className="btn btn-small"
                onClick={() => goToCueByNumber()}
                style={{ padding: '6px 12px', fontSize: '12px', background: '#2f5f8f', border: '1px solid #5a89bf' }}
              >
                Go
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddCueModal && (
        <div
          onClick={() => setShowAddCueModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2300,
            padding: '20px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '460px',
              background: '#222',
              border: '1px solid #444',
              borderRadius: '12px',
              padding: '16px'
            }}
          >
            <h3 style={{ margin: '0 0 10px 0' }}>Add Cue</h3>
            <p style={{ margin: '0 0 12px 0', color: '#aaa', fontSize: '13px' }}>
              New cues record current fixture values at the cue number you enter.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ color: '#9fb5cf', fontSize: '12px' }}>Cue Number</label>
              <input
                type="text"
                value={addCueNumberInput}
                onChange={(e) => setAddCueNumberInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addCueToActiveList();
                  }
                }}
                autoFocus
                style={{
                  width: '100%',
                  background: '#111b35',
                  border: '1px solid #3a4d76',
                  borderRadius: '6px',
                  color: '#e7f0ff',
                  padding: '9px 10px',
                  fontSize: '14px'
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
              <label style={{ color: '#9fb5cf', fontSize: '12px' }}>Cue Name</label>
              <input
                type="text"
                value={addCueNameInput}
                onChange={(e) => setAddCueNameInput(e.target.value)}
                placeholder={`Cue ${addCueNumberInput || ''}`}
                style={{
                  width: '100%',
                  background: '#111b35',
                  border: '1px solid #3a4d76',
                  borderRadius: '6px',
                  color: '#e7f0ff',
                  padding: '9px 10px',
                  fontSize: '14px'
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                className="btn btn-small"
                onClick={() => setShowAddCueModal(false)}
                style={{ padding: '6px 12px', fontSize: '12px', background: '#444', border: '1px solid #666' }}
              >
                Cancel
              </button>
              <button
                className="btn btn-small"
                onClick={addCueToActiveList}
                style={{ padding: '6px 12px', fontSize: '12px', background: '#2f4f2f', border: '1px solid #4a7', color: '#d7ffd7' }}
              >
                Add Cue
              </button>
            </div>
          </div>
        </div>
      )}

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

            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-small"
                onClick={() => goToSettingsTab('patching')}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  background: '#2f2f2f',
                  border: '1px solid #555',
                  cursor: 'pointer'
                }}
              >
                Patch
              </button>
              <button
                className="btn btn-small"
                onClick={() => goToSettingsTab('profiles')}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  background: '#2f2f2f',
                  border: '1px solid #555',
                  cursor: 'pointer'
                }}
              >
                Fixture Editor
              </button>
              <button
                className="btn btn-small"
                onClick={() => goToSettingsTab('showlayout')}
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  background: '#2f2f2f',
                  border: '1px solid #555',
                  cursor: 'pointer'
                }}
              >
                Dashboard Settings
              </button>
            </div>

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
              maxWidth: '920px',
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
              Manage looks for this dashboard only. You can rename/reorder looks, choose color, record values, show or hide the dashboard rec button, and edit target values.
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', color: '#888' }}>{lookEditorDraft.length} look{lookEditorDraft.length === 1 ? '' : 's'}</span>
              <button
                className="btn btn-small"
                onClick={addLookToEditor}
                disabled={lookEditorSaving}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: '#2f4f2f',
                  border: '1px solid #4a7',
                  color: '#d7ffd7',
                  opacity: lookEditorSaving ? 0.5 : 1,
                  cursor: lookEditorSaving ? 'not-allowed' : 'pointer'
                }}
              >
                + Add Look
              </button>
            </div>

            {lookEditorDraft.length === 0 ? (
              <div style={{ padding: '10px', border: '1px solid #444', borderRadius: '6px', color: '#aaa', fontSize: '13px' }}>
                No looks in this dashboard yet.
              </div>
            ) : (
              lookEditorDraft.map((lookItem, index) => (
                <div
                  key={lookItem.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    padding: '10px',
                    border: '1px solid #3d3d3d',
                    borderRadius: '6px',
                    marginBottom: '8px',
                    background: '#1e1e1e',
                    boxShadow: lookItem.expanded ? '0 0 0 1px #4a90e255 inset' : 'none'
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto auto auto', gap: '8px', alignItems: 'center' }}>
                    <div style={{ textAlign: 'center', color: '#888', fontSize: '12px' }}>
                      {index + 1}
                    </div>
                    <input
                      type="text"
                      value={lookItem.name}
                      onChange={(e) => updateLookDraftField(lookItem.id, 'name', e.target.value)}
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
                    <button
                      className="btn btn-small btn-danger"
                      onClick={() => removeLookFromEditor(lookItem.id)}
                      disabled={lookEditorSaving}
                      style={{
                        width: '36px',
                        padding: '4px 0',
                        fontSize: '12px',
                        background: '#6f2323',
                        border: '1px solid #a44',
                        opacity: lookEditorSaving ? 0.4 : 1,
                        cursor: lookEditorSaving ? 'not-allowed' : 'pointer'
                      }}
                      title="Delete look"
                    >
                      ×
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: '#aaa' }}>Color:</span>
                    {LOOK_COLORS.map(color => (
                      <button
                        key={`${lookItem.id}-${color.id}`}
                        onClick={() => updateLookDraftField(lookItem.id, 'color', color.id)}
                        disabled={lookEditorSaving}
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          background: color.hex,
                          border: lookItem.color === color.id ? '2px solid #fff' : '1px solid #444',
                          cursor: lookEditorSaving ? 'not-allowed' : 'pointer',
                          opacity: lookEditorSaving ? 0.5 : 1
                        }}
                        title={color.name}
                      />
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '12px', color: '#aaa' }}>UI Type:</label>
                    <select
                      value={lookItem.lookUiMode || 'slider'}
                      onChange={(e) => updateLookDraftField(lookItem.id, 'lookUiMode', e.target.value)}
                      disabled={lookEditorSaving}
                      style={{
                        minWidth: '130px',
                        background: '#111b35',
                        border: '1px solid #3a4d76',
                        borderRadius: '4px',
                        color: '#f0f0f0',
                        padding: '6px 10px',
                        fontSize: '12px'
                      }}
                    >
                      <option value="slider">Slider</option>
                      <option value="toggle">Toggle</option>
                      <option value="radio">Radio</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#ddd', cursor: lookEditorSaving ? 'default' : 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={lookItem.showRecordButton === true}
                        onChange={(e) => updateLookDraftField(lookItem.id, 'showRecordButton', e.target.checked)}
                        disabled={lookEditorSaving}
                      />
                      Show Rec Button in Dashboard
                    </label>
                    <button
                      className="btn btn-small"
                      onClick={() => captureLookFromEditor(lookItem.id)}
                      disabled={lookEditorSaving || !(config?.looks || []).some(look => look.id === lookItem.id)}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        background: '#6f2323',
                        border: '1px solid #a44',
                        color: '#fff',
                        opacity: (lookEditorSaving || !(config?.looks || []).some(look => look.id === lookItem.id)) ? 0.4 : 1,
                        cursor: (lookEditorSaving || !(config?.looks || []).some(look => look.id === lookItem.id)) ? 'not-allowed' : 'pointer'
                      }}
                      title={(config?.looks || []).some(look => look.id === lookItem.id) ? 'Record current values into this look' : 'Save first, then record'}
                    >
                      ● Record Look
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => toggleLookDraftExpanded(lookItem.id)}
                      disabled={lookEditorSaving}
                      style={{
                        padding: '4px 10px',
                        fontSize: '12px',
                        background: '#2b2b2b',
                        border: '1px solid #555',
                        opacity: lookEditorSaving ? 0.4 : 1,
                        cursor: lookEditorSaving ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {lookItem.expanded ? 'Hide Values' : 'Edit Values'}
                    </button>
                    {!(config?.looks || []).some(look => look.id === lookItem.id) && (
                      <span style={{ fontSize: '11px', color: '#f0c674' }}>Save first to enable record</span>
                    )}
                  </div>

                  {lookItem.expanded && (
                    <div style={{ borderTop: '1px solid #333', paddingTop: '10px' }}>
                      <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '8px' }}>Target Values (0-100)</div>
                      {lookEditorFixtureDefinitions.length === 0 ? (
                        <div style={{ fontSize: '12px', color: '#777', padding: '6px 0' }}>
                          No fixtures in this dashboard yet.
                        </div>
                      ) : (
                        lookEditorFixtureDefinitions.map(definition => (
                          <div
                            key={`${lookItem.id}-${definition.fixtureId}`}
                            style={{
                              border: '1px solid #353535',
                              borderRadius: '6px',
                              padding: '10px',
                              marginBottom: '8px',
                              background: '#1b1b1b'
                            }}
                          >
                            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#ddd' }}>
                              {definition.fixtureName}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
                              {definition.channels.map(channel => {
                                const rawValue = lookItem.targets?.[definition.fixtureId]?.[channel.name];
                                const channelValue = Number.isFinite(Number(rawValue)) ? Number(rawValue) : 0;
                                return (
                                  <label
                                    key={`${lookItem.id}-${definition.fixtureId}-${channel.name}`}
                                    style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '4px',
                                      fontSize: '12px',
                                      color: '#bbb'
                                    }}
                                  >
                                    <span>{channel.label}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={1}
                                      value={channelValue}
                                      onChange={(e) => updateLookDraftTarget(lookItem.id, definition.fixtureId, channel.name, e.target.value)}
                                      disabled={lookEditorSaving}
                                      style={{
                                        width: '100%',
                                        background: '#101a33',
                                        border: '1px solid #334',
                                        borderRadius: '4px',
                                        color: '#fff',
                                        padding: '6px 8px',
                                        fontSize: '12px'
                                      }}
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
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
