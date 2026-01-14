const crypto = require('crypto');

// Generate UUID v4 using Node's crypto module
function uuidv4() {
  return crypto.randomUUID();
}

/**
 * HSV to RGB conversion
 * Input: h (0-360), s (0-100), v (0-100)
 * Output: { r, g, b } (0-100)
 */
function hsvToRgb(h, s, v) {
  s = s / 100;
  v = v / 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r, g, b;
  if (h >= 0 && h < 60) {
    [r, g, b] = [c, x, 0];
  } else if (h >= 60 && h < 120) {
    [r, g, b] = [x, c, 0];
  } else if (h >= 120 && h < 180) {
    [r, g, b] = [0, c, x];
  } else if (h >= 180 && h < 240) {
    [r, g, b] = [0, x, c];
  } else if (h >= 240 && h < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }

  return {
    r: Math.round((r + m) * 100),
    g: Math.round((g + m) * 100),
    b: Math.round((b + m) * 100)
  };
}

/**
 * Migrate old profile schema (channels) to new Control Blocks schema
 */
function migrateProfilesToControlBlocks(config) {
  console.log('[Migration] Starting profile migration to Control Blocks...');

  if (!config.fixtureProfiles || config.fixtureProfiles.length === 0) {
    console.log('[Migration] No profiles to migrate');
    return config;
  }

  config.fixtureProfiles = config.fixtureProfiles.map(profile => {
    // Skip if already migrated
    if (profile.controls && !profile.channels) {
      console.log(`[Migration] Profile ${profile.id} already migrated`);
      return profile;
    }

    // Skip if no channels (invalid profile)
    if (!profile.channels || profile.channels.length === 0) {
      console.log(`[Migration] Profile ${profile.id} has no channels, creating empty controls`);
      return {
        ...profile,
        controls: [],
        channels: undefined // Remove old schema
      };
    }

    console.log(`[Migration] Migrating profile ${profile.id} (${profile.name})`);

    const controls = [];
    const channels = [...profile.channels]; // Copy to avoid mutation
    let processedIndices = new Set();

    // Detect RGB groups (consecutive red, green, blue)
    for (let i = 0; i < channels.length; i++) {
      if (processedIndices.has(i)) continue;

      const ch = channels[i];

      // Check for RGB pattern
      if (
        i + 2 < channels.length &&
        ch.name === 'red' &&
        channels[i + 1].name === 'green' &&
        channels[i + 2].name === 'blue'
      ) {
        console.log(`[Migration]   Found RGB at index ${i}`);
        controls.push({
          id: uuidv4(),
          label: 'RGB Color',
          domain: 'Color',
          controlType: 'RGB',
          channelCount: 3,
          components: [
            { type: 'red', name: 'red', offset: i },
            { type: 'green', name: 'green', offset: i + 1 },
            { type: 'blue', name: 'blue', offset: i + 2 }
          ],
          defaultValue: { type: 'rgb', r: 1.0, g: 1.0, b: 1.0 } // White default
        });
        processedIndices.add(i);
        processedIndices.add(i + 1);
        processedIndices.add(i + 2);
        continue;
      }

      // Check for RGBW pattern
      if (
        i + 3 < channels.length &&
        ch.name === 'red' &&
        channels[i + 1].name === 'green' &&
        channels[i + 2].name === 'blue' &&
        channels[i + 3].name === 'white'
      ) {
        console.log(`[Migration]   Found RGBW at index ${i}`);
        controls.push({
          id: uuidv4(),
          label: 'RGBW Color',
          domain: 'Color',
          controlType: 'RGBW',
          channelCount: 4,
          components: [
            { type: 'red', name: 'red', offset: i },
            { type: 'green', name: 'green', offset: i + 1 },
            { type: 'blue', name: 'blue', offset: i + 2 },
            { type: 'white', name: 'white', offset: i + 3 }
          ],
          defaultValue: { type: 'rgbw', r: 1.0, g: 1.0, b: 1.0, w: 1.0 } // White default
        });
        processedIndices.add(i);
        processedIndices.add(i + 1);
        processedIndices.add(i + 2);
        processedIndices.add(i + 3);
        continue;
      }

      // Check for Intensity
      if (ch.name === 'intensity') {
        console.log(`[Migration]   Found Intensity at index ${i}`);
        controls.push({
          id: uuidv4(),
          label: 'Dimmer',
          domain: 'Intensity',
          controlType: 'Intensity',
          channelCount: 1,
          components: [
            { type: 'intensity', name: 'intensity', offset: i }
          ],
          defaultValue: { type: 'scalar', v: 0.0 } // Off by default
        });
        processedIndices.add(i);
        continue;
      }

      // Everything else becomes Generic
      console.log(`[Migration]   Found Generic channel '${ch.name}' at index ${i}`);
      controls.push({
        id: uuidv4(),
        label: ch.name.charAt(0).toUpperCase() + ch.name.slice(1), // Capitalize first letter
        domain: 'Other',
        controlType: 'Generic',
        channelCount: 1,
        components: [
          { type: 'generic', name: ch.name, offset: i }
        ],
        defaultValue: null
      });
      processedIndices.add(i);
    }

    console.log(`[Migration]   Created ${controls.length} controls`);

    return {
      ...profile,
      controls,
      channels: undefined // Remove old schema
    };
  });

  console.log('[Migration] Profile migration complete');
  return config;
}

