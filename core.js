export const TICKS_PER_QUARTER = 24;

export const GRID_OPTIONS = [
  { id: "half", label: "1/2", ticks: 48 },
  { id: "quarter", label: "1/4", ticks: 24 },
  { id: "eighth", label: "1/8", ticks: 12 },
  { id: "sixteenth", label: "1/16", ticks: 6 },
  { id: "thirtysecond", label: "1/32", ticks: 3 },
  { id: "triplet", label: "1/8T · triplets", ticks: 8 },
  { id: "dotted-quarter", label: "1/4· · dotted", ticks: 36 },
  { id: "dotted-eighth", label: "1/8· · dotted", ticks: 18 }
];

export const PAPER_SIZES = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 }
};

export function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

export function lcm(a, b) {
  const x = Math.abs(Math.round(a));
  const y = Math.abs(Math.round(b));
  return x && y ? Math.abs(x * y) / gcd(x, y) : 0;
}

export function lcmMany(values) {
  return values.reduce((total, value) => lcm(total, value), 1);
}

export function getGridOption(gridId) {
  return GRID_OPTIONS.find((option) => option.id === gridId) ?? GRID_OPTIONS[3];
}

export function getBarTicks(meter, ticksPerQuarter = TICKS_PER_QUARTER) {
  const numerator = Number(meter?.numerator) || 4;
  const denominator = Number(meter?.denominator) || 4;
  return Math.round(numerator * (4 / denominator) * ticksPerQuarter);
}

export function getCycleTicks({ meter, gridId, bars = "auto" }) {
  const bar = getBarTicks(meter);
  const step = getGridOption(gridId).ticks;
  const requestedBars = bars === "auto" ? 1 : Math.max(1, Number(bars) || 1);
  return lcm(bar * requestedBars, step);
}

export function getGridColumns({ meter, gridId, bars = "auto" }) {
  const cycleTicks = getCycleTicks({ meter, gridId, bars });
  return cycleTicks / getGridOption(gridId).ticks;
}

export function angleForTick(tick, cycleTicks, startAngle = 0, direction = "clockwise") {
  const sign = direction === "counterclockwise" ? -1 : 1;
  return startAngle + sign * (Number(tick) / Number(cycleTicks)) * 360;
}

export function polarPoint(cx, cy, radius, degrees) {
  const radians = (degrees - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

export function formatStepLabel(index, gridId) {
  if (gridId === "triplet") return `${index + 1}T`;
  return String(index + 1);
}

export function calculateLayout({ paper = "A4", orientation = "portrait", circleDiameter = 190, margin = 10 }) {
  const base = PAPER_SIZES[paper] ?? PAPER_SIZES.A4;
  const page = orientation === "landscape"
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
  const radius = Number(circleDiameter) / 2;
  const circleFits = circleDiameter + margin * 2 <= Math.min(page.width, page.height);
  const cx = page.width / 2;
  const cy = Math.min(Math.max(radius + margin, page.height * 0.37), page.height - radius - margin);
  return { ...page, cx, cy, radius, circleFits };
}

export function ringRadii({ radius, ringCount = 2, ringPitch = 8 }) {
  const count = Math.max(1, Number(ringCount) || 1);
  const pitch = Math.max(0.1, Number(ringPitch) || 8);
  const outer = radius - 14 - (count - 1) * pitch;
  return Array.from({ length: count }, (_, index) => outer + (count - 1 - index) * pitch);
}

export function validateGeometry({ circleDiameter, margin, centerHole, holeDiameter, ringCount, ringPitch, paper, orientation }) {
  const errors = [];
  const warnings = [];
  const diameter = Number(circleDiameter);
  const safeMargin = Number(margin);
  const center = Number(centerHole);
  const hole = Number(holeDiameter);
  if (!(diameter > 0)) errors.push("Circle diameter must be greater than 0 mm.");
  if (!(safeMargin >= 0)) errors.push("Page margin cannot be negative.");
  if (!(center > 0 && center < diameter)) errors.push("Center hole must be smaller than the circle.");
  if (!(hole > 0 && hole < diameter / 2)) errors.push("Peg mark diameter is outside the usable range.");
  if (!(Number(ringCount) >= 1 && Number(ringCount) <= 8)) errors.push("Ring count must be between 1 and 8.");
  if (!(Number(ringPitch) > 0)) errors.push("Ring pitch must be greater than 0 mm.");
  const layout = calculateLayout({ paper, orientation, circleDiameter: diameter, margin: safeMargin });
  if (!layout.circleFits) warnings.push(`${diameter} mm circle does not fit on ${paper} with ${safeMargin} mm margins.`);
  const radii = ringRadii({ radius: layout.radius, ringCount, ringPitch });
  if (radii.some((r) => r <= center / 2 + hole / 2 + 2)) warnings.push("Rings are too close to the center hole or each other.");
  return { errors, warnings, layout, radii };
}
