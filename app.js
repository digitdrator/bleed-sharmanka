import {
  GRID_OPTIONS,
  PAPER_SIZES,
  TICKS_PER_QUARTER,
  angleForTick,
  calculateLayout,
  chordDistance,
  getBarTicks,
  getCycleTicks,
  getGridColumns,
  getGridOption,
  polarPoint,
  ringRadii,
  validateGeometry
} from "./core.js";

const COLORS = ["#ffb15c", "#79d8d2", "#f4876e", "#c7a4ff"];
const $ = (id) => document.getElementById(id);

const initialState = {
  title: "Opening rhythm study",
  bpm: 120,
  meter: { numerator: 4, denominator: 4 },
  gridId: "sixteenth",
  bars: "auto",
  voices: [
    { name: "kick", ring: 0, events: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90] },
    { name: "snare", ring: 1, events: [24, 72] }
  ],
  circle: {
    diameter: 190, paper: "A4", orientation: "portrait", margin: 10, centerHole: 6,
    holeDiameter: 3, centerDotDiameter: 0.8, ringCount: 2, ringPitch: 8, startAngle: 0, direction: "clockwise", mode: "holes"
  },
  labels: { bars: true, beats: true, subdivisions: true, gridLines: true, noteRays: true, voices: true }
};

let state = clone(initialState);
let undoStack = [];
let playTimer = null;
let currentStep = -1;
let audioContext = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
function escapeXml(value) { return escapeHtml(value); }
function gridFromResolution(resolution) {
  return ({ "1/2": "half", "1/4": "quarter", "1/8": "eighth", "1/16": "sixteenth", "32nd": "thirtysecond", "1/32": "thirtysecond" }[resolution] ?? "sixteenth");
}
function resolutionFromGrid(gridId) {
  return ({ half: "1/2", quarter: "1/4", eighth: "1/8", sixteenth: "1/16", thirtysecond: "32nd", triplet: "triplet", "dotted-quarter": "dotted-quarter", "dotted-eighth": "dotted-eighth" }[gridId] ?? "1/16");
}
function cycleTicks() { return getCycleTicks({ meter: state.meter, gridId: state.gridId, bars: state.bars }); }
function stepTicks() { return getGridOption(state.gridId).ticks; }
function columnCount() { return getGridColumns({ meter: state.meter, gridId: state.gridId, bars: state.bars }); }

function normalizeState(next) {
  const normalized = clone(next);
  normalized.title = String(normalized.title ?? "Untitled rhythm");
  normalized.bpm = Math.min(300, Math.max(30, Number(normalized.bpm) || 120));
  normalized.meter = {
    numerator: Math.min(32, Math.max(1, Number(normalized.meter?.numerator) || 4)),
    denominator: [2, 4, 8, 16].includes(Number(normalized.meter?.denominator)) ? Number(normalized.meter.denominator) : 4
  };
  normalized.gridId = getGridOption(normalized.gridId).id;
  normalized.bars = normalized.bars === "auto" ? "auto" : Math.min(8, Math.max(1, Number(normalized.bars) || 1));
  normalized.voices = Array.isArray(normalized.voices) && normalized.voices.length ? normalized.voices.slice(0, 4) : [{ name: "voice 1", ring: 0, events: [] }];
  const maxTick = getCycleTicks({ meter: normalized.meter, gridId: normalized.gridId, bars: normalized.bars });
  normalized.voices = normalized.voices.map((voice, index) => ({
    name: String(voice.name ?? `voice ${index + 1}`).slice(0, 32) || `voice ${index + 1}`,
    ring: Math.max(0, Number(voice.ring) || 0),
    events: [...new Set((Array.isArray(voice.events) ? voice.events : []).map(Number).filter((event) => Number.isInteger(event) && event >= 0 && event < maxTick))].sort((a, b) => a - b)
  }));
  normalized.circle = { ...initialState.circle, ...(normalized.circle ?? {}) };
  normalized.labels = { ...initialState.labels, ...(normalized.labels ?? {}) };
  return normalized;
}

function remapEvents(oldState, nextState) {
  const oldCycle = getCycleTicks({ meter: oldState.meter, gridId: oldState.gridId, bars: oldState.bars });
  const nextCycle = getCycleTicks({ meter: nextState.meter, gridId: nextState.gridId, bars: nextState.bars });
  const nextStep = getGridOption(nextState.gridId).ticks;
  nextState.voices = nextState.voices.map((voice, index) => {
    const oldVoice = oldState.voices[index] ?? { events: [] };
    const events = (oldVoice.events ?? []).map((event) => Math.round((event / oldCycle) * nextCycle / nextStep) * nextStep % nextCycle);
    return { ...voice, events: [...new Set(events)].sort((a, b) => a - b) };
  });
  return nextState;
}

