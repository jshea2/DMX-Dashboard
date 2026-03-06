const config = require('./config');

// Helper to get profile for a fixture
function getProfile(cfg, fixture) {
  return cfg.fixtureProfiles?.find(p => p.id === fixture.profileId);
}

// Generate default state dynamically from config
function generateDefaultState() {
  const cfg = config.get();

  const fixtures = {};
  cfg.fixtures.forEach(fixture => {
    const profile = getProfile(cfg, fixture);
    if (!profile) return;

    fixtures[fixture.id] = {};

    // Use Control Blocks to generate state keys with default values
    if (profile.controls) {
      // New Control Blocks schema
      profile.controls.forEach(control => {
        // Apply default values if defined, otherwise use safe fallbacks
        if (control.defaultValue) {
          const dv = control.defaultValue;

          if (dv.type === 'rgb') {
            control.components.forEach(comp => {
              if (comp.type === 'red') fixtures[fixture.id][comp.name] = (dv.r || 0) * 100;
              else if (comp.type === 'green') fixtures[fixture.id][comp.name] = (dv.g || 0) * 100;
              else if (comp.type === 'blue') fixtures[fixture.id][comp.name] = (dv.b || 0) * 100;
            });
          } else if (dv.type === 'rgbw') {
            control.components.forEach(comp => {
              if (comp.type === 'red') fixtures[fixture.id][comp.name] = (dv.r || 0) * 100;
              else if (comp.type === 'green') fixtures[fixture.id][comp.name] = (dv.g || 0) * 100;
              else if (comp.type === 'blue') fixtures[fixture.id][comp.name] = (dv.b || 0) * 100;
              else if (comp.type === 'white') fixtures[fixture.id][comp.name] = (dv.w || 0) * 100;
            });
          } else if (dv.type === 'scalar') {
            control.components.forEach(comp => {
              fixtures[fixture.id][comp.name] = (dv.v || 0) * 100;
            });
          } else if (dv.type === 'xy') {
            const hasPanFine = control.components?.some(comp => comp.type === 'panFine');
            const hasTiltFine = control.components?.some(comp => comp.type === 'tiltFine');
            const panNormalized = dv.x || 0.5;
            const tiltNormalized = dv.y || 0.5;
            const panRaw = Math.round(Math.max(0, Math.min(1, panNormalized)) * 65535);
            const tiltRaw = Math.round(Math.max(0, Math.min(1, tiltNormalized)) * 65535);

            control.components.forEach(comp => {
              if (comp.type === 'pan') {
                fixtures[fixture.id][comp.name] = hasPanFine ? (((panRaw >> 8) / 255) * 100) : (panNormalized * 100);
              } else if (comp.type === 'panFine') {
                fixtures[fixture.id][comp.name] = ((panRaw & 0xff) / 255) * 100;
              } else if (comp.type === 'tilt') {
                fixtures[fixture.id][comp.name] = hasTiltFine ? (((tiltRaw >> 8) / 255) * 100) : (tiltNormalized * 100);
              } else if (comp.type === 'tiltFine') {
                fixtures[fixture.id][comp.name] = ((tiltRaw & 0xff) / 255) * 100;
              }
            });
          }
        } else {
          // No default value - use safe fallbacks
          control.components.forEach(comp => {
            if (comp.type === 'intensity') {
              fixtures[fixture.id][comp.name] = 0; // Intensity off
            } else if (comp.type === 'red' || comp.type === 'green' || comp.type === 'blue') {
              fixtures[fixture.id][comp.name] = 100; // White (RGB 100,100,100)
            } else if (comp.type === 'white' || comp.type === 'amber') {
              fixtures[fixture.id][comp.name] = 100; // Full white/amber
            } else {
              fixtures[fixture.id][comp.name] = 0; // Generic channels off
            }
          });
        }
      });
    } else if (profile.channels) {
      // Legacy fallback (shouldn't happen after migration)
      console.warn(`[State] Profile ${profile.id} still has old 'channels' schema`);
      profile.channels.forEach(ch => {
        fixtures[fixture.id][ch.name] = 0;
      });
    }
  });

  const looks = {};
  cfg.looks.forEach(look => {
    looks[look.id] = 0;
  });

  const cuePlayback = {};
  (cfg.showLayouts || []).forEach(layout => {
    if (!layout?.id) return;
    cuePlayback[layout.id] = {
      cueListId: layout.cueListId || cfg.cueLists?.[0]?.id || null,
      cueId: null,
      cueIndex: -1,
      status: 'stopped',
      transition: null
    };
  });

  return {
    blackout: false,
    fixtures,
    looks,
    overriddenFixtures: {},
    fixtureHsv: {},
    cuePlayback,
    cueOverrides: {}
  };
}

