const CATEGORIES = [
  ['tiles', 'Ploščice'], ['flooring', 'Talne obloge'], ['kitchen appliances', 'Kuhinjski aparati'],
  ['kitchen fixtures', 'Kuhinjska oprema'], ['bathroom fixtures', 'Kopalniška oprema'],
  ['sinks', 'Umivalniki / korita'], ['toilets', 'WC školjke'], ['showers', 'Prhe'],
  ['paint', 'Barve'], ['lighting', 'Razsvetljava'], ['doors', 'Vrata'], ['other', 'Drugo']
];
const ROOM_TYPES = {
  bathroom: 'Kopalnica', kitchen: 'Kuhinja', bedroom: 'Spalnica', living: 'Dnevna soba',
  hall: 'Hodnik', utility: 'Utility', other: 'Drugo'
};
const ROOM_PALETTE = ['#ffd6d6', '#d8f3dc', '#d7e3fc', '#fff3b0', '#e7d8ff', '#cdeffd', '#ffd8be', '#d8f8e1', '#f7d6e0', '#d6f6ff', '#ece4db', '#e2f0cb'];
const ROOM_COLORS = {
  bathroom: '#cdeffd', kitchen: '#ffd8be', bedroom: '#e7d8ff', living: '#d8f3dc',
  hall: '#ece4db', utility: '#d7e3fc', other: '#f0f1f3'
};
const CATEGORY_COLORS = {
  tiles: '#b9d8e8', flooring: '#c6dbea', 'kitchen appliances': '#d5e2ec',
  'kitchen fixtures': '#c7e1f4', 'bathroom fixtures': '#c9def0', sinks: '#c7e4ef',
  toilets: '#e5edf3', showers: '#bcdce8', paint: '#dcecf6', lighting: '#cde5f7',
  doors: '#bfd4e4', other: '#e7f3fb'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const API_BASE = '/hisa/api';

let project = null;
let selectedFloorId = null;
let selectedRoomId = null;
let selectedGroupId = null;
let drawMode = false;
let drawPoints = [];
let previewPoint = null;
let drag = null;
let scenePan = null;
let saveTimer = null;
let lastSavedAt = null;
let activeRightTab = 'lists';
const candidateDrafts = {};
const planViews = {};
let editingCandidateId = null;

const el = {
  saveStatus: $('#saveStatus'), projectName: $('#projectName'), currency: $('#currency'),
  floorList: $('#floorList'), addFloorBtn: $('#addFloorBtn'), floorTitle: $('#floorTitle'),
  planSvg: $('#planSvg'), drawRoomBtn: $('#drawRoomBtn'), finishDrawBtn: $('#finishDrawBtn'), cancelDrawBtn: $('#cancelDrawBtn'), zoomOutBtn: $('#zoomOutBtn'), zoomInBtn: $('#zoomInBtn'), fitViewBtn: $('#fitViewBtn'),
  roomInspector: $('#roomInspector'), groupList: $('#groupList'), groupEditor: $('#groupEditor'),
  newGroupBtn: $('#newGroupBtn'), candidatePanel: $('#candidatePanel'), summary: $('#summary'),
  exportBtn: $('#exportBtn'), importFile: $('#importFile'),
  tabButtons: $$('.tab-button'), tabPanels: $$('.tab-panel')
};

init();

async function init() {
  project = await fetch(`${API_BASE}/project`).then(r => r.json());
  selectedFloorId = project.floors[0]?.id || null;
  selectedGroupId = project.materialGroups[0]?.id || null;
  bindStaticEvents();
  renderAll();
  setStatus('Naloženo');
}

function bindStaticEvents() {
  el.projectName.addEventListener('input', () => { project.name = el.projectName.value; changed(); });
  el.currency.addEventListener('input', () => { project.currency = el.currency.value || 'EUR'; changed(); renderSummary(); renderGroups(); renderCandidates(); });
  el.addFloorBtn.addEventListener('click', addFloor);
  el.drawRoomBtn.addEventListener('click', () => setDrawMode(!drawMode));
  el.finishDrawBtn.addEventListener('click', finishDrawRoom);
  el.cancelDrawBtn.addEventListener('click', cancelDrawRoom);
  el.zoomOutBtn.addEventListener('click', () => zoomPlan(1.2));
  el.zoomInBtn.addEventListener('click', () => zoomPlan(0.82));
  el.fitViewBtn.addEventListener('click', resetPlanView);
  el.newGroupBtn.addEventListener('click', addMaterialGroup);
  el.exportBtn.addEventListener('click', exportJson);
  el.importFile.addEventListener('change', importJson);
  el.tabButtons.forEach(button => button.addEventListener('click', () => setRightTab(button.dataset.tab)));

  el.planSvg.addEventListener('pointerdown', onSvgPointerDown);
  el.planSvg.addEventListener('wheel', onPlanWheel, { passive: false });
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function currentFloor() { return project.floors.find(f => f.id === selectedFloorId) || project.floors[0]; }
function currentPlanView() {
  const floor = currentFloor();
  if (!floor) return { x: 0, y: 0, w: 1200, h: 800 };
  if (!planViews[floor.id]) planViews[floor.id] = { x: 0, y: 0, w: floor.width, h: floor.height };
  return planViews[floor.id];
}
function setPlanView(view) {
  const floor = currentFloor();
  const minW = Math.max(120, floor.width * 0.12);
  const maxW = floor.width * 5;
  const ratio = currentPlanView().h / currentPlanView().w;
  const w = Math.min(maxW, Math.max(minW, view.w));
  const h = w * ratio;
  planViews[floor.id] = { x: view.x, y: view.y, w, h };
}
function resetPlanView() {
  const floor = currentFloor();
  if (!floor) return;
  planViews[floor.id] = { x: 0, y: 0, w: floor.width, h: floor.height };
  renderPlan();
}
function zoomPlan(factor, center = null) {
  const view = currentPlanView();
  const focus = center || { x: view.x + view.w / 2, y: view.y + view.h / 2 };
  const newW = view.w * factor;
  const scale = Math.min(currentFloor().width * 5, Math.max(Math.max(120, currentFloor().width * 0.12), newW)) / view.w;
  const newH = view.h * scale;
  setPlanView({
    x: focus.x - (focus.x - view.x) * scale,
    y: focus.y - (focus.y - view.y) * scale,
    w: view.w * scale,
    h: newH
  });
  renderPlan();
}
function selectedRoom() { return currentFloor()?.rooms.find(r => r.id === selectedRoomId) || null; }
function selectedGroup() { return project.materialGroups.find(g => g.id === selectedGroupId) || null; }
function allRooms() { return project.floors.flatMap(f => f.rooms.map(r => ({ ...r, floorName: f.name }))); }
function formatMoney(value) {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: project.currency || 'EUR' }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${project.currency || ''}`.trim();
  }
}
function groupRooms(group) { return allRooms().filter(r => (group.roomIds || []).includes(r.id) || (r.materialGroupIds || []).includes(group.id)); }
function roomPoints(room) {
  if (Array.isArray(room.points) && room.points.length >= 3) return room.points.map(p => ({ x: Number(p.x), y: Number(p.y) }));
  return [
    { x: Number(room.x), y: Number(room.y) },
    { x: Number(room.x) + Number(room.w), y: Number(room.y) },
    { x: Number(room.x) + Number(room.w), y: Number(room.y) + Number(room.h) },
    { x: Number(room.x), y: Number(room.y) + Number(room.h) }
  ];
}
function pointsToString(points) { return points.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '); }
function pointsBounds(points) {
  const xs = points.map(p => Number(p.x));
  const ys = points.map(p => Number(p.y));
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
function syncRoomBounds(room) {
  const b = pointsBounds(roomPoints(room));
  room.x = Math.round(b.x); room.y = Math.round(b.y); room.w = Math.round(b.w); room.h = Math.round(b.h);
}
function polygonAreaCm2(points) {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
}
function roomAreaM2(room) { return Math.round((polygonAreaCm2(roomPoints(room)) / 10000) * 10) / 10; }
function segmentLengthCm(a, b) { return Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y)); }
function formatLength(a, b) { return `${(segmentLengthCm(a, b) / 100).toFixed(2)} m`; }
function snapOrthogonal(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.round(to.x), y: Math.round(from.y) } : { x: Math.round(from.x), y: Math.round(to.y) };
}
function canClosePoints(points) {
  if (points.length < 3) return false;
  const first = points[0], last = points[points.length - 1];
  return Math.round(first.x) === Math.round(last.x) || Math.round(first.y) === Math.round(last.y);
}
function autoClosePoints(points) {
  const closed = points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  if (closed.length < 3 || canClosePoints(closed)) return closed;
  const first = closed[0];
  const last = closed[closed.length - 1];
  const prev = closed[closed.length - 2];
  const previousSideHorizontal = Math.abs(last.x - prev.x) >= Math.abs(last.y - prev.y);
  if (previousSideHorizontal) last.x = first.x;
  else last.y = first.y;
  return closed;
}
function removeConsecutiveDuplicatePoints(points) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return point.x !== previous.x || point.y !== previous.y;
  });
}
function candidateQuantityMode(candidate) { return candidate.quantityMode || (candidate.quantity === '' || candidate.quantity === undefined ? 'list' : 'exact'); }
function assignedRoomsForGroup(group) { return groupRooms(group); }
function groupAreaQuantity(group, rooms = assignedRoomsForGroup(group)) { return Math.round(rooms.reduce((sum, room) => sum + roomAreaM2(room), 0) * 100) / 100; }
function candidateQuantity(group, candidate, rooms = assignedRoomsForGroup(group)) {
  const mode = candidateQuantityMode(candidate);
  if (mode === 'area') return groupAreaQuantity(group, rooms);
  if (mode === 'exact') return Number(candidate.quantity || 0);
  return Number(group.quantity || 0);
}
function candidateUnit(group, candidate) { return candidateQuantityMode(candidate) === 'area' ? 'm²' : (group.unit || 'kos'); }
function candidateCost(group, candidate, rooms) { return Number(candidate.price || 0) * candidateQuantity(group, candidate, rooms); }
function candidateCostForFloor(group, candidate, floor) {
  const rooms = floor.rooms.filter(room => (group.roomIds || []).includes(room.id) || (room.materialGroupIds || []).includes(group.id));
  if (!rooms.length) return 0;
  if (candidateQuantityMode(candidate) === 'area') return candidateCost(group, candidate, rooms);
  const assignedCount = Math.max(1, assignedRoomsForGroup(group).length);
  return candidateCost(group, candidate) * (rooms.length / assignedCount);
}
function selectedCandidate(group) { return group.candidates?.find(c => c.id === group.selectedCandidateId) || null; }
function categoryLabel(value) { return CATEGORIES.find(([key]) => key === value)?.[1] || value || 'Drugo'; }
function roomTypeLabel(value) { return ROOM_TYPES[value] || value || 'Drugo'; }
function roomFill(room, floor, groups = []) {
  if (groups[0]) return CATEGORY_COLORS[groups[0].category] || CATEGORY_COLORS.other;
  const index = Math.max(0, floor.rooms.findIndex(r => r.id === room.id));
  return ROOM_PALETTE[index % ROOM_PALETTE.length];
}
function candidateDraft(groupId) {
  candidateDrafts[groupId] = candidateDrafts[groupId] || { sourceUrl: '', name: '', vendor: '', price: '', quantityMode: 'exact', qty: '', imageUrl: '', notes: '' };
  return candidateDrafts[groupId];
}
function updateTabs() {
  el.tabButtons.forEach(button => button.classList.toggle('active', button.dataset.tab === activeRightTab));
  el.tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${activeRightTab}`));
}
function setRightTab(tab) { activeRightTab = tab; updateTabs(); }
function setDrawMode(enabled) {
  drawMode = enabled;
  if (!enabled) { drawPoints = []; previewPoint = null; }
  el.drawRoomBtn.classList.toggle('active', drawMode);
  el.drawRoomBtn.textContent = drawMode ? 'Risanje vogalov…' : 'Nariši prostor';
  el.finishDrawBtn.classList.toggle('hidden', !drawMode);
  el.cancelDrawBtn.classList.toggle('hidden', !drawMode);
  renderPlan();
}
function cancelDrawRoom() { setDrawMode(false); }
function finishDrawRoom() {
  if (drawPoints.length < 4) return alert('Za prostor potrebuješ vsaj štiri vogale.');
  const floor = currentFloor();
  const points = removeConsecutiveDuplicatePoints(autoClosePoints(drawPoints));
  if (points.length < 4 || polygonAreaCm2(points) < 1000) return alert('Prostora ni mogoče zaključiti. Dodaj večje stranice.');
  const b = pointsBounds(points);
  const room = {
    id: uid('room'), name: `Prostor ${floor.rooms.length + 1}`, type: 'other',
    x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h),
    points, materialGroupIds: []
  };
  floor.rooms.push(room);
  selectedRoomId = room.id;
  setDrawMode(false);
  changed({ render: true });
}

