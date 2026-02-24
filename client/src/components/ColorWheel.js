import { useRef, useEffect, useState, useCallback } from 'react';
import Slider from './Slider';
import { rgbToHsv, hsvToRgb } from '../utils/color';

const ColorWheel = ({
  // Can accept either RGB or HSV props
  red = 0,              // 0-100 (RGB input) - used when mode='rgb'
  green = 0,            // 0-100 (RGB input) - used when mode='rgb'
  blue = 0,             // 0-100 (RGB input) - used when mode='rgb'
  hue = 0,              // 0-360 (HSV input) - used when mode='hsv'
  sat = 0,              // 0-100 (HSV input) - used when mode='hsv'
  brightness = 0,       // 0-100 (HSV input) - used when mode='hsv'
  mode = 'rgb',         // 'rgb' or 'hsv' - determines which props to use and how to send updates
  onChange,             // (r, g, b) => {} when mode='rgb', (h, s, v) => {} when mode='hsv'
  disabled = false,
  showWheel = true,
  sliderMaxWidth = 200,
  showBrightnessSlider = true,
  lockHueSat = false,
  syncHueSatFromProps = false,
  initialHsv = null,
  customTrackGradient = null,
  customThumbColor = null,

  // Highlight props (matching Slider.js)
  hasManualValue = false,
  isOverridden = false,
  isFrozen = false,
  lookContributors = [],  // [{ color, value }]
  lookIntensity = 1
}) => {
  const canvasRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [actualSize, setActualSize] = useState(200);
  const wheelSize = 200; // Canvas element size (constant)

  // Internal HSV state - ref is source of truth for current values
  const internalHSVRef = useRef({ h: 0, s: 0, v: 0 });
  const [renderTrigger, setRenderTrigger] = useState(0);
  const isUpdatingFromProps = useRef(false);
  const lastRgbRatioRef = useRef(null);

  // Track if user has ever set H/S manually
  const hasUserSetColor = useRef(false);

  // Seed from initial HSV (dashboard/looks)
  useEffect(() => {
    if (!initialHsv) return;
    internalHSVRef.current.h = initialHsv.h ?? 0;
    internalHSVRef.current.s = initialHsv.s ?? 0;
    internalHSVRef.current.v = initialHsv.v ?? 0;
    setRenderTrigger(t => t + 1);
  }, [initialHsv?.h, initialHsv?.s, initialHsv?.v]);

  // Sync from props
  useEffect(() => {
    if (isUpdatingFromProps.current) {
      console.log('[ColorWheel] Skipping prop sync - currently updating from local change');
      return;
    }

    let h, s, v;

    if (mode === 'hsv') {
      // HSV mode: Use HSV props directly (no conversion!)
      h = hue;
      s = sat;
      v = brightness;
      console.log(`[ColorWheel HSV] Props changed: HSV(${h.toFixed(1)}, ${s.toFixed(1)}, ${v.toFixed(1)})`);
    } else {
      // RGB mode: Convert RGB to HSV
      const hsv = rgbToHsv(red, green, blue);
      h = hsv.h;
      s = hsv.s;
      v = hsv.v;
      console.log(`[ColorWheel RGB] Props changed: RGB(${red}, ${green}, ${blue}) -> HSV(${h.toFixed(1)}, ${s.toFixed(1)}, ${v.toFixed(1)})`);
    }

    console.log(`[ColorWheel] Current internal: HSV(${internalHSVRef.current.h.toFixed(1)}, ${internalHSVRef.current.s.toFixed(1)}, ${internalHSVRef.current.v.toFixed(1)})`);

    // If saturation is 0 with brightness > 0 (white), reset to center
    if (s === 0 && v > 0) {
      console.log('[ColorWheel] ✅ Saturation is 0 (clear button or white), resetting to center');
      hasUserSetColor.current = false;
      internalHSVRef.current.h = 0;
      internalHSVRef.current.s = 0;
      internalHSVRef.current.v = v;
      setRenderTrigger(t => t + 1);
      return;
    }
    // If brightness is 0, preserve H/S so dimming doesn't shift hue
    if (v === 0) {
      internalHSVRef.current.v = v;
      return;
    }

    if (mode === 'hsv') {
      if (lockHueSat) {
        // Lock H/S to props; only allow V changes from slider
        internalHSVRef.current.h = h;
        internalHSVRef.current.s = s;
        internalHSVRef.current.v = v;
        setRenderTrigger(t => t + 1);
        return;
      }
      // HSV mode: Always sync from props (no conversion drift)
      console.log('[ColorWheel HSV] Syncing from props (no conversion issues)');
      internalHSVRef.current.h = h;
      internalHSVRef.current.s = s;
      internalHSVRef.current.v = v;
      setRenderTrigger(t => t + 1);
    } else {
      const comingFromBlack = internalHSVRef.current.v === 0 && v > 0;
      const hasKnownHue = hasUserSetColor.current || lastRgbRatioRef.current;
      let isBrightnessOnly = false;
      if (v > 0) {
        const max = Math.max(red, green, blue);
        if (max > 0) {
          const ratios = {
            r: red / max,
            g: green / max,
            b: blue / max
          };
          if (lastRgbRatioRef.current) {
            const dr = Math.abs(ratios.r - lastRgbRatioRef.current.r);
            const dg = Math.abs(ratios.g - lastRgbRatioRef.current.g);
            const db = Math.abs(ratios.b - lastRgbRatioRef.current.b);
            if (dr < 0.02 && dg < 0.02 && db < 0.02) {
              isBrightnessOnly = true;
            }
          }
          lastRgbRatioRef.current = ratios;
        }
      }

      // RGB mode: Only update H and S if user hasn't set color (prevent conversion drift)
      // Avoid hue snaps at very low brightness values.
      if (!isBrightnessOnly && !comingFromBlack && (syncHueSatFromProps || !hasUserSetColor.current) && v > 1 && s > 0) {
        console.log('[ColorWheel RGB] User has not set color yet, initializing H and S from props');
        internalHSVRef.current.h = h;
        internalHSVRef.current.s = s;
        setRenderTrigger(t => t + 1);
      } else {
        console.log('[ColorWheel RGB] User has set color, NOT updating H and S from props (prevents conversion drift)');
      }
      // Always update brightness from props
      internalHSVRef.current.v = v;
    }
  }, [mode, red, green, blue, hue, sat, brightness]);

  // Helper to update color and notify parent
  const updateColor = useCallback((h, s, v, triggerRender = true) => {
    console.log(`[ColorWheel] updateColor called: h=${h.toFixed(1)}, s=${s.toFixed(1)}, v=${v.toFixed(1)}, triggerRender=${triggerRender}, mode=${mode}`);

    // Update ref
    internalHSVRef.current = { h, s, v };

    if (mode === 'hsv') {
      // HSV mode: Send HSV values directly (no conversion)
      console.log(`[ColorWheel HSV] Sending HSV(${h.toFixed(1)}, ${s.toFixed(1)}, ${v.toFixed(1)}) to parent`);
      onChange(h, s, v);
    } else {
      // RGB mode: Convert HSV to RGB before sending
      const rgb = hsvToRgb(h, s, v);
      console.log(`[ColorWheel RGB] Sending RGB(${rgb.r}, ${rgb.g}, ${rgb.b}) to parent`);
      onChange(rgb.r, rgb.g, rgb.b);
    }

    // Block prop updates briefly
    isUpdatingFromProps.current = true;
    setTimeout(() => {
      isUpdatingFromProps.current = false;
    }, 100);

    // Only trigger re-render if H or S changed (not just V)
    if (triggerRender) {
      console.log('[ColorWheel] Triggering re-render');
      setRenderTrigger(t => t + 1);
    }
  }, [mode, onChange]);

  // Track actual rendered size for responsive positioning
  useEffect(() => {
    const updateSize = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setActualSize(rect.width);
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Color map for look contributors (matching Slider.js)
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

  // Generate container outline style (matching Slider.js getTrackOutlineStyle)
  const getContainerOutlineStyle = () => {
    const opacity = isOverridden ? 0.6 : Math.max(0.3, lookIntensity);

    if (isOverridden) {
      return {
        outline: `2px solid rgba(102, 102, 102, ${opacity})`,
        outlineOffset: '2px',
        borderRadius: '8px'
      };
    }

    if (isFrozen) {
      return {
        outline: `3px solid rgba(128, 128, 128, 0.7)`,
        outlineOffset: '2px',
        borderRadius: '8px'
      };
    }

    if (!lookContributors || lookContributors.length === 0) {
      return {};
    }

    // Weighted color mixing
    let r = 0, g = 0, b = 0, totalWeight = 0;
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
      borderRadius: '8px'
    };
  };

  // Draw the color wheel on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const centerX = wheelSize / 2;
    const centerY = wheelSize / 2;
    const radius = wheelSize / 2 - 10;

    // Clear canvas
    ctx.clearRect(0, 0, wheelSize, wheelSize);

    // Draw color wheel using pixel-by-pixel approach with anti-aliasing
    const imageData = ctx.createImageData(wheelSize, wheelSize);
    const data = imageData.data;

    for (let y = 0; y < wheelSize; y++) {
      for (let x = 0; x < wheelSize; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= radius + 1) {
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          let hue = angle + 90;
          if (hue < 0) hue += 360;
          if (hue >= 360) hue -= 360;

          const sat = Math.min((distance / radius) * 100, 100);

          // Convert HSV to RGB for pixel color (white center)
          const h = hue;
          const s = sat / 100;
          const v = 1;

          const c = v * s;
          const x1 = c * (1 - Math.abs(((h / 60) % 2) - 1));
          const m = v - c;

          let r = 0, g = 0, b = 0;
          if (h >= 0 && h < 60) { r = c; g = x1; b = 0; }
          else if (h >= 60 && h < 120) { r = x1; g = c; b = 0; }
          else if (h >= 120 && h < 180) { r = 0; g = c; b = x1; }
          else if (h >= 180 && h < 240) { r = 0; g = x1; b = c; }
          else if (h >= 240 && h < 300) { r = x1; g = 0; b = c; }
          else { r = c; g = 0; b = x1; }

          // Anti-aliasing for smooth edge
          let alpha = 255;
          if (distance > radius - 1) {
            alpha = Math.round((1 - (distance - (radius - 1))) * 255);
          }

          const idx = (y * wheelSize + x) * 4;
          data[idx] = Math.round((r + m) * 255);
          data[idx + 1] = Math.round((g + m) * 255);
          data[idx + 2] = Math.round((b + m) * 255);
          data[idx + 3] = alpha;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [wheelSize]);

  // Convert hue/sat to x/y position (uses actualSize for responsive positioning)
  const getPositionFromHS = useCallback((h, s) => {
    const scale = actualSize / wheelSize; // Scale factor for CSS resizing
    const centerX = Math.round(actualSize / 2);
    const centerY = Math.round(actualSize / 2);
    const radius = (actualSize / 2 - 10 * scale) * (s / 100);
    const angle = (h - 90) * Math.PI / 180;

    return {
      x: Math.round(centerX + radius * Math.cos(angle)),
      y: Math.round(centerY + radius * Math.sin(angle))
    };
  }, [actualSize, wheelSize]);

  // Handle brightness change (don't trigger re-render, only update ref and notify parent)
  const handleBrightnessChange = useCallback((val) => {
    updateColor(internalHSVRef.current.h, internalHSVRef.current.s, val, false);
  }, [updateColor]);

  // Handle mouse/touch events
  const handleInteraction = useCallback((event) => {
    if (disabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if (event.touches) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    // Calculate hue/sat directly here to avoid dependency on getHSFromPosition
    const centerX = wheelSize / 2;
    const centerY = wheelSize / 2;
    const maxRadius = wheelSize / 2 - 10;

    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    let h = angle + 90;
    if (h < 0) h += 360;
    if (h >= 360) h -= 360;

    const s = Math.min((distance / maxRadius) * 100, 100);

    // Mark that user has manually set color
    hasUserSetColor.current = true;
    console.log('[ColorWheel] User manually set color on wheel');

    updateColor(h, s, internalHSVRef.current.v);
  }, [disabled, updateColor, wheelSize]);

  const handleMouseDown = useCallback((event) => {
    if (disabled) return;
    setIsDragging(true);
    handleInteraction(event);
  }, [disabled, handleInteraction]);

  const handleMouseMove = useCallback((event) => {
    if (!isDragging || disabled) return;
    if (event.cancelable && event.touches) {
      event.preventDefault();
    }
    handleInteraction(event);
  }, [isDragging, disabled, handleInteraction]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse/touch event listeners
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove, { passive: false });
      window.addEventListener('touchend', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleMouseMove);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Use internal ref for handle position
  const handlePosition = getPositionFromHS(internalHSVRef.current.h, internalHSVRef.current.s);

  // Calculate RGB color for brightness slider thumb (current brightness)
  const thumbColor = hsvToRgb(internalHSVRef.current.h, internalHSVRef.current.s, internalHSVRef.current.v);
  const thumbRgbString = customThumbColor || `rgb(${Math.round(thumbColor.r * 2.55)}, ${Math.round(thumbColor.g * 2.55)}, ${Math.round(thumbColor.b * 2.55)})`;

  // Calculate full brightness color for track gradient (H and S at full V)
  const fullBrightnessColor = hsvToRgb(internalHSVRef.current.h, internalHSVRef.current.s, 100);
  const trackGradient = customTrackGradient || `linear-gradient(to right, #111 0%, rgb(${Math.round(fullBrightnessColor.r * 2.55)}, ${Math.round(fullBrightnessColor.g * 2.55)}, ${Math.round(fullBrightnessColor.b * 2.55)}) 100%)`;

  return (
    <div className="colorwheel-container" style={getContainerOutlineStyle()}>
      {showWheel && (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <canvas
            ref={canvasRef}
            width={wheelSize}
            height={wheelSize}
            className={`colorwheel-wheel${hasManualValue ? ' colorwheel-manual' : ''}`}
            onMouseDown={handleMouseDown}
            onTouchStart={handleMouseDown}
            style={{
              cursor: disabled ? 'not-allowed' : 'crosshair',
              opacity: disabled ? 0.5 : 1,
              display: 'block'
            }}
          />

          {/* Handle indicator */}
          <div
            className="colorwheel-handle"
            style={{
              position: 'absolute',
              left: `${handlePosition.x}px`,
              top: `${handlePosition.y}px`,
              pointerEvents: 'none'
            }}
          />
        </div>
      )}

      {/* Brightness slider */}
      {showBrightnessSlider && (
        <div style={{ width: '100%', maxWidth: sliderMaxWidth }}>
          <Slider
            label=""
            value={internalHSVRef.current.v}
            onChange={handleBrightnessChange}
            min={0}
            max={100}
            color="intensity"
            unit="%"
            hasManualValue={hasManualValue}
            isOverridden={isOverridden}
            isFrozen={isFrozen}
            lookContributors={lookContributors}
            lookIntensity={lookIntensity}
            disabled={disabled}
            customThumbColor={thumbRgbString}
            customTrackGradient={trackGradient}
          />
        </div>
      )}
    </div>
  );
};

export default ColorWheel;