class State {
  constructor() {
    this.state = generateDefaultState();
    this.listeners = [];
  }

  // Reinitialize state when config changes (e.g., fixtures added/removed)
  reinitialize() {
    const newDefaults = generateDefaultState();
    // Merge existing values with new structure
    const mergedFixtures = {};
    Object.keys(newDefaults.fixtures).forEach(fixtureId => {
      if (this.state.fixtures[fixtureId]) {
        // Keep existing values, add any new channels
        mergedFixtures[fixtureId] = { ...newDefaults.fixtures[fixtureId], ...this.state.fixtures[fixtureId] };
      } else {
        mergedFixtures[fixtureId] = newDefaults.fixtures[fixtureId];
      }
    });

    const mergedLooks = {};
    Object.keys(newDefaults.looks).forEach(lookId => {
      mergedLooks[lookId] = this.state.looks[lookId] !== undefined ? this.state.looks[lookId] : 0;
    });

    const mergedCuePlayback = {};
    Object.keys(newDefaults.cuePlayback || {}).forEach(layoutId => {
      const existing = this.state.cuePlayback?.[layoutId];
      if (existing) {
        mergedCuePlayback[layoutId] = {
          ...newDefaults.cuePlayback[layoutId],
          ...existing
        };
      } else {
        mergedCuePlayback[layoutId] = newDefaults.cuePlayback[layoutId];
      }
    });

    this.state = {
      blackout: this.state.blackout,
      fixtures: mergedFixtures,
      looks: mergedLooks,
      overriddenFixtures: this.state.overriddenFixtures || {},
      fixtureHsv: this.state.fixtureHsv || {},
      cuePlayback: mergedCuePlayback,
      cueOverrides: this.state.cueOverrides || {}
    };
    this.notifyListeners();
  }

  get() {
    return this.state;
  }

  update(updates) {
    if (updates.blackout !== undefined) {
      this.state.blackout = updates.blackout;
    }

    if (updates.looks) {
      this.state.looks = { ...this.state.looks, ...updates.looks };
    }

    if (updates.fixtures) {
      Object.keys(updates.fixtures).forEach(fixtureId => {
        this.state.fixtures[fixtureId] = {
          ...this.state.fixtures[fixtureId],
          ...updates.fixtures[fixtureId]
        };
      });
    }

    if (updates.fixtureHsv) {
      this.state.fixtureHsv = {
        ...this.state.fixtureHsv,
        ...updates.fixtureHsv
      };
    }

    if (updates.cuePlayback) {
      Object.keys(updates.cuePlayback).forEach(layoutId => {
        const nextPlayback = updates.cuePlayback[layoutId];
        if (nextPlayback === null) {
          delete this.state.cuePlayback[layoutId];
        } else {
          this.state.cuePlayback[layoutId] = {
            ...(this.state.cuePlayback[layoutId] || {}),
            ...nextPlayback
          };
        }
      });
    }

    // Handle overriddenFixtures updates
    // Format: { fixtureId: { active: boolean, looks: [{ id, color }] } }
    if (updates.overriddenFixtures) {
      Object.keys(updates.overriddenFixtures).forEach(fixtureId => {
        const override = updates.overriddenFixtures[fixtureId];
        if (override === null || override.active === false) {
          // Clear override for this fixture
          delete this.state.overriddenFixtures[fixtureId];
        } else {
          // Set override for this fixture
          this.state.overriddenFixtures[fixtureId] = override;
        }
      });
    }

    // Handle cueOverrides updates
    // Format: { fixtureId: { active: boolean, dashboardId, cueListId, cueId } }
    if (updates.cueOverrides) {
      Object.keys(updates.cueOverrides).forEach(fixtureId => {
        const override = updates.cueOverrides[fixtureId];
        if (override === null || override.active === false) {
          delete this.state.cueOverrides[fixtureId];
        } else {
          this.state.cueOverrides[fixtureId] = override;
        }
      });
    }

    this.notifyListeners();
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter(l => l !== callback);
  }

  notifyListeners() {
    this.listeners.forEach(callback => callback(this.state));
  }

  reset() {
    this.state = generateDefaultState();
    this.notifyListeners();
  }
}

module.exports = new State();
