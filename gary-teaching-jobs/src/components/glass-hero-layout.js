// Envelope of the original 30-degree tilted plate with full parallax/press.
// Sizes are derived from the available box, not viewport-specific icon presets.
export const glassHeroEnvelope = Object.freeze({
  top: 0.44,
  right: 0.57,
  left: 0.07,
  breathing: 8,
  labelHeight: 46,
  minimumLabelOffset: 13,
  introFaceShift: 0.1,
  focusReach: 6,
  minimumTarget: 44
});

const floor = value => Math.floor(value * 100) / 100;

export function measureGlassHeroLayout(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const columns = width < 420 ? 2 : 3;
  const rows = 6 / columns;
  const e = glassHeroEnvelope;
  const frameWidth = floor(width * 0.96);
  const labelWidth = Math.max(80, Math.min(148, Math.floor((frameWidth - 24) / columns) - 12));
  const envelope = size => {
    // The keyboard focus outline travels with the face during its intro. Keep
    // the tooltip below that complete path, not only the final resting plate.
    const labelOffset = Math.ceil(Math.max(e.minimumLabelOffset, e.introFaceShift * size + e.focusReach + 2));
    const labelTail = labelOffset + e.labelHeight;
    const left = Math.max(e.left * size, (labelWidth - size) / 2) + e.breathing;
    const right = Math.max(e.right * size, (labelWidth - size) / 2) + e.breathing;
    const top = e.top * size + e.breathing;
    const bottom = labelTail + e.breathing;
    // Two independent intro/hover poses can put one rear plate at its rightmost
    // extent while the next one reaches left. Reserve both, not only the first.
    const gap = Math.max((e.right + e.left) * size + e.breathing, labelWidth - size + e.breathing);
    const rowGap = e.top * size + labelTail + e.breathing;
    return { left, right, top, bottom, gap, rowGap, labelOffset, labelTail,
      width: columns * size + (columns - 1) * gap + left + right,
      height: rows * size + (rows - 1) * rowGap + top + bottom };
  };
  const minimum = envelope(e.minimumTarget);
  // Very small/hidden containers keep the six usable DOM links, without a GPU
  // allocation or undersized controls. Public CSS supplies a sufficient height.
  if (minimum.width + 0.5 > frameWidth || minimum.height + 0.5 > height) return null;
  const heightBudget = floor(Math.max(minimum.height + 0.5, height * (columns === 3 ? 0.8 : 0.9)));
  const fits = size => {
    const box = envelope(size);
    return box.width + 0.5 <= frameWidth && box.height + 0.5 <= heightBudget;
  };
  let low = e.minimumTarget;
  const scaledSize = Math.sqrt(width * height) * (columns === 3 ? 0.16 : 0.175);
  let high = Math.max(low, columns === 3 ? Math.min(scaledSize, width / 6) : scaledSize);
  for (let i = 0; i < 24; i++) {
    const candidate = (low + high) / 2;
    if (fits(candidate)) low = candidate;
    else high = candidate;
  }
  const size = Math.floor(low);
  const reserve = envelope(size);
  const padding = { top: floor(reserve.top), right: floor(reserve.right), bottom: floor(reserve.bottom), left: floor(reserve.left) };
  // Leave half a pixel for wrapping and limit the spare space between rows.
  const gap = floor((frameWidth - padding.left - padding.right - columns * size - 0.5) / (columns - 1));
  const spareHeight = Math.max(0, heightBudget - reserve.height - 0.5);
  const rowGap = floor(reserve.rowGap + Math.min(spareHeight / (rows - 1), size * 0.32));
  const gridHeight = rows * size + (rows - 1) * rowGap;
  const frameHeight = floor(gridHeight + padding.top + padding.bottom + 0.5);
  return {
    size, gap, rowGap, columns, rows, labelWidth, labelOffset: reserve.labelOffset, labelTail: reserve.labelTail, frameWidth, frameHeight, padding,
    gridWidth: columns * size + (columns - 1) * gap,
    gridHeight,
    heightRatio: frameHeight / height
  };
}
