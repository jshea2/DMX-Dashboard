import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Color options for look themes
const LOOK_COLORS = [
  { id: 'blue', name: 'Blue', hex: '#4a90e2' },
  { id: 'red', name: 'Red', hex: '#e24a4a' },
  { id: 'green', name: 'Green', hex: '#4ae24a' },
  { id: 'yellow', name: 'Yellow', hex: '#e2e24a' },
  { id: 'purple', name: 'Purple', hex: '#9b4ae2' },
  { id: 'orange', name: 'Orange', hex: '#e2904a' },
  { id: 'cyan', name: 'Cyan', hex: '#4ae2e2' },
  { id: 'pink', name: 'Pink', hex: '#e24a90' },
];

const TABS = [
  { id: 'network', label: 'Network / Output' },
  { id: 'profiles', label: 'Fixture Profiles' },
  { id: 'patching', label: 'Patching' },
  { id: 'looks', label: 'Looks' },
  { id: 'showlayout', label: 'Show Layout Editor' },
  { id: 'cuelist', label: 'Cue List' },
  { id: 'dmxoutput', label: 'DMX Viewer' },
];

const SettingsPage = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState(false);
  const [networkInterfaces, setNetworkInterfaces] = useState([]);
  const [draggedItem, setDraggedItem] = useState(null);
  const [activeTab, setActiveTab] = useState('network');
  const [collapsedSections, setCollapsedSections] = useState({});
  const [collapsedProfiles, setCollapsedProfiles] = useState({});
  const [collapsedFixtures, setCollapsedFixtures] = useState({});
  const [collapsedLayouts, setCollapsedLayouts] = useState({});
  const [patchViewerUniverse, setPatchViewerUniverse] = useState(1);
  const [draggingFixture, setDraggingFixture] = useState(null);

  const toggleSection = (section) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    fetchConfig();
    fetchNetworkInterfaces();
  }, []);

  const fetchNetworkInterfaces = () => {
    fetch('/api/network-interfaces')
      .then(res => res.json())
      .then(data => setNetworkInterfaces(data))
      .catch(err => console.error('Failed to fetch network interfaces:', err));
  };

  const fetchConfig = () => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch config:', err));
  };

  const handleSave = () => {
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    })
      .then(res => res.json())
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch(err => console.error('Failed to save config:', err));
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset to default configuration?')) {
      fetch('/api/config/reset', { method: 'POST' })
        .then(res => res.json())
        .then(data => setConfig(data.config))
        .catch(err => console.error('Failed to reset config:', err));
    }
  };

  const handleExport = () => {
    fetch('/api/config/export')
      .then(res => res.text())
      .then(data => {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dmx-config.json';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(err => console.error('Failed to export config:', err));
  };

  const handleImport = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          fetch('/api/config/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(imported)
          })
            .then(res => res.json())
            .then(data => setConfig(data.config))
            .catch(err => console.error('Failed to import config:', err));
        } catch (error) {
          alert('Invalid config file');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleCaptureLook = (lookId) => {
    if (window.confirm('Capture current fixture values into this look?')) {
      fetch(`/api/looks/${lookId}/capture`, { method: 'POST' })
        .then(res => res.json())
        .then(() => {
          alert('Look captured successfully!');
          fetchConfig();
        })
        .catch(err => console.error('Failed to capture look:', err));
    }
  };

  const updateConfig = (path, value) => {
    const newConfig = { ...config };
    let current = newConfig;
    const keys = path.split('.');
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    setConfig(newConfig);
  };

  const updateFixture = (index, field, value) => {
    const newConfig = { ...config };
    newConfig.fixtures[index][field] = value;
    setConfig(newConfig);
  };

  const updateLook = (index, field, value) => {
    const newConfig = { ...config };
    newConfig.looks[index][field] = value;
    setConfig(newConfig);
  };

  const updateLookTarget = (lookIndex, fixtureId, field, value) => {
    const newConfig = { ...config };
    if (!newConfig.looks[lookIndex].targets[fixtureId]) {
      newConfig.looks[lookIndex].targets[fixtureId] = {};
    }
    newConfig.looks[lookIndex].targets[fixtureId][field] = parseFloat(value);
    setConfig(newConfig);
  };

  // === FIXTURE PROFILE FUNCTIONS ===
  const addProfile = () => {
    const newConfig = { ...config };
    if (!newConfig.fixtureProfiles) newConfig.fixtureProfiles = [];
    const newId = `profile-${Date.now()}`;
    newConfig.fixtureProfiles.push({
      id: newId,
      name: 'New Profile',
      channels: [{ name: 'intensity', offset: 0 }]
    });
    setConfig(newConfig);
  };

  const removeProfile = (index) => {
    const newConfig = { ...config };
    newConfig.fixtureProfiles.splice(index, 1);
    setConfig(newConfig);
  };

  const duplicateProfile = (index) => {
    const newConfig = { ...config };
    const original = newConfig.fixtureProfiles[index];
    const duplicate = {
      id: `profile-${Date.now()}`,
      name: `${original.name} (Copy)`,
      channels: original.channels.map(ch => ({ ...ch }))
    };
    // Insert right after the original
    newConfig.fixtureProfiles.splice(index + 1, 0, duplicate);
    setConfig(newConfig);
  };

  // Drag and drop for profiles
  const handleProfileDragStart = (e, index) => {
    setDraggedItem({ type: 'profile', index });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleProfileDragOver = (e, index) => {
    e.preventDefault();
    if (draggedItem?.type === 'profile' && draggedItem.index !== index) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleProfileDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'profile' && draggedItem.index !== targetIndex) {
      const newConfig = { ...config };
      const [removed] = newConfig.fixtureProfiles.splice(draggedItem.index, 1);
      newConfig.fixtureProfiles.splice(targetIndex, 0, removed);
      setConfig(newConfig);
    }
    setDraggedItem(null);
  };

  // Drag and drop for channels within a profile
  const handleChannelDragStart = (e, profileIndex, channelIndex) => {
    e.stopPropagation(); // Prevent profile drag from interfering
    setDraggedItem({ type: 'channel', profileIndex, channelIndex });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleChannelDragOver = (e, profileIndex, channelIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'channel' && 
        draggedItem.profileIndex === profileIndex && 
        draggedItem.channelIndex !== channelIndex) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleChannelDrop = (e, profileIndex, targetIndex) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent profile drop from interfering
    if (draggedItem?.type === 'channel' && 
        draggedItem.profileIndex === profileIndex && 
        draggedItem.channelIndex !== targetIndex) {
      const newConfig = { ...config };
      const channels = newConfig.fixtureProfiles[profileIndex].channels;
      const [removed] = channels.splice(draggedItem.channelIndex, 1);
      channels.splice(targetIndex, 0, removed);
      // Recalculate offsets
      channels.forEach((ch, idx) => {
        ch.offset = idx;
      });
      setConfig(newConfig);
    }
    setDraggedItem(null);
  };

  const updateProfile = (index, field, value) => {
    const newConfig = { ...config };
    newConfig.fixtureProfiles[index][field] = value;
    setConfig(newConfig);
  };

  // Preset channel types
  const CHANNEL_TYPES = {
    RGB: [
      { name: 'red', label: 'Red' },
      { name: 'green', label: 'Green' },
      { name: 'blue', label: 'Blue' }
    ],
    RGBW: [
      { name: 'red', label: 'Red' },
      { name: 'green', label: 'Green' },
      { name: 'blue', label: 'Blue' },
      { name: 'white', label: 'White' }
    ],
    Intensity: [
      { name: 'intensity', label: 'Intensity' }
    ]
  };

  const addProfileChannel = (profileIndex) => {
    const newConfig = { ...config };
    const channels = newConfig.fixtureProfiles[profileIndex].channels;
    // Offset is simply the index (0-based), channel display is 1-based
    channels.push({ name: '', offset: channels.length });
    setConfig(newConfig);
  };

  const addProfileChannelType = (profileIndex, typeName) => {
    const newConfig = { ...config };
    const channels = newConfig.fixtureProfiles[profileIndex].channels;
    const typeChannels = CHANNEL_TYPES[typeName];
    
    if (!typeChannels) return;

    const startOffset = channels.length;
    const groupId = `${typeName.toLowerCase()}-${Date.now()}`;
    
    typeChannels.forEach((ch, idx) => {
      channels.push({
        name: ch.name,
        offset: startOffset + idx,
        type: typeName,
        groupId: groupId,
        locked: true
      });
    });
    
    setConfig(newConfig);
  };

  const removeProfileChannel = (profileIndex, channelIndex) => {
    const newConfig = { ...config };
    newConfig.fixtureProfiles[profileIndex].channels.splice(channelIndex, 1);
    // Recalculate offsets to keep them sequential
    newConfig.fixtureProfiles[profileIndex].channels.forEach((ch, idx) => {
      ch.offset = idx;
    });
    setConfig(newConfig);
  };

  const updateProfileChannel = (profileIndex, channelIndex, field, value) => {
    const newConfig = { ...config };
    newConfig.fixtureProfiles[profileIndex].channels[channelIndex][field] = value;
    setConfig(newConfig);
  };

  // === SHOW LAYOUT FUNCTIONS ===
  const generateUrlSlug = (name, existingSlugs = []) => {
    const baseSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50);

    const reservedSlugs = ['home', 'settings', 'dmx-output'];
    let slug = baseSlug;
    let counter = 2;

    while (reservedSlugs.includes(slug) || existingSlugs.includes(slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  };

  const addShowLayout = () => {
    const newConfig = { ...config };
    if (!newConfig.showLayouts) newConfig.showLayouts = [];

    const existingSlugs = newConfig.showLayouts.map(l => l.urlSlug);
    const newId = `layout-${Date.now()}`;
    const name = 'New Layout';
    const urlSlug = generateUrlSlug(name, existingSlugs);

    const newLayout = {
      id: newId,
      name: name,
      urlSlug: urlSlug,
      isHome: newConfig.showLayouts.length === 0, // First layout is home
      showName: true,
      backgroundColor: '#1a1a2e',
      logo: null,
      title: 'Lighting',
      showBlackoutButton: true,
      items: []
    };

    // Add all looks
    newConfig.looks.forEach((look, index) => {
      newLayout.items.push({
        type: 'look',
        id: look.id,
        visible: true,
        order: index
      });
    });

    // Add all fixtures
    const lookCount = newConfig.looks.length;
    newConfig.fixtures.forEach((fixture, index) => {
      newLayout.items.push({
        type: 'fixture',
        id: fixture.id,
        visible: true,
        order: lookCount + index
      });
    });

    newConfig.showLayouts.push(newLayout);
    setConfig(newConfig);
  };

  const removeShowLayout = (index) => {
    const newConfig = { ...config };
    const layout = newConfig.showLayouts[index];

    // Prevent deleting home layout
    if (layout.isHome && newConfig.showLayouts.length > 1) {
      alert('Cannot delete the home layout. Please set another layout as home first.');
      return;
    }

    newConfig.showLayouts.splice(index, 1);

    // If this was the last layout and we deleted it, that's ok
    // The migration will create a default one next time

    setConfig(newConfig);
  };

  const duplicateShowLayout = (index) => {
    const newConfig = { ...config };
    const original = newConfig.showLayouts[index];
    const existingSlugs = newConfig.showLayouts.map(l => l.urlSlug);

    const duplicate = {
      ...original,
      id: `layout-${Date.now()}`,
      name: `${original.name} (Copy)`,
      urlSlug: generateUrlSlug(`${original.name} Copy`, existingSlugs),
      isHome: false, // Duplicates are never home
      items: original.items.map(item => ({ ...item }))
    };

    newConfig.showLayouts.splice(index + 1, 0, duplicate);
    setConfig(newConfig);
  };

  const updateShowLayout = (index, field, value) => {
    const newConfig = { ...config };

    // If updating name, regenerate URL slug
    if (field === 'name') {
      const existingSlugs = newConfig.showLayouts
        .filter((_, i) => i !== index)
        .map(l => l.urlSlug);
      newConfig.showLayouts[index].urlSlug = generateUrlSlug(value, existingSlugs);
    }

    newConfig.showLayouts[index][field] = value;
    setConfig(newConfig);
  };

  const setHomeLayout = (layoutId) => {
    const newConfig = { ...config };
    // Set all to false, then set the selected one to true
    newConfig.showLayouts.forEach(layout => {
      layout.isHome = layout.id === layoutId;
    });
    setConfig(newConfig);
  };

  const handleLogoUpload = (layoutIndex, event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      // Check file size (max 500KB recommended)
      if (file.size > 500 * 1024) {
        alert('Logo file is too large. Please use an image smaller than 500KB.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        updateShowLayout(layoutIndex, 'logo', e.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const updateLayoutItem = (layoutIndex, itemId, field, value) => {
    const newConfig = { ...config };
    const item = newConfig.showLayouts[layoutIndex].items.find(i => i.id === itemId);
    if (item) {
      item[field] = value;
      setConfig(newConfig);
    }
  };

  const toggleAllLayoutItems = (layoutIndex, itemType, visible) => {
    const newConfig = { ...config };
    newConfig.showLayouts[layoutIndex].items
      .filter(item => item.type === itemType)
      .forEach(item => item.visible = visible);
    setConfig(newConfig);
  };

  const handleLayoutItemDragStart = (e, layoutIndex, itemIndex) => {
    setDraggedItem({ type: 'layoutItem', layoutIndex, itemIndex });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleLayoutItemDragOver = (e, layoutIndex, itemIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'layoutItem' &&
        draggedItem.layoutIndex === layoutIndex &&
        draggedItem.itemIndex !== itemIndex) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleLayoutItemDrop = (e, layoutIndex, targetIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'layoutItem' &&
        draggedItem.layoutIndex === layoutIndex &&
        draggedItem.itemIndex !== targetIndex) {
      const newConfig = { ...config };
      const items = newConfig.showLayouts[layoutIndex].items;
      const [removed] = items.splice(draggedItem.itemIndex, 1);
      items.splice(targetIndex, 0, removed);
      // Recalculate order values
      items.forEach((item, idx) => {
        item.order = idx;
      });
      setConfig(newConfig);
    }
    setDraggedItem(null);
  };

  // === SECTION MANAGEMENT FUNCTIONS ===
  const addSection = (layoutIndex) => {
    const newConfig = { ...config };
    const layout = newConfig.showLayouts[layoutIndex];
    if (!layout.sections) layout.sections = [];

    const newSection = {
      id: `section-${Date.now()}`,
      name: 'New Section',
      type: 'custom',
      visible: true,
      showClearButton: false,
      order: layout.sections.length,
      items: []
    };

    layout.sections.push(newSection);
    setConfig(newConfig);
  };

  const removeSection = (layoutIndex, sectionIndex) => {
    const newConfig = { ...config };
    newConfig.showLayouts[layoutIndex].sections.splice(sectionIndex, 1);
    // Recalculate order values
    newConfig.showLayouts[layoutIndex].sections.forEach((section, idx) => {
      section.order = idx;
    });
    setConfig(newConfig);
  };

  const updateSection = (layoutIndex, sectionIndex, field, value) => {
    const newConfig = { ...config };
    newConfig.showLayouts[layoutIndex].sections[sectionIndex][field] = value;
    setConfig(newConfig);
  };

  const addItemToSection = (layoutIndex, sectionIndex, type, id) => {
    const newConfig = { ...config };
    const section = newConfig.showLayouts[layoutIndex].sections[sectionIndex];

    // Check if item already exists in this section
    const exists = section.items.some(item => item.type === type && item.id === id);
    if (exists) return;

    section.items.push({
      type: type,
      id: id,
      visible: true,
      order: section.items.length
    });
    setConfig(newConfig);
  };

  const removeItemFromSection = (layoutIndex, sectionIndex, itemIndex) => {
    const newConfig = { ...config };
    const section = newConfig.showLayouts[layoutIndex].sections[sectionIndex];
    section.items.splice(itemIndex, 1);
    // Recalculate order values
    section.items.forEach((item, idx) => {
      item.order = idx;
    });
    setConfig(newConfig);
  };

  const updateSectionItem = (layoutIndex, sectionIndex, itemId, field, value) => {
    const newConfig = { ...config };
    const section = newConfig.showLayouts[layoutIndex].sections[sectionIndex];
    const item = section.items.find(i => i.id === itemId);
    if (item) {
      item[field] = value;
      setConfig(newConfig);
    }
  };

  // Drag and drop for sections
  const handleSectionDragStart = (e, layoutIndex, sectionIndex) => {
    setDraggedItem({ type: 'section', layoutIndex, sectionIndex });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleSectionDragOver = (e, layoutIndex, sectionIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'section' &&
        draggedItem.layoutIndex === layoutIndex &&
        draggedItem.sectionIndex !== sectionIndex) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleSectionDrop = (e, layoutIndex, targetIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'section' &&
        draggedItem.layoutIndex === layoutIndex &&
        draggedItem.sectionIndex !== targetIndex) {
      const newConfig = { ...config };
      const sections = newConfig.showLayouts[layoutIndex].sections;
      const [removed] = sections.splice(draggedItem.sectionIndex, 1);
      sections.splice(targetIndex, 0, removed);
      // Recalculate order values
      sections.forEach((section, idx) => {
        section.order = idx;
      });
      setConfig(newConfig);
    }
    setDraggedItem(null);
  };

  // Drag and drop for items within a section
  const handleSectionItemDragStart = (e, layoutIndex, sectionIndex, itemIndex) => {
    e.stopPropagation(); // Prevent section drag from interfering
    setDraggedItem({ type: 'sectionItem', layoutIndex, sectionIndex, itemIndex });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleSectionItemDragOver = (e, layoutIndex, sectionIndex, itemIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'sectionItem' &&
        draggedItem.layoutIndex === layoutIndex &&
        draggedItem.sectionIndex === sectionIndex &&
        draggedItem.itemIndex !== itemIndex) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleSectionItemDrop = (e, layoutIndex, sectionIndex, targetIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'sectionItem' &&
        draggedItem.layoutIndex === layoutIndex &&
        draggedItem.sectionIndex === sectionIndex &&
        draggedItem.itemIndex !== targetIndex) {
      const newConfig = { ...config };
      const items = newConfig.showLayouts[layoutIndex].sections[sectionIndex].items;
      const [removed] = items.splice(draggedItem.itemIndex, 1);
      items.splice(targetIndex, 0, removed);
      // Recalculate order values
      items.forEach((item, idx) => {
        item.order = idx;
      });
      setConfig(newConfig);
    }
    setDraggedItem(null);
  };

  // === FIXTURE FUNCTIONS ===
  const addFixture = () => {
    const newConfig = { ...config };
    const newId = `fixture-${Date.now()}`;
    const defaultProfile = newConfig.fixtureProfiles?.[0]?.id || 'intensity-1ch';
    newConfig.fixtures.push({
      id: newId,
      name: 'New Fixture',
      profileId: defaultProfile,
      universe: 1,
      startAddress: 1,
      showOnMain: true
    });
    // Initialize look targets for new fixture
    newConfig.looks.forEach(look => {
      look.targets[newId] = {};
    });
    setConfig(newConfig);
  };

  const removeFixture = (index) => {
    const newConfig = { ...config };
    const fixtureId = newConfig.fixtures[index].id;
    newConfig.fixtures.splice(index, 1);
    // Remove from look targets
    newConfig.looks.forEach(look => {
      delete look.targets[fixtureId];
    });
    setConfig(newConfig);
  };

  // === LOOK FUNCTIONS ===
  const addLook = () => {
    const newConfig = { ...config };
    const newId = `look-${Date.now()}`;
    const targets = {};
    // Initialize targets for all fixtures
    newConfig.fixtures.forEach(fixture => {
      const profile = newConfig.fixtureProfiles?.find(p => p.id === fixture.profileId);
      if (profile) {
        const isRgb = profile.channels?.some(ch => ch.name === 'red') &&
                      profile.channels?.some(ch => ch.name === 'green') &&
                      profile.channels?.some(ch => ch.name === 'blue');
        if (isRgb) {
          targets[fixture.id] = { hue: 0, brightness: 0 };
        } else {
          targets[fixture.id] = {};
          profile.channels.forEach(ch => {
            targets[fixture.id][ch.name] = 0;
          });
        }
      }
    });
    newConfig.looks.push({
      id: newId,
      name: 'New Look',
      targets
    });
    setConfig(newConfig);
  };

  const removeLook = (index) => {
    const newConfig = { ...config };
    newConfig.looks.splice(index, 1);
    setConfig(newConfig);
  };

  if (!config) {
    return (
      <div className="settings-page">
        <div className="settings-header">
          <h1>Loading...</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <button className="settings-btn" onClick={() => navigate('/home')} title="Go to Home">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
        </button>
      </div>

      {saved && (
        <div className="card" style={{ background: '#1a5928', marginBottom: '16px' }}>
          <p style={{ margin: 0, fontSize: '16px' }}>✓ Configuration saved successfully!</p>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tabs-container" style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`btn tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 16px',
              fontSize: '14px',
              background: activeTab === tab.id ? '#4a90e2' : '#333',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              color: activeTab === tab.id ? '#fff' : '#aaa',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Network / Output Tab */}
      {activeTab === 'network' && (
      <div className="card">
        <div className="settings-section">
          <h3 
            onClick={() => toggleSection('network')} 
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <span style={{ transition: 'transform 0.2s', transform: collapsedSections.network ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            Network Output
          </h3>

          {!collapsedSections.network && (
            <>
              <div className="form-group">
            <label>Protocol</label>
            <select
              value={config.network.protocol}
              onChange={(e) => updateConfig('network.protocol', e.target.value)}
            >
              <option value="sacn">sACN (E1.31)</option>
              <option value="artnet">Art-Net</option>
            </select>
          </div>

          {config.network.protocol === 'sacn' && (
            <>
              <div className="form-group">
                <label>Universe</label>
                <input
                  type="number"
                  min="1"
                  max="63999"
                  value={config.network.sacn.universe}
                  onChange={(e) => updateConfig('network.sacn.universe', parseInt(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label>Priority</label>
                <input
                  type="number"
                  min="0"
                  max="200"
                  value={config.network.sacn.priority}
                  onChange={(e) => updateConfig('network.sacn.priority', parseInt(e.target.value))}
                />
                <small>Default: 100</small>
              </div>

              <div className="form-group checkbox-group">
                <input
                  type="checkbox"
                  id="multicast"
                  checked={config.network.sacn.multicast}
                  onChange={(e) => updateConfig('network.sacn.multicast', e.target.checked)}
                />
                <label htmlFor="multicast">Use Multicast</label>
              </div>

              {!config.network.sacn.multicast && (
                <div className="form-group">
                  <label>Unicast Destinations (comma-separated IPs)</label>
                  <input
                    type="text"
                    value={config.network.sacn.unicastDestinations.join(', ')}
                    onChange={(e) => updateConfig(
                      'network.sacn.unicastDestinations',
                      e.target.value.split(',').map(s => s.trim()).filter(s => s)
                    )}
                  />
                </div>
              )}

              <div className="form-group">
                <label>Bind to Network Interface</label>
                <select
                  value={config.network.sacn.bindAddress || ''}
                  onChange={(e) => updateConfig('network.sacn.bindAddress', e.target.value)}
                >
                  <option value="">Auto (All Interfaces)</option>
                  {networkInterfaces.map((iface) => (
                    <option key={iface.address} value={iface.address}>
                      {iface.label}
                    </option>
                  ))}
                </select>
                <small>Bind sACN output to specific network interface</small>
              </div>
            </>
          )}

          {config.network.protocol === 'artnet' && (
            <>
              <div className="form-group">
                <label>Net</label>
                <input
                  type="number"
                  min="0"
                  max="127"
                  value={config.network.artnet.net}
                  onChange={(e) => updateConfig('network.artnet.net', parseInt(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label>Subnet</label>
                <input
                  type="number"
                  min="0"
                  max="15"
                  value={config.network.artnet.subnet}
                  onChange={(e) => updateConfig('network.artnet.subnet', parseInt(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label>Universe</label>
                <input
                  type="number"
                  min="0"
                  max="15"
                  value={config.network.artnet.universe}
                  onChange={(e) => updateConfig('network.artnet.universe', parseInt(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label>Destination IP</label>
                <input
                  type="text"
                  value={config.network.artnet.destination}
                  onChange={(e) => updateConfig('network.artnet.destination', e.target.value)}
                />
                <small>Use 255.255.255.255 for broadcast</small>
              </div>

              <div className="form-group">
                <label>Bind to Network Interface</label>
                <select
                  value={config.network.artnet.bindAddress || ''}
                  onChange={(e) => updateConfig('network.artnet.bindAddress', e.target.value)}
                >
                  <option value="">Auto (All Interfaces)</option>
                  {networkInterfaces.map((iface) => (
                    <option key={iface.address} value={iface.address}>
                      {iface.label}
                    </option>
                  ))}
                </select>
                <small>Bind Art-Net output to specific network interface</small>
              </div>
            </>
          )}

          <div className="form-group">
            <label>Output FPS</label>
            <input
              type="number"
              min="10"
              max="60"
              value={config.network.outputFps}
              onChange={(e) => updateConfig('network.outputFps', parseInt(e.target.value))}
            />
            <small>Recommended: 30-40</small>
          </div>
            </>
          )}
        </div>

        <div className="settings-section">
          <h3 
            onClick={() => toggleSection('server')} 
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <span style={{ transition: 'transform 0.2s', transform: collapsedSections.server ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            Web Server Network
          </h3>

          {!collapsedSections.server && (
            <>
              <div className="form-group">
            <label>Server Port</label>
            <input
              type="number"
              min="1"
              max="65535"
              value={config.server?.port || 3001}
              onChange={(e) => updateConfig('server.port', parseInt(e.target.value))}
            />
            <small>Default: 3001 (restart required after change)</small>
          </div>

          <div className="form-group">
            <label>Server Bind Address</label>
            <input
              type="text"
              value={config.server?.bindAddress || '0.0.0.0'}
              onChange={(e) => updateConfig('server.bindAddress', e.target.value)}
              placeholder="0.0.0.0"
            />
            <small>0.0.0.0 = all interfaces, or specify IP for one interface (restart required)</small>
          </div>
            </>
          )}
        </div>
      </div>
      )}

      {/* Fixture Profiles Tab */}
      {activeTab === 'profiles' && (
      <div className="card">
        <div className="settings-section">
          <h3>Fixture Profiles</h3>
          
              <p style={{ fontSize: '14px', color: '#888', marginBottom: '16px', marginTop: '12px' }}>
                Define reusable fixture types with channel configurations
              </p>

              {(config.fixtureProfiles || []).map((profile, profileIndex) => {
                const isCollapsed = collapsedProfiles[profile.id];
                const channelSummary = profile.channels.length + ' ch: ' + 
                  profile.channels.map(ch => ch.name).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4).join(', ') +
                  (profile.channels.length > 4 ? '...' : '');
                
                return (
            <div 
              key={profile.id} 
              className="fixture-editor" 
              style={{ position: 'relative', padding: isCollapsed ? '12px' : '16px' }}
              draggable
              onDragStart={(e) => handleProfileDragStart(e, profileIndex)}
              onDragOver={(e) => handleProfileDragOver(e, profileIndex)}
              onDrop={(e) => handleProfileDrop(e, profileIndex)}
            >
              {/* Header row - always visible */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ cursor: 'grab', color: '#666', fontSize: '16px', padding: '4px' }} title="Drag to reorder">⋮⋮</div>
                <span 
                  onClick={() => setCollapsedProfiles(prev => ({ ...prev, [profile.id]: !prev[profile.id] }))}
                  style={{ cursor: 'pointer', color: '#888', transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                >▼</span>
                <input
                  type="text"
                  value={profile.name}
                  onChange={(e) => updateProfile(profileIndex, 'name', e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ flex: 1, fontWeight: '500', background: '#1a1a2e', border: '1px solid #333', borderRadius: '4px', padding: '8px 12px', color: '#f0f0f0', fontSize: '16px' }}
                />
                {isCollapsed && (
                  <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>{channelSummary}</span>
                )}
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => duplicateProfile(profileIndex)}
                    style={{ padding: '4px 8px', fontSize: '12px' }}
                    title="Duplicate Profile"
                  >⧉</button>
                  <button
                    className="btn btn-danger btn-small"
                    onClick={() => removeProfile(profileIndex)}
                    style={{ padding: '4px 8px', fontSize: '12px' }}
                    title="Delete Profile"
                  >×</button>
                </div>
              </div>

              {/* Channels - collapsible */}
              {!isCollapsed && (
              <>
              <label style={{ display: 'block', marginTop: '12px', marginBottom: '8px', fontWeight: '500' }}>
                Channels
              </label>

              {(() => {
                // Group consecutive channels by groupId for display
                const displayItems = [];
                let i = 0;
                while (i < profile.channels.length) {
                  const channel = profile.channels[i];
                  if (channel.groupId) {
                    // Find all channels in this group
                    const groupChannels = [];
                    const groupId = channel.groupId;
                    let j = i;
                    while (j < profile.channels.length && profile.channels[j].groupId === groupId) {
                      groupChannels.push({ ...profile.channels[j], originalIndex: j });
                      j++;
                    }
                    displayItems.push({ type: 'group', channels: groupChannels, typeName: channel.type, startIndex: i });
                    i = j;
                  } else {
                    displayItems.push({ type: 'single', channel, index: i });
                    i++;
                  }
                }

                return displayItems.map((item, displayIndex) => {
                  if (item.type === 'group') {
                    const startCh = item.startIndex + 1;
                    const endCh = item.startIndex + item.channels.length;
                    return (
                      <div 
                        key={`group-${displayIndex}`} 
                        style={{ 
                          display: 'flex', 
                          gap: '12px', 
                          alignItems: 'center', 
                          marginBottom: '8px', 
                          background: '#1a2a1a', 
                          padding: '10px 12px', 
                          borderRadius: '6px',
                          border: '1px solid #2a4a2a'
                        }}
                        onDragOver={(e) => { e.preventDefault(); handleChannelDragOver(e, profileIndex, item.startIndex); }}
                        onDrop={(e) => handleChannelDrop(e, profileIndex, item.startIndex)}
                      >
                        <div 
                          draggable="true"
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', item.startIndex);
                            handleChannelDragStart(e, profileIndex, item.startIndex);
                          }}
                          style={{ 
                            color: '#888', 
                            cursor: 'grab', 
                            padding: '8px 4px',
                            fontSize: '18px',
                            userSelect: 'none'
                          }}
                          title="Drag to reorder"
                        >☰</div>
                        <span style={{ minWidth: '80px', fontWeight: '500', color: '#888' }}>
                          Ch {startCh}{item.channels.length > 1 ? ` - ${endCh}` : ''}
                        </span>
                        <span style={{ flex: 1, color: '#6c8', fontWeight: '500' }}>
                          {item.typeName}
                        </span>
                        <button
                          className="btn btn-danger btn-small"
                          onClick={() => {
                            // Remove all channels in this group
                            const newConfig = { ...config };
                            newConfig.fixtureProfiles[profileIndex].channels = 
                              newConfig.fixtureProfiles[profileIndex].channels.filter(ch => ch.groupId !== item.channels[0].groupId);
                            // Recalculate offsets
                            newConfig.fixtureProfiles[profileIndex].channels.forEach((ch, idx) => {
                              ch.offset = idx;
                            });
                            setConfig(newConfig);
                          }}
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  } else {
                    return (
                      <div 
                        key={`single-${item.index}`} 
                        style={{ 
                          display: 'flex', 
                          gap: '12px', 
                          alignItems: 'center', 
                          marginBottom: '8px',
                          background: '#252538',
                          padding: '10px 12px',
                          borderRadius: '6px',
                          border: '1px solid #333'
                        }}
                        onDragOver={(e) => { e.preventDefault(); handleChannelDragOver(e, profileIndex, item.index); }}
                        onDrop={(e) => handleChannelDrop(e, profileIndex, item.index)}
                      >
                        <div 
                          draggable="true"
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', item.index);
                            handleChannelDragStart(e, profileIndex, item.index);
                          }}
                          style={{ 
                            color: '#888', 
                            cursor: 'grab', 
                            padding: '8px 4px',
                            fontSize: '18px',
                            userSelect: 'none'
                          }}
                          title="Drag to reorder"
                        >☰</div>
                        <span style={{ minWidth: '50px', fontWeight: '500', color: '#888' }}>
                          Ch {item.index + 1}
                        </span>
                        <input
                          type="text"
                          placeholder="e.g. Strobe, Gobo, Pan"
                          value={item.channel.name}
                          onChange={(e) => updateProfileChannel(profileIndex, item.index, 'name', e.target.value)}
                          style={{ flex: 1, background: '#1a1a2e', border: '1px solid #333', borderRadius: '4px', padding: '8px 12px', color: '#f0f0f0', fontSize: '14px' }}
                        />
                        <button
                          className="btn btn-danger btn-small"
                          onClick={() => removeProfileChannel(profileIndex, item.index)}
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  }
                });
              })()}

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => addProfileChannel(profileIndex)}
                >
                  + Add Channel
                </button>
                <select
                  className="btn btn-secondary btn-small"
                  style={{ cursor: 'pointer' }}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addProfileChannelType(profileIndex, e.target.value);
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="">+ Add Type</option>
                  <option value="RGB">RGB (3 ch)</option>
                  <option value="RGBW">RGBW (4 ch)</option>
                  <option value="Intensity">Intensity (1 ch)</option>
                </select>
              </div>
              </>
              )}
            </div>
          );
          })}

              <button className="btn btn-primary" onClick={addProfile} style={{ marginTop: '12px' }}>
                + Add Profile
              </button>
        </div>
      </div>
      )}

      {/* Patching Tab */}
      {activeTab === 'patching' && (
      <div className="card">
        <div className="settings-section">
          <h3>Fixture Patching</h3>

              {config.fixtures.map((fixture, index) => {
                const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
                const isCollapsed = collapsedFixtures[fixture.id];
                const channelCount = profile?.channels?.length || 0;
                const endAddress = fixture.startAddress + channelCount - 1;
                const summary = `${profile?.name || 'No Profile'} • U${fixture.universe} • Ch ${fixture.startAddress}${channelCount > 1 ? `-${endAddress}` : ''}`;
                
                return (
                  <div key={fixture.id} className="fixture-editor" style={{ position: 'relative', padding: isCollapsed ? '12px' : '16px' }}>
                    {/* Header row - always visible */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span 
                        onClick={() => setCollapsedFixtures(prev => ({ ...prev, [fixture.id]: !prev[fixture.id] }))}
                        style={{ cursor: 'pointer', color: '#888', transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                      >▼</span>
                      <input
                        type="text"
                        value={fixture.name}
                        onChange={(e) => updateFixture(index, 'name', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ flex: 1, fontWeight: '500', background: '#1a1a2e', border: '1px solid #333', borderRadius: '4px', padding: '8px 12px', color: '#f0f0f0', fontSize: '16px' }}
                      />
                      {isCollapsed && (
                        <span style={{ color: '#666', fontSize: '12px', whiteSpace: 'nowrap' }}>{summary}</span>
                      )}
                      <button
                        className="btn btn-danger btn-small"
                        onClick={() => removeFixture(index)}
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                      >×</button>
                    </div>

                    {/* Expanded content */}
                    {!isCollapsed && (
                    <>
                    <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
                      <div className="form-group" style={{ flex: 1, minWidth: '150px', marginBottom: '8px' }}>
                        <label>Profile</label>
                        <select
                          value={fixture.profileId || ''}
                          onChange={(e) => updateFixture(index, 'profileId', e.target.value)}
                        >
                          {(config.fixtureProfiles || []).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ width: '100px', marginBottom: '8px' }}>
                        <label>Universe</label>
                        <input
                          type="number"
                          min="0"
                          max="63999"
                          value={fixture.universe}
                          onChange={(e) => updateFixture(index, 'universe', parseInt(e.target.value))}
                        />
                      </div>
                      <div className="form-group" style={{ width: '100px', marginBottom: '8px' }}>
                        <label>Start Address</label>
                        <input
                          type="number"
                          min="1"
                          max="512"
                          value={fixture.startAddress}
                          onChange={(e) => updateFixture(index, 'startAddress', parseInt(e.target.value))}
                        />
                      </div>
                    </div>

                    {profile && (
                      <div style={{ color: '#888', fontSize: '12px', marginBottom: '8px' }}>
                        Channels: {profile.channels.map(ch => `${ch.name}: ${fixture.startAddress + ch.offset}`).join(', ')}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div className="form-group checkbox-group" style={{ marginBottom: 0 }}>
                        <input
                          type="checkbox"
                          id={`hideOnMain-${fixture.id}`}
                          checked={fixture.showOnMain === false}
                          onChange={(e) => updateFixture(index, 'showOnMain', !e.target.checked)}
                        />
                        <label htmlFor={`hideOnMain-${fixture.id}`}>Hide on Main UI</label>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '12px', color: '#666' }}>Fixture ID: </label>
                        <input
                          type="text"
                          value={fixture.id}
                          onChange={(e) => updateFixture(index, 'id', e.target.value)}
                          style={{ width: '120px', fontSize: '12px', padding: '4px 8px' }}
                        />
                      </div>
                    </div>
                    </>
                    )}
                  </div>
                );
              })}

              <button className="btn btn-primary" onClick={addFixture} style={{ marginTop: '12px' }}>
                + Add Fixture
              </button>

              {/* Patch Viewer */}
              <div style={{ marginTop: '24px', borderTop: '1px solid #333', paddingTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ margin: 0 }}>Patch Viewer</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '12px', color: '#888' }}>Universe:</label>
                    <select
                      value={patchViewerUniverse}
                      onChange={(e) => setPatchViewerUniverse(parseInt(e.target.value))}
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                    >
                      {/* Always show universes 1-10, plus any that have fixtures */}
                      {[...new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...config.fixtures.map(f => f.universe)])].sort((a, b) => a - b).map(u => (
                        <option key={u} value={u}>Universe {u}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {/* 512 channel grid - 24 columns x ~22 rows */}
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(24, 1fr)', 
                  gap: '2px', 
                  background: '#222',
                  padding: '2px',
                  borderRadius: '4px',
                  fontSize: '10px'
                }}>
                  {Array.from({ length: 512 }, (_, i) => {
                    const channel = i + 1;
                    const fixturesAtChannel = config.fixtures
                      .filter(f => f.universe === patchViewerUniverse)
                      .filter(f => {
                        const profile = config.fixtureProfiles?.find(p => p.id === f.profileId);
                        const channelCount = profile?.channels?.length || 1;
                        return channel >= f.startAddress && channel < f.startAddress + channelCount;
                      });
                    
                    const hasOverlap = fixturesAtChannel.length > 1;
                    const fixture = fixturesAtChannel[0];
                    const profile = fixture ? config.fixtureProfiles?.find(p => p.id === fixture.profileId) : null;
                    const channelOffset = fixture ? channel - fixture.startAddress : 0;
                    const channelName = profile?.channels?.[channelOffset]?.name || '';
                    const channelCount = profile?.channels?.length || 1;
                    
                    // Determine border for fixture grouping
                    const isFirstChannel = fixture && channel === fixture.startAddress;
                    const isLastChannel = fixture && channel === fixture.startAddress + channelCount - 1;
                    
                    // Generate a color based on fixture id
                    const getFixtureColor = (f) => {
                      if (!f) return '#333';
                      const hash = f.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
                      const hue = hash % 360;
                      return `hsl(${hue}, 50%, 35%)`;
                    };
                    
                    const borderStyle = {};
                    if (fixture && !hasOverlap) {
                      if (isFirstChannel) borderStyle.borderLeft = '2px solid rgba(255,255,255,0.8)';
                      if (isLastChannel) borderStyle.borderRight = '2px solid rgba(255,255,255,0.8)';
                      // Top border for first row of fixture
                      if (channel <= fixture.startAddress + 23 && channel >= fixture.startAddress) {
                        borderStyle.borderTop = '2px solid rgba(255,255,255,0.8)';
                      }
                      // Bottom border for last row of fixture  
                      const lastRowStart = fixture.startAddress + channelCount - ((channelCount - 1) % 24) - 1;
                      if (channel >= fixture.startAddress + channelCount - 24 || channel > lastRowStart) {
                        borderStyle.borderBottom = '2px solid rgba(255,255,255,0.8)';
                      }
                    }
                    
                    return (
                      <div
                        key={channel}
                        style={{
                          background: hasOverlap ? '#b86800' : (fixture ? getFixtureColor(fixture) : '#1a1a2e'),
                          padding: '4px 2px',
                          textAlign: 'center',
                          color: fixture ? '#fff' : '#555',
                          cursor: fixture ? 'grab' : 'default',
                          minHeight: '24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          ...borderStyle
                        }}
                        title={fixture ? `${fixture.name}\n${channelName} (Ch ${channel})\nDrag to move` : `Ch ${channel} - Empty`}
                        draggable={!!fixture}
                        onDragStart={(e) => {
                          if (fixture) {
                            setDraggingFixture(fixture.id);
                            e.dataTransfer.setData('fixtureId', fixture.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }
                        }}
                        onDragEnd={() => setDraggingFixture(null)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const fixtureId = e.dataTransfer.getData('fixtureId');
                          if (fixtureId) {
                            const fixtureIndex = config.fixtures.findIndex(f => f.id === fixtureId);
                            if (fixtureIndex !== -1) {
                              updateFixture(fixtureIndex, 'startAddress', channel);
                            }
                          }
                          setDraggingFixture(null);
                        }}
                      >
                        {channel}
                      </div>
                    );
                  })}
                </div>
                
                {/* Legend */}
                <div style={{ marginTop: '12px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px' }}>
                  {config.fixtures
                    .filter(f => f.universe === patchViewerUniverse)
                    .map(fixture => {
                      const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
                      const channelCount = profile?.channels?.length || 1;
                      const hash = fixture.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
                      const hue = hash % 360;
                      return (
                        <div key={fixture.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <div style={{ width: '12px', height: '12px', background: `hsl(${hue}, 50%, 35%)`, borderRadius: '2px', border: '1px solid rgba(255,255,255,0.5)' }} />
                          <span>{fixture.name} ({fixture.startAddress}-{fixture.startAddress + channelCount - 1})</span>
                        </div>
                      );
                    })}
                  {config.fixtures.filter(f => f.universe === patchViewerUniverse).length === 0 && (
                    <span style={{ color: '#666', fontStyle: 'italic' }}>No fixtures patched in this universe</span>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div style={{ width: '12px', height: '12px', background: '#b86800', borderRadius: '2px' }} />
                    <span style={{ color: '#b86800' }}>Overlap</span>
                  </div>
                </div>
              </div>
        </div>
      </div>
      )}

      {/* Looks Tab */}
      {activeTab === 'looks' && (
      <div className="card">
        <div className="settings-section">
          <h3>Look Editor</h3>

              {config.looks.map((look, lookIndex) => (
            <div key={look.id} className="look-editor" style={{ position: 'relative' }}>
              <button
                className="btn btn-danger btn-small"
                onClick={() => removeLook(lookIndex)}
                style={{ position: 'absolute', top: '8px', right: '8px', padding: '4px 8px', fontSize: '12px' }}
              >
                ×
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0 }}>{look.name}</h4>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => handleCaptureLook(look.id)}
                >
                  Record Current
                </button>
              </div>

              <div className="form-group">
                <label>Look Name</label>
                <input
                  type="text"
                  value={look.name}
                  onChange={(e) => updateLook(lookIndex, 'name', e.target.value)}
                />
              </div>

              <div className="form-group checkbox-group">
                <input
                  type="checkbox"
                  id={`showRecordBtn-${look.id}`}
                  checked={look.showRecordButton === true}
                  onChange={(e) => updateLook(lookIndex, 'showRecordButton', e.target.checked)}
                />
                <label htmlFor={`showRecordBtn-${look.id}`}>Show Record Button in Main UI</label>
              </div>

              <div className="form-group">
                <label>Color Theme</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {LOOK_COLORS.map(color => (
                    <button
                      key={color.id}
                      onClick={() => updateLook(lookIndex, 'color', color.id)}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: color.hex,
                        border: look.color === color.id ? '3px solid #fff' : '2px solid #555',
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>

              <label style={{ display: 'block', marginTop: '12px', marginBottom: '8px', fontWeight: '500' }}>
                Target Values
              </label>

              <div className="look-targets">
                {config.fixtures.map(fixture => {
                  const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
                  if (!profile) return null;
                  
                  const targets = look.targets[fixture.id] || {};

                  return (
                    <div key={fixture.id} className="fixture-targets" style={{ marginBottom: '16px', padding: '12px', background: '#1a1a2e', borderRadius: '8px' }}>
                      <h5 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#ccc' }}>{fixture.name}</h5>
                      
                      {profile.channels.map(channel => (
                        <div key={channel.name} className="slider-group" style={{ marginBottom: '8px' }}>
                          <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span>{channel.name.charAt(0).toUpperCase() + channel.name.slice(1)}</span>
                            <span>{targets[channel.name] || 0}%</span>
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={targets[channel.name] || 0}
                            onChange={(e) => updateLookTarget(lookIndex, fixture.id, channel.name, e.target.value)}
                            style={{ width: '100%' }}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

              <button className="btn btn-primary" onClick={addLook} style={{ marginTop: '12px' }}>
                + Add Look
              </button>
        </div>
      </div>
      )}

      {/* Show Layout Editor Tab */}
      {activeTab === 'showlayout' && (
      <div className="card">
        <div className="settings-section">
          <h3>Show Layout Editor</h3>

          <p style={{ fontSize: '14px', color: '#888', marginBottom: '16px', marginTop: '12px' }}>
            Create custom layouts that control what appears on the main lighting control page.
            Each layout can have its own branding, colors, and selection of looks/fixtures.
            Access layouts at <code>/home</code> or <code>/layout-name</code>.
          </p>

          {(config.showLayouts || []).map((layout, layoutIndex) => {
            const isCollapsed = collapsedLayouts[layout.id];
            const isHome = layout.isHome;

            return (
              <div
                key={layout.id}
                className="fixture-editor"
                style={{
                  position: 'relative',
                  padding: isCollapsed ? '12px' : '16px',
                  border: isHome ? '2px solid #4a90e2' : '1px solid #444',
                  background: isHome ? '#2a3a4a' : '#333',
                  marginBottom: '12px'
                }}
              >
                {/* Header row - always visible */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    onClick={() => setCollapsedLayouts(prev => ({ ...prev, [layout.id]: !prev[layout.id] }))}
                    style={{ cursor: 'pointer', color: '#888', transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                  >▼</span>
                  <input
                    type="text"
                    value={layout.name}
                    onChange={(e) => updateShowLayout(layoutIndex, 'name', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: 1, fontWeight: '500', background: '#1a1a2e', border: '1px solid #333', borderRadius: '4px', padding: '8px 12px', color: '#f0f0f0', fontSize: '16px' }}
                  />
                  {isHome && (
                    <span style={{ color: '#4a90e2', fontSize: '12px', fontWeight: '600', padding: '4px 8px', background: '#1a3a5a', borderRadius: '4px' }}>
                      HOME
                    </span>
                  )}
                  {isCollapsed && (
                    <span style={{ color: '#666', fontSize: '12px' }}>
                      {layout.items.filter(i => i.visible).length} visible items • /{layout.urlSlug}
                    </span>
                  )}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {!isHome && (
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => setHomeLayout(layout.id)}
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                        title="Set as Home Layout"
                      >
                        Set Home
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => duplicateShowLayout(layoutIndex)}
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                      title="Duplicate Layout"
                    >⧉</button>
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => removeShowLayout(layoutIndex)}
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                      title="Delete Layout"
                    >×</button>
                  </div>
                </div>

                {/* Expanded content */}
                {!isCollapsed && (
                <>
                  {/* URL Slug Display */}
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
                    URL: <code style={{ background: '#1a1a2e', padding: '2px 6px', borderRadius: '3px' }}>/{layout.urlSlug}</code>
                  </div>

                  {/* Layout Properties */}
                  <div style={{ marginTop: '16px', padding: '12px', background: '#252538', borderRadius: '6px' }}>
                    <h4 style={{ fontSize: '14px', marginBottom: '12px', color: '#4a90e2' }}>Layout Properties</h4>

                    {/* Logo Upload */}
                    <div className="form-group">
                      <label>Logo Header</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <label className="btn btn-secondary btn-small" style={{ marginBottom: 0, cursor: 'pointer' }}>
                          Upload Image
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/jpg"
                            onChange={(e) => handleLogoUpload(layoutIndex, e)}
                            style={{ display: 'none' }}
                          />
                        </label>
                        {layout.logo && (
                          <>
                            <button
                              className="btn btn-danger btn-small"
                              onClick={() => updateShowLayout(layoutIndex, 'logo', null)}
                              style={{ marginBottom: 0 }}
                            >
                              Remove Logo
                            </button>
                            <img
                              src={layout.logo}
                              alt="Logo preview"
                              style={{ maxHeight: '40px', maxWidth: '200px', borderRadius: '4px' }}
                            />
                          </>
                        )}
                      </div>
                      <small>Displayed as banner above the title on main page (max 500KB)</small>
                    </div>

                    {/* Background Color */}
                    <div className="form-group">
                      <label>Background Color</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="color"
                          value={layout.backgroundColor}
                          onChange={(e) => updateShowLayout(layoutIndex, 'backgroundColor', e.target.value)}
                          style={{ width: '60px', height: '40px', cursor: 'pointer' }}
                        />
                        <input
                          type="text"
                          value={layout.backgroundColor}
                          onChange={(e) => updateShowLayout(layoutIndex, 'backgroundColor', e.target.value)}
                          style={{ flex: 1, fontFamily: 'monospace' }}
                        />
                      </div>
                      <small>Main page background color</small>
                    </div>

                    {/* Title */}
                    <div className="form-group">
                      <label>Page Title</label>
                      <input
                        type="text"
                        value={layout.title}
                        onChange={(e) => updateShowLayout(layoutIndex, 'title', e.target.value)}
                        placeholder="Lighting"
                      />
                    </div>

                    {/* Show/Hide Options */}
                    <div className="form-group checkbox-group">
                      <input
                        type="checkbox"
                        id={`showName-${layout.id}`}
                        checked={layout.showName === true}
                        onChange={(e) => updateShowLayout(layoutIndex, 'showName', e.target.checked)}
                      />
                      <label htmlFor={`showName-${layout.id}`}>Show Layout Name on Main Page</label>
                    </div>

                    <div className="form-group checkbox-group">
                      <input
                        type="checkbox"
                        id={`showBlackout-${layout.id}`}
                        checked={layout.showBlackoutButton !== false}
                        onChange={(e) => updateShowLayout(layoutIndex, 'showBlackoutButton', e.target.checked)}
                      />
                      <label htmlFor={`showBlackout-${layout.id}`}>Show Blackout Button</label>
                    </div>
                  </div>

                  {/* Sections Configuration */}
                  <div style={{ marginTop: '16px' }}>
                    <h4 style={{ fontSize: '14px', marginBottom: '12px', color: '#4a90e2' }}>Sections</h4>
                    <p style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
                      Sections organize your layout. Static sections (Looks/Fixtures) can only contain their type. Custom sections can mix any items.
                    </p>

                    {/* Sections List */}
                    {(layout.sections || [])
                      .sort((a, b) => a.order - b.order)
                      .map((section, sectionIndex) => {
                        const isStatic = section.type === 'static';

                        return (
                          <div
                            key={section.id}
                            draggable
                            onDragStart={(e) => handleSectionDragStart(e, layoutIndex, sectionIndex)}
                            onDragOver={(e) => handleSectionDragOver(e, layoutIndex, sectionIndex)}
                            onDrop={(e) => handleSectionDrop(e, layoutIndex, sectionIndex)}
                            style={{
                              background: '#252538',
                              padding: '12px',
                              borderRadius: '6px',
                              marginBottom: '12px',
                              border: isStatic ? '1px solid #4a4a6a' : '1px solid #444'
                            }}
                          >
                            {/* Section Header */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                              <div style={{ color: '#666', fontSize: '14px', cursor: 'grab' }}>☰</div>
                              <input
                                type="text"
                                value={section.name}
                                onChange={(e) => updateSection(layoutIndex, sectionIndex, 'name', e.target.value)}
                                disabled={isStatic}
                                style={{
                                  flex: 1,
                                  background: isStatic ? '#1a1a2e80' : '#1a1a2e',
                                  border: '1px solid #333',
                                  borderRadius: '4px',
                                  padding: '6px 10px',
                                  color: '#f0f0f0',
                                  fontSize: '14px',
                                  fontWeight: '500'
                                }}
                              />
                              {isStatic && (
                                <span style={{
                                  fontSize: '10px',
                                  padding: '3px 8px',
                                  background: '#4a4a6a',
                                  borderRadius: '3px',
                                  color: '#ccc',
                                  textTransform: 'uppercase',
                                  fontWeight: '600'
                                }}>
                                  STATIC
                                </span>
                              )}
                              <div className="form-group checkbox-group" style={{ marginBottom: 0 }}>
                                <input
                                  type="checkbox"
                                  id={`section-visible-${section.id}`}
                                  checked={section.visible !== false}
                                  onChange={(e) => updateSection(layoutIndex, sectionIndex, 'visible', e.target.checked)}
                                />
                                <label htmlFor={`section-visible-${section.id}`} style={{ fontSize: '12px' }}>
                                  Visible
                                </label>
                              </div>
                              {!isStatic && (
                                <button
                                  className="btn btn-danger btn-small"
                                  onClick={() => removeSection(layoutIndex, sectionIndex)}
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                  title="Delete Section"
                                >×</button>
                              )}
                            </div>

                            {/* Section Options */}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                              <label style={{ fontSize: '12px', color: '#888' }}>
                                <input
                                  type="checkbox"
                                  checked={section.showClearButton === true}
                                  onChange={(e) => updateSection(layoutIndex, sectionIndex, 'showClearButton', e.target.checked)}
                                  style={{ marginRight: '4px' }}
                                />
                                Show Clear Button
                              </label>
                            </div>

                            {/* Add Item Dropdown */}
                            <div style={{ marginBottom: '8px' }}>
                              <select
                                onChange={(e) => {
                                  const [type, id] = e.target.value.split(':');
                                  if (type && id) {
                                    addItemToSection(layoutIndex, sectionIndex, type, id);
                                    e.target.value = '';
                                  }
                                }}
                                style={{
                                  width: '100%',
                                  background: '#1a1a2e',
                                  border: '1px solid #333',
                                  borderRadius: '4px',
                                  padding: '6px 10px',
                                  color: '#f0f0f0',
                                  fontSize: '12px'
                                }}
                              >
                                <option value="">+ Add Item to Section...</option>
                                <optgroup label="Looks">
                                  {config.looks
                                    .filter(look => !isStatic || section.staticType === 'looks')
                                    .map(look => (
                                      <option key={look.id} value={`look:${look.id}`}>
                                        {look.name}
                                      </option>
                                    ))}
                                </optgroup>
                                <optgroup label="Fixtures">
                                  {config.fixtures
                                    .filter(fixture => !isStatic || section.staticType === 'fixtures')
                                    .map(fixture => (
                                      <option key={fixture.id} value={`fixture:${fixture.id}`}>
                                        {fixture.name}
                                      </option>
                                    ))}
                                </optgroup>
                              </select>
                            </div>

                            {/* Items in Section */}
                            <div style={{ background: '#1a1a2e', padding: '8px', borderRadius: '4px' }}>
                              {section.items.length === 0 && (
                                <p style={{ color: '#666', fontSize: '12px', margin: 0, padding: '8px', textAlign: 'center' }}>
                                  No items in this section
                                </p>
                              )}
                              {section.items
                                .sort((a, b) => a.order - b.order)
                                .map((item, itemIndex) => {
                                  let itemName = '';
                                  let itemType = item.type;

                                  if (item.type === 'look') {
                                    const look = config.looks.find(l => l.id === item.id);
                                    itemName = look?.name || `Look ${item.id}`;
                                  } else {
                                    const fixture = config.fixtures.find(f => f.id === item.id);
                                    itemName = fixture?.name || `Fixture ${item.id}`;
                                  }

                                  return (
                                    <div
                                      key={item.id}
                                      draggable
                                      onDragStart={(e) => handleSectionItemDragStart(e, layoutIndex, sectionIndex, itemIndex)}
                                      onDragOver={(e) => handleSectionItemDragOver(e, layoutIndex, sectionIndex, itemIndex)}
                                      onDrop={(e) => handleSectionItemDrop(e, layoutIndex, sectionIndex, itemIndex)}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        padding: '6px 8px',
                                        marginBottom: '4px',
                                        background: item.visible ? '#2a3a2a' : '#3a2a2a',
                                        borderRadius: '4px',
                                        border: item.visible ? '1px solid #4a6a4a' : '1px solid #6a4a4a',
                                        cursor: 'grab'
                                      }}
                                    >
                                      <div style={{ color: '#666', fontSize: '12px' }}>☰</div>
                                      <span style={{
                                        fontSize: '9px',
                                        padding: '2px 5px',
                                        background: itemType === 'look' ? '#4a4a6a' : '#6a4a4a',
                                        borderRadius: '3px',
                                        color: '#ccc',
                                        textTransform: 'uppercase',
                                        fontWeight: '600'
                                      }}>
                                        {itemType}
                                      </span>
                                      <span style={{ flex: 1, color: item.visible ? '#e0e0e0' : '#888', fontSize: '12px' }}>
                                        {itemName}
                                      </span>
                                      <div className="form-group checkbox-group" style={{ marginBottom: 0 }}>
                                        <input
                                          type="checkbox"
                                          id={`item-visible-${section.id}-${item.id}`}
                                          checked={item.visible === true}
                                          onChange={(e) => updateSectionItem(layoutIndex, sectionIndex, item.id, 'visible', e.target.checked)}
                                        />
                                        <label htmlFor={`item-visible-${section.id}-${item.id}`} style={{ fontSize: '11px' }}>
                                          Show
                                        </label>
                                      </div>
                                      <button
                                        className="btn btn-danger btn-small"
                                        onClick={() => removeItemFromSection(layoutIndex, sectionIndex, itemIndex)}
                                        style={{ padding: '2px 6px', fontSize: '11px' }}
                                        title="Remove from Section"
                                      >×</button>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        );
                      })}

                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => addSection(layoutIndex)}
                      style={{ marginTop: '8px' }}
                    >
                      + Add Custom Section
                    </button>
                  </div>
                </>
                )}
              </div>
            );
          })}

          <button className="btn btn-primary" onClick={addShowLayout} style={{ marginTop: '12px' }}>
            + Add Layout
          </button>
        </div>
      </div>
      )}

      {/* Cue List Tab (Coming Soon) */}
      {activeTab === 'cuelist' && (
      <div className="card">
        <div className="settings-section">
          <h3>Cue List</h3>
          <p style={{ color: '#888', fontStyle: 'italic' }}>Coming soon...</p>
        </div>
      </div>
      )}

      {/* DMX Output Tab - auto-navigate */}
      {activeTab === 'dmxoutput' && navigate('/dmx-output')}

      {/* Configuration Management - Always visible */}
      <div className="card" style={{ marginTop: '16px' }}>
        <div className="settings-section">
          <h3>Configuration Management</h3>

          <button className="btn btn-primary" onClick={handleSave}>
            Save Configuration
          </button>

          <button className="btn btn-secondary" onClick={handleExport}>
            Export Config
          </button>

          <label className="btn btn-secondary" style={{ display: 'inline-block', cursor: 'pointer' }}>
            Import Config
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              style={{ display: 'none' }}
            />
          </label>

          <button className="btn btn-danger" onClick={handleReset}>
            Reset to Defaults
          </button>
        </div>
      </div>

      <div className="card">
        <div className="settings-section">
          <h3>Diagnostics</h3>

          <button className="btn btn-secondary" onClick={() => navigate('/dmx-output')}>
            DMX Output Viewer
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