function changed({ render = false, immediate = false } = {}) {
  project.updatedAt = new Date().toISOString();
  if (render) renderAll();
  setStatus('Neshranjene spremembe…');
  clearTimeout(saveTimer);
  if (immediate) saveProject();
  else saveTimer = setTimeout(saveProject, 550);
}

async function saveProject() {
  try {
    setStatus('Shranjevanje…');
    const res = await fetch(`${API_BASE}/project`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) });
    if (!res.ok) throw new Error((await res.json()).error || 'Shranjevanje ni uspelo');
    lastSavedAt = new Date();
    setStatus(`Shranjeno ${lastSavedAt.toLocaleTimeString()}`);
  } catch (error) {
    setStatus(`Napaka pri shranjevanju: ${error.message}`);
  }
}

function setStatus(text) { el.saveStatus.textContent = text; }

function renderAll() {
  el.projectName.value = project.name || '';
  el.currency.value = project.currency || 'EUR';
  renderFloors(); renderPlan(); renderRoomInspector(); renderGroups(); renderGroupEditor(); renderCandidates(); renderSummary(); updateTabs();
}

function renderFloors() {
  el.floorList.innerHTML = '';
  project.floors.forEach(floor => {
    const card = document.createElement('div');
    card.className = `card ${floor.id === selectedFloorId ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="card-header">
        <div><div class="card-title"></div><div class="card-subtitle">${floor.width} × ${floor.height} cm · ${floor.rooms.length} prostorov</div></div>
        <button class="small secondary" data-action="select">Odpri</button>
      </div>
      <div class="actions">
        <button class="small secondary" data-action="rename">Preimenuj</button>
        <button class="small danger" data-action="delete">Izbriši</button>
      </div>`;
    $('.card-title', card).textContent = floor.name;
    card.querySelector('[data-action="select"]').onclick = () => { selectedFloorId = floor.id; selectedRoomId = null; renderAll(); };
    card.querySelector('[data-action="rename"]').onclick = () => {
      const name = prompt('Ime etaže', floor.name);
      if (name) { floor.name = name; changed({ render: true }); }
    };
    card.querySelector('[data-action="delete"]').onclick = () => deleteFloor(floor.id);
    el.floorList.appendChild(card);
  });
}

