import React from 'react';

const Slider = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  unit = '%',
  color,
  lookColors = [],       // Array of color strings: ['purple', 'orange']
  isOverridden = false,  // Boolean: is this channel overridden?
  isFrozen = false,      // Boolean: is this channel frozen after recording?
  lookIntensity = 1,     // Float 0-1: highest look intensity controlling this channel
  hasManualValue = false // Boolean: has channel been manually adjusted?
}) => {
  const displayValue = unit === '°' ? Math.round(value) : Math.round(value);

  // Intensity/white sliders get inline gradient style, RGB handled by CSS classes
  const getSliderStyle = () => {
    if (color === 'white' || color === 'intensity') {
      return {
        background: `linear-gradient(to right, #222 0%, #fff 100%)`
      };
    }
    return {};
  };

  // Map color names to CSS classes
  const getThumbClass = () => {
    let className = 'slider';

    if (color === 'intensity' || color === 'white') {
      className += ' intensity-slider';
    } else if (color) {
      className += ` ${color}-slider`;
    }

    // Add manual-value class for white thumb outline
    if (hasManualValue) {
      className += ' manual-value';
    }

    return className;
  };

  // Generate outline style for slider track based on look control
  const getTrackOutlineStyle = (opacity = 1) => {
    // Color mapping for outlines
    const colorMap = {
      purple: '#9b4ae2',
      orange: '#e2904a',
      cyan: '#4ae2e2',
      pink: '#e24a90',
      yellow: '#e2e24a',
      blue: '#4a90e2',
      red: '#e24a4a',
      green: '#4ae24a'
    };

    if (isOverridden) {
      // Overridden: light grey outline
      return {
        outline: `2px solid rgba(102, 102, 102, ${opacity})`,
        outlineOffset: '2px',
        borderRadius: '8px',
        position: 'relative',
        zIndex: 0
      };
    }

    if (isFrozen) {
      // Frozen after recording: grey outline (darker than override)
      return {
        outline: `3px solid rgba(128, 128, 128, 0.7)`,
        outlineOffset: '2px',
        borderRadius: '8px',
        position: 'relative',
        zIndex: 0
      };
    }

    if (lookColors.length === 0) {
      // No look control: no outline
      return {};
    }

    if (lookColors.length === 1) {
      // Single look: solid color outline with opacity
      const hexColor = colorMap[lookColors[0]] || '#4a90e2';
      // Convert hex to rgba with opacity
      const r = parseInt(hexColor.slice(1, 3), 16);
      const g = parseInt(hexColor.slice(3, 5), 16);
      const b = parseInt(hexColor.slice(5, 7), 16);
      return {
        outline: `3px solid rgba(${r}, ${g}, ${b}, ${opacity})`,
        outlineOffset: '2px',
        borderRadius: '8px',
        position: 'relative',
        zIndex: 0
      };
    }

    // Multiple looks: create striped outline using box-shadow
    const boxShadows = [];
    const stripeWidth = 3; // width of each color stripe in px

    lookColors.forEach((c, index) => {
      const hex = colorMap[c] || '#4a90e2';
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const color = `rgba(${r}, ${g}, ${b}, ${opacity})`;

      // Create box-shadow layers for striped effect
      const offset = index * stripeWidth;
      boxShadows.push(`0 0 0 ${offset + stripeWidth}px ${color}`);
    });

    return {
      outline: `${lookColors.length * stripeWidth}px solid transparent`,
      outlineOffset: '2px',
      borderRadius: '8px',
      position: 'relative',
      zIndex: 0,
      boxShadow: boxShadows.join(', ')
    };
  };

  // Calculate opacity based on look intensity (0-1 scale)
  const outlineOpacity = isOverridden ? 0.6 : Math.max(0.3, lookIntensity);
  const trackOutlineStyle = getTrackOutlineStyle(outlineOpacity);

  return (
    <div className="slider-group">
      <div className="slider-label">
        <span>{label}</span>
        <span>{displayValue}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={getThumbClass()}
        style={{
          ...getSliderStyle(),
          ...trackOutlineStyle,
          position: 'relative',
          zIndex: 1
        }}
      />
    </div>
  );
};

export default Slider;
