const config = require('./config');
const state = require('./state');

// Convert HSV to RGB
// H: 0-360, S: 0-1, V: 0-1
// Returns: {r, g, b} 0-255
function hsvToRgb(h, s, v) {
  let r, g, b;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rPrime, gPrime, bPrime;

  if (h >= 0 && h < 60) {
    [rPrime, gPrime, bPrime] = [c, x, 0];
  } else if (h >= 60 && h < 120) {
    [rPrime, gPrime, bPrime] = [x, c, 0];
  } else if (h >= 120 && h < 180) {
    [rPrime, gPrime, bPrime] = [0, c, x];
  } else if (h >= 180 && h < 240) {
    [rPrime, gPrime, bPrime] = [0, x, c];
  } else if (h >= 240 && h < 300) {
    [rPrime, gPrime, bPrime] = [x, 0, c];
  } else {
    [rPrime, gPrime, bPrime] = [c, 0, x];
  }

  r = Math.round((rPrime + m) * 255);
  g = Math.round((gPrime + m) * 255);
  b = Math.round((bPrime + m) * 255);

  return { r, g, b };
}

// Convert hue (0-360) and brightness (0-100) to RGB (0-255)
function hueBrightnessToRgb(hue, brightness) {
  const s = 1.0; // Full saturation
  const v = brightness / 100;
  return hsvToRgb(hue, s, v);
}

// Clamp value between min and max
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getDefaultValueForComponent(control, component) {
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
}

// Helper to get profile for a fixture
function getProfile(cfg, fixture) {
  return cfg.fixtureProfiles?.find(p => p.id === fixture.profileId);
}

// Check if profile has specific channel types (for backwards compatibility)
function profileHasChannel(profile, channelName) {
  return profile?.channels?.some(ch => ch.name === channelName);
}

// Check if this is an RGB-type profile (has red, green, blue channels)
function isRgbProfile(profile) {
  return profileHasChannel(profile, 'red') && 
         profileHasChannel(profile, 'green') && 
         profileHasChannel(profile, 'blue');
}

function getActiveCueSnapshots(currentState, cfg) {
  const snapshots = [];
  const nowMs = Date.now();
  const cuePlayback = currentState.cuePlayback || {};
  const cueLists = cfg.cueLists || [];
  const layoutsById = new Map((cfg.showLayouts || []).map(layout => [layout.id, layout]));

  const toPercent = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return null;
    return Math.max(0, Math.min(100, numericValue));
  };

  Object.entries(cuePlayback).forEach(([dashboardId, playback]) => {
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

    snapshots.push({
      dashboardId,
      cueListId: cueList.id,
      cueId: cue.id,
      targets: cue.targets || {},
      transition
    });
  });

  return snapshots;
}

function getCueChannelValue(snapshot, fixtureId, channelName) {
  if (!snapshot) return null;

  const toPercent = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return null;
    return Math.max(0, Math.min(100, numericValue));
  };

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
}

class DMXEngine {
  constructor() {
    this.universes = {};
    this.initializeUniverses();
  }

  // Get universe key for a fixture based on protocol
  getUniverseKey(cfg, fixture) {
    if (cfg.network.protocol === 'artnet') {
      // For Art-Net: encode net/subnet/universe into a unique key
      const net = fixture.artnetNet || 0;
      const subnet = fixture.artnetSubnet || 0;
      const universe = fixture.artnetUniverse || 0;
      return `artnet_${net}_${subnet}_${universe}`;
    } else {
      // For sACN: use the universe number directly
      return fixture.universe;
    }
  }

  initializeUniverses() {
    const cfg = config.get();
    // Initialize universe buffers based on fixtures
    cfg.fixtures.forEach(fixture => {
      const universeKey = this.getUniverseKey(cfg, fixture);
      if (!this.universes[universeKey]) {
        this.universes[universeKey] = new Array(512).fill(0);
      }
    });
  }