function addFloor() {
  const floor = { id: uid('floor'), name: `Etaža ${project.floors.length + 1}`, width: 1200, height: 800, rooms: [] };
  project.floors.push(floor);
  selectedFloorId = floor.id;
  selectedRoomId = null;
  changed({ render: true });
}

function deleteFloor(floorId) {
  if (project.floors.length <= 1) return alert('Ohrani vsaj eno etažo.');
  const floor = project.floors.find(f => f.id === floorId);
  if (!confirm(`Izbrišem ${floor.name}?`)) return;
  const roomIds = new Set(floor.rooms.map(r => r.id));
  project.materialGroups.forEach(g => g.roomIds = (g.roomIds || []).filter(id => !roomIds.has(id)));
  project.floors = project.floors.filter(f => f.id !== floorId);
  selectedFloorId = project.floors[0].id;
  selectedRoomId = null;
  changed({ render: true });
}

function renderPlan() {
  const floor = currentFloor();
  if (!floor) return;
  const view = currentPlanView();
  el.floorTitle.textContent = floor.name;
  el.planSvg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  el.planSvg.innerHTML = '';

  const defs = svgEl('defs');
  const pattern = svgEl('pattern', { id: 'grid', width: 50, height: 50, patternUnits: 'userSpaceOnUse' });
  pattern.appendChild(svgEl('path', { d: 'M 50 0 L 0 0 0 50', fill: 'none', stroke: '#e1e4e8', 'stroke-width': 1 }));
  defs.appendChild(pattern); el.planSvg.appendChild(defs);
  el.planSvg.appendChild(svgEl('rect', { x: view.x - view.w * 2, y: view.y - view.h * 2, width: view.w * 5, height: view.h * 5, fill: '#f7f8fa' }));
  el.planSvg.appendChild(svgEl('rect', { x: 0, y: 0, width: floor.width, height: floor.height, fill: 'url(#grid)', stroke: '#cfd4dc', 'stroke-width': 2 }));

  floor.rooms.forEach(room => {
    const points = roomPoints(room);
    const bounds = pointsBounds(points);
    const groups = project.materialGroups.filter(g => (room.materialGroupIds || []).includes(g.id) || (g.roomIds || []).includes(room.id));
    const fill = roomFill(room, floor, groups);
    const g = svgEl('g', { 'data-room-id': room.id });
    const polygon = svgEl('polygon', { points: pointsToString(points), fill, class: `room-shape ${room.id === selectedRoomId ? 'selected' : ''}` });
    g.appendChild(polygon);
    const label = svgEl('text', { x: bounds.x + 14, y: bounds.y + 32, class: 'room-label' });
    label.textContent = room.name;
    g.appendChild(label);
    const meta = svgEl('text', { x: bounds.x + 14, y: bounds.y + 56, class: 'room-meta' });
    const finalCount = groups.filter(gr => gr.selectedCandidateId).length;
    meta.textContent = `${roomTypeLabel(room.type)} · ${roomAreaM2(room)} m² · ${groups.length} seznamov${finalCount ? ` · ${finalCount} končnih` : ''}`;
    g.appendChild(meta);
    const list = svgEl('text', { x: bounds.x + 14, y: bounds.y + 80, class: 'room-meta' });
    list.textContent = groups.slice(0, 3).map(gr => gr.name).join(' · ');
    g.appendChild(list);
    g.addEventListener('pointerdown', (event) => onRoomPointerDown(event, room.id));
    el.planSvg.appendChild(g);
    if (room.id === selectedRoomId) renderRoomSides(room, points);
  });

  renderDrawingPreview();
}

