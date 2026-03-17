const { createBlankConfig } = require('./projectTemplates');

const PROJECT_FILE_FORMAT = 'dmx-dashboard-project';
const PROJECT_FILE_VERSION = 1;
const PROJECT_FILE_EXTENSION = 'dmxd';
const PROJECT_CONFIG_KEYS = [
  'fixtureProfiles',
  'fixtures',
  'looks',
  'cueLists',
  'showLayouts',
  'activeLayoutId',
  'network'
];

const clone = (value) => JSON.parse(JSON.stringify(value));

const extractProjectConfig = (config = {}) => {
  const projectConfig = {};
  PROJECT_CONFIG_KEYS.forEach((key) => {
    if (typeof config[key] !== 'undefined') {
      projectConfig[key] = clone(config[key]);
    }
  });
  return projectConfig;
};

const mergeProjectIntoConfig = (baseConfig = {}, projectConfig = {}) => {
  const mergedConfig = {
    ...clone(createBlankConfig()),
    ...clone(baseConfig)
  };

  PROJECT_CONFIG_KEYS.forEach((key) => {
    if (typeof projectConfig[key] !== 'undefined') {
      mergedConfig[key] = clone(projectConfig[key]);
    }
  });

  mergedConfig.clients = [];
  return mergedConfig;
};

const createProjectDocument = (config = {}) => ({
  format: PROJECT_FILE_FORMAT,
  version: PROJECT_FILE_VERSION,
  exportedAt: new Date().toISOString(),
  project: extractProjectConfig(config)
});

const serializeProjectFile = (config = {}) => (
  JSON.stringify(createProjectDocument(config), null, 2)
);

const parseProjectFileContent = (text) => {
  const parsed = JSON.parse(text);

  if (
    parsed &&
    typeof parsed === 'object' &&
    parsed.format === PROJECT_FILE_FORMAT
  ) {
    if (parsed.project && typeof parsed.project === 'object') {
      return parsed.project;
    }
    if (parsed.config && typeof parsed.config === 'object') {
      return parsed.config;
    }
  }

  return parsed;
};

module.exports = {
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_FORMAT,
  createProjectDocument,
  extractProjectConfig,
  mergeProjectIntoConfig,
  parseProjectFileContent,
  serializeProjectFile
};