function setState(next, { record = true } = {}) {
  if (record) undoStack.push(clone(state));
  undoStack = undoStack.slice(-40);
  state = normalizeState(next);
  render();
  saveDraft();
}

function showMessage(message = "") { $("globalMessage").textContent = message; }

function populateControls() {
  $("gridInput").innerHTML = GRID_OPTIONS.map((option) => `<option value="${option.id}">${option.label}</option>`).join("");
  $("gridInput").value = state.gridId;
}

function renderRoll() {
  const columns = columnCount();
  const step = stepTicks();
  const barTicks = getBarTicks(state.meter);
  const beatTicks = TICKS_PER_QUARTER * (4 / state.meter.denominator);
  const roll = $("roll");
  roll.style.setProperty("--steps", columns);
  let header = `<div class="roll-header"><div class="roll-label">Time</div>`;
  for (let index = 0; index < columns; index += 1) {
    const tick = index * step;
    const barStart = tick % barTicks === 0;
    const beatStart = tick % beatTicks === 0;
    const bar = Math.floor(tick / barTicks) + 1;
    const beat = Math.floor((tick % barTicks) / beatTicks) + 1;
    header += `<div class="step-header ${barStart ? "bar-start" : ""} ${beatStart ? "beat-start" : ""}">${barStart ? `<span class="bar-number">bar ${bar}</span>` : ""}<span>${beatStart ? `·${beat}` : "·"}</span></div>`;
  }
  header += "</div>";
  const rows = state.voices.map((voice, voiceIndex) => {
    const events = new Set(voice.events);
    let row = `<div class="roll-row"><div class="voice-label"><span class="voice-color" style="background:${COLORS[voiceIndex]}"></span><input data-voice-name="${voiceIndex}" aria-label="Voice ${voiceIndex + 1} name" value="${escapeHtml(voice.name)}" /><button class="remove-voice" data-remove-voice="${voiceIndex}" aria-label="Remove ${escapeHtml(voice.name)}">×</button></div>`;
    for (let index = 0; index < columns; index += 1) {
      const tick = index * step;
      const active = events.has(tick);
      const barStart = tick % barTicks === 0;
      const beatStart = tick % beatTicks === 0;
      const playing = index === currentStep;
      row += `<button class="step-cell ${active ? "is-active" : ""} ${playing ? "is-playing" : ""} ${barStart ? "bar-start" : ""} ${beatStart ? "beat-start" : ""}" data-voice="${voiceIndex}" data-tick="${tick}" aria-label="${escapeHtml(voice.name)} step ${index + 1}, ${active ? "on" : "off"}"><span class="step-dot"></span></button>`;
    }
    return `${row}</div>`;
  }).join("");
  roll.innerHTML = header + rows;
  roll.querySelectorAll("[data-voice]").forEach((button) => button.addEventListener("click", () => {
    const voiceIndex = Number(button.dataset.voice);
    const tick = Number(button.dataset.tick);
    const next = clone(state);
    const events = new Set(next.voices[voiceIndex].events);
    events.has(tick) ? events.delete(tick) : events.add(tick);
    next.voices[voiceIndex].events = [...events].sort((a, b) => a - b);
    setState(next);
  }));
  roll.querySelectorAll("[data-voice-name]").forEach((input) => input.addEventListener("change", () => {
    const next = clone(state);
    next.voices[Number(input.dataset.voiceName)].name = input.value;
    setState(next);
  }));
  roll.querySelectorAll("[data-remove-voice]").forEach((button) => button.addEventListener("click", () => {
    if (state.voices.length === 1) return showMessage("Keep at least one voice in the grid.");
    const next = clone(state);
    next.voices.splice(Number(button.dataset.removeVoice), 1);
    setState(next);
  }));
  $("stepCount").textContent = `${columns} equal steps · ${cycleTicks()} base ticks`;
}