function renderRoomSides(room, points) {
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    const line = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'room-side', 'data-side-index': index });
    line.addEventListener('pointerdown', event => { event.stopPropagation(); editRoomSide(room, index); });
    el.planSvg.appendChild(line);
    addLengthLabel(a, b, 'side-length');
  });
}

function renderDrawingPreview() {
  if (!drawMode || !drawPoints.length) return;
  const preview = previewPoint ? [...drawPoints, previewPoint] : drawPoints;
  el.planSvg.appendChild(svgEl('polyline', { points: pointsToString(preview), class: 'draw-line' }));
  drawPoints.forEach(point => el.planSvg.appendChild(svgEl('circle', { cx: point.x, cy: point.y, r: 6, class: 'draw-point' })));
  for (let i = 0; i < preview.length - 1; i++) addLengthLabel(preview[i], preview[i + 1], i === preview.length - 2 && previewPoint ? 'side-length preview' : 'side-length');
  if (drawPoints.length >= 3) {
    const closed = autoClosePoints(drawPoints);
    const first = closed[0];
    const adjustedLast = closed[closed.length - 1];
    const rawLast = drawPoints[drawPoints.length - 1];
    if (adjustedLast.x !== rawLast.x || adjustedLast.y !== rawLast.y) {
      const previous = closed[closed.length - 2];
      el.planSvg.appendChild(svgEl('line', { x1: previous.x, y1: previous.y, x2: adjustedLast.x, y2: adjustedLast.y, class: 'close-line' }));
      addLengthLabel(previous, adjustedLast, 'side-length preview');
    }
    el.planSvg.appendChild(svgEl('line', { x1: adjustedLast.x, y1: adjustedLast.y, x2: first.x, y2: first.y, class: 'close-line' }));
    addLengthLabel(adjustedLast, first, 'side-length preview');
  }
}

function addLengthLabel(a, b, className) {
  const midX = (Number(a.x) + Number(b.x)) / 2;
  const midY = (Number(a.y) + Number(b.y)) / 2;
  const horizontal = Math.abs(Number(b.x) - Number(a.x)) >= Math.abs(Number(b.y) - Number(a.y));
  const text = svgEl('text', { x: midX + (horizontal ? 0 : 10), y: midY + (horizontal ? -8 : 0), class: className, 'text-anchor': 'middle' });
  text.textContent = formatLength(a, b);
  el.planSvg.appendChild(text);
}

