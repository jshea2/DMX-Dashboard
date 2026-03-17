const clone = (value) => JSON.parse(JSON.stringify(value));

const createControl = (profileId, controlId, control) => ({
  id: `${profileId}-${controlId}`,
  ...control
});

const BUILT_IN_FIXTURE_PROFILES = [
  {
    id: 'intensity-1ch',
    name: 'Dimmer (1ch)',
    controls: [
      createControl('intensity-1ch', 'intensity', {
        label: 'Dimmer',
        domain: 'Intensity',
        controlType: 'Intensity',
        channelCount: 1,
        components: [
          { type: 'intensity', name: 'intensity', offset: 0 }
        ],
        defaultValue: { type: 'scalar', v: 0.0 }
      })
    ]
  },
  {
    id: 'rgb-3ch',
    name: 'LED Par (3ch RGB)',
    controls: [
      createControl('rgb-3ch', 'rgb', {
        label: 'RGB Color',
        domain: 'Color',
        controlType: 'RGB',
        channelCount: 3,
        components: [
          { type: 'red', name: 'red', offset: 0 },
          { type: 'green', name: 'green', offset: 1 },
          { type: 'blue', name: 'blue', offset: 2 }
        ],
        defaultValue: { type: 'rgb', r: 0.0, g: 0.0, b: 0.0 }
      })
    ]
  },
  {
    id: 'rgbw-4ch',
    name: 'LED Par (4ch RGBW)',
    controls: [
      createControl('rgbw-4ch', 'rgbw', {
        label: 'RGBW Color',
        domain: 'Color',
        controlType: 'RGBW',
        channelCount: 4,
        components: [
          { type: 'red', name: 'red', offset: 0 },
          { type: 'green', name: 'green', offset: 1 },
          { type: 'blue', name: 'blue', offset: 2 },
          { type: 'white', name: 'white', offset: 3 }
        ],
        defaultValue: { type: 'rgbw', r: 0.0, g: 0.0, b: 0.0, w: 0.0 }
      })
    ]
  },
  {
    id: 'dimmer-rgb-4ch',
    name: 'Dimmer + RGB (4ch)',
    controls: [
      createControl('dimmer-rgb-4ch', 'intensity', {
        label: 'Dimmer',
        domain: 'Intensity',
        controlType: 'Intensity',
        channelCount: 1,
        components: [
          { type: 'intensity', name: 'intensity', offset: 0 }
        ],
        defaultValue: { type: 'scalar', v: 0.0 }
      }),
      createControl('dimmer-rgb-4ch', 'rgb', {
        label: 'RGB Color',
        domain: 'Color',
        controlType: 'RGB',
        brightnessDrivenByIntensity: true,
        channelCount: 3,
        components: [
          { type: 'red', name: 'red', offset: 1 },
          { type: 'green', name: 'green', offset: 2 },
          { type: 'blue', name: 'blue', offset: 3 }
        ],
        defaultValue: { type: 'rgb', r: 1.0, g: 1.0, b: 1.0 }
      })
    ]
  },
  {
    id: 'pan-tilt-8bit-2ch',
    name: 'Pan/Tilt (8-bit, 2ch)',
    controls: [
      createControl('pan-tilt-8bit-2ch', 'pantilt', {
        label: 'Pan/Tilt',
        domain: 'Position',
        controlType: 'PanTilt',
        channelCount: 2,
        components: [
          { type: 'pan', name: 'pan', offset: 0 },
          { type: 'tilt', name: 'tilt', offset: 1 }
        ],
        defaultValue: { type: 'xy', x: 0.5, y: 0.5 }
      })
    ]
  },
  {
    id: 'pan-tilt-16bit-4ch',
    name: 'Pan/Tilt (16-bit, 4ch)',
    controls: [
      createControl('pan-tilt-16bit-4ch', 'pantilt16', {
        label: 'Pan/Tilt',
        domain: 'Position',
        controlType: 'PanTilt16',
        channelCount: 4,
        components: [
          { type: 'pan', name: 'pan', offset: 0 },
          { type: 'panFine', name: 'panFine', offset: 1 },
          { type: 'tilt', name: 'tilt', offset: 2 },
          { type: 'tiltFine', name: 'tiltFine', offset: 3 }
        ],
        defaultValue: { type: 'xy', x: 0.5, y: 0.5 }
      })
    ]
  },
  {
    id: 'generic-1ch',
    name: 'Generic (1ch)',
    controls: [
      createControl('generic-1ch', 'generic', {
        label: 'Generic',
        domain: 'Other',
        controlType: 'Generic',
        channelCount: 1,
        components: [
          { type: 'generic', name: 'generic', offset: 0 }
        ],
        defaultValue: null
      })
    ]
  },
  {
    id: 'zoom-1ch',
    name: 'Zoom (1ch)',
    controls: [
      createControl('zoom-1ch', 'zoom', {
        label: 'Zoom',
        domain: 'Beam',
        controlType: 'Zoom',
        channelCount: 1,
        components: [
          { type: 'zoom', name: 'zoom', offset: 0 }
        ],
        defaultValue: { type: 'scalar', v: 127 / 255 }
      })
    ]
  },
  {
    id: 'cct-1ch',
    name: 'CCT (1ch)',
    controls: [
      createControl('cct-1ch', 'cct', {
        label: 'CCT',
        domain: 'Color',
        controlType: 'CCT',
        channelCount: 1,
        components: [
          { type: 'cct', name: 'cct', offset: 0 }
        ],
        defaultValue: { type: 'scalar', v: 63 / 255 }
      })
    ]
  },
  {
    id: 'tint-1ch',
    name: 'Tint (1ch)',
    controls: [
      createControl('tint-1ch', 'tint', {
        label: 'Tint',
        domain: 'Color',
        controlType: 'Tint',
        channelCount: 1,
        components: [
          { type: 'tint', name: 'tint', offset: 0 }
        ],
        defaultValue: { type: 'scalar', v: 127 / 255 }
      })
    ]
  }
];