function renderVoiceSettings() {
  const ringCount = Math.max(1, Number(state.circle.ringCount) || 1);
  $("voiceSettings").innerHTML = state.voices.map((voice, index) => `<div class="voice-setting"><div class="voice-name"><span class="voice-color" style="background:${COLORS[index]}"></span><span>${escapeHtml(voice.name)}</span></div><select data-ring="${index}" aria-label="Ring for ${escapeHtml(voice.name)}">${Array.from({ length: ringCount }, (_, ring) => `<option value="${ring}" ${ring === voice.ring ? "selected" : ""}>Ring ${ring + 1}</option>`).join("")}</select></div>`).join("");
  $("voiceSettings").querySelectorAll("[data-ring]").forEach((select) => select.addEventListener("change", () => {
    const next = clone(state);
    next.voices[Number(select.dataset.ring)].ring = Number(select.value);
    setState(next);
  }));
}

function renderCircleSettings() {
  $("titleInput").value = state.title;
  $("bpmInput").value = state.bpm;
  $("numeratorInput").value = state.meter.numerator;
  $("denominatorInput").value = state.meter.denominator;
  $("gridInput").value = state.gridId;
  $("barsInput").value = state.bars;
  $("circleDiameterInput").value = state.circle.diameter;
  $("paperInput").value = state.circle.paper;
  $("orientationInput").value = state.circle.orientation;
  $("marginInput").value = state.circle.margin;
  $("centerHoleInput").value = state.circle.centerHole;
  $("holeDiameterInput").value = state.circle.holeDiameter;
  $("centerDotDiameterInput").value = state.circle.centerDotDiameter;
  $("ringCountInput").value = state.circle.ringCount;
  $("ringPitchInput").value = state.circle.ringPitch;
  $("trackInsetInput").value = state.circle.trackInset;
  $("startAngleInput").value = state.circle.startAngle;
  $("directionInput").value = state.circle.direction;
  $("modeInput").value = state.circle.mode;
  $("barLabelsInput").checked = state.labels.bars;
  $("beatLabelsInput").checked = state.labels.beats;
  $("subdivisionLabelsInput").checked = state.labels.subdivisions;
  $("gridLinesInput").checked = state.labels.gridLines;
  $("noteRaysInput").checked = state.labels.noteRays;
  $("voiceLabelsInput").checked = state.labels.voices;
}

function buildWarnings() {
  const validation = validateGeometry({ ...state.circle, circleDiameter: state.circle.diameter, centerHole: state.circle.centerHole, holeDiameter: state.circle.holeDiameter, centerDotDiameter: state.circle.centerDotDiameter, ringCount: state.circle.ringCount, ringPitch: state.circle.ringPitch, trackInset: state.circle.trackInset });
  const warnings = [...validation.errors.map((text) => `<div class="warning error">${escapeHtml(text)}</div>`), ...validation.warnings.map((text) => `<div class="warning">${escapeHtml(text)}</div>`)];
  const minimumSpacing = validation.radii.length ? Math.min(...validation.radii.map((radius) => chordDistance(radius, columnCount()))) : 0;
  if (minimumSpacing < Number(state.circle.holeDiameter)) warnings.push(`<div class="warning">The tightest grid sectors are about ${minimumSpacing.toFixed(1)} mm apart center-to-center; consider a coarser grid or smaller peg marks.</div>`);
  $("warnings").innerHTML = warnings.join("");
  $("fitStatus").textContent = validation.errors.length ? "Check settings" : validation.layout.circleFits ? "Fits page" : "Does not fit";
  $("fitStatus").classList.toggle("bad", validation.errors.length > 0 || !validation.layout.circleFits);
  return validation;
}

function render() {
  renderCircleSettings();
  renderRoll();
  renderVoiceSettings();
  const barTicks = getBarTicks(state.meter);
  const bars = cycleTicks() / barTicks;
  const grid = getGridOption(state.gridId);
  $("cycleSummary").textContent = `${state.meter.numerator}/${state.meter.denominator} · ${bars} ${bars === 1 ? "bar" : "bars"}`;
  $("gridHint").textContent = `${grid.label}: ${columnCount()} equal positions around the loop. Auto length closes the bar and grid together.`;
  const validation = buildWarnings();
  $("svgPreview").innerHTML = buildSvg(state, validation);
  $("downloadSvgButton").disabled = validation.errors.length > 0;
  $("downloadPdfButton").disabled = validation.errors.length > 0;
  $("undoButton").disabled = undoStack.length === 0;
  $("addVoiceButton").disabled = state.voices.length >= 4;
}