function svgEl(name, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function svgPoint(event) {
  const pt = el.planSvg.createSVGPoint();
  pt.x = event.clientX; pt.y = event.clientY;
  return pt.matrixTransform(el.planSvg.getScreenCTM().inverse());
}

function onPlanWheel(event) {
  event.preventDefault();
  zoomPlan(event.deltaY > 0 ? 1.12 : 0.88, svgPoint(event));
}

function onSvgPointerDown(event) {
  if (event.target.closest('[data-room-id]') || event.target.classList?.contains('room-side')) return;
  event.preventDefault();
  if (drawMode) {
    const raw = svgPoint(event);
    const point = drawPoints.length ? snapOrthogonal(drawPoints.at(-1), raw) : { x: Math.round(raw.x), y: Math.round(raw.y) };
    if (drawPoints.length && segmentLengthCm(drawPoints.at(-1), point) < 20) return;
    drawPoints.push(point);
    previewPoint = null;
    renderPlan();
    return;
  }
  scenePan = { startX: event.clientX, startY: event.clientY, view: { ...currentPlanView() } };
  el.planSvg.classList.add('panning');
}

function onRoomPointerDown(event, roomId) {
  event.stopPropagation();
  selectedRoomId = roomId;
  renderAll();
  if (drawMode) return;
  const room = selectedRoom();
  const p = svgPoint(event);
  drag = { roomId, startX: p.x, startY: p.y, origX: Number(room.x), origY: Number(room.y), origPoints: room.points ? roomPoints(room) : null };
}

function onPointerMove(event) {
  const floor = currentFloor();
  if (scenePan) {
    const box = el.planSvg.getBoundingClientRect();
    const dx = (event.clientX - scenePan.startX) * (scenePan.view.w / box.width);
    const dy = (event.clientY - scenePan.startY) * (scenePan.view.h / box.height);
    setPlanView({ ...scenePan.view, x: scenePan.view.x - dx, y: scenePan.view.y - dy });
    renderPlan();
    return;
  }
  if (drawMode && drawPoints.length) {
    const p = svgPoint(event);
    previewPoint = snapOrthogonal(drawPoints.at(-1), p);
    renderPlan();
  }
  if (drag) {
    const room = floor.rooms.find(r => r.id === drag.roomId);
    const p = svgPoint(event);
    const dx = Math.round(p.x - drag.startX);
    const dy = Math.round(p.y - drag.startY);
    if (drag.origPoints) {
      room.points = drag.origPoints.map(point => ({ x: point.x + dx, y: point.y + dy }));
      syncRoomBounds(room);
    } else {
      room.x = Math.max(0, Math.round(drag.origX + dx));
      room.y = Math.max(0, Math.round(drag.origY + dy));
    }
    renderPlan(); renderRoomInspector();
  }
}

function onPointerUp() {
  if (scenePan) { scenePan = null; el.planSvg.classList.remove('panning'); }
  if (drag) { drag = null; changed(); renderAll(); }
}

function editRoomSide(room, sideIndex) {
  selectedRoomId = room.id;
  const points = roomPoints(room);
  const a = points[sideIndex];
  const bIndex = (sideIndex + 1) % points.length;
  const b = points[bIndex];
  const currentM = segmentLengthCm(a, b) / 100;
  const input = prompt('Nova dolžina stranice v metrih', currentM.toFixed(2));
  if (input === null) return;
  const newCm = Number(String(input).replace(',', '.')) * 100;
  if (!Number.isFinite(newCm) || newCm <= 0) return alert('Vnesi veljavno dolžino v metrih.');
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (bIndex !== 0) {
    if (horizontal) {
      const sign = Math.sign(b.x - a.x) || 1;
      const newX = Math.round(a.x + sign * newCm);
      b.x = newX;
      const cIndex = (bIndex + 1) % points.length;
      points[cIndex].x = newX;
    } else {
      const sign = Math.sign(b.y - a.y) || 1;
      const newY = Math.round(a.y + sign * newCm);
      b.y = newY;
      const cIndex = (bIndex + 1) % points.length;
      points[cIndex].y = newY;
    }
  } else {
    if (horizontal) {
      const sign = Math.sign(b.x - a.x) || 1;
      const newX = Math.round(b.x - sign * newCm);
      a.x = newX;
      const prevIndex = (sideIndex - 1 + points.length) % points.length;
      if (prevIndex !== 0) points[prevIndex].x = newX;
    } else {
      const sign = Math.sign(b.y - a.y) || 1;
      const newY = Math.round(b.y - sign * newCm);
      a.y = newY;
      const prevIndex = (sideIndex - 1 + points.length) % points.length;
      if (prevIndex !== 0) points[prevIndex].y = newY;
    }
  }
  room.points = points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  syncRoomBounds(room);
  changed({ render: true });
}

function updateRoomGeometryField(room, field, value) {
  if (!['x', 'y', 'w', 'h'].includes(field)) { room[field] = value; return; }
  if (!room.points) { room[field] = value; return; }
  const points = roomPoints(room);
  const b = pointsBounds(points);
  if (field === 'x' || field === 'y') {
    const delta = value - b[field];
    room.points = points.map(p => field === 'x' ? { x: p.x + delta, y: p.y } : { x: p.x, y: p.y + delta });
  } else {
    const axis = field === 'w' ? 'x' : 'y';
    const oldSize = field === 'w' ? b.w : b.h;
    const origin = field === 'w' ? b.x : b.y;
    const scale = oldSize ? value / oldSize : 1;
    room.points = points.map(p => ({ ...p, [axis]: origin + (p[axis] - origin) * scale }));
  }
  syncRoomBounds(room);
}

function renderRoomInspector() {
  const room = selectedRoom();
  if (!room) { el.roomInspector.className = 'muted'; el.roomInspector.textContent = 'Izberi ali nariši prostor.'; return; }
  el.roomInspector.className = '';
  syncRoomBounds(room);
  const tpl = $('#roomInspectorTemplate').content.cloneNode(true);
  $$('[data-field]', tpl).forEach(input => {
    input.value = room[input.dataset.field];
    input.addEventListener('input', () => {
      const value = ['x', 'y', 'w', 'h'].includes(input.dataset.field) ? Number(input.value) : input.value;
      updateRoomGeometryField(room, input.dataset.field, value);
      changed(); renderPlan(); renderSummary(); renderGroups();
    });
  });
  const groupsWrap = $('[data-role="roomGroups"]', tpl);
  project.materialGroups.forEach(group => {
    const label = document.createElement('label');
    const checked = (group.roomIds || []).includes(room.id);
    label.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}> <span></span>`;
    $('span', label).textContent = `${group.name} (${categoryLabel(group.category)})`;
    $('input', label).addEventListener('change', (event) => {
      group.roomIds = group.roomIds || [];
      room.materialGroupIds = room.materialGroupIds || [];
      if (event.target.checked) {
        if (!group.roomIds.includes(room.id)) group.roomIds.push(room.id);
        if (!room.materialGroupIds.includes(group.id)) room.materialGroupIds.push(group.id);
      } else {
        group.roomIds = group.roomIds.filter(id => id !== room.id);
        room.materialGroupIds = room.materialGroupIds.filter(id => id !== group.id);
      }
      changed({ render: true });
    });
    groupsWrap.appendChild(label);
  });
  $('[data-action="deleteRoom"]', tpl).onclick = deleteSelectedRoom;
  el.roomInspector.innerHTML = '';
  el.roomInspector.appendChild(tpl);
}

function deleteSelectedRoom() {
  const floor = currentFloor();
  const room = selectedRoom();
  if (!room || !confirm(`Izbrišem prostor ${room.name}?`)) return;
  floor.rooms = floor.rooms.filter(r => r.id !== room.id);
  project.materialGroups.forEach(g => g.roomIds = (g.roomIds || []).filter(id => id !== room.id));
  selectedRoomId = null;
  changed({ render: true });
}

function renderGroups() {
  el.groupList.innerHTML = '';
  if (!project.materialGroups.length) {
    el.groupList.innerHTML = '<div class="card muted">Ni še seznamov materialov. Klikni »+ Seznam« za nov seznam.</div>';
    return;
  }
  project.materialGroups.forEach(group => {
    const candidate = selectedCandidate(group);
    const rooms = groupRooms(group);
    const card = document.createElement('div');
    card.className = `card ${group.id === selectedGroupId ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title"></div>
          <div class="card-subtitle">${categoryLabel(group.category)} · enota: ${group.unit || 'kos'} · ${rooms.length} prostorov</div>
        </div>
        <span class="cost">${candidate ? formatMoney(candidateCost(group, candidate)) : 'Brez izbire'}</span>
      </div>
      <div>${rooms.map(r => `<span class="pill">${escapeHtml(r.floorName)} / ${escapeHtml(r.name)}</span>`).join('') || '<span class="pill">Ni dodeljeno prostoru</span>'}</div>
      <div>${candidate ? `<span class="pill final">Končna izbira: ${escapeHtml(candidate.name || 'Brez imena')}</span>` : `<span class="pill">${group.candidates?.length || 0} kandidatov</span>`}</div>
      <div class="actions">
        <button class="small" data-action="open">Nastavitve</button>
        <button class="small secondary" data-action="candidates">Kandidati</button>
        <button class="small secondary" data-action="clone">Podvoji</button>
        <button class="small danger" data-action="delete">Izbriši</button>
      </div>`;
    $('.card-title', card).textContent = group.name;
    card.querySelector('[data-action="open"]').onclick = () => { selectedGroupId = group.id; editingCandidateId = null; activeRightTab = 'details'; renderAll(); };
    card.querySelector('[data-action="candidates"]').onclick = () => { selectedGroupId = group.id; editingCandidateId = null; activeRightTab = 'candidates'; renderAll(); };
    card.querySelector('[data-action="clone"]').onclick = () => duplicateGroup(group.id);
    card.querySelector('[data-action="delete"]').onclick = () => deleteGroup(group.id);
    el.groupList.appendChild(card);
  });
}

function addMaterialGroup() {
  const group = { id: uid('mat'), name: 'Nov seznam materialov', category: 'tiles', unit: 'm²', quantity: 1, roomIds: selectedRoomId ? [selectedRoomId] : [], selectedCandidateId: null, candidates: [] };
  project.materialGroups.unshift(group);
  if (selectedRoomId) {
    const room = selectedRoom();
    room.materialGroupIds = [...new Set([...(room.materialGroupIds || []), group.id])];
  }
  selectedGroupId = group.id;
  editingCandidateId = null;
  activeRightTab = 'details';
  changed({ render: true });
}

function duplicateGroup(groupId) {
  const original = project.materialGroups.find(g => g.id === groupId);
  const copy = JSON.parse(JSON.stringify(original));
  copy.id = uid('mat'); copy.name = `${copy.name} kopija`; copy.selectedCandidateId = null;
  copy.candidates = (copy.candidates || []).map(c => ({ ...c, id: uid('cand') }));
  project.materialGroups.unshift(copy);
  selectedGroupId = copy.id;
  changed({ render: true });
}

function deleteGroup(groupId) {
  const group = project.materialGroups.find(g => g.id === groupId);
  if (!confirm(`Izbrišem seznam materialov ${group.name}?`)) return;
  project.materialGroups = project.materialGroups.filter(g => g.id !== groupId);
  project.floors.forEach(f => f.rooms.forEach(r => r.materialGroupIds = (r.materialGroupIds || []).filter(id => id !== groupId)));
  selectedGroupId = project.materialGroups[0]?.id || null;
  changed({ render: true });
}

function renderGroupEditor() {
  const group = selectedGroup();
  if (!group) { el.groupEditor.classList.remove('hidden'); el.groupEditor.innerHTML = '<p class="muted">Najprej izberi ali ustvari seznam materialov.</p>'; return; }
  el.groupEditor.classList.remove('hidden');
  el.groupEditor.innerHTML = `
    <p class="hint">Tu določiš, kaj kupuješ, količino in v katerih prostorih bo uporabljeno.</p>
    <label>Ime seznama<input data-field="name"></label>
    <div class="grid two">
      <label>Kategorija<select data-field="category">${CATEGORIES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label>Enota za točno količino<input data-field="unit" placeholder="kos, tm, komplet"></label>
    </div>
    <h3>Prostori uporabe</h3>
    <div class="checkbox-list" data-role="rooms"></div>`;
  $$('[data-field]', el.groupEditor).forEach(input => {
    input.value = group[input.dataset.field] ?? '';
    input.addEventListener('input', () => {
      group[input.dataset.field] = input.value;
      changed(); renderPlan(); renderGroups(); renderSummary();
    });
  });
  const roomsWrap = $('[data-role="rooms"]', el.groupEditor);
  allRooms().forEach(room => {
    const label = document.createElement('label');
    const checked = (group.roomIds || []).includes(room.id);
    label.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}> <span></span>`;
    $('span', label).textContent = `${room.floorName} / ${room.name}`;
    $('input', label).onchange = (event) => {
      group.roomIds = group.roomIds || [];
      const realRoom = project.floors.flatMap(f => f.rooms).find(r => r.id === room.id);
      realRoom.materialGroupIds = realRoom.materialGroupIds || [];
      if (event.target.checked) {
        group.roomIds.push(room.id); group.roomIds = [...new Set(group.roomIds)];
        realRoom.materialGroupIds.push(group.id); realRoom.materialGroupIds = [...new Set(realRoom.materialGroupIds)];
      } else {
        group.roomIds = group.roomIds.filter(id => id !== room.id);
        realRoom.materialGroupIds = realRoom.materialGroupIds.filter(id => id !== group.id);
      }
      changed({ render: true });
    };
    roomsWrap.appendChild(label);
  });
}

function renderCandidates() {
  const group = selectedGroup();
  if (!group) { el.candidatePanel.className = 'muted'; el.candidatePanel.textContent = 'Izberi seznam materialov.'; return; }
  el.candidatePanel.className = '';
  const draft = candidateDraft(group.id);
  const isEditing = Boolean(editingCandidateId);
  const assignedArea = groupAreaQuantity(group);
  el.candidatePanel.innerHTML = `
    <div class="editor">
      <p class="hint">${isEditing ? 'Uredi celoten objekt kandidata.' : `Dodaj več možnosti za “${escapeHtml(group.name)}”.`} Količina je lahko točna količina ali samodejni izračun po m² glede na dodeljene prostore.</p>
      <label>URL izdelka<input id="sourceUrl" placeholder="https://…" value="${escapeAttr(draft.sourceUrl)}"></label>
      <button id="fetchUrlBtn" class="secondary small">Pridobi podatke iz URL-ja</button>
      <div class="grid two">
        <label>Ime izdelka<input id="candName" value="${escapeAttr(draft.name)}"></label>
        <label>Prodajalec<input id="candVendor" value="${escapeAttr(draft.vendor)}"></label>
        <label>Cena na enoto<input id="candPrice" type="number" min="0" step="0.01" value="${escapeAttr(draft.price)}"></label>
        <label>Način količine
          <select id="candQuantityMode">
            <option value="exact" ${draft.quantityMode !== 'area' ? 'selected' : ''}>Točna količina, npr. 1 umivalnik</option>
            <option value="area" ${draft.quantityMode === 'area' ? 'selected' : ''}>Cena na m² iz površine prostorov</option>
          </select>
        </label>
        <label id="candQtyLabel">Točna količina<input id="candQty" type="number" min="0" step="0.01" placeholder="npr. 1" value="${escapeAttr(draft.qty)}"></label>
        <div class="hint quantity-help" id="quantityHelp"></div>
      </div>
      <label>URL slike<input id="candImage" value="${escapeAttr(draft.imageUrl)}"></label>
      <label>Opombe<textarea id="candNotes" placeholder="format, dimenzije, dobava, SKU, prednosti/slabosti…">${escapeHtml(draft.notes)}</textarea></label>
      <div class="actions">
        <button id="addCandidateBtn">${isEditing ? 'Shrani kandidata' : 'Dodaj kandidata'}</button>
        ${isEditing ? '<button id="cancelEditCandidateBtn" class="secondary" type="button">Prekliči urejanje</button>' : ''}
      </div>
    </div>
    <div class="list" id="candidateList"></div>`;

  bindCandidateDraftInputs(group.id);
  updateQuantityModeUi(group);
  $('#fetchUrlBtn', el.candidatePanel).onclick = fetchCandidateUrl;
  $('#addCandidateBtn', el.candidatePanel).onclick = saveCandidateFromForm;
  $('#cancelEditCandidateBtn', el.candidatePanel)?.addEventListener('click', () => { editingCandidateId = null; candidateDrafts[group.id] = { sourceUrl: '', name: '', vendor: '', price: '', quantityMode: 'exact', qty: '', imageUrl: '', notes: '' }; renderCandidates(); });
  renderCandidateList(group);
}

function bindCandidateDraftInputs(groupId) {
  const map = { sourceUrl: 'sourceUrl', candName: 'name', candVendor: 'vendor', candPrice: 'price', candQuantityMode: 'quantityMode', candQty: 'qty', candImage: 'imageUrl', candNotes: 'notes' };
  Object.entries(map).forEach(([elementId, field]) => {
    const input = $(`#${elementId}`, el.candidatePanel);
    if (!input) return;
    const onValueChange = () => {
      candidateDraft(groupId)[field] = input.value;
      if (elementId === 'candQuantityMode') updateQuantityModeUi(selectedGroup());
    };
    input.addEventListener('input', onValueChange);
    input.addEventListener('change', onValueChange);
  });
}

function updateQuantityModeUi(group) {
  const mode = $('#candQuantityMode', el.candidatePanel)?.value || 'exact';
  const qtyLabel = $('#candQtyLabel', el.candidatePanel);
  const qtyInput = $('#candQty', el.candidatePanel);
  const help = $('#quantityHelp', el.candidatePanel);
  if (!qtyLabel || !qtyInput || !help) return;
  const area = groupAreaQuantity(group);
  if (mode === 'area') {
    qtyLabel.classList.add('hidden');
    qtyInput.value = '';
    candidateDraft(group.id).qty = '';
    help.textContent = `Količina se izračuna iz površine dodeljenih prostorov: ${area.toFixed(2)} m². Cena naj bo cena na m².`;
  } else {
    qtyLabel.classList.remove('hidden');
    help.textContent = 'Vnesi točno količino za ta izdelek, npr. 1 umivalnik, 2 WC školjki ali 8 luči.';
  }
}

function renderCandidateList(group) {
  const list = $('#candidateList', el.candidatePanel);
  list.innerHTML = '';
  if (!(group.candidates || []).length) {
    list.innerHTML = '<div class="card muted">Ni še kandidatov. Izpolni obrazec zgoraj in klikni »Dodaj kandidata«.</div>';
    return;
  }
  (group.candidates || []).forEach(candidate => {
    const isFinal = candidate.id === group.selectedCandidateId;
    const card = document.createElement('div');
    card.className = `card ${isFinal ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="candidate-card">
        ${candidate.imageUrl ? `<img src="${escapeAttr(candidate.imageUrl)}" alt="">` : '<div></div>'}
        <div>
          <div class="card-header">
            <div><div class="card-title">${escapeHtml(candidate.name || 'Kandidat brez imena')}</div><div class="card-subtitle">${escapeHtml(candidate.vendor || '')}</div></div>
            <span class="cost">${formatMoney(candidateCost(group, candidate))}</span>
          </div>
          <div class="card-subtitle">${formatMoney(candidate.price || 0)} × ${candidateQuantity(group, candidate).toFixed(2)} ${candidateUnit(group, candidate)}${candidateQuantityMode(candidate) === 'area' ? ' (iz površine prostorov)' : ''}</div>
          ${candidate.notes ? `<p>${escapeHtml(candidate.notes)}</p>` : ''}
          ${candidate.sourceUrl ? `<a href="${escapeAttr(candidate.sourceUrl)}" target="_blank" rel="noreferrer">Vir</a>` : ''}
          <div class="actions">
            <button class="small ${isFinal ? 'secondary' : ''}" data-action="select">${isFinal ? 'Končna izbira' : 'Izberi kot končno'}</button>
            <button class="small secondary" data-action="edit">Uredi</button>
            <button class="small danger" data-action="delete">Izbriši</button>
          </div>
        </div>
      </div>`;
    card.querySelector('[data-action="select"]').onclick = () => { group.selectedCandidateId = isFinal ? null : candidate.id; changed({ render: true }); };
    card.querySelector('[data-action="edit"]').onclick = () => editCandidate(group, candidate);
    card.querySelector('[data-action="delete"]').onclick = () => deleteCandidate(group, candidate.id);
    list.appendChild(card);
  });
}

async function fetchCandidateUrl() {
  const sourceUrl = $('#sourceUrl', el.candidatePanel).value.trim();
  if (!sourceUrl) return alert('Najprej vnesi URL izdelka.');
  try {
    $('#fetchUrlBtn', el.candidatePanel).textContent = 'Pridobivam…';
    const res = await fetch(`${API_BASE}/fetch-url`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: sourceUrl }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'URL-ja ni bilo mogoče prebrati');
    const draft = candidateDraft(selectedGroupId);
    draft.sourceUrl = sourceUrl;
    draft.name = data.name || '';
    draft.vendor = data.vendor || '';
    draft.price = data.price || '';
    draft.imageUrl = data.imageUrl || '';
    draft.notes = data.notes || '';
    $('#candName', el.candidatePanel).value = draft.name;
    $('#candVendor', el.candidatePanel).value = draft.vendor;
    $('#candPrice', el.candidatePanel).value = draft.price;
    $('#candImage', el.candidatePanel).value = draft.imageUrl;
    $('#candNotes', el.candidatePanel).value = draft.notes;
  } catch (error) {
    alert(error.message);
  } finally {
    $('#fetchUrlBtn', el.candidatePanel).textContent = 'Pridobi podatke iz URL-ja';
  }
}

function saveCandidateFromForm() {
  const group = selectedGroup();
  const mode = $('#candQuantityMode', el.candidatePanel).value;
  const candidateData = {
    name: $('#candName', el.candidatePanel).value.trim(),
    vendor: $('#candVendor', el.candidatePanel).value.trim(),
    sourceUrl: $('#sourceUrl', el.candidatePanel).value.trim(),
    imageUrl: $('#candImage', el.candidatePanel).value.trim(),
    price: Number($('#candPrice', el.candidatePanel).value || 0),
    quantityMode: mode,
    quantity: mode === 'area' ? '' : Number($('#candQty', el.candidatePanel).value || 0),
    notes: $('#candNotes', el.candidatePanel).value.trim()
  };
  if (!candidateData.name) return alert('Ime kandidata je obvezno.');
  if (candidateData.quantityMode === 'exact' && candidateData.quantity <= 0) return alert('Za točno količino vnesi količino večjo od 0.');
  group.candidates = group.candidates || [];
  if (editingCandidateId) {
    const existing = group.candidates.find(c => c.id === editingCandidateId);
    if (existing) Object.assign(existing, candidateData);
    editingCandidateId = null;
  } else {
    const candidate = { id: uid('cand'), ...candidateData };
    group.candidates.push(candidate);
    if (!group.selectedCandidateId) group.selectedCandidateId = candidate.id;
  }
  candidateDrafts[group.id] = { sourceUrl: '', name: '', vendor: '', price: '', quantityMode: 'exact', qty: '', imageUrl: '', notes: '' };
  changed({ render: true, immediate: true });
}

function editCandidate(group, candidate) {
  editingCandidateId = candidate.id;
  candidateDrafts[group.id] = {
    sourceUrl: candidate.sourceUrl || '',
    name: candidate.name || '',
    vendor: candidate.vendor || '',
    price: candidate.price || '',
    quantityMode: candidateQuantityMode(candidate) === 'area' ? 'area' : 'exact',
    qty: candidateQuantityMode(candidate) === 'area' ? '' : (candidate.quantity || ''),
    imageUrl: candidate.imageUrl || '',
    notes: candidate.notes || ''
  };
  activeRightTab = 'candidates';
  renderAll();
}

function deleteCandidate(group, candidateId) {
  group.candidates = (group.candidates || []).filter(c => c.id !== candidateId);
  if (group.selectedCandidateId === candidateId) group.selectedCandidateId = null;
  if (editingCandidateId === candidateId) editingCandidateId = null;
  changed({ render: true });
}

function renderSummary() {
  const selectedGroups = project.materialGroups.filter(selectedCandidate);
  const unselected = project.materialGroups.length - selectedGroups.length;
  const total = selectedGroups.reduce((sum, group) => sum + candidateCost(group, selectedCandidate(group)), 0);
  const byCategory = {};
  selectedGroups.forEach(group => byCategory[group.category] = (byCategory[group.category] || 0) + candidateCost(group, selectedCandidate(group)));
  const floorCosts = project.floors.map(floor => ({
    floor,
    cost: selectedGroups.reduce((sum, group) => sum + candidateCostForFloor(group, selectedCandidate(group), floor), 0)
  }));
  const unassignedCost = selectedGroups.reduce((sum, group) => {
    const assignedRoomCount = assignedRoomsForGroup(group).length;
    return assignedRoomCount ? sum : sum + candidateCost(group, selectedCandidate(group));
  }, 0);
  el.summary.innerHTML = `
    <div class="summary-grid">
      <div class="summary-tile">Skupaj izbrano<strong>${formatMoney(total)}</strong></div>
      <div class="summary-tile">Seznami materialov<strong>${project.materialGroups.length}</strong></div>
      <div class="summary-tile">Brez končne izbire<strong>${unselected}</strong></div>
    </div>
    <table class="table">
      <thead><tr><th>Kategorija</th><th>Strošek</th></tr></thead>
      <tbody>${Object.entries(byCategory).map(([cat, cost]) => `<tr><td>${escapeHtml(categoryLabel(cat))}</td><td class="cost">${formatMoney(cost)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Končne izbire še niso izbrane.</td></tr>'}</tbody>
    </table>
    <table class="table">
      <thead><tr><th>Etaža</th><th>Strošek izbranih materialov</th></tr></thead>
      <tbody>
        ${floorCosts.map(({ floor, cost }) => `<tr><td>${escapeHtml(floor.name)}</td><td class="cost">${formatMoney(cost)}</td></tr>`).join('')}
        ${unassignedCost ? `<tr><td>Ni dodeljeno etaži</td><td class="cost">${formatMoney(unassignedCost)}</td></tr>` : ''}
      </tbody>
      <tfoot><tr><th>Skupaj</th><th class="cost">${formatMoney(total)}</th></tr></tfoot>
    </table>
    <table class="table">
      <thead><tr><th>Seznam</th><th>Končni kandidat</th><th>Kje</th><th>Količina</th><th>Strošek</th></tr></thead>
      <tbody>${project.materialGroups.map(group => {
        const cand = selectedCandidate(group);
        return `<tr><td>${escapeHtml(group.name)}</td><td>${cand ? escapeHtml(cand.name) : '<span class="muted">Ni izbrano</span>'}</td><td>${groupRooms(group).map(r => escapeHtml(r.name)).join(', ') || 'Ni dodeljeno'}</td><td>${cand ? `${candidateQuantity(group, cand).toFixed(2)} ${candidateUnit(group, cand)}` : '—'}</td><td class="cost">${cand ? formatMoney(candidateCost(group, cand)) : '—'}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="muted">Ustvari sezname materialov za začetek proračuna.</td></tr>'}</tbody>
      <tfoot><tr><th colspan="4">Skupaj</th><th class="cost">${formatMoney(total)}</th></tr></tfoot>
    </table>`;
}


function exportJson() {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${(project.name || 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`; a.click();
  URL.revokeObjectURL(url);
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.floors) || !Array.isArray(imported.materialGroups)) throw new Error('Neveljaven JSON projekta.');
      project = imported;
      selectedFloorId = project.floors[0]?.id || null;
      selectedRoomId = null;
      selectedGroupId = project.materialGroups[0]?.id || null;
      changed({ render: true });
    } catch (error) { alert(error.message); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
function escapeAttr(value = '') { return escapeHtml(value).replace(/'/g, '&#39;'); }