const createBaseConfig = () => ({
  fixtureProfiles: clone(BUILT_IN_FIXTURE_PROFILES),
  network: {
    protocol: 'sacn',
    sacn: {
      universe: 1,
      priority: 100,
      multicast: true,
      unicastDestinations: [],
      bindAddress: ''
    },
    artnet: {
      net: 0,
      subnet: 0,
      universe: 0,
      destination: '255.255.255.255',
      port: 6454,
      bindAddress: ''
    },
    outputFps: 30
  },
  server: {
    port: 3000,
    bindAddress: '0.0.0.0'
  },
  webServer: {
    passcode: '',
    passcodeEnabled: false,
    showConnectedUsers: true,
    defaultClientRole: 'viewer',
    autoUpdateCheck: true
  },
  clients: [],
  fixtures: [],
  looks: [],
  cueLists: [
    {
      id: 'cue-list-main',
      name: 'Main Cue List',
      cueOutTime: 0,
      backTime: 0,
      defaultNewCueTransitionTime: 5,
      shortcuts: {
        enableSpacebarGo: true,
        enableShiftSpacebarFastGo: false,
        enableOptionSpacebarBackPause: false
      },
      cues: []
    }
  ],
  settings: {
    requirePassword: false,
    password: ''
  }
});

const createBlankConfig = () => createBaseConfig();

const createDemoConfig = () => {
  const config = createBaseConfig();

  config.fixtures = [
    {
      id: 'demo-panel-1',
      name: 'Front L',
      profileId: 'rgb-3ch',
      colorMode: 'rgb',
      universe: 1,
      startAddress: 1,
      showOnMain: true,
      tags: []
    },
    {
      id: 'demo-panel-2',
      name: 'Front R',
      profileId: 'rgb-3ch',
      colorMode: 'rgb',
      universe: 1,
      startAddress: 4,
      showOnMain: true,
      tags: []
    },
    {
      id: 'demo-par-1',
      name: 'Back L',
      profileId: 'intensity-1ch',
      universe: 1,
      startAddress: 7,
      showOnMain: true,
      tags: []
    },
    {
      id: 'demo-par-2',
      name: 'Back R',
      profileId: 'intensity-1ch',
      universe: 1,
      startAddress: 8,
      showOnMain: true,
      tags: []
    }
  ];

  config.looks = [
    {
      id: 'demo-look-warm',
      name: 'Warm Dramatic',
      showRecordButton: true,
      excludeFromCues: false,
      color: 'orange',
      tags: [],
      targets: {
        'demo-panel-1': { red: 100, green: 60, blue: 18 },
        'demo-panel-2': { red: 100, green: 60, blue: 18 },
        'demo-par-1': { intensity: 60 },
        'demo-par-2': { intensity: 60 }
      }
    },
    {
      id: 'demo-look-cool',
      name: 'Cool Dramatic',
      showRecordButton: true,
      excludeFromCues: false,
      color: 'cyan',
      tags: [],
      targets: {
        'demo-panel-1': { red: 18, green: 70, blue: 100 },
        'demo-panel-2': { red: 18, green: 70, blue: 100 },
        'demo-par-1': { intensity: 50 },
        'demo-par-2': { intensity: 50 }
      }
    },
    {
      id: 'demo-look-vibrant',
      name: 'Vibrant',
      showRecordButton: true,
      excludeFromCues: false,
      color: 'purple',
      tags: [],
      targets: {
        'demo-panel-1': { red: 62, green: 18, blue: 100 },
        'demo-panel-2': { red: 25, green: 100, blue: 35 },
        'demo-par-1': { intensity: 70 },
        'demo-par-2': { intensity: 70 }
      }
    }
  ];

  return config;
};

module.exports = {
  createBlankConfig,
  createDemoConfig
};