function textSvg(text, x, y, size = 3, fill = "#334155", anchor = "middle", weight = 500) {
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${escapeXml(text)}</text>`;
}
function buildSvg(current, validation = validateGeometry({ ...current.circle, circleDiameter: current.circle.diameter, centerHole: current.circle.centerHole, holeDiameter: current.circle.holeDiameter, centerDotDiameter: current.circle.centerDotDiameter, ringCount: current.circle.ringCount, ringPitch: current.circle.ringPitch, trackInset: current.circle.trackInset })) {
  const layout = validation.layout;
  const radii = validation.radii;
  const cycle = getCycleTicks({ meter: current.meter, gridId: current.gridId, bars: current.bars });
  const step = getGridOption(current.gridId).ticks;
  const barTicks = getBarTicks(current.meter);
  const beatTicks = TICKS_PER_QUARTER * (4 / current.meter.denominator);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}mm" height="${layout.height}mm" role="img" aria-label="Printable rhythm circle"><rect width="100%" height="100%" fill="#fffdf8"/><rect x="${current.circle.margin}" y="${current.circle.margin}" width="${layout.width - current.circle.margin * 2}" height="${layout.height - current.circle.margin * 2}" fill="none" stroke="#d8d3c9" stroke-width="0.3"/><circle cx="${layout.cx}" cy="${layout.cy}" r="${layout.radius}" fill="#fffdf8" stroke="#172235" stroke-width="0.45"/>`];
  radii.forEach((radius) => parts.push(`<circle cx="${layout.cx}" cy="${layout.cy}" r="${radius}" fill="none" stroke="#afbac6" stroke-width="0.25"/>`));
  const tickCount = Math.max(1, Math.round(cycle / step));
  for (let index = 0; index < tickCount; index += 1) {
    const tick = index * step;
    const isBar = tick % barTicks === 0;
    const isBeat = tick % beatTicks === 0;
    if (!current.labels.gridLines && !current.labels.subdivisions && !isBar && !isBeat) continue;
    const angle = angleForTick(tick, cycle, Number(current.circle.startAngle), current.circle.direction);
    if (current.labels.gridLines) {
      const gridEnd = polarPoint(layout.cx, layout.cy, layout.radius - 1, angle);
      parts.push(`<line x1="${layout.cx.toFixed(2)}" y1="${layout.cy.toFixed(2)}" x2="${gridEnd.x.toFixed(2)}" y2="${gridEnd.y.toFixed(2)}" stroke="${isBar ? "#9aa7b5" : isBeat ? "#b5bec8" : "#d0d6dc"}" stroke-width="${isBar ? 0.45 : isBeat ? 0.3 : 0.18}"/>`);
    }
    const outer = layout.radius - (isBar ? 1 : isBeat ? 3 : 5);
    const inner = layout.radius - 1;
    const a = polarPoint(layout.cx, layout.cy, outer, angle);
    const b = polarPoint(layout.cx, layout.cy, inner, angle);
    parts.push(`<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${isBar ? "#172235" : isBeat ? "#52687e" : "#a4afbc"}" stroke-width="${isBar ? 0.7 : isBeat ? 0.45 : 0.25}"/>`);
    if (current.labels.bars && isBar) { const label = polarPoint(layout.cx, layout.cy, layout.radius + 4, angle); parts.push(textSvg(`bar ${Math.floor(tick / barTicks) + 1}`, label.x, label.y + 1, 2.5, "#536276")); }
    else if (current.labels.beats && isBeat) { const label = polarPoint(layout.cx, layout.cy, layout.radius + 4, angle); parts.push(textSvg(String(Math.floor((tick % barTicks) / beatTicks) + 1), label.x, label.y + 1, 2.5, "#8793a3")); }
  }
  current.voices.forEach((voice, voiceIndex) => {
    const radius = radii[Math.min(radii.length - 1, Math.max(0, voice.ring))];
    voice.events.forEach((tick) => {
      const angle = angleForTick(tick, cycle, Number(current.circle.startAngle), current.circle.direction);
      const point = polarPoint(layout.cx, layout.cy, radius, angle);
      const markRadius = Number(current.circle.holeDiameter) / 2;
      const dotRadius = Number(current.circle.centerDotDiameter) / 2;
      if (current.labels.noteRays) parts.push(`<line x1="${layout.cx.toFixed(2)}" y1="${layout.cy.toFixed(2)}" x2="${point.x.toFixed(2)}" y2="${point.y.toFixed(2)}" stroke="${COLORS[voiceIndex]}" stroke-opacity="0.34" stroke-width="0.45"/>`);
      parts.push(current.circle.mode === "holes"
        ? `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${markRadius.toFixed(2)}" fill="#fffdf8" stroke="${COLORS[voiceIndex]}" stroke-width="0.6"/>`
        : `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${markRadius.toFixed(2)}" fill="${COLORS[voiceIndex]}" stroke="#172235" stroke-width="0.25"/>`);
      parts.push(`<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${dotRadius.toFixed(2)}" fill="#172235"/>`);
    });
  });
  const centerR = Number(current.circle.centerHole) / 2;
  parts.push(`<circle cx="${layout.cx}" cy="${layout.cy}" r="${centerR}" fill="#fffdf8" stroke="#172235" stroke-width="0.45"/>`);
  const arrowStart = polarPoint(layout.cx, layout.cy, layout.radius - 8, Number(current.circle.startAngle));
  const arrowEnd = polarPoint(layout.cx, layout.cy, layout.radius - 18, Number(current.circle.startAngle) + (current.circle.direction === "clockwise" ? 35 : -35));
  parts.push(`<path d="M ${arrowStart.x.toFixed(2)} ${arrowStart.y.toFixed(2)} Q ${layout.cx} ${layout.cy} ${arrowEnd.x.toFixed(2)} ${arrowEnd.y.toFixed(2)}" fill="none" stroke="#f4876e" stroke-width="0.55" marker-end="url(#arrow)"/>`);
  const rulerY = Math.min(layout.height - 14, layout.cy + layout.radius + 26);
  parts.push(`<line x1="${layout.cx - 50}" y1="${rulerY}" x2="${layout.cx + 50}" y2="${rulerY}" stroke="#172235" stroke-width="0.5"/><line x1="${layout.cx - 50}" y1="${rulerY - 2}" x2="${layout.cx - 50}" y2="${rulerY + 2}" stroke="#172235" stroke-width="0.5"/><line x1="${layout.cx + 50}" y1="${rulerY - 2}" x2="${layout.cx + 50}" y2="${rulerY + 2}" stroke="#172235" stroke-width="0.5"/>`);
  parts.push(textSvg("100 mm check line", layout.cx, rulerY + 5, 2.7, "#536276"));
  parts.push(textSvg("PRINT AT 100% / ACTUAL SIZE", current.circle.margin, layout.height - 5, 3, "#172235", "start", 800));
  if (current.labels.voices) {
    const legendY = Math.min(layout.height - 21, rulerY + 12);
    current.voices.forEach((voice, index) => parts.push(`<circle cx="${current.circle.margin + index * 32}" cy="${legendY}" r="1.5" fill="${COLORS[index]}"/>${textSvg(voice.name, current.circle.margin + 3 + index * 32, legendY + 1, 2.6, "#536276", "start")}`));
  }
  parts.push(`<defs><marker id="arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M 0 0 L 4 2 L 0 4 z" fill="#f4876e"/></marker></defs></svg>`);
  return parts.join("");
}

