// RGB to HSV conversion
export const rgbToHsv = (r, g, b) => {
  let rNorm = r / 100;
  let gNorm = g / 100;
  let bNorm = b / 100;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const diff = max - min;

  let h = 0;
  const s = max === 0 ? 0 : (diff / max) * 100;
  const v = max * 100;

  if (diff !== 0) {
    if (max === rNorm) {
      h = 60 * (((gNorm - bNorm) / diff) % 6);
    } else if (max === gNorm) {
      h = 60 * (((bNorm - rNorm) / diff) + 2);
    } else {
      h = 60 * (((rNorm - gNorm) / diff) + 4);
    }
  }

  if (h < 0) h += 360;

  return { h: Math.round(h), s: Math.round(s), v: Math.round(v) };
};

// HSV to RGB conversion
export const hsvToRgb = (h, s, v) => {
  const sNorm = s / 100;
  const vNorm = v / 100;

  const c = vNorm * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vNorm - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 100),
    g: Math.round((g + m) * 100),
    b: Math.round((b + m) * 100)
  };
};
