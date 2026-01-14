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
  lookContributors = [], // Array of { color: string, value: number } for weighted mixing
  isOverridden = false,  // Boolean: is this channel overridden?
  isFrozen = false,      // Boolean: is this channel frozen after recording?
  lookIntensity = 1,     // Float 0-1: highest look intensity controlling this channel
  hasManualValue = false, // Boolean: has channel been manually adjusted?
  disabled = false,      // Boolean: disable slider for viewers
  customThumbColor = null, // Optional: custom RGB string for thumb color (e.g., 'rgb(255, 128, 0)')
  customTrackGradient = null // Optional: custom gradient string for track (e.g., 'linear-gradient(to right, #000, rgb(255,0,0))')
}) => {
  const displayValue = unit === '°' ? Math.round(value) : Math.round(value);

  // Color mapping for look colors and channel colors
  const colorMap = {
    purple: { r: 155, g: 74, b: 226 },
    orange: { r: 226, g: 144, b: 74 },
    cyan: { r: 74, g: 226, b: 226 },
    pink: { r: 226, g: 74, b: 144 },
    yellow: { r: 226, g: 226, b: 74 },
    blue: { r: 74, g: 144, b: 226 },
    red: { r: 226, g: 74, b: 74 },
    green: { r: 74, g: 226, b: 74 },
    intensity: { r: 255, g: 255, b: 170 },
    white: { r: 255, g: 255, b: 255 }
  };

  // Colors that get the outline-to-fill thumb effect
  const outlineFillColors = ['purple', 'orange', 'cyan', 'pink', 'yellow', 'blue', 'red', 'green', 'intensity', 'white'];
  const hasOutlineFillThumb = outlineFillColors.includes(color);

  // Get slider track gradient style
  const getSliderStyle = () => {
    // Use custom track gradient if provided
    if (customTrackGradient) {
      return {
        background: customTrackGradient
      };
    }
    if (color === 'white' || color === 'intensity') {
      return {
        background: `linear-gradient(to right, #222 0%, #fff 100%)`
      };
    }
    // Sliders with outline-fill effect get gradient from black to their color
    if (hasOutlineFillThumb && colorMap[color]) {
      const rgb = colorMap[color];
      return {
        background: `linear-gradient(to right, #111 0%, rgb(${rgb.r}, ${rgb.g}, ${rgb.b}) 100%)`
      };
    }
    return {};
  };

  // Get thumb style for sliders with outline-fill effect (outline at 0%, solid at 100%)
  const getLookThumbStyle = () => {
    // If custom thumb color is provided, use it
    if (customThumbColor) {
      return {
        '--thumb-bg': customThumbColor,
        '--thumb-border': customThumbColor
      };
    }

    if (!hasOutlineFillThumb || !colorMap[color]) return {};

    const rgb = colorMap[color];
    const intensity = value / max; // 0 to 1

    // At 0%: outline color, black center
    // At 100%: solid color
    return {
      '--thumb-bg': `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity})`,
      '--thumb-border': `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
    };
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

    // Add look-slider class for CSS variable thumb styling
    if (hasOutlineFillThumb) {
      className += ' look-slider';
    }

    return className;
  };

  // Generate outline style for slider track based on look control
  const getTrackOutlineStyle = (opacity = 1) => {
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

    if (lookContributors.length === 0) {
      // No look control: no outline
      return {};
    }

    // Weighted color mixing based on each look's contribution value
    let r = 0, g = 0, b = 0;
    let totalWeight = 0;
    lookContributors.forEach(contrib => {
      const rgb = colorMap[contrib.color] || { r: 74, g: 144, b: 226 };
      const weight = contrib.value || 1;
      r += rgb.r * weight;
      g += rgb.g * weight;
      b += rgb.b * weight;
      totalWeight += weight;
    });
    if (totalWeight > 0) {
      r = Math.round(r / totalWeight);
      g = Math.round(g / totalWeight);
      b = Math.round(b / totalWeight);
    }

    return {
      outline: `3px solid rgba(${r}, ${g}, ${b}, ${opacity})`,
      outlineOffset: '2px',
      borderRadius: '8px',
      position: 'relative',
      zIndex: 0
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
        disabled={disabled}
        className={getThumbClass()}
        style={{
          ...getSliderStyle(),
          ...trackOutlineStyle,
          ...getLookThumbStyle(),
          position: 'relative',
          zIndex: 1,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      />
    </div>
  );
};

export default Slider;