function pdfEscape(text) { return String(text).replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7E]/g, "?"); }
function mmToPt(mm) { return mm * 72 / 25.4; }
function pdfPoint(layout, x, y) { return [mmToPt(x), mmToPt(layout.height - y)]; }
function pdfCircle(layout, cx, cy, radius) {
  const k = 0.5522848;
  const segments = [[cx + radius, cy], [cx, cy + radius], [cx - radius, cy], [cx, cy - radius]];
  const toPdf = (x, y) => pdfPoint(layout, x, y);
  const [p0, p1, p2, p3] = segments.map(([x, y]) => toPdf(x, y));
  const c = (x1, y1, x2, y2, x3, y3) => `${mmToPt(x1).toFixed(2)} ${mmToPt(layout.height - y1).toFixed(2)} ${mmToPt(x2).toFixed(2)} ${mmToPt(layout.height - y2).toFixed(2)} ${mmToPt(x3).toFixed(2)} ${mmToPt(layout.height - y3).toFixed(2)} c`;
  return `${p0[0].toFixed(2)} ${p0[1].toFixed(2)} m ${c(cx + radius, cy + k * radius, cx + k * radius, cy + radius, cx, cy + radius)} ${c(cx - k * radius, cy + radius, cx - radius, cy + k * radius, cx - radius, cy)} ${c(cx - radius, cy - k * radius, cx - k * radius, cy - radius, cx, cy - radius)} ${c(cx + k * radius, cy - radius, cx + radius, cy - k * radius, cx + radius, cy)} h`;
}
function pdfLine(layout, x1, y1, x2, y2) { const a = pdfPoint(layout, x1, y1); const b = pdfPoint(layout, x2, y2); return `${a[0].toFixed(2)} ${a[1].toFixed(2)} m ${b[0].toFixed(2)} ${b[1].toFixed(2)} l S`; }
function pdfText(layout, text, x, y, size = 8) { const p = pdfPoint(layout, x, y); return `BT /F1 ${size} Tf ${p[0].toFixed(2)} ${p[1].toFixed(2)} Td (${pdfEscape(text)}) Tj ET`; }
function buildPdf(current) {
  const validation = validateGeometry({ ...current.circle, circleDiameter: current.circle.diameter, centerHole: current.circle.centerHole, holeDiameter: current.circle.holeDiameter, centerDotDiameter: current.circle.centerDotDiameter, ringCount: current.circle.ringCount, ringPitch: current.circle.ringPitch, trackInset: current.circle.trackInset });
  const layout = validation.layout;
  const radii = validation.radii;
  const cycle = getCycleTicks({ meter: current.meter, gridId: current.gridId, bars: current.bars });
  const step = getGridOption(current.gridId).ticks;
  const barTicks = getBarTicks(current.meter);
  const beatTicks = TICKS_PER_QUARTER * (4 / current.meter.denominator);
  const content = ["1 1 1 rg", `0 0 ${mmToPt(layout.width).toFixed(2)} ${mmToPt(layout.height).toFixed(2)} re f`, "0 0 0 RG 0.8 w", pdfCircle(layout, layout.cx, layout.cy, layout.radius), "S"];
  radii.forEach((radius) => content.push("0.55 0.62 0.68 RG 0.35 w", pdfCircle(layout, layout.cx, layout.cy, radius), "S"));
  const tickCount = Math.max(1, Math.round(cycle / step));
  for (let index = 0; index < tickCount; index += 1) {
    const tick = index * step;
    const isBar = tick % barTicks === 0;
    const isBeat = tick % beatTicks === 0;
    if (!current.labels.gridLines && !current.labels.subdivisions && !isBar && !isBeat) continue;
    const angle = angleForTick(tick, cycle, Number(current.circle.startAngle), current.circle.direction);
    if (current.labels.gridLines) {
      const gridEnd = polarPoint(layout.cx, layout.cy, layout.radius - 1, angle);
      content.push(isBar ? "0.60 0.65 0.71 RG 0.65 w" : isBeat ? "0.71 0.75 0.78 RG 0.45 w" : "0.82 0.84 0.86 RG 0.25 w", pdfLine(layout, layout.cx, layout.cy, gridEnd.x, gridEnd.y));
    }
    const outer = layout.radius - (isBar ? 1 : isBeat ? 3 : 5);
    const a = polarPoint(layout.cx, layout.cy, outer, angle);
    const b = polarPoint(layout.cx, layout.cy, layout.radius - 1, angle);
    content.push(isBar ? "0.09 0.13 0.21 RG 1.1 w" : "0.32 0.41 0.49 RG 0.55 w", pdfLine(layout, a.x, a.y, b.x, b.y));
    if (current.labels.bars && isBar) { const label = polarPoint(layout.cx, layout.cy, layout.radius + 4, angle); content.push(pdfText(layout, `bar ${Math.floor(tick / barTicks) + 1}`, label.x, label.y + 1, 7)); }
    else if (current.labels.beats && isBeat) { const label = polarPoint(layout.cx, layout.cy, layout.radius + 4, angle); content.push(pdfText(layout, String(Math.floor((tick % barTicks) / beatTicks) + 1), label.x, label.y + 1, 7)); }
  }
  current.voices.forEach((voice, voiceIndex) => {
    const radius = radii[Math.min(radii.length - 1, Math.max(0, voice.ring))];
    voice.events.forEach((tick) => {
      const angle = angleForTick(tick, cycle, Number(current.circle.startAngle), current.circle.direction);
      const point = polarPoint(layout.cx, layout.cy, radius, angle);
      const markRadius = Number(current.circle.holeDiameter) / 2;
      const dotRadius = Number(current.circle.centerDotDiameter) / 2;
      if (current.labels.noteRays) content.push("0.55 0.58 0.62 RG 0.45 w", pdfLine(layout, layout.cx, layout.cy, point.x, point.y));
      content.push(current.circle.mode === "holes" ? "1 1 1 rg 0.96 0.53 0.36 RG 0.7 w" : "0.96 0.53 0.36 rg 0.09 0.13 0.21 RG 0.3 w", pdfCircle(layout, point.x, point.y, markRadius), "B");
      content.push("0.09 0.13 0.21 rg", pdfCircle(layout, point.x, point.y, dotRadius), "f");
    });
  });
  content.push("0 0 0 RG 0.8 w", pdfCircle(layout, layout.cx, layout.cy, Number(current.circle.centerHole) / 2), "S");
  const rulerY = Math.min(layout.height - 14, layout.cy + layout.radius + 26);
  content.push("0 0 0 RG 0.7 w", pdfLine(layout, layout.cx - 50, rulerY, layout.cx + 50, rulerY), pdfLine(layout, layout.cx - 50, rulerY - 2, layout.cx - 50, rulerY + 2), pdfLine(layout, layout.cx + 50, rulerY - 2, layout.cx + 50, rulerY + 2), pdfText(layout, "100 mm check line", layout.cx, rulerY + 5, 7), pdfText(layout, "PRINT AT 100% / ACTUAL SIZE", current.circle.margin, layout.height - 5, 8));
  if (current.labels.voices) current.voices.forEach((voice, index) => content.push(pdfText(layout, `${index + 1}. ${voice.name}`, current.circle.margin + index * 32, Math.min(layout.height - 21, rulerY + 12), 7)));
  const stream = content.join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${mmToPt(layout.width).toFixed(2)} ${mmToPt(layout.height).toFixed(2)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n% Bleed Sharmanka\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function download(blob, filename) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function slug() { return (state.title || "rhythm-circle").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rhythm-circle"; }
function saveDraft() { localStorage.setItem("bleed-sharmanka-draft", JSON.stringify(state)); }
function loadProject(json) {
  const next = normalizeState({ ...initialState, ...json, gridId: json.gridId ?? gridFromResolution(json.resolution), bars: json.bars ?? "auto", voices: json.voices, circle: json.circle ?? initialState.circle, labels: json.labels ?? initialState.labels });
  setState(next);
  showMessage("Project loaded. Check the ring assignment before generating.");
}
function projectJson() { return { ...clone(state), resolution: resolutionFromGrid(state.gridId), cycleTicks: cycleTicks(), grid: getGridOption(state.gridId).label }; }

async function togglePlayback() {
  if (playTimer) return stopPlayback();
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) throw new Error("Web Audio API is unavailable");
    audioContext ??= new AudioCtor();
    await audioContext.resume();
    if (audioContext.state !== "running") throw new Error("AudioContext is not running");
    showMessage("Preview playing — browser audio is enabled.");
    currentStep = 0;
    playCurrentStep();
    const secondsPerStep = (60 / state.bpm) * (stepTicks() / TICKS_PER_QUARTER);
    playTimer = setInterval(() => { currentStep = (currentStep + 1) % columnCount(); playCurrentStep(); }, secondsPerStep * 1000);
    $("playButton").textContent = "❚❚ Pause";
  } catch (error) { showMessage("Audio is blocked by the browser. Click Play again after interacting with the page."); console.warn(error); }
}
function playCurrentStep() {
  const tick = currentStep * stepTicks();
  state.voices.forEach((voice, index) => { if (voice.events.includes(tick)) playClick(index); });
  renderRoll();
}
function playClick(index) {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = index % 2 ? "triangle" : "square";
  oscillator.frequency.setValueAtTime(180 + index * 90, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.08);
}
function stopPlayback() { if (playTimer) clearInterval(playTimer); playTimer = null; currentStep = -1; $("playButton").textContent = "▶ Play"; renderRoll(); showMessage("Preview stopped."); }

function bindControls() {
  $("playButton").addEventListener("click", togglePlayback);
  $("stopButton").addEventListener("click", stopPlayback);
  $("generateButton").addEventListener("click", () => { render(); showMessage("Circle regenerated from the current grid."); document.querySelector(".preview-panel").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
  $("addVoiceButton").addEventListener("click", () => { if (state.voices.length >= 4) return; const next = clone(state); next.voices.push({ name: `voice ${next.voices.length + 1}`, ring: Math.min(next.voices.length, next.circle.ringCount - 1), events: [] }); setState(next); });
  $("clearButton").addEventListener("click", () => { const next = clone(state); next.voices.forEach((voice) => { voice.events = []; }); setState(next); showMessage("All onsets cleared. Undo can restore them."); });
  $("undoButton").addEventListener("click", () => { if (!undoStack.length) return; const previous = undoStack.pop(); state = normalizeState(previous); render(); saveDraft(); showMessage("Last edit undone."); });
  $("saveButton").addEventListener("click", () => download(new Blob([JSON.stringify(projectJson(), null, 2)], { type: "application/json" }), `${slug()}.json`));
  $("loadButton").addEventListener("click", () => $("loadFileInput").click());
  $("loadFileInput").addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (!file) return; try { loadProject(JSON.parse(await file.text())); } catch { showMessage("Could not load JSON. Check the file format."); } event.target.value = ""; });
  $("downloadSvgButton").addEventListener("click", () => download(new Blob([buildSvg(state)], { type: "image/svg+xml" }), `${slug()}.svg`));
  $("downloadPdfButton").addEventListener("click", () => download(buildPdf(state), `${slug()}.pdf`));
  $("maximizeSpacingButton").addEventListener("click", () => {
    const next = clone(state);
    const count = Math.max(1, Number(next.circle.ringCount) || 1);
    const minimumInnerRadius = Number(next.circle.centerHole) / 2 + Number(next.circle.holeDiameter) / 2 + 2;
    next.circle.trackInset = Number(Math.max(1, Number(next.circle.holeDiameter) / 2 + 1).toFixed(1));
    const maximumOuterRadius = Number(next.circle.diameter) / 2 - next.circle.trackInset;
    if (count > 1) next.circle.ringPitch = Number(Math.min(80, Math.max(0.5, (maximumOuterRadius - minimumInnerRadius) / (count - 1))).toFixed(1));
    setState(next);
    showMessage("Spacing maximized for the current circle, rings and mark size.");
  });
  const simpleFields = { titleInput: ["title"], bpmInput: ["bpm", Number], circleDiameterInput: ["circle", "diameter", Number], paperInput: ["circle", "paper"], orientationInput: ["circle", "orientation"], marginInput: ["circle", "margin", Number], centerHoleInput: ["circle", "centerHole", Number], holeDiameterInput: ["circle", "holeDiameter", Number], centerDotDiameterInput: ["circle", "centerDotDiameter", Number], ringCountInput: ["circle", "ringCount", Number], ringPitchInput: ["circle", "ringPitch", Number], trackInsetInput: ["circle", "trackInset", Number], startAngleInput: ["circle", "startAngle", Number], directionInput: ["circle", "direction"], modeInput: ["circle", "mode"] };
  Object.entries(simpleFields).forEach(([id, path]) => $(id).addEventListener("change", (event) => { const next = clone(state); const hasConverter = typeof path.at(-1) === "function"; const converter = hasConverter ? path.at(-1) : String; const targetPath = hasConverter ? path.slice(0, -1) : path; const value = converter(event.target.value); if (targetPath.length === 1) next[targetPath[0]] = value; else next[targetPath[0]][targetPath[1]] = value; setState(next); }));
  ["numeratorInput", "denominatorInput", "gridInput", "barsInput"].forEach((id) => $(id).addEventListener("change", (event) => { const next = clone(state); const old = clone(state); if (id === "numeratorInput") next.meter.numerator = Number(event.target.value); if (id === "denominatorInput") next.meter.denominator = Number(event.target.value); if (id === "gridInput") next.gridId = event.target.value; if (id === "barsInput") next.bars = event.target.value === "auto" ? "auto" : Number(event.target.value); setState(remapEvents(old, next)); }));
  [["barLabelsInput", "bars"], ["beatLabelsInput", "beats"], ["subdivisionLabelsInput", "subdivisions"], ["gridLinesInput", "gridLines"], ["noteRaysInput", "noteRays"], ["voiceLabelsInput", "voices"]].forEach(([id, key]) => $(id).addEventListener("change", (event) => { const next = clone(state); next.labels[key] = event.target.checked; setState(next); }));
}

populateControls();
bindControls();
try { const draft = localStorage.getItem("bleed-sharmanka-draft"); if (draft) state = normalizeState(JSON.parse(draft)); } catch { /* ignore a damaged draft */ }
render();