  computeOutput() {
    const currentState = state.get();
    const cfg = config.get();
    const activeCueSnapshots = getActiveCueSnapshots(currentState, cfg);

    // Reinitialize universes in case fixtures changed
    cfg.fixtures.forEach(fixture => {
      const universeKey = this.getUniverseKey(cfg, fixture);
      if (!this.universes[universeKey]) {
        this.universes[universeKey] = new Array(512).fill(0);
      }
    });

    // Clear all universes
    Object.keys(this.universes).forEach(univ => {
      this.universes[univ].fill(0);
    });

    // If blackout, return empty buffers
    if (currentState.blackout) {
      return this.universes;
    }

    // HTP (Highest Takes Precedence) blending
    cfg.fixtures.forEach(fixture => {
      const fixtureId = fixture.id;
      const universeKey = this.getUniverseKey(cfg, fixture);
      const universe = this.universes[universeKey];
      const profile = getProfile(cfg, fixture);
      const isFixtureOverridden = currentState.overriddenFixtures?.[fixtureId]?.active;
      const isCueOverridden = currentState.cueOverrides?.[fixtureId]?.active;

      if (!universe || !profile) return;

      // Use Control Blocks to process each component
      if (profile.controls) {
        // New Control Blocks schema
        profile.controls.forEach(control => {
          if (!control.components) return;
          control.components.forEach(component => {
            const channelName = component.name;
            const dmxAddress = fixture.startAddress + component.offset;

            // Collect all sources for this channel for HTP comparison
            const sources = [];

            // Source 1: Individual fixture control (direct channel values)
            const fixtureState = currentState.fixtures[fixtureId];
            if (fixtureState) {
              const value = fixtureState[channelName];
              if (value > 0) {
                sources.push(Math.round((value / 100) * 255));
              }
            }

            // Source 2+: Each look's contribution (blend from defaults unless overridden)
            if (!isFixtureOverridden) {
              cfg.looks.forEach(look => {
                const lookLevel = currentState.looks[look.id] ?? 0;
                if (look.targets[fixtureId]) {
                  const target = look.targets[fixtureId];
                  const targetValue = target[channelName];
                  if (targetValue !== undefined) {
                    const defaultValue = getDefaultValueForComponent(control, component);
                    const effectiveValue = defaultValue + (targetValue - defaultValue) * lookLevel;
                    sources.push(Math.round((effectiveValue / 100) * 255));
                  }
                }
              });
            }

            // Source N+: Active cue contributions (unless this fixture has cue override)
            if (!isCueOverridden) {
              activeCueSnapshots.forEach(snapshot => {
                const cueValue = getCueChannelValue(snapshot, fixtureId, channelName);
                if (cueValue === null) return;
                sources.push(Math.round((cueValue / 100) * 255));
              });
            }

            // Apply HTP: Take the highest value
            const maxValue = Math.max(0, ...sources);
            universe[dmxAddress - 1] = clamp(maxValue, 0, 255);
          });
        });
      } else if (profile.channels) {
        // Legacy fallback (shouldn't happen after migration)
        console.warn(`[DMX] Profile ${profile.id} still has old 'channels' schema`);
        profile.channels.forEach(channel => {
          const channelName = channel.name;
          const dmxAddress = fixture.startAddress + channel.offset;

          // Collect all sources for this channel for HTP comparison
          const sources = [];

          // Source 1: Individual fixture control (direct channel values)
          const fixtureState = currentState.fixtures[fixtureId];
          if (fixtureState) {
            const value = fixtureState[channelName];
            if (value > 0) {
              sources.push(Math.round((value / 100) * 255));
            }
          }

          // Source 2+: Each look's contribution (blend from defaults unless overridden)
          if (!isFixtureOverridden) {
            cfg.looks.forEach(look => {
              const lookLevel = currentState.looks[look.id] ?? 0;
              if (look.targets[fixtureId]) {
                const target = look.targets[fixtureId];
                const targetValue = target[channelName];
                if (targetValue !== undefined) {
                  const defaultValue = 0;
                  const effectiveValue = defaultValue + (targetValue - defaultValue) * lookLevel;
                  sources.push(Math.round((effectiveValue / 100) * 255));
                }
              }
            });
          }

          // Source N+: Active cue contributions (unless this fixture has cue override)
          if (!isCueOverridden) {
            activeCueSnapshots.forEach(snapshot => {
              const cueValue = getCueChannelValue(snapshot, fixtureId, channelName);
              if (cueValue === null) return;
              sources.push(Math.round((cueValue / 100) * 255));
            });
          }

          // Apply HTP: Take the highest value
          const maxValue = Math.max(0, ...sources);
          universe[dmxAddress - 1] = clamp(maxValue, 0, 255);
        });
      }
    });

    return this.universes;
  }

  getUniverse(universeNum) {
    return this.universes[universeNum] || new Array(512).fill(0);
  }
}

module.exports = new DMXEngine();
