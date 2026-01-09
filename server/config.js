const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  fixtureProfiles: [
    {
      id: 'rgb-3ch',
      name: 'LED Par (3ch RGB)',
      channels: [
        { name: 'red', offset: 0 },
        { name: 'green', offset: 1 },
        { name: 'blue', offset: 2 }
      ]
    },
    {
      id: 'intensity-1ch',
      name: 'Dimmer (1ch)',
      channels: [
        { name: 'intensity', offset: 0 }
      ]
    },
    {
      id: 'rgbw-4ch',
      name: 'LED Par (4ch RGBW)',
      channels: [
        { name: 'red', offset: 0 },
        { name: 'green', offset: 1 },
        { name: 'blue', offset: 2 },
        { name: 'white', offset: 3 }
      ]
    }
  ],
  network: {
    protocol: 'sacn', // 'sacn' or 'artnet'
    sacn: {
      universe: 1,
      priority: 100,
      multicast: true,
      unicastDestinations: [], // Array of IP addresses for unicast
      bindAddress: '' // Optional: bind to specific network interface (e.g., '192.168.1.100')
    },
    artnet: {
      net: 0,
      subnet: 0,
      universe: 0,
      destination: '255.255.255.255', // Broadcast or specific IP
      port: 6454,
      bindAddress: '' // Optional: bind to specific network interface (e.g., '192.168.1.100')
    },
    outputFps: 30
  },
  server: {
    port: 3000,
    bindAddress: '0.0.0.0' // 0.0.0.0 = all interfaces, or specify IP for one interface
  },
  webServer: {
    passcode: '',
    passcodeEnabled: false,
    showConnectedUsers: true, // Show bottom-left connected users indicator
    defaultClientRole: 'viewer' // Default role for new clients: 'viewer', 'controller', or 'editor'
  },
  clients: [],
  fixtures: [
    {
      id: 'panel1',
      name: 'RGB Panel 1',
      profileId: 'rgb-3ch',
      universe: 1,
      startAddress: 1,
      showOnMain: true
    },
    {
      id: 'panel2',
      name: 'RGB Panel 2',
      profileId: 'rgb-3ch',
      universe: 1,
      startAddress: 4,
      showOnMain: true
    },
    {
      id: 'par1',
      name: 'Backlight PAR 1',
      profileId: 'intensity-1ch',
      universe: 1,
      startAddress: 7,
      showOnMain: true
    },
    {
      id: 'par2',
      name: 'Backlight PAR 2',
      profileId: 'intensity-1ch',
      universe: 1,
      startAddress: 8,
      showOnMain: true
    }
  ],
  looks: [
    {
      id: 'look1',
      name: 'Warm Dramatic',
      color: 'orange',
      targets: {
        panel1: { hue: 30, brightness: 75 },
        panel2: { hue: 30, brightness: 75 },
        par1: { intensity: 60 },
        par2: { intensity: 60 }
      }
    },
    {
      id: 'look2',
      name: 'Cool Dramatic',
      color: 'cyan',
      targets: {
        panel1: { hue: 200, brightness: 70 },
        panel2: { hue: 200, brightness: 70 },
        par1: { intensity: 50 },
        par2: { intensity: 50 }
      }
    },
    {
      id: 'look3',
      name: 'Vibrant',
      color: 'purple',
      targets: {
        panel1: { hue: 280, brightness: 85 },
        panel2: { hue: 120, brightness: 85 },
        par1: { intensity: 70 },
        par2: { intensity: 70 }
      }
    }
  ],
  settings: {
    requirePassword: false,
    password: ''
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
        let config = JSON.parse(data);
        // Migrate to showLayouts if not present
        config = this.ensureShowLayouts(config);
        // Migrate layout access control fields
        config = this.ensureLayoutAccessControl(config);
        return config;
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
    let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config = this.ensureShowLayouts(config);
    config = this.ensureLayoutAccessControl(config);
    return config;
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
        name: "Default Layout",
        urlSlug: "home",
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
          order: 1,
          items: []
        };
        config.fixtures.forEach((fixture, index) => {
          fixturesSection.items.push({
            type: "fixture",
            id: fixture.id,
            visible: fixture.showOnMain !== false,
            order: index
          });
        });
        defaultLayout.sections.push(fixturesSection);
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

  ensureLayoutAccessControl(config) {
    // Migrate layouts to include access control fields for multi-dashboard system
    if (config.showLayouts) {
      config.showLayouts.forEach(layout => {
        // Add showReturnToMenuButton (default: true)
        if (layout.showReturnToMenuButton === undefined) {
          layout.showReturnToMenuButton = true;
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
      });
    }

    return config;
  }

  save() {
    try {
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
    this.config = newConfig;
    return this.save();
  }

  reset() {
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    return this.save();
  }

  exportConfig() {
    return JSON.stringify(this.config, null, 2);
  }

  importConfig(configJson) {
    try {
      const imported = JSON.parse(configJson);
      this.config = imported;
      return this.save();
    } catch (error) {
      console.error('Error importing config:', error);
      return false;
    }
  }
}

module.exports = new Config();
