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
    if (component.type === 'pan') return (defaultVal.x || 0.5) * 100;
    if (component.type === 'tilt') return (defaultVal.y || 0.5) * 100;
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
