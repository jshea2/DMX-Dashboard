import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import useWebSocket from '../hooks/useWebSocket';
import ConnectedUsers from '../components/ConnectedUsers';
import { QRCodeCanvas } from 'qrcode.react';

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
  { id: 'showlayout', label: 'Dashboard' },
  { id: 'users', label: 'Users and Access' },
  { id: 'network', label: 'Networking / IO' },
  { id: 'profiles', label: 'Fixture Profiles' },
  { id: 'patching', label: 'Patch' },
  { id: 'looks', label: 'Looks' },
  { id: 'cuelist', label: 'Cue List' },
  { id: 'export', label: 'Export / Import' },
];

const SettingsPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeClients, role, isEditorAnywhere, dashboardAccess } = useWebSocket();
  const [config, setConfig] = useState(null);
  const [originalConfig, setOriginalConfig] = useState(null);  // Track original for comparison
  const [saved, setSaved] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [networkInterfaces, setNetworkInterfaces] = useState([]);
  const [draggedItem, setDraggedItem] = useState(null);
  const [selectedDashboard, setSelectedDashboard] = useState('global'); // 'global' or dashboardId

  // Check URL query params for initial tab, or use last visited tab from localStorage
  const queryParams = new URLSearchParams(location.search);
  const tabFromUrl = queryParams.get('tab');
  const lastVisitedTab = localStorage.getItem('settings_last_tab');
  const initialTab = tabFromUrl || lastVisitedTab || 'showlayout';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [collapsedProfiles, setCollapsedProfiles] = useState({});
  const [collapsedFixtures, setCollapsedFixtures] = useState({});
  const [collapsedLayouts, setCollapsedLayouts] = useState({});
  const [patchViewerUniverse, setPatchViewerUniverse] = useState(1);
  const [dmxData, setDmxData] = useState({});
  const [draggingFixture, setDraggingFixture] = useState(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateFixtureIndex, setDuplicateFixtureIndex] = useState(null);
  const [duplicateCount, setDuplicateCount] = useState(1);
  const [duplicateAddressOffset, setDuplicateAddressOffset] = useState(0);

  const toggleSection = (section) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    fetchConfig();
    fetchNetworkInterfaces();
  }, []);

  // Refetch config when active clients change (to update client list and pending requests)
  useEffect(() => {
    if (activeClients.length > 0) {
      fetchConfig();
    }
  }, [activeClients]);

  // Watch for URL changes and update active tab
  useEffect(() => {
    const handleLocationChange = () => {
      const queryParams = new URLSearchParams(window.location.search);
      const tabFromUrl = queryParams.get('tab');
      if (tabFromUrl && tabFromUrl !== activeTab) {
        setActiveTab(tabFromUrl);
      }
    };

    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, [activeTab]);

  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('settings_last_tab', activeTab);
  }, [activeTab]);

  // Poll for config updates when on users tab (to catch pending access requests)
  useEffect(() => {
    if (activeTab !== 'users') return;

    const interval = setInterval(() => {
      // Only refetch if there are no unsaved changes
      if (!hasUnsavedChanges) {
        fetchConfig();
      }
    }, 2000); // Check every 2 seconds for pending requests

    return () => clearInterval(interval);
  }, [activeTab, hasUnsavedChanges]);

  // Fetch DMX data when on patching tab
  useEffect(() => {
    if (activeTab !== 'patching') return;

    const fetchDmxOutput = () => {
      fetch('/api/dmx-output')
        .then(res => res.json())
        .then(data => setDmxData(data))
        .catch(err => console.error('Failed to fetch DMX output:', err));
    };

    fetchDmxOutput();
    const interval = setInterval(fetchDmxOutput, 100); // Update 10 times per second
    return () => clearInterval(interval);
  }, [activeTab]);

  const fetchNetworkInterfaces = () => {
    fetch('/api/network-interfaces')
      .then(res => res.json())
      .then(data => setNetworkInterfaces(data))
      .catch(err => console.error('Failed to fetch network interfaces:', err));
  };

  const fetchConfig = () => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setConfig(data);
        setOriginalConfig(JSON.stringify(data));
        setHasUnsavedChanges(false);

        // Set all items to collapsed by default
        const profilesCollapsed = {};
        data.fixtureProfiles?.forEach(profile => {
          profilesCollapsed[profile.id] = true;
        });
        setCollapsedProfiles(profilesCollapsed);

        const fixturesCollapsed = {};
        data.fixtures?.forEach(fixture => {
          fixturesCollapsed[fixture.id] = true;
        });
        setCollapsedFixtures(fixturesCollapsed);

        const layoutsCollapsed = {};
        data.showLayouts?.forEach(layout => {
          layoutsCollapsed[layout.id] = true;
        });
        setCollapsedLayouts(layoutsCollapsed);

        const looksCollapsed = {};
        data.looks?.forEach(look => {
          looksCollapsed[look.id] = true;
        });
        setCollapsedSections(looksCollapsed);

        // Set patch viewer universe to the first fixture's universe
        if (data.fixtures?.length > 0) {
          setPatchViewerUniverse(data.fixtures[0].universe || 1);
        }
      })
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
        setOriginalConfig(JSON.stringify(config));
        setHasUnsavedChanges(false);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch(err => console.error('Failed to save config:', err));
  };

  // Track changes to config
  useEffect(() => {
    if (config && originalConfig) {
      const hasChanges = JSON.stringify(config) !== originalConfig;
      setHasUnsavedChanges(hasChanges);
    }
  }, [config, originalConfig]);

  // Navigation with unsaved changes warning
  const handleNavigation = useCallback((path) => {
    // Check if navigating to dashboard with hidden settings button
    if (path === '/dashboard' && config) {
      const activeLayout = config.showLayouts?.find(l => l.id === config.activeLayoutId) || config.showLayouts?.[0];
      if (activeLayout?.showSettingsButton === false) {
        const confirmed = window.confirm(
          'Warning: To get back to settings page you must manually type it in the URL. Replace "/dashboard" with "/settings".\n\nWould you like to continue?'
        );
        if (!confirmed) {
          return; // Cancel navigation
        }
      }
    }

    if (hasUnsavedChanges) {
      setPendingNavigation(path);
      setShowUnsavedModal(true);
    } else {
      navigate(path);
    }
  }, [hasUnsavedChanges, navigate, config]);

  const handleDiscardChanges = () => {
    setShowUnsavedModal(false);
    setHasUnsavedChanges(false);
    if (pendingNavigation) {
      navigate(pendingNavigation);
    }
  };

  const handleSaveAndNavigate = () => {
    handleSave();
    setShowUnsavedModal(false);
    if (pendingNavigation) {
      setTimeout(() => navigate(pendingNavigation), 100);
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
      // Create nested object if it doesn't exist
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
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
  // Helper to generate unique profile name
  const getUniqueProfileName = (baseName, existingProfiles) => {
    const existingNames = existingProfiles.map(p => p.name);
    if (!existingNames.includes(baseName)) return baseName;
    let counter = 1;
    while (existingNames.includes(`${baseName}${counter}`)) {
      counter++;
    }
    return `${baseName}${counter}`;
  };

  const addProfile = () => {
    const newConfig = { ...config };
    if (!newConfig.fixtureProfiles) newConfig.fixtureProfiles = [];
    const newId = `profile-${Date.now()}`;
    const name = getUniqueProfileName('New Profile', newConfig.fixtureProfiles);
    newConfig.fixtureProfiles.push({
      id: newId,
      name,
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
    const name = getUniqueProfileName(original.name, newConfig.fixtureProfiles);
    const duplicate = {
      id: `profile-${Date.now()}`,
      name,
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

  // Drag and drop for fixtures
  const handleFixtureDragStart = (e, index) => {
    setDraggedItem({ type: 'fixture', index });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFixtureDragOver = (e, index) => {
    e.preventDefault();
    if (draggedItem?.type === 'fixture' && draggedItem.index !== index) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleFixtureDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'fixture' && draggedItem.index !== targetIndex) {
      const newConfig = { ...config };
      const [removed] = newConfig.fixtures.splice(draggedItem.index, 1);
      newConfig.fixtures.splice(targetIndex, 0, removed);
      setConfig(newConfig);
    }
    setDraggedItem(null);
  };

  // Drag and drop for looks
  const handleLookDragStart = (e, index) => {
    setDraggedItem({ type: 'look', index });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleLookDragOver = (e, index) => {
    e.preventDefault();
    if (draggedItem?.type === 'look' && draggedItem.index !== index) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleLookDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedItem?.type === 'look' && draggedItem.index !== targetIndex) {
      const newConfig = { ...config };
      const [removed] = newConfig.looks.splice(draggedItem.index, 1);
      newConfig.looks.splice(targetIndex, 0, removed);
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
      showName: true,
      backgroundColor: '#1a1a2e',
      logo: null,
      title: 'Lighting',
      showBlackoutButton: true,
      showLayoutSelector: true,
      sections: [
        {
          id: 'section-looks',
          name: 'Looks',
          type: 'static',
          staticType: 'looks',
          visible: true,
          showClearButton: true,
          order: 0,
          items: newConfig.looks.map((look, index) => ({
            type: 'look',
            id: look.id,
            visible: true,
            order: index
          }))
        },
        {
          id: 'section-fixtures',
          name: 'Fixtures',
          type: 'static',
          staticType: 'fixtures',
          visible: true,
          showClearButton: true,
          order: 1,
          items: newConfig.fixtures.map((fixture, index) => ({
            type: 'fixture',
            id: fixture.id,
            visible: true,
            order: index
          }))
        }
      ]
    };

    newConfig.showLayouts.push(newLayout);

    // Set as active if it's the first layout
    if (newConfig.showLayouts.length === 1) {
      newConfig.activeLayoutId = newId;
    }
    setConfig(newConfig);
  };

  const removeShowLayout = (index) => {
    const newConfig = { ...config };
    const layout = newConfig.showLayouts[index];

    // Prevent deleting active layout
    if (layout.id === newConfig.activeLayoutId && newConfig.showLayouts.length > 1) {
      alert('Cannot delete the active layout. Please set another layout as active first.');
      return;
    }

    newConfig.showLayouts.splice(index, 1);

    // If we deleted the active layout and it was the last one, clear activeLayoutId
    if (layout.id === newConfig.activeLayoutId) {
      delete newConfig.activeLayoutId;
    }

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
      sections: (original.sections || []).map(section => ({ ...section }))
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

  const setActiveLayout = (layoutId) => {
    const newConfig = { ...config };
    // Set the active layout ID
    newConfig.activeLayoutId = layoutId;

    // Also update on server
    fetch('/api/config/active-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeLayoutId: layoutId })
    }).catch(err => console.error('Failed to update active layout:', err));

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
  // Helper to generate unique fixture name
  const getUniqueFixtureName = (baseName, existingFixtures) => {
    const existingNames = existingFixtures.map(f => f.name);
    if (!existingNames.includes(baseName)) return baseName;
    let counter = 1;
    while (existingNames.includes(`${baseName}${counter}`)) {
      counter++;
    }
    return `${baseName}${counter}`;
  };

  // Helper to find next available address in a universe
  const getNextAddress = (fixtures, universe, profileId, profiles) => {
    const profile = profiles?.find(p => p.id === profileId);
    const channelCount = profile?.channels?.length || 1;
    
    // Get all fixtures in this universe
    const universeFixtures = fixtures.filter(f => f.universe === universe);
    if (universeFixtures.length === 0) return 1;
    
    // Find the highest end address
    let maxEndAddress = 0;
    universeFixtures.forEach(f => {
      const fProfile = profiles?.find(p => p.id === f.profileId);
      const fChannelCount = fProfile?.channels?.length || 1;
      const endAddress = f.startAddress + fChannelCount - 1;
      if (endAddress > maxEndAddress) maxEndAddress = endAddress;
    });
    
    const nextAddress = maxEndAddress + 1;
    // If it would exceed 512, wrap or return 1
    return nextAddress <= 512 ? nextAddress : 1;
  };

  const addFixture = () => {
    const newConfig = { ...config };
    const newId = `fixture-${Date.now()}`;
    const defaultProfile = newConfig.fixtureProfiles?.[0]?.id || 'intensity-1ch';
    
    // Get universe from last fixture, or default to 1
    const lastFixture = newConfig.fixtures[newConfig.fixtures.length - 1];
    const universe = lastFixture?.universe || 1;
    
    // Get next available address
    const startAddress = getNextAddress(newConfig.fixtures, universe, defaultProfile, newConfig.fixtureProfiles);
    
    // Get unique name
    const name = getUniqueFixtureName('New Fixture', newConfig.fixtures);
    
    newConfig.fixtures.push({
      id: newId,
      name,
      profileId: defaultProfile,
      universe,
      startAddress,
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
    // Remove from all layout sections
    newConfig.showLayouts?.forEach(layout => {
      layout.sections?.forEach(section => {
        section.items = section.items.filter(item => !(item.type === 'fixture' && item.id === fixtureId));
      });
    });
    setConfig(newConfig);
  };

  // Open duplicate modal
  const openDuplicateModal = (index) => {
    const fixture = config.fixtures[index];
    const profile = config.fixtureProfiles?.find(p => p.id === fixture.profileId);
    const channelCount = profile?.channels?.length || 1;
    setDuplicateFixtureIndex(index);
    setDuplicateCount(1);
    setDuplicateAddressOffset(channelCount); // Default offset is channel count
    setShowDuplicateModal(true);
  };

  // Execute fixture duplication
  const duplicateFixture = () => {
    if (duplicateFixtureIndex === null) return;
    if (!duplicateCount || duplicateCount <= 0) {
      setShowDuplicateModal(false);
      return;
    }
    
    const newConfig = { ...config };
    const sourceFixture = newConfig.fixtures[duplicateFixtureIndex];
    const profile = newConfig.fixtureProfiles?.find(p => p.id === sourceFixture.profileId);
    const channelCount = profile?.channels?.length || 1;
    
    for (let i = 0; i < duplicateCount; i++) {
      const newId = `fixture-${Date.now()}-${i}`;
      const newName = getUniqueFixtureName(sourceFixture.name, newConfig.fixtures);
      
      // Calculate address: if offset is 0, use next available; otherwise use offset
      let newAddress;
      if (duplicateAddressOffset === 0) {
        newAddress = getNextAddress(newConfig.fixtures, sourceFixture.universe, sourceFixture.profileId, newConfig.fixtureProfiles);
      } else {
        // Get the last fixture we added (or source if first)
        const lastInChain = newConfig.fixtures[newConfig.fixtures.length - 1];
        newAddress = lastInChain.startAddress + duplicateAddressOffset;
        // Wrap around if exceeds 512
        if (newAddress > 512) newAddress = newAddress - 512;
      }
      
      newConfig.fixtures.push({
        id: newId,
        name: newName,
        profileId: sourceFixture.profileId,
        universe: sourceFixture.universe,
        artnetNet: sourceFixture.artnetNet,
        artnetSubnet: sourceFixture.artnetSubnet,
        artnetUniverse: sourceFixture.artnetUniverse,
        startAddress: newAddress,
        showOnMain: sourceFixture.showOnMain
      });
      
      // Initialize look targets for new fixture
      newConfig.looks.forEach(look => {
        look.targets[newId] = {};
      });
    }
    
    setConfig(newConfig);
    setShowDuplicateModal(false);
    setDuplicateFixtureIndex(null);
  };

  // === QR CODE FUNCTIONS ===
  const downloadQRCode = (interfaceAddress, dashboardSlug = null) => {
    // For dashboard-specific QR codes, generate on-the-fly
    if (dashboardSlug) {
      // Create a temporary canvas to generate the QR code
      const tempCanvas = document.createElement('canvas');
      const qrCodeUrl = getQRCodeURL(interfaceAddress, dashboardSlug);

      // Import QRCode library dynamically
      import('qrcode').then(QRCode => {
        QRCode.toCanvas(tempCanvas, qrCodeUrl, { width: 300, margin: 2 }, (error) => {
          if (error) {
            console.error('QR Code generation error:', error);
            return;
          }
          const url = tempCanvas.toDataURL('image/png');
          const link = document.createElement('a');
          link.download = `${dashboardSlug}-${interfaceAddress}.png`;
          link.href = url;
          link.click();
        });
      }).catch(() => {
        // Fallback: try to find the canvas element directly
        alert('Please try again. QR code download is processing...');
      });
    } else {
      // Original behavior for global QR codes
      const canvas = document.getElementById(`qr-canvas-${interfaceAddress}`)?.querySelector('canvas');
      if (canvas) {
        const url = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `dmx-control-${interfaceAddress}.png`;
        link.href = url;
        link.click();
      }
    }
  };

  const getQRCodeURL = (interfaceAddress, dashboardSlug = null) => {
    const port = window.location.port || 3000;
    let url = `http://${interfaceAddress}:${port}`;

    if (dashboardSlug) {
      url += `/dashboard/${dashboardSlug}`;
    }

    return url;
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
    const lookId = newConfig.looks[index].id;
    newConfig.looks.splice(index, 1);
    // Remove from all layout sections
    newConfig.showLayouts?.forEach(layout => {
      layout.sections?.forEach(section => {
        section.items = section.items.filter(item => !(item.type === 'look' && item.id === lookId));
      });
    });
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
      {/* Unsaved Changes Modal */}
      {showUnsavedModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: '#2a2a3e',
            padding: '24px',
            borderRadius: '12px',
            maxWidth: '400px',
            textAlign: 'center'
          }}>
            <h3 style={{ margin: '0 0 16px 0' }}>Unsaved Changes</h3>
            <p style={{ color: '#aaa', marginBottom: '24px' }}>
              You have unsaved changes. Would you like to save before leaving?
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={handleSaveAndNavigate}>
                Save & Leave
              </button>
              <button className="btn btn-danger" onClick={handleDiscardChanges}>
                Discard
              </button>
              <button className="btn btn-secondary" onClick={() => setShowUnsavedModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Fixture Modal */}
      {showDuplicateModal && duplicateFixtureIndex !== null && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: '#2a2a3e',
            padding: '24px',
            borderRadius: '12px',
            maxWidth: '400px',
            width: '90%'
          }}>
            <h3 style={{ margin: '0 0 16px 0' }}>Duplicate Fixture</h3>
            <p style={{ color: '#aaa', marginBottom: '16px' }}>
              Duplicating: <strong>{config.fixtures[duplicateFixtureIndex]?.name}</strong>
            </p>
            
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label>Number of Copies</label>
              <input
                type="text"
                value={duplicateCount}
                onChange={(e) => {
                  const val = e.target.value;
                  // Allow empty or numeric input
                  if (val === '' || /^\d+$/.test(val)) {
                    setDuplicateCount(val === '' ? '' : parseInt(val));
                  }
                }}
                onBlur={(e) => {
                  // On blur, ensure we have a valid number (default to 1 if empty/0)
                  const val = parseInt(e.target.value) || 0;
                  setDuplicateCount(val);
                }}
                style={{ width: '100%' }}
                placeholder="Enter number of copies"
              />
            </div>
            
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label>Address Offset</label>
              <input
                type="number"
                min="0"
                max="512"
                value={duplicateAddressOffset}
                onChange={(e) => setDuplicateAddressOffset(Math.max(0, parseInt(e.target.value) || 0))}
                style={{ width: '100%' }}
              />
              <small style={{ color: '#888' }}>
                0 = auto (next available), or specify channel offset between fixtures
              </small>
            </div>
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowDuplicateModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={duplicateFixture}>
                Duplicate
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="settings-header" style={{ flexDirection: 'column', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <h1 style={{ margin: 0, textAlign: 'center' }}>Settings</h1>
      </div>
      <button 
        className="btn" 
        onClick={() => handleNavigation('/dashboard')}
        style={{ 
          fontSize: '14px', 
          padding: '8px 16px',
          background: '#4a90e2',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          marginBottom: '12px'
        }}
      >
        ← Back to Dashboard
      </button>

      {saved && (
        <div className="card" style={{ background: '#1a5928', marginBottom: '12px' }}>
          <p style={{ margin: 0, fontSize: '16px' }}>✓ Configuration saved successfully!</p>
        </div>
      )}

      {/* Main Layout: Tabs on Left, Content on Right */}
      <div style={{ display: 'flex', gap: '12px', height: 'calc(100vh - 120px)' }}>
      
      {/* Fixed Save Button - matches dashboard settings button size */}
      <button 
        onClick={handleSave} 
        title={hasUnsavedChanges ? "Save Configuration (Unsaved Changes)" : "Save Configuration"}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: hasUnsavedChanges ? '#e2904a' : '#4ae24a',
          border: 'none',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          zIndex: 1000
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill={hasUnsavedChanges ? 'white' : '#000'}>
          <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
        </svg>
      </button>
        {/* Vertical Tab Navigation - Fixed */}
        <div className="tabs-container" style={{ 
          display: 'flex', 
          flexDirection: 'column',
          gap: '2px',
          minWidth: '160px',
          borderRight: '2px solid #333',
          paddingRight: '0',
          position: 'sticky',
          top: '0',
          alignSelf: 'flex-start'
        }}>
          {TABS.filter(tab => {
            // Editors (anywhere) see all tabs
            if (isEditorAnywhere) {
              return true;
            }

            // Moderators (on any dashboard) can only see Users and Access tab
            const isModeratorAnywhere = role === 'moderator' ||
              (dashboardAccess && Object.values(dashboardAccess).some(r => r === 'moderator' || r === 'editor'));

            if (isModeratorAnywhere && !isEditorAnywhere) {
              return tab.id === 'users';
            }

            // Viewers/controllers see no settings tabs
            return false;
          }).map(tab => (
            <button
              key={tab.id}
              className={`btn tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 14px',
                fontSize: '13px',
                background: activeTab === tab.id ? '#2a2a2a' : 'transparent',
                border: 'none',
                borderRight: activeTab === tab.id ? '2px solid #4a90e2' : '2px solid transparent',
                borderRadius: '0',
                color: activeTab === tab.id ? '#fff' : '#888',
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
                marginRight: '-2px',
                textAlign: 'left'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content - Scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px' }}>

      {/* Network / Output Tab */}
      {activeTab === 'network' && (
      <div className="card">
        <div className="settings-section">
          <h3 
            onClick={() => toggleSection('network')} 
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <span style={{ transition: 'transform 0.2s', transform: collapsedSections.network ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            Network / DMX Output
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
      </div>
      )}

      {/* Users and Access Tab */}
      {activeTab === 'users' && (
      <div className="card">
        {/* Dashboard Selector */}
        <div className="settings-section" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '12px' }}>Select Dashboard</h3>
          <div className="form-group">
            <select
              value={selectedDashboard}
              onChange={(e) => setSelectedDashboard(e.target.value)}
              style={{
                padding: '12px',
                fontSize: '14px',
                background: '#1a1a2e',
                color: '#f0f0f0',
                border: '2px solid #4a90e2',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
            >
              {/* Global matrix only for editors */}
              {isEditorAnywhere && <option value="global">Global Access Matrix</option>}

              {/* Show only dashboards user can moderate/edit */}
              {config?.showLayouts?.map((layout) => {
                const dashboardRole = dashboardAccess?.[layout.id] || role;
                const canModerate = isEditorAnywhere || dashboardRole === 'moderator' || dashboardRole === 'editor';

                if (canModerate) {
                  return (
                    <option key={layout.id} value={layout.id}>
                      {layout.name}
                    </option>
                  );
                }
                return null;
              })}
            </select>
            <small>
              {selectedDashboard === 'global'
                ? 'View and manage user access across all dashboards'
                : 'Manage users and settings for this specific dashboard'}
            </small>
          </div>
        </div>

        {/* Global Access Matrix View */}
        {selectedDashboard === 'global' && (
          <div className="settings-section">
            <h3 style={{ marginBottom: '16px' }}>Global Access Matrix</h3>
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>
              View and manage user access across all dashboards. Click a cell to change a user's role for that dashboard.
            </p>

            {(!config?.clients || config.clients.length === 0) && (
              <p style={{ fontSize: '13px', color: '#666', fontStyle: 'italic', padding: '16px', background: '#1a1a2e', borderRadius: '6px' }}>
                No clients have connected yet. The matrix will appear here when clients connect.
              </p>
            )}

            {config?.clients && config.clients.length > 0 && config?.showLayouts && config.showLayouts.length > 0 && (
              <div style={{ overflowX: 'auto', marginTop: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#1a1a2e' }}>
                      <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #333', position: 'sticky', left: 0, background: '#1a1a2e', zIndex: 2, minWidth: '250px' }}>
                        Client
                      </th>
                      {config.showLayouts.map((layout) => (
                        <th key={layout.id} style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #333', minWidth: '100px' }}>
                          {layout.name}
                        </th>
                      ))}
                      <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #333', minWidth: '80px' }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {config.clients.map((client) => {
                      const shortId = client.id.substring(0, 6).toUpperCase();
                      const isActive = activeClients.some(ac => ac.id === client.id);
                      const lastSeenDate = client.lastSeen ? new Date(client.lastSeen).toLocaleDateString() : 'Never';
                      const lastSeenTime = client.lastSeen ? new Date(client.lastSeen).toLocaleTimeString() : '';

                      return (
                        <tr key={client.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
                          <td style={{ padding: '12px', position: 'sticky', left: 0, background: '#16213e', borderRight: '2px solid #333' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div
                                  style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: isActive ? '#4ae24a' : '#666',
                                    flexShrink: 0
                                  }}
                                />
                                <input
                                  type="text"
                                  value={client.nickname || ''}
                                  placeholder={shortId}
                                  onChange={(e) => {
                                    const newNickname = e.target.value;
                                    fetch(`/api/clients/${client.id}/nickname`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ nickname: newNickname })
                                    })
                                      .then(res => res.json())
                                      .then(() => fetchConfig())
                                      .catch(err => console.error('Failed to update nickname:', err));
                                  }}
                                  style={{
                                    padding: '4px 8px',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    background: '#252538',
                                    color: '#f0f0f0',
                                    border: '1px solid #333',
                                    borderRadius: '4px',
                                    outline: 'none',
                                    flex: 1,
                                    minWidth: '120px'
                                  }}
                                  onFocus={(e) => {
                                    e.target.style.borderColor = '#4a90e2';
                                  }}
                                  onBlur={(e) => {
                                    e.target.style.borderColor = '#333';
                                  }}
                                />
                              </div>
                              <div style={{ fontSize: '10px', color: '#888', paddingLeft: '16px' }}>
                                <div>ID: {shortId}</div>
                                <div>Last seen: {lastSeenDate} {lastSeenTime}</div>
                                {client.lastIp && <div>IP: {client.lastIp}</div>}
                              </div>
                            </div>
                          </td>
                          {config.showLayouts.map((layout) => {
                            const dashboardRole = client.dashboardAccess?.[layout.id] || client.role || 'viewer';
                            const roleColors = {
                              editor: { bg: '#2a4a2a', color: '#4ae24a', label: 'E' },
                              moderator: { bg: '#4a2a4a', color: '#e24ae2', label: 'M' },
                              controller: { bg: '#4a3a2a', color: '#e2904a', label: 'C' },
                              viewer: { bg: '#2a2a4a', color: '#4a90e2', label: 'V' }
                            };
                            const roleStyle = roleColors[dashboardRole] || roleColors.viewer;

                            return (
                              <td key={layout.id} style={{ padding: '8px', textAlign: 'center' }}>
                                <select
                                  value={dashboardRole}
                                  onChange={(e) => {
                                    const newRole = e.target.value;

                                    // If setting to Editor, apply to ALL dashboards
                                    if (newRole === 'editor') {
                                      if (window.confirm(`Making this user an Editor will grant them Editor access to ALL dashboards. Continue?`)) {
                                        // Update all dashboards
                                        const updatePromises = config.showLayouts.map(layout =>
                                          fetch(`/api/dashboards/${layout.id}/clients/${client.id}/role`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ role: 'editor' })
                                          })
                                        );

                                        Promise.all(updatePromises)
                                          .then(() => fetchConfig())
                                          .catch(err => console.error('Failed to update roles:', err));
                                      }
                                    } else {
                                      // Normal per-dashboard role update
                                      fetch(`/api/dashboards/${layout.id}/clients/${client.id}/role`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ role: newRole })
                                      })
                                        .then(res => res.json())
                                        .then(() => fetchConfig())
                                        .catch(err => console.error('Failed to update role:', err));
                                    }
                                  }}
                                  style={{
                                    padding: '6px 8px',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    background: roleStyle.bg,
                                    color: roleStyle.color,
                                    border: `1px solid ${roleStyle.color}`,
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    width: '100%'
                                  }}
                                >
                                  <option value="viewer">Viewer</option>
                                  <option value="controller">Controller</option>
                                  <option value="moderator">Moderator</option>
                                  <option value="editor">Editor</option>
                                </select>
                              </td>
                            );
                          })}
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <button
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to remove client "${client.nickname || shortId}"? This will delete them from all dashboards.`)) {
                                  fetch(`/api/clients/${client.id}`, {
                                    method: 'DELETE'
                                  })
                                    .then(res => res.json())
                                    .then(() => fetchConfig())
                                    .catch(err => console.error('Failed to remove client:', err));
                                }
                              }}
                              style={{
                                padding: '6px 12px',
                                fontSize: '11px',
                                background: '#dc3545',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: '600'
                              }}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Conditional rendering based on selection */}
        {selectedDashboard !== 'global' && (
          <div className="settings-section">
            <h3
              onClick={() => toggleSection('server')}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <span style={{ transition: 'transform 0.2s', transform: collapsedSections.server ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
              Network Access QR Codes
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
              disabled={role === 'moderator'}
              style={{ opacity: role === 'moderator' ? 0.6 : 1, cursor: role === 'moderator' ? 'not-allowed' : 'text' }}
            />
            <small>Default: 3001 (restart required after change)</small>
          </div>

          <div className="form-group">
            <label>Server Bind Address</label>
            <input
              type="text"
              value={config.server?.bindAddress || '0.0.0.0'}
              onChange={(e) => updateConfig('server.bindAddress', e.target.value)}
              disabled={role === 'moderator'}
              style={{ opacity: role === 'moderator' ? 0.6 : 1, cursor: role === 'moderator' ? 'not-allowed' : 'text' }}
              placeholder="0.0.0.0"
            />
            <small>0.0.0.0 = all interfaces, or specify IP for one interface (restart required)</small>
          </div>

          <div className="form-group">
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px' }}>
              Scan QR codes with mobile devices for easy access to the control interface
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {networkInterfaces.map((iface) => (
                <div
                  key={iface.address}
                  style={{
                    padding: '12px',
                    background: '#1a1a2e',
                    borderRadius: '8px',
                    border: '2px solid #333'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '600' }}>
                      {iface.label}
                    </span>
                  </div>

                  <div style={{ textAlign: 'center', marginTop: '12px' }}>
                    <div
                      id={`qr-canvas-${iface.address}`}
                      style={{
                        background: 'white',
                        padding: '12px',
                        borderRadius: '8px',
                        display: 'inline-block',
                        marginBottom: '12px'
                      }}
                    >
                      <QRCodeCanvas
                        value={getQRCodeURL(iface.address, config.showLayouts?.find(l => l.id === selectedDashboard)?.urlSlug)}
                        size={150}
                        level="M"
                      />
                    </div>
                    <p style={{ fontSize: '12px', color: '#888', marginBottom: '12px', fontFamily: 'monospace' }}>
                      {getQRCodeURL(iface.address, config.showLayouts?.find(l => l.id === selectedDashboard)?.urlSlug)}
                    </p>
                    <button
                      onClick={() => downloadQRCode(iface.address)}
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        background: '#4ae24a',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600'
                      }}
                    >
                      Download PNG
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
            </>
          )}
        </div>
        )}

        {/* Client Access Control - Hidden for moderators */}
        {selectedDashboard !== 'global' && role === 'editor' && (
        <div className="settings-section">
          <h3
            onClick={() => toggleSection('webServer')}
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <span style={{ transition: 'transform 0.2s', transform: collapsedSections.webServer ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            Client Access Control
          </h3>

          {!collapsedSections.webServer && (
            <>
              <div className="form-group">
                <label>New Clients Default Role</label>
                <select
                  value={config.webServer?.defaultClientRole || 'viewer'}
                  onChange={(e) => updateConfig('webServer.defaultClientRole', e.target.value)}
                >
                  <option value="viewer">Viewer (View Only)</option>
                  <option value="controller">Controller (Can Control Lights)</option>
                  <option value="moderator">Moderator (Can Manage Users)</option>
                  <option value="editor">Editor (Full Access)</option>
                </select>
                <small>New clients will be assigned this role by default (Localhost is always Editor)</small>
              </div>

              <div style={{ marginTop: '16px' }}>
                <h4 style={{ marginBottom: '12px', fontSize: '15px' }}>Client List</h4>
                <p style={{ fontSize: '13px', color: '#888', marginBottom: '12px' }}>
                  Manage which devices can view or edit your lighting control. Localhost is always Editor.
                </p>

                {(!config.clients || config.clients.length === 0) && (
                  <p style={{ fontSize: '13px', color: '#666', fontStyle: 'italic', padding: '16px', background: '#1a1a2e', borderRadius: '6px' }}>
                    No clients have connected yet. Clients will appear here when they access the app.
                  </p>
                )}

                {config.clients && config.clients.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {config.clients.map((client) => {
                      const isActive = activeClients.some(ac => ac.id === client.id);
                      const shortId = client.id.substring(0, 6).toUpperCase();

                      return (
                        <div
                          key={client.id}
                          style={{
                            padding: '12px',
                            background: '#1a1a2e',
                            borderRadius: '6px',
                            border: `2px solid ${isActive ? '#4ae24a' : '#333'}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px'
                          }}
                        >
                          {/* Status indicator */}
                          <div
                            style={{
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              background: isActive ? '#4ae24a' : '#666',
                              flexShrink: 0
                            }}
                            title={isActive ? 'Connected' : 'Disconnected'}
                          />

                          {/* Client info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ fontWeight: '600', fontSize: '13px' }}>
                                {shortId}
                              </span>
                              {client.nickname && (
                                <span style={{ color: '#888', fontSize: '12px' }}>
                                  - {client.nickname}
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: '11px',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  background: client.role === 'editor' ? '#2a4a2a' : client.role === 'controller' ? '#4a3a2a' : '#2a2a4a',
                                  color: client.role === 'editor' ? '#4ae24a' : client.role === 'controller' ? '#e2904a' : '#4a90e2'
                                }}
                              >
                                {client.role.toUpperCase()}
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#666' }}>
                              Last seen: {new Date(client.lastSeen).toLocaleString()} • IP: {client.lastIp}
                            </div>

                            {/* Nickname input */}
                            <input
                              type="text"
                              value={client.nickname || ''}
                              onChange={(e) => {
                                const newConfig = { ...config };
                                const clientEntry = newConfig.clients.find(c => c.id === client.id);
                                if (clientEntry) {
                                  clientEntry.nickname = e.target.value;
                                  setConfig(newConfig);
                                }
                              }}
                              onBlur={() => {
                                // Save to server when done editing
                                fetch(`/api/clients/${client.id}/nickname`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ nickname: client.nickname || '' })
                                });
                              }}
                              placeholder="Add nickname..."
                              style={{
                                marginTop: '8px',
                                width: '100%',
                                padding: '6px 8px',
                                fontSize: '12px',
                                background: '#252538',
                                border: '1px solid #333',
                                borderRadius: '4px',
                                color: '#f0f0f0'
                              }}
                            />
                          </div>

                          {/* Actions */}
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {client.pendingRequest && (
                              <>
                                <button
                                  className="btn btn-primary"
                                  onClick={() => {
                                    fetch(`/api/clients/${client.id}/approve`, {
                                      method: 'POST'
                                    })
                                      .then(res => res.json())
                                      .then(() => {
                                        fetchConfig();
                                      });
                                  }}
                                  style={{
                                    padding: '6px 12px',
                                    fontSize: '12px',
                                    background: '#4ae24a',
                                    color: '#000'
                                  }}
                                >
                                  Approve
                                </button>
                                <button
                                  className="btn btn-danger"
                                  onClick={() => {
                                    fetch(`/api/clients/${client.id}/deny`, {
                                      method: 'POST'
                                    })
                                      .then(res => res.json())
                                      .then(() => {
                                        fetchConfig();
                                      });
                                  }}
                                  style={{
                                    padding: '6px 12px',
                                    fontSize: '12px',
                                    background: '#e24a4a',
                                    color: '#fff'
                                  }}
                                >
                                  Deny
                                </button>
                              </>
                            )}

                            {!client.pendingRequest && (
                              <select
                                value={client.role}
                                onChange={(e) => {
                                  fetch(`/api/clients/${client.id}/role`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ role: e.target.value })
                                  })
                                    .then(res => res.json())
                                    .then(() => {
                                      fetchConfig();
                                    });
                                }}
                                disabled={role === 'moderator' && (client.role === 'moderator' || client.role === 'editor')}
                                style={{
                                  padding: '6px 8px',
                                  fontSize: '12px',
                                  background: '#252538',
                                  border: '1px solid #333',
                                  borderRadius: '4px',
                                  color: '#f0f0f0',
                                  opacity: role === 'moderator' && (client.role === 'moderator' || client.role === 'editor') ? 0.5 : 1,
                                  cursor: role === 'moderator' && (client.role === 'moderator' || client.role === 'editor') ? 'not-allowed' : 'pointer'
                                }}
                              >
                                <option value="viewer">Viewer</option>
                                <option value="controller">Controller</option>
                                {role === 'editor' && <option value="moderator">Moderator</option>}
                                {role === 'editor' && <option value="editor">Editor</option>}
                              </select>
                            )}

                            <button
                              className="btn btn-danger btn-small"
                              onClick={() => {
                                if (window.confirm(`Remove client ${shortId}?`)) {
                                  fetch(`/api/clients/${client.id}`, {
                                    method: 'DELETE'
                                  })
                                    .then(res => res.json())
                                    .then(() => {
                                      fetchConfig();
                                    });
                                }
                              }}
                              style={{ padding: '6px 8px', fontSize: '12px' }}
                              title="Remove Client"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        )}
      </div>
      )}

      {/* Fixture Profiles Tab */}
      {activeTab === 'profiles' && (
      <div className="card">
        <div className="settings-section">
          <h3>Fixture Profiles</h3>
          <p style={{ fontSize: '14px', color: '#888', marginBottom: '16px' }}>
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
                const addressSummary = config.network.protocol === 'artnet'
                  ? `Net${fixture.artnetNet || 0}:Sub${fixture.artnetSubnet || 0}:U${fixture.artnetUniverse || 0}`
                  : `U${fixture.universe}`;
                const summary = `${profile?.name || 'No Profile'} • ${addressSummary} • Ch ${fixture.startAddress}${channelCount > 1 ? `-${endAddress}` : ''}`;

                return (
                  <div
                    key={fixture.id}
                    className="fixture-editor"
                    style={{ position: 'relative', padding: isCollapsed ? '12px' : '16px' }}
                    draggable
                    onDragStart={(e) => handleFixtureDragStart(e, index)}
                    onDragOver={(e) => handleFixtureDragOver(e, index)}
                    onDrop={(e) => handleFixtureDrop(e, index)}
                  >
                    {/* Header row - always visible */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ cursor: 'grab', color: '#666', fontSize: '16px', padding: '4px' }} title="Drag to reorder">⋮⋮</div>
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
                        className="btn btn-secondary btn-small"
                        onClick={() => openDuplicateModal(index)}
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                        title="Duplicate Fixture"
                      >⧉</button>
                      <button
                        className="btn btn-danger btn-small"
                        onClick={() => removeFixture(index)}
                        style={{ padding: '4px 8px', fontSize: '12px' }}
                      >×</button>
                    </div>

                    {/* Expanded content */}
                    {!isCollapsed && (
                    <>
                    {/* Row 1: Profile */}
                    <div className="form-group" style={{ marginTop: '12px', marginBottom: '12px' }}>
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

                    {/* Row 2: Universe/Address */}
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      {config.network.protocol === 'artnet' ? (
                        <>
                          <div className="form-group" style={{ width: '80px', marginBottom: 0 }}>
                            <label>Net</label>
                            <input
                              type="number"
                              min="0"
                              max="127"
                              value={fixture.artnetNet || 0}
                              onChange={(e) => updateFixture(index, 'artnetNet', parseInt(e.target.value))}
                            />
                          </div>
                          <div className="form-group" style={{ width: '80px', marginBottom: 0 }}>
                            <label>Subnet</label>
                            <input
                              type="number"
                              min="0"
                              max="15"
                              value={fixture.artnetSubnet || 0}
                              onChange={(e) => updateFixture(index, 'artnetSubnet', parseInt(e.target.value))}
                            />
                          </div>
                          <div className="form-group" style={{ width: '80px', marginBottom: 0 }}>
                            <label>Universe</label>
                            <input
                              type="number"
                              min="0"
                              max="15"
                              value={fixture.artnetUniverse || 0}
                              onChange={(e) => updateFixture(index, 'artnetUniverse', parseInt(e.target.value))}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="form-group" style={{ width: '100px', marginBottom: 0 }}>
                          <label>Universe</label>
                          <input
                            type="number"
                            min="1"
                            max="63999"
                            value={fixture.universe}
                            onChange={(e) => updateFixture(index, 'universe', parseInt(e.target.value))}
                          />
                        </div>
                      )}
                      <div className="form-group" style={{ width: '120px', marginBottom: 0 }}>
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
                      <div style={{ color: '#888', fontSize: '12px', marginBottom: '12px' }}>
                        Channels: {profile.channels.map(ch => `${ch.name}: ${fixture.startAddress + ch.offset}`).join(', ')}
                      </div>
                    )}

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
                    
                    // Get DMX value for this channel
                    const universeData = dmxData[patchViewerUniverse] || [];
                    const dmxValue = universeData[channel - 1] || 0;
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
                    
                    // Calculate intensity overlay for DMX value
                    const intensityOpacity = dmxValue / 255 * 0.6;
                    
                    return (
                      <div
                        key={channel}
                        style={{
                          background: hasOverlap ? '#b86800' : (fixture ? getFixtureColor(fixture) : '#1a1a2e'),
                          padding: '2px 1px',
                          textAlign: 'center',
                          color: fixture ? '#fff' : '#555',
                          cursor: fixture ? 'grab' : 'default',
                          minHeight: '36px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          ...borderStyle
                        }}
                        title={fixture ? `${fixture.name}\n${channelName} (Ch ${channel})\nValue: ${dmxValue}\nDrag to move` : `Ch ${channel} - Value: ${dmxValue}`}
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
                        {/* DMX value intensity overlay */}
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          background: `rgba(74, 226, 74, ${intensityOpacity})`,
                          pointerEvents: 'none'
                        }} />
                        <span style={{ fontSize: '9px', opacity: 0.7, position: 'relative', zIndex: 1 }}>{channel}</span>
                        <span style={{ fontSize: '11px', fontWeight: dmxValue > 0 ? 'bold' : 'normal', position: 'relative', zIndex: 1 }}>{dmxValue}</span>
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
          {config.looks.map((look, lookIndex) => {
                const isCollapsed = collapsedSections[look.id];
                return (
            <div
              key={look.id}
              className="look-editor"
              style={{ position: 'relative' }}
              draggable
              onDragStart={(e) => handleLookDragStart(e, lookIndex)}
              onDragOver={(e) => handleLookDragOver(e, lookIndex)}
              onDrop={(e) => handleLookDrop(e, lookIndex)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ cursor: 'grab', color: '#666', fontSize: '16px', padding: '4px' }} title="Drag to reorder">⋮⋮</div>
                  <span
                    onClick={() => setCollapsedSections(prev => ({ ...prev, [look.id]: !prev[look.id] }))}
                    style={{ cursor: 'pointer', color: '#888', transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                  >▼</span>
                  <h4 style={{ margin: 0 }}>{look.name}</h4>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleCaptureLook(look.id)}
                  >
                    Record Current
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => removeLook(lookIndex)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {!isCollapsed && (
              <>

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
              </>
              )}
            </div>
                );
          })}

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
          <h3>Dashboard Layout Editor</h3>
          <p style={{ fontSize: '14px', color: '#888', marginBottom: '16px', marginTop: '12px' }}>
            Create custom layouts that control what appears on the main lighting control page.
            Each layout can have its own branding, colors, and selection of looks/fixtures.
            Access layouts at <code>/home</code> or <code>/layout-name</code>.
          </p>

          {(config.showLayouts || []).map((layout, layoutIndex) => {
            const isCollapsed = collapsedLayouts[layout.id];

            return (
              <div
                key={layout.id}
                className="fixture-editor"
                style={{
                  position: 'relative',
                  padding: isCollapsed ? '12px' : '16px',
                  border: '1px solid #444',
                  background: '#333',
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
                  {isCollapsed && (
                    <span style={{ color: '#666', fontSize: '12px' }}>
                      {(layout.sections || []).filter(s => s.visible !== false).length} visible sections
                    </span>
                  )}
                  <div style={{ display: 'flex', gap: '4px' }}>
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
                  {/* Layout Properties */}
                  <div style={{ marginTop: '16px', padding: '12px', background: layout.backgroundColor || '#1a1a2e', borderRadius: '6px', border: '1px solid #333' }}>
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
                          value={layout.backgroundColor || '#1a1a2e'}
                          onChange={(e) => updateShowLayout(layoutIndex, 'backgroundColor', e.target.value)}
                          style={{ width: '40px', height: '32px', cursor: 'pointer', padding: 0, border: '1px solid #444' }}
                        />
                        <input
                          type="text"
                          value={layout.backgroundColor || '#1a1a2e'}
                          onChange={(e) => updateShowLayout(layoutIndex, 'backgroundColor', e.target.value)}
                          style={{ width: '90px', fontFamily: 'monospace', fontSize: '13px' }}
                        />
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => updateShowLayout(layoutIndex, 'backgroundColor', '#1a1a2e')}
                          style={{ padding: '6px 10px', fontSize: '12px' }}
                        >
                          Default
                        </button>
                      </div>
                      <small>Main page background color</small>
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

                    <div className="form-group checkbox-group">
                      <input
                        type="checkbox"
                        id={`showLayoutSelector-${layout.id}`}
                        checked={layout.showLayoutSelector !== false}
                        onChange={(e) => updateShowLayout(layoutIndex, 'showLayoutSelector', e.target.checked)}
                      />
                      <label htmlFor={`showLayoutSelector-${layout.id}`}>Show Layout Selector</label>
                    </div>

                    <div className="form-group checkbox-group">
                      <input
                        type="checkbox"
                        id={`showSettingsButton-${layout.id}`}
                        checked={layout.showSettingsButton !== false}
                        onChange={(e) => updateShowLayout(layoutIndex, 'showSettingsButton', e.target.checked)}
                      />
                      <label htmlFor={`showSettingsButton-${layout.id}`}>Show Settings Button</label>
                    </div>

                    <div className="form-group checkbox-group">
                      <input
                        type="checkbox"
                        id={`showConnectedUsers-${layout.id}`}
                        checked={layout.showConnectedUsers !== false}
                        onChange={(e) => updateShowLayout(layoutIndex, 'showConnectedUsers', e.target.checked)}
                      />
                      <label htmlFor={`showConnectedUsers-${layout.id}`}>Show Connected Users Indicator</label>
                    </div>
                  </div>

                  {/* Dashboard URL and QR Code */}
                  <div style={{ marginTop: '16px', padding: '12px', background: '#1a1a2e', borderRadius: '6px', border: '1px solid #333' }}>
                    <h4 style={{ fontSize: '14px', marginBottom: '12px', color: '#4a90e2' }}>Dashboard Access</h4>

                    <div className="form-group">
                      <label>Dashboard URL</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="text"
                          value={`${window.location.origin}/dashboard/${layout.urlSlug}`}
                          readOnly
                          style={{ flex: 1, fontFamily: 'monospace', fontSize: '12px', background: '#252538', border: '1px solid #333', color: '#4a90e2' }}
                        />
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/dashboard/${layout.urlSlug}`);
                            alert('URL copied to clipboard!');
                          }}
                          style={{ padding: '8px 12px', fontSize: '12px' }}
                        >
                          Copy
                        </button>
                      </div>
                      <small>Direct link to this dashboard</small>
                    </div>

                    {/* QR Code for each network interface */}
                    {networkInterfaces.length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '8px' }}>QR Codes</label>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          {networkInterfaces.map((iface) => (
                            <div
                              key={iface.address}
                              style={{
                                padding: '8px',
                                background: '#252538',
                                borderRadius: '6px',
                                border: '1px solid #333',
                                textAlign: 'center'
                              }}
                            >
                              <div style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', color: '#888' }}>
                                {iface.name}
                              </div>
                              <div style={{ background: 'white', padding: '8px', borderRadius: '4px', display: 'inline-block' }}>
                                <QRCodeCanvas
                                  value={getQRCodeURL(iface.address, layout.urlSlug)}
                                  size={100}
                                  level="M"
                                />
                              </div>
                              <div style={{ fontSize: '10px', color: '#666', marginTop: '4px', fontFamily: 'monospace' }}>
                                {getQRCodeURL(iface.address, layout.urlSlug)}
                              </div>
                              <button
                                onClick={() => downloadQRCode(iface.address, layout.urlSlug)}
                                style={{
                                  marginTop: '6px',
                                  padding: '4px 8px',
                                  fontSize: '10px',
                                  background: '#4ae24a',
                                  color: '#000',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontWeight: '600'
                                }}
                              >
                                Download
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Dashboard Users */}
                  <div style={{ marginTop: '16px', padding: '12px', background: '#1a1a2e', borderRadius: '6px', border: '1px solid #333' }}>
                    <h4 style={{ fontSize: '14px', marginBottom: '12px', color: '#4a90e2' }}>Users with Access</h4>
                    <p style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
                      Manage which users can access this dashboard. Click a user to change their role.
                    </p>

                    {config.clients && config.clients.filter(client => {
                      const dashboardRole = client.dashboardAccess?.[layout.id] || client.role;
                      const hasAccess = client.dashboardAccess?.[layout.id] || !layout.accessControl?.requireExplicitAccess;
                      return hasAccess;
                    }).length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {config.clients.filter(client => {
                          const hasAccess = client.dashboardAccess?.[layout.id] || !layout.accessControl?.requireExplicitAccess;
                          return hasAccess;
                        }).map((client) => {
                          const shortId = client.id.substring(0, 6).toUpperCase();
                          const isActive = activeClients.some(ac => ac.id === client.id);
                          const dashboardRole = client.dashboardAccess?.[layout.id] || client.role || 'viewer';

                          return (
                            <div
                              key={client.id}
                              style={{
                                padding: '8px',
                                background: '#252538',
                                borderRadius: '4px',
                                border: `1px solid ${isActive ? '#4ae24a' : '#333'}`,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '12px'
                              }}
                            >
                              <div
                                style={{
                                  width: '6px',
                                  height: '6px',
                                  borderRadius: '50%',
                                  background: isActive ? '#4ae24a' : '#666',
                                  flexShrink: 0
                                }}
                              />
                              <span style={{ fontWeight: '600', flex: 1 }}>
                                {client.nickname || shortId}
                              </span>
                              <select
                                value={dashboardRole}
                                onChange={(e) => {
                                  const newRole = e.target.value;

                                  // If setting to Editor, apply to ALL dashboards
                                  if (newRole === 'editor') {
                                    if (window.confirm(`Making this user an Editor will grant them Editor access to ALL dashboards. Continue?`)) {
                                      // Update all dashboards
                                      const updatePromises = config.showLayouts.map(layout =>
                                        fetch(`/api/dashboards/${layout.id}/clients/${client.id}/role`, {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ role: 'editor' })
                                        })
                                      );

                                      Promise.all(updatePromises)
                                        .then(() => fetchConfig())
                                        .catch(err => console.error('Failed to update roles:', err));
                                    }
                                  } else {
                                    // Normal per-dashboard role update
                                    fetch(`/api/dashboards/${layout.id}/clients/${client.id}/role`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ role: newRole })
                                    })
                                      .then(res => res.json())
                                      .then(() => fetchConfig())
                                      .catch(err => console.error('Failed to update role:', err));
                                  }
                                }}
                                style={{
                                  padding: '4px 6px',
                                  fontSize: '11px',
                                  background: '#1a1a2e',
                                  border: '1px solid #333',
                                  borderRadius: '3px',
                                  color: '#f0f0f0',
                                  cursor: 'pointer'
                                }}
                              >
                                <option value="viewer">Viewer</option>
                                <option value="controller">Controller</option>
                                <option value="moderator">Moderator</option>
                                <option value="editor">Editor</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#666', fontStyle: 'italic', padding: '8px', background: '#252538', borderRadius: '4px' }}>
                        No users have access to this dashboard yet.
                      </p>
                    )}
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

                            {/* Add Item Dropdown - only for custom sections */}
                            {!isStatic && (
                            <div style={{ marginBottom: '8px' }}>
                              <select
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === 'all:looks') {
                                    config.looks.forEach(look => {
                                      if (!section.items.find(i => i.type === 'look' && i.id === look.id)) {
                                        addItemToSection(layoutIndex, sectionIndex, 'look', look.id);
                                      }
                                    });
                                  } else if (value === 'all:fixtures') {
                                    config.fixtures.forEach(fixture => {
                                      if (!section.items.find(i => i.type === 'fixture' && i.id === fixture.id)) {
                                        addItemToSection(layoutIndex, sectionIndex, 'fixture', fixture.id);
                                      }
                                    });
                                  } else {
                                    const [type, id] = value.split(':');
                                    if (type && id) {
                                      addItemToSection(layoutIndex, sectionIndex, type, id);
                                    }
                                  }
                                  e.target.value = '';
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
                                <option value="all:looks" style={{ fontWeight: 'bold' }}>➕ Add All Looks</option>
                                <option value="all:fixtures" style={{ fontWeight: 'bold' }}>➕ Add All Fixtures</option>
                                <optgroup label="Looks">
                                  {config.looks.map(look => (
                                    <option key={look.id} value={`look:${look.id}`}>
                                      {look.name}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Fixtures">
                                  {config.fixtures.map(fixture => (
                                    <option key={fixture.id} value={`fixture:${fixture.id}`}>
                                      {fixture.name}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>
                            )}

                            {/* Visible All / Deselect All toggle */}
                            <div style={{ marginBottom: '8px', display: 'flex', gap: '8px' }}>
                              <button
                                className="btn btn-secondary btn-small"
                                onClick={() => {
                                  const allVisible = section.items.every(item => item.visible);
                                  section.items.forEach(item => {
                                    updateSectionItem(layoutIndex, sectionIndex, item.id, 'visible', !allVisible);
                                  });
                                }}
                                style={{ fontSize: '11px', padding: '4px 8px' }}
                              >
                                {section.items.every(item => item.visible) ? 'Deselect All' : 'Visible All'}
                              </button>
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
                                          Visible
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
            + Add Dashboard
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

      {/* Export / Import Tab */}
      {activeTab === 'export' && (
        <div className="card">
          <div className="settings-section">
            <h3>Export / Import Configuration</h3>
            <p style={{ color: '#888', marginBottom: '24px' }}>
              Save your entire configuration (fixtures, looks, layouts, etc.) to a JSON file or load a previously saved configuration.
            </p>

            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1', minWidth: '250px' }}>
                <h4 style={{ marginBottom: '12px' }}>Export Configuration</h4>
                <p style={{ fontSize: '14px', color: '#aaa', marginBottom: '12px' }}>
                  Download your complete configuration as a JSON file.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const dataStr = JSON.stringify(config, null, 2);
                    const dataBlob = new Blob([dataStr], { type: 'application/json' });
                    const url = URL.createObjectURL(dataBlob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `dmx-config-${new Date().toISOString().split('T')[0]}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  📥 Export Configuration
                </button>
              </div>

              <div style={{ flex: '1', minWidth: '250px' }}>
                <h4 style={{ marginBottom: '12px' }}>Import Configuration</h4>
                <p style={{ fontSize: '14px', color: '#aaa', marginBottom: '12px' }}>
                  Load a configuration file. This will replace your current settings.
                </p>
                <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-block' }}>
                  📤 Import Configuration
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          try {
                            const importedConfig = JSON.parse(event.target.result);
                            if (window.confirm('This will replace your current configuration. Are you sure?')) {
                              setConfig(importedConfig);
                              // Optionally auto-save
                              fetch('/api/config', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(importedConfig)
                              })
                                .then(() => {
                                  alert('Configuration imported successfully!');
                                  window.location.reload();
                                })
                                .catch(err => {
                                  console.error('Failed to save imported config:', err);
                                  alert('Import successful but failed to save. Please save manually.');
                                });
                            }
                          } catch (err) {
                            alert('Invalid JSON file. Please check the file and try again.');
                            console.error('Import error:', err);
                          }
                        };
                        reader.readAsText(file);
                      }
                      e.target.value = ''; // Reset file input
                    }}
                  />
                </label>
              </div>
            </div>

            <div style={{ marginTop: '32px', padding: '16px', background: '#1a2a3a', borderRadius: '8px', borderLeft: '4px solid #4a90e2' }}>
              <h4 style={{ marginTop: 0, marginBottom: '8px' }}>⚠️ Important Notes</h4>
              <ul style={{ marginBottom: 0, paddingLeft: '20px', color: '#aaa' }}>
                <li>The exported file contains ALL your settings: fixtures, looks, layouts, cue lists, and network configuration.</li>
                <li>Importing will completely replace your current configuration.</li>
                <li>It's recommended to export your configuration regularly as a backup.</li>
                <li>Make sure to save any unsaved changes before importing.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

        </div>{/* End Tab Content */}
      </div>{/* End Main Layout */}

      <ConnectedUsers activeClients={activeClients} show={true} />
    </div>
  );
};

export default SettingsPage;