/**
 * Convert HSV look targets to RGB
 */
function convertHsvLooksToRgb(config) {
  console.log('[Migration] Starting HSV → RGB look conversion...');

  if (!config.looks || config.looks.length === 0) {
    console.log('[Migration] No looks to migrate');
    return config;
  }

  config.looks = config.looks.map(look => {
    if (!look.targets) return look;

    let hasHsvTargets = false;

    const newTargets = {};
    Object.keys(look.targets).forEach(fixtureId => {
      const target = look.targets[fixtureId];

      // Check if this target uses HSV (has hue, sat, brightness keys)
      if (target.hue !== undefined && target.sat !== undefined && target.brightness !== undefined) {
        hasHsvTargets = true;
        console.log(`[Migration]   Converting look ${look.id} target ${fixtureId} from HSV to RGB`);

        const rgb = hsvToRgb(target.hue, target.sat, target.brightness);
        console.log(`[Migration]     HSV(${target.hue}, ${target.sat}, ${target.brightness}) → RGB(${rgb.r}, ${rgb.g}, ${rgb.b})`);

        newTargets[fixtureId] = {
          red: rgb.r,
          green: rgb.g,
          blue: rgb.b
        };
      } else {
        // Already RGB or other format, keep as-is
        newTargets[fixtureId] = target;
      }
    });

    if (hasHsvTargets) {
      console.log(`[Migration]   Look ${look.id} converted`);
    }

    return {
      ...look,
      targets: newTargets
    };
  });

  console.log('[Migration] Look conversion complete');
  return config;
}

/**
 * Remove colorMode from fixtures
 */
function removeColorModeFromFixtures(config) {
  console.log('[Migration] Removing colorMode from fixtures...');

  if (!config.fixtures || config.fixtures.length === 0) {
    console.log('[Migration] No fixtures to update');
    return config;
  }

  let removedCount = 0;
  config.fixtures = config.fixtures.map(fixture => {
    if (fixture.colorMode) {
      console.log(`[Migration]   Removing colorMode from fixture ${fixture.id}`);
      removedCount++;
      const { colorMode, ...rest } = fixture;
      return rest;
    }
    return fixture;
  });

  console.log(`[Migration] Removed colorMode from ${removedCount} fixtures`);
  return config;
}

/**
 * Main migration runner
 */
function runMigrations(config) {
  console.log('[Migration] ========================================');
  console.log('[Migration] Starting migration to Control Blocks v1');
  console.log('[Migration] ========================================');

  // Check if already migrated
  if (config.migrationVersion >= 1) {
    console.log('[Migration] Already at version 1 or higher, skipping');
    return config;
  }

  // Step 1: Migrate profiles to Control Blocks
  config = migrateProfilesToControlBlocks(config);

  // Step 2: Convert HSV looks to RGB
  config = convertHsvLooksToRgb(config);

  // Step 3: Remove colorMode from fixtures
  config = removeColorModeFromFixtures(config);

  // Step 4: Set migration version
  config.migrationVersion = 1;

  console.log('[Migration] ========================================');
  console.log('[Migration] Migration complete!');
  console.log('[Migration] ========================================');

  return config;
}

module.exports = {
  runMigrations,
  hsvToRgb, // Export for testing
  migrateProfilesToControlBlocks, // Export for testing
  convertHsvLooksToRgb, // Export for testing
  removeColorModeFromFixtures // Export for testing
};
