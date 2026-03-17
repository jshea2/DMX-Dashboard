const fs = require('fs');
const path = require('path');
const { createBlankConfig } = require('./projectTemplates');
const {
  mergeProjectIntoConfig,
  parseProjectFileContent,
  serializeProjectFile
} = require('./projectFile');

const CONFIG_FILE = process.env.DMX_CONFIG_PATH || path.join(__dirname, 'config.json');

const ensureConfigDir = () => {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

class Config {
  constructor() {
    this.config = this.load();
  }

  load() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        return this.normalizeConfig(JSON.parse(data));
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
    return this.normalizeConfig(createBlankConfig());
  }

  normalizeConfig(config) {
    let nextConfig = config;
    nextConfig = this.ensureShowLayouts(nextConfig);
    nextConfig = this.ensureLayoutAccessControl(nextConfig);
    nextConfig = this.ensureDashboardScopedLooks(nextConfig);
    nextConfig = this.ensureCueLists(nextConfig);
    nextConfig = this.ensureTags(nextConfig);
    nextConfig = this.ensureUpdateSettings(nextConfig);
    nextConfig = this.ensureControlBlockDefaults(nextConfig);
    return nextConfig;
  }

  ensureShowLayouts(config) {
    // Generate URL-friendly slug from name
    const generateUrlSlug = (name, existingSlugs = []) => {
      const baseSlug = name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 50);

      // Handle reserved slugs and collisions
      const reservedSlugs = ['settings', 'dmx-output'];
      let slug = baseSlug;
      let counter = 2;

      while (reservedSlugs.includes(slug) || existingSlugs.includes(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      return slug;
    };

    if (!config.showLayouts || config.showLayouts.length === 0) {
      const layoutId = `layout-${Date.now()}`;
      const defaultLayout = {
        id: layoutId,
        name: "Main Dashboard",
        urlSlug: generateUrlSlug("Main Dashboard", []),
        showName: false,
        backgroundColor: "#1a1a2e",
        logo: null,
        title: "Lighting",
        showBlackoutButton: true,
        showLayoutSelector: true,
        showConnectedUsers: true,
        sections: []
      };

      // Set as active layout
      if (!config.activeLayoutId) {
        config.activeLayoutId = layoutId;
      }

      // Create Looks section with all looks
      if (config.looks && config.looks.length > 0) {
        const looksSection = {
          id: "section-looks",
          name: "Looks",
          type: "static",
          staticType: "looks",
          visible: true,
          showClearButton: true,
          order: 0,
          items: []
        };
        config.looks.forEach((look, index) => {
          looksSection.items.push({
            type: "look",
            id: look.id,
            visible: true,
            order: index
          });
        });
        defaultLayout.sections.push(looksSection);
      }

      // Create Fixtures section with all fixtures
      if (config.fixtures && config.fixtures.length > 0) {
        const fixturesSection = {
          id: "section-fixtures",
          name: "Fixtures",
          type: "static",
          staticType: "fixtures",
          visible: true,
          showClearButton: true,
          order: 2,
          items: []
        };
        config.fixtures.forEach((fixture, index) => {
          fixturesSection.items.push({
            type: "fixture",
            id: fixture.id,
            visible: fixture.showOnMain !== false,
            displayMode: 'sliders', // 'sliders' or 'colorwheel' for RGB fixtures
            order: index
          });
        });
        defaultLayout.sections.push(fixturesSection);
      }

      if (config.cueLists && config.cueLists.length > 0) {
        defaultLayout.cueListId = config.cueLists[0].id;
        defaultLayout.sections.push({
          id: "section-cues",
          name: "Cue List",
          type: "static",
          staticType: "cues",
          visible: true,
          showClearButton: true,
          order: 1,
          items: []
        });
      }

      config.showLayouts = [defaultLayout];
    }

    // Migrate old flat items structure to sections
    if (config.showLayouts) {
      config.showLayouts.forEach(layout => {
        if (layout.items && !layout.sections) {
          // Old structure detected, migrate to sections
          layout.sections = [];

          const lookItems = layout.items.filter(item => item.type === 'look');
          const fixtureItems = layout.items.filter(item => item.type === 'fixture');

          if (lookItems.length > 0) {
            layout.sections.push({
              id: "section-looks",
              name: "Looks",
              type: "static",
              staticType: "looks",
              visible: true,
              showClearButton: true,
              order: 0,
              items: lookItems
            });
          }

          if (fixtureItems.length > 0) {
            layout.sections.push({
              id: "section-fixtures",
              name: "Fixtures",
              type: "static",
              staticType: "fixtures",
              visible: true,
              showClearButton: true,
              order: 1,
              items: fixtureItems
            });
          }

          delete layout.items; // Remove old structure
        }
      });
    }

    // Ensure there's an active layout set
    if (!config.activeLayoutId && config.showLayouts.length > 0) {
      config.activeLayoutId = config.showLayouts[0].id;
    }

    return config;
  }

  ensureUpdateSettings(config) {
    if (!config.webServer) {
      config.webServer = {};
    }
    if (typeof config.webServer.autoUpdateCheck !== 'boolean') {
      config.webServer.autoUpdateCheck = true;
    }
    return config;
  }

  ensureControlBlockDefaults(config) {
    if (!Array.isArray(config.fixtureProfiles)) return config;

    config.fixtureProfiles.forEach(profile => {
      if (!Array.isArray(profile.controls)) return;
      profile.controls.forEach(control => {
        if (!control || !control.controlType) return;
        const isRgb = control.controlType === 'RGB';
        const isRgbw = control.controlType === 'RGBW';
        if (!isRgb && !isRgbw) return;
        const isStrictDimmerColor = Boolean(control.brightnessDrivenByIntensity);

        const defaultValue = control.defaultValue || {};
        const type = defaultValue.type || (isRgbw ? 'rgbw' : 'rgb');
        const r = Number(defaultValue.r);
        const g = Number(defaultValue.g);
        const b = Number(defaultValue.b);
        const w = Number(defaultValue.w);

        const isBlackDefault = isRgbw
          ? r === 0 && g === 0 && b === 0 && w === 0
          : r === 0 && g === 0 && b === 0;

        const isWhiteDefault = isRgbw
          ? r === 1 && g === 1 && b === 1 && w === 1
          : r === 1 && g === 1 && b === 1;

        // Strict Dimmer+RGB profiles should default to white so dimmer-only bring-up works.
        if (isStrictDimmerColor) {
          if (!control.defaultValue || isBlackDefault) {
            control.defaultValue = isRgbw
              ? { type, r: 1.0, g: 1.0, b: 1.0, w: 1.0 }
              : { type, r: 1.0, g: 1.0, b: 1.0 };
          }
          return;
        }

        // Non-strict RGB/RGBW defaults should be black.
        if (!control.defaultValue || isWhiteDefault) {
          control.defaultValue = isRgbw
            ? { type, r: 0.0, g: 0.0, b: 0.0, w: 0.0 }
            : { type, r: 0.0, g: 0.0, b: 0.0 };
        }
      });
    });

    return config;
  }

  ensureLayoutAccessControl(config) {
    // Migrate layouts to include access control fields for multi-dashboard system
    if (config.showLayouts) {
      const hasManyDashboards = config.showLayouts.length > 1;

      config.showLayouts.forEach(layout => {
        // Add showReturnToMenuButton (default: false for single dashboard, true for multiple)
        if (layout.showReturnToMenuButton === undefined) {
          layout.showReturnToMenuButton = hasManyDashboards;
        }

        // Add showSettingsButton if missing (default: true)
        if (layout.showSettingsButton === undefined) {
          layout.showSettingsButton = true;
        }

        // Add accessControl object
        if (!layout.accessControl) {
          layout.accessControl = {
            defaultRole: 'viewer',           // Role for new users added to this dashboard
            requireExplicitAccess: false     // If false, all users can access (uses global role)
          };
        } else {
          // Ensure both fields exist in accessControl
          if (layout.accessControl.defaultRole === undefined) {
            layout.accessControl.defaultRole = 'viewer';
          }
          if (layout.accessControl.requireExplicitAccess === undefined) {
            layout.accessControl.requireExplicitAccess = false;
          }
        }

        // Lock dashboard editing affordances for non-editors
        if (layout.lockEdits === undefined) {
          layout.lockEdits = false;
        }
      });
    }

    return config;
  }

  ensureDashboardScopedLooks(config) {
    if (!Array.isArray(config.looks)) {
      config.looks = [];
      return config;
    }
    if (!Array.isArray(config.showLayouts) || config.showLayouts.length === 0) {
      return config;
    }

    const layouts = config.showLayouts;
    const firstLayoutId = layouts[0].id;
    let lookCloneCounter = 0;

    const makeLookId = () => {
      lookCloneCounter += 1;
      return `look-${Date.now()}-${lookCloneCounter}`;
    };

    const cloneLookForDashboard = (sourceLook, dashboardId) => {
      const clone = {
        ...sourceLook,
        id: makeLookId(),
        dashboardId,
        targets: sourceLook.targets ? JSON.parse(JSON.stringify(sourceLook.targets)) : {},
        tags: Array.isArray(sourceLook.tags) ? [...sourceLook.tags] : []
      };
      config.looks.push(clone);
      return clone;
    };

    // Ensure each layout has a looks section
    layouts.forEach(layout => {
      if (!Array.isArray(layout.sections)) {
        layout.sections = [];
      }
      const hasLooksSection = layout.sections.some(section => section.type === 'static' && section.staticType === 'looks');
      if (!hasLooksSection) {
        const nextOrder = layout.sections.length;
        layout.sections.push({
          id: `section-looks-${layout.id}`,
          name: 'Looks',
          type: 'static',
          staticType: 'looks',
          visible: true,
          showClearButton: true,
          order: nextOrder,
          items: []
        });
      }
    });

    const getLooksSection = (layout) =>
      (layout.sections || []).find(section => section.type === 'static' && section.staticType === 'looks');

    const lookById = new Map(config.looks.map(look => [look.id, look]));
    const firstUseByLookId = new Map();

    // Ensure each look reference in layout sections points to a look owned by that layout
    layouts.forEach(layout => {
      const section = getLooksSection(layout);
      if (!section || !Array.isArray(section.items)) return;

      section.items = section.items
        .filter(item => item && item.type === 'look' && item.id)
        .map(item => ({ ...item }));

      section.items.forEach(item => {
        const sourceLook = lookById.get(item.id);
        if (!sourceLook) return;

        // First time we see this look, assign ownership if missing.
        if (!firstUseByLookId.has(sourceLook.id)) {
          firstUseByLookId.set(sourceLook.id, layout.id);
          if (!sourceLook.dashboardId) {
            sourceLook.dashboardId = layout.id;
          }
          if (sourceLook.dashboardId !== layout.id) {
            const clone = cloneLookForDashboard(sourceLook, layout.id);
            lookById.set(clone.id, clone);
            item.id = clone.id;
          }
          return;
        }

        // Reused on another layout: clone so each dashboard owns its own look.
        const firstLayoutForLook = firstUseByLookId.get(sourceLook.id);
        if (firstLayoutForLook !== layout.id) {
          const clone = cloneLookForDashboard(sourceLook, layout.id);
          lookById.set(clone.id, clone);
          item.id = clone.id;
        }
      });
    });

    // Any unowned look becomes owned by first layout.
    config.looks.forEach(look => {
      if (!look.dashboardId) {
        look.dashboardId = firstLayoutId;
      }
    });

    // Ensure each dashboard's looks section contains all and only its own looks.
    layouts.forEach(layout => {
      const section = getLooksSection(layout);
      if (!section) return;

      const ownedLookIds = config.looks
        .filter(look => look.dashboardId === layout.id)
        .map(look => look.id);

      const existingItems = (section.items || [])
        .filter(item => item && item.type === 'look')
        .filter(item => ownedLookIds.includes(item.id));
      const existingIds = new Set(existingItems.map(item => item.id));

      ownedLookIds.forEach(lookId => {
        if (!existingIds.has(lookId)) {
          existingItems.push({
            type: 'look',
            id: lookId,
            visible: true,
            order: existingItems.length,
            lookUiMode: 'slider'
          });
        }
      });

      // Preserve non-look items in mixed/custom sections.
      const nonLookItems = (section.items || []).filter(item => item?.type !== 'look');
      section.items = [...existingItems, ...nonLookItems];
      section.items.forEach((item, index) => {
        item.order = index;
      });
    });

    return config;
  }

  ensureTags(config) {
    // Add tags array to fixtures and looks for filtering and organization
    if (config.fixtures) {
      config.fixtures.forEach(fixture => {
        if (!fixture.tags) {
          fixture.tags = [];
        }
      });
    }

    if (config.looks) {
      config.looks.forEach(look => {
        if (!look.tags) {
          look.tags = [];
        }
        if (typeof look.excludeFromCues !== 'boolean') {
          look.excludeFromCues = false;
        }
      });
    }

    return config;
  }

  ensureCueLists(config) {
    if (!Array.isArray(config.cueLists)) {
      config.cueLists = [];
    }

    const sanitizeTargets = (targets) => {
      if (!targets || typeof targets !== 'object' || Array.isArray(targets)) return {};
      const next = {};
      Object.entries(targets).forEach(([fixtureId, channelMap]) => {
        if (!fixtureId || !channelMap || typeof channelMap !== 'object' || Array.isArray(channelMap)) return;
        const sanitizedChannels = {};
        Object.entries(channelMap).forEach(([channelName, value]) => {
          const numeric = Number(value);
          if (!channelName || !Number.isFinite(numeric)) return;
          sanitizedChannels[channelName] = Math.max(0, Math.min(100, numeric));
        });
        next[fixtureId] = sanitizedChannels;
      });
      return next;
    };

    const sanitizeShortcuts = (shortcuts) => ({
      enableSpacebarGo: shortcuts?.enableSpacebarGo !== false,
      enableShiftSpacebarFastGo: shortcuts?.enableShiftSpacebarFastGo === true,
      enableOptionSpacebarBackPause: shortcuts?.enableOptionSpacebarBackPause === true
    });

    config.cueLists = config.cueLists
      .filter(cueList => cueList && cueList.id)
      .map(cueList => ({
        id: cueList.id,
        name: cueList.name || 'Cue List',
        cueOutTime: Number.isFinite(Number(cueList.cueOutTime))
          ? Math.max(0, Math.round(Number(cueList.cueOutTime)))
          : 0,
        backTime: Number.isFinite(Number(cueList.backTime))
          ? Math.max(0, Math.round(Number(cueList.backTime)))
          : 0,
        defaultNewCueTransitionTime: Number.isFinite(Number(cueList.defaultNewCueTransitionTime))
          ? Math.max(0, Math.round(Number(cueList.defaultNewCueTransitionTime)))
          : 5,
        shortcuts: sanitizeShortcuts(cueList.shortcuts),
        cues: Array.isArray(cueList.cues)
          ? cueList.cues
            .filter(cue => cue && cue.id)
            .map((cue, index) => ({
              id: cue.id,
              number: cue.number != null ? String(cue.number) : String(index + 1),
              name: cue.name || `Cue ${index + 1}`,
              fadeTime: Number.isFinite(Number(cue.fadeTime)) ? Math.max(0, Number(cue.fadeTime)) : 0,
              targets: sanitizeTargets(cue.targets || {})
            }))
          : []
      }));

    if (config.cueLists.length === 0) {
      config.cueLists.push({
        id: 'cue-list-main',
        name: 'Main Cue List',
        cueOutTime: 0,
        backTime: 0,
        defaultNewCueTransitionTime: 5,
        shortcuts: sanitizeShortcuts(null),
        cues: []
      });
    }

    if (!Array.isArray(config.showLayouts)) return config;
    const firstCueListId = config.cueLists[0]?.id || null;

    config.showLayouts.forEach((layout) => {
      if (layout.cueListId === undefined) {
        layout.cueListId = firstCueListId;
      }
      if (layout.cueListId && !config.cueLists.some(c => c.id === layout.cueListId)) {
        layout.cueListId = firstCueListId;
      }

      if (!Array.isArray(layout.sections)) {
        layout.sections = [];
      }

      const hasCueSection = layout.sections.some(section => section?.type === 'static' && section?.staticType === 'cues');
      if (!hasCueSection) {
        layout.sections.push({
          id: `section-cues-${layout.id}`,
          name: 'Cue List',
          type: 'static',
          staticType: 'cues',
          visible: true,
          showClearButton: true,
          order: layout.sections.length,
          items: []
        });
      }

      layout.sections.forEach((section, index) => {
        if (section?.order === undefined) {
          section.order = index;
        }
      });
    });

    return config;
  }

  save() {
    try {
      ensureConfigDir();
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      return false;
    }
  }

  get() {
    return this.config;
  }

  update(newConfig) {
    this.config = this.normalizeConfig(newConfig);
    return this.save();
  }

  reset() {
    this.config = this.normalizeConfig(createBlankConfig());
    return this.save();
  }

  exportConfig() {
    return serializeProjectFile(this.config);
  }

  importConfig(configJson) {
    try {
      const importedProject = parseProjectFileContent(configJson);
      const mergedConfig = mergeProjectIntoConfig(this.config, importedProject);
      this.config = this.normalizeConfig(mergedConfig);
      return this.save();
    } catch (error) {
      console.error('Error importing config:', error);
      return false;
    }
  }
}

module.exports = new Config();
