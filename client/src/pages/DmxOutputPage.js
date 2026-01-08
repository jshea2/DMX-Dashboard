import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const DmxOutputPage = () => {
  const navigate = useNavigate();
  const [dmxData, setDmxData] = useState({});
  const [selectedUniverse, setSelectedUniverse] = useState(null);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    fetchConfig();
    fetchDmxOutput();
    const interval = setInterval(fetchDmxOutput, 100); // Update 10 times per second
    return () => clearInterval(interval);
  }, []);

  const fetchConfig = () => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch config:', err));
  };

  const fetchDmxOutput = () => {
    fetch('/api/dmx-output')
      .then(res => res.json())
      .then(data => {
        console.log('DMX Output data:', data);
        setDmxData(data);
        // Set default universe if not set
        if (!selectedUniverse && Object.keys(data).length > 0) {
          const firstKey = Object.keys(data)[0];
          // Handle both numeric and string keys (sACN vs Art-Net)
          setSelectedUniverse(isNaN(firstKey) ? firstKey : parseInt(firstKey));
        }
      })
      .catch(err => console.error('Failed to fetch DMX output:', err));
  };

  // Handle both numeric (sACN) and string (Art-Net) universe keys
  const universes = Object.keys(dmxData).sort((a, b) => {
    const aNum = parseInt(a);
    const bNum = parseInt(b);
    if (isNaN(aNum) || isNaN(bNum)) return a.localeCompare(b);
    return aNum - bNum;
  });

  const currentUniverseData = dmxData[selectedUniverse] || new Array(512).fill(0);

  // Format universe label based on protocol
  const getUniverseLabel = (univ) => {
    if (!config) return `Universe ${univ}`;

    if (config.network.protocol === 'artnet') {
      const artnet = config.network.artnet;
      return `Art-Net Net:${artnet.net} Sub:${artnet.subnet} Univ:${artnet.universe}`;
    } else {
      return `sACN Universe ${univ}`;
    }
  };

  // Create grid of DMX values (16 columns)
  const rows = [];
  for (let i = 0; i < 512; i += 16) {
    const row = [];
    for (let j = 0; j < 16; j++) {
      const channel = i + j;
      const value = currentUniverseData[channel] || 0;
      row.push({ channel: channel + 1, value });
    }
    rows.push(row);
  }

  return (
    <div className="dmx-output-page">
      <div className="settings-header">
        <h1>DMX Output Viewer</h1>
        <button className="back-btn" onClick={() => navigate('/settings')}>
          Back
        </button>
      </div>

      <div className="card">
        <div className="form-group">
          <label>Universe</label>
          <select
            value={selectedUniverse}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedUniverse(isNaN(val) ? val : parseInt(val));
            }}
          >
            {universes.length === 0 && <option value="">No universes configured</option>}
            {universes.map(univ => (
              <option key={univ} value={univ}>{getUniverseLabel(univ)}</option>
            ))}
          </select>
        </div>

        <div className="dmx-grid">
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} className="dmx-grid-row">
              {row.map(cell => (
                <div
                  key={cell.channel}
                  className="dmx-grid-cell"
                  style={{
                    backgroundColor: `rgba(59, 130, 246, ${cell.value / 255})`,
                    color: cell.value > 128 ? '#000' : '#fff'
                  }}
                  title={`Channel ${cell.channel}: ${cell.value}`}
                >
                  <div className="dmx-channel">{cell.channel}</div>
                  <div className="dmx-value">{cell.value}</div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '16px', fontSize: '14px', color: '#9ca3af' }}>
          <p>Live DMX output values (0-255). Cells are color-coded by intensity.</p>
          <p>Updates 10 times per second.</p>
        </div>
      </div>
    </div>
  );
};

export default DmxOutputPage;
