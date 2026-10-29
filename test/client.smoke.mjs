// Headless smoke test: load the plugin factory with a DOM stub and exercise
// the sidebar-region path (span split, independent alpha, restore).
import { readFileSync } from 'node:fs';

const src = readFileSync(process.argv[2] || 'lib/client.js', 'utf8');

// ── tiny DOM/CSS stub ────────────────────────────────────────────────
function makeCtx2d() {
  const calls = [];
  const state = { globalCompositeOperation: 'source-over' };
  const stack = [];
  const rec = (name) => (...args) => {
    calls.push({ name, args, op: state.globalCompositeOperation });
  };
  const grad = { addColorStop: (...args) => calls.push({ name: 'addColorStop', args, op: state.globalCompositeOperation }) };
  const api = {
    calls,
    canvas: null,
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    setTransform: rec('setTransform'),
    clearRect: rec('clearRect'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    stroke: rec('stroke'),
    fill: rec('fill'),
    // Real save/restore semantics: state must not leak between regions.
    save: () => { stack.push({ ...state }); calls.push({ name: 'save', args: [], op: state.globalCompositeOperation }); },
    restore: () => {
      const prev = stack.pop();
      if (prev) Object.assign(state, prev);
      calls.push({ name: 'restore', args: [], op: state.globalCompositeOperation });
    },
    fillText: rec('fillText'),
    drawImage: rec('drawImage'),
    createLinearGradient: (...args) => { calls.push({ name: 'createLinearGradient', args, op: state.globalCompositeOperation }); return grad; },
    createRadialGradient: (...args) => { calls.push({ name: 'createRadialGradient', args, op: state.globalCompositeOperation }); return grad; },
  };
  Object.defineProperty(api, 'globalCompositeOperation', {
    get: () => state.globalCompositeOperation,
    set: (v) => { state.globalCompositeOperation = v; },
  });
  return api;
}

const styleOf = (el) => {
  const s = {};
  return new Proxy(s, {
    set(t, k, v) { t[k] = v; return true; },
    get(t, k) { return t[k] === undefined ? '' : t[k]; },
  });
};

function el(tag, extra = {}) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    style: styleOf(),
    dataset: {},
    className: '',
    textContent: '',
    isConnected: true,
    ...extra,
  };
  // Real DOM keeps attributes in one place; mirror that so getAttribute sees
  // both `data-*` values and ordinary names like `data-sidebar-collapsed`.
  node.__attrs = {};
  node.setAttribute = (k, v) => {
    const value = String(v);
    node.__attrs[k] = value;
    if (k.startsWith('data-')) node.dataset[k.slice(5)] = value;
    else node[k] = value;
  };
  node.getAttribute = (k) => (k in node.__attrs ? node.__attrs[k] : null);
  node.removeAttribute = (k) => { delete node.__attrs[k]; if (k.startsWith('data-')) delete node.dataset[k.slice(5)]; else delete node[k]; };
  node.appendChild = (c) => { c.parentNode = node; node.children.push(c); return c; };
  node.append = (...cs) => cs.forEach((c) => node.appendChild(c));
  node.prepend = (c) => { c.parentNode = node; node.children.unshift(c); return c; };
  node.insertBefore = (c, ref) => {
    const i = ref ? node.children.indexOf(ref) : -1;
    c.parentNode = node;
    if (i < 0) node.children.unshift(c); else node.children.splice(i, 0, c);
    return c;
  };
  node.removeChild = (c) => {
    const i = node.children.indexOf(c);
    if (i >= 0) node.children.splice(i, 1);
    c.parentNode = null;
    return c;
  };
  node.remove = () => { if (node.parentNode) node.parentNode.removeChild(node); };
  node.contains = (other) => {
    let p = other;
    while (p) { if (p === node) return true; p = p.parentNode; }
    return false;
  };
  node.addEventListener = () => {};
  node.removeEventListener = () => {};
  node.closest = () => null;
  node.getBoundingClientRect = () => node.__rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  node.querySelector = () => null;
  Object.defineProperty(node, 'firstChild', { get: () => node.children[0] || null });
  Object.defineProperty(node, 'firstElementChild', { get: () => node.children[0] || null });
  // Real DOM exposes both; findLayout walks parentElement, so the stub must too.
  Object.defineProperty(node, 'parentElement', { get: () => node.parentNode || null });
  Object.defineProperty(node, 'clientWidth', { get: () => node.getBoundingClientRect().width });
  Object.defineProperty(node, 'clientHeight', { get: () => node.getBoundingClientRect().height });
  return node;
}

// ── build an AppFrame lookalike ─────────────────────────────────────
const body = el('body');
const frame = el('div', { className: 'mP3x-q_frame' });
const sidebarCol = el('div', { className: 'mP3x-q_sidebarCol' });
const slotAnchor = el('div', { className: '' });
const sidebarRoot = el('div', { className: 'wtg9ga_root' });
const centerCol = el('div', { className: 'mP3x-q_centerCol' });
const dock = el('div');

body.appendChild(frame);
frame.appendChild(sidebarCol);
sidebarCol.appendChild(slotAnchor);
slotAnchor.appendChild(sidebarRoot);
frame.appendChild(centerCol);
centerCol.appendChild(dock);

frame.__rect = { left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800 };
sidebarCol.__rect = { left: 0, top: 0, right: 280, bottom: 800, width: 280, height: 800 };
sidebarRoot.__rect = { left: 0, top: 0, right: 280, bottom: 800, width: 280, height: 800 };
centerCol.__rect = { left: 280, top: 0, right: 1280, bottom: 800, width: 1000, height: 800 };

global.document = {
  body,
  documentElement: el('html'),
  head: el('head'),
  createElement: (tag) => {
    const node = el(tag);
    if (String(tag).toLowerCase() === 'canvas') {
      const ctx = makeCtx2d();
      node.getContext = () => ctx;
      node.__ctx = ctx;
    }
    return node;
  },
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
};
global.window = {
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  localStorage: { getItem: () => null, setItem: () => {} },
  getComputedStyle: (node) => ({ position: 'relative', backgroundColor: 'rgb(250,250,250)', backgroundImage: 'none' }),
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.performance = { now: () => Date.now() };
global.ResizeObserver = class { observe() {} disconnect() {} };

// ── load the plugin factory ─────────────────────────────────────────
let factory = null;
const loader = { load: ({ id, factory: f }) => { factory = f; } };
global.window.__ModuleLoader__ = loader;
// The bundle calls window.__ModuleLoader__.load at top level.
new Function('window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', src)(
  global.window, global.document, global.requestAnimationFrame, global.cancelAnimationFrame,
);
if (!factory) throw new Error('factory was not registered');

const fakeReact = {
  useEffect: () => {},
  useRef: () => ({ current: null }),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
};
const requireStub = (name) => {
  if (name === 'react') return fakeReact;
  throw new Error(`unexpected require: ${name}`);
};
const mod = factory(requireStub);

// ── exercise the exports without React mounting ─────────────────────
const results = [];
const assert = (label, ok, detail) => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
};

assert('exports present', typeof mod.OceanEngine === 'function' && typeof mod.apply === 'function');

// Renderer region math: simulate a two-region frame.
const canvas = el('canvas');
canvas.__rect = { left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800 };
canvas.__ctx = makeCtx2d();
canvas.getContext = () => canvas.__ctx;
const renderer = new mod.AsciiRenderer(canvas);
renderer.resize(1280, 800, 1);
assert('renderer sized', renderer.cols > 0 && renderer.rows > 0, `${renderer.cols}x${renderer.rows}`);

const world = new mod.World([{ kind: 'koi', size: 1 }]);
world.resize(1280, 800, renderer.cellWidth, renderer.cellHeight);
renderer.world = world;

// Single-region (sidebar off): full-canvas punch only when alpha < 1.
renderer.sidebarSpan = 0;
renderer.centerAlpha = 1;
renderer.sidebarAlpha = 0;
canvas.__ctx.calls.length = 0;
renderer.render(world, 1 / 60);
let punches = canvas.__ctx.calls.filter((c) => c.op === 'destination-out');
assert('alpha=1 single region punches nothing', punches.length === 0, `punches=${punches.length}`);

// Two-region: sidebar 0.35, center 1.0 → sidebar block punched, gradient feather.
renderer.sidebarSpan = 280;
renderer.centerAlpha = 0.5;
renderer.sidebarAlpha = 0.35;
canvas.__ctx.calls.length = 0;
renderer.render(world, 1 / 60);
const destOut = canvas.__ctx.calls.filter((c) => c.op === 'destination-out' && c.name === 'fillRect');
const grads = canvas.__ctx.calls.filter((c) => c.name === 'createLinearGradient');
assert('two-region punches both slices', destOut.length >= 2, `punches=${destOut.length}`);
assert('feather gradient built', grads.length === 1, `createLinearGradient=${grads.length}`);
if (grads.length) {
  const args = grads[0].args.map((v) => Math.round(v));
  assert('feather sits at the sidebar edge', args[0] === 280 - Math.min(48, 140) && args[2] === 280, JSON.stringify(args));
}
const stops = canvas.__ctx.calls.filter((c) => c.name === 'addColorStop').map((c) => c.args);
assert('gradient stops encode both alphas', stops.length === 2 && String(stops[0][1]).includes('0.65') && String(stops[1][1]).includes('0.5'), JSON.stringify(stops));

// Engine: sidebar alpha is independent of hero/idle opacity.
const engine = new mod.OceanEngine(canvas, { heroProbe: null, host: centerCol });
engine.renderer = renderer;
engine.settings = Object.assign({}, engine.settings, { sidebarBackdrop: true, sidebarOpacity: 0.2, heroOpacity: 1 });
engine.opacity = 1;
engine.sidebarAlpha = 0;
renderer.sidebarSpan = 280;
// Drive one tick manually.
engine.last = 0;
engine.acc = 0;
engine.tick(1000 / 60);
assert('center alpha tracks hero opacity', Math.abs(renderer.centerAlpha - 1) < 0.2, `center=${renderer.centerAlpha.toFixed(3)}`);
assert('sidebar alpha heads to its own slider', renderer.sidebarAlpha > 0 && renderer.sidebarAlpha < 0.2, `side=${renderer.sidebarAlpha.toFixed(3)}`);
assert('element stays opaque while split', parseFloat(canvas.style.opacity) === 1, `opacity=${canvas.style.opacity}`);

// With the extension off the sidebar alpha decays to zero and the element
// carries the alpha again.
engine.settings = Object.assign({}, engine.settings, { sidebarBackdrop: false });
for (let i = 0; i < 400; i++) { engine.last = i * 16; engine.tick(engine.last + 16); }
assert('sidebar alpha falls to 0 when off', renderer.sidebarAlpha < 0.02, `side=${renderer.sidebarAlpha.toFixed(4)}`);

// Regression: unsplit, the element owns the conversation alpha and the frame
// is not punched again — otherwise 0.1 would render as 0.01.
renderer.sidebarSpan = 0;
engine.settings = Object.assign({}, engine.settings, { sidebarBackdrop: false, heroOpacity: 0.1, idleOpacity: 0.1 });
engine.opacity = 0.1;
engine.paintedOpacity = -1;
canvas.__ctx.calls.length = 0;
engine.tick(20001);
const unsplitPunches = canvas.__ctx.calls.filter((c) => c.op === 'destination-out');
assert('unsplit does not double-dim', unsplitPunches.length === 0, `punches=${unsplitPunches.length}`);
assert('unsplit puts alpha on the element', Math.abs(parseFloat(canvas.style.opacity) - 0.1) < 0.06, `opacity=${canvas.style.opacity}`);

// Regression: the static (reduced-motion) path must reach the same verdict.
renderer.sidebarSpan = 280;
engine.settings = Object.assign({}, engine.settings, { sidebarBackdrop: true, sidebarOpacity: 0.4 });
engine.opacity = 0.6;
canvas.__ctx.calls.length = 0;
engine.drawStill();
const stillPunches = canvas.__ctx.calls.filter((c) => c.op === 'destination-out');
assert('static path punches when split', stillPunches.length >= 2, `punches=${stillPunches.length}`);
assert('static path leaves element opaque', parseFloat(canvas.style.opacity) === 1, `opacity=${canvas.style.opacity}`);
assert('static path applies the sidebar slider', Math.abs(renderer.sidebarAlpha - 0.4) < 1e-6, `side=${renderer.sidebarAlpha}`);

// findLayout must survive a build whose hashed class names are gone, and must
// never mistake the full-width frame for the centre column.
const frame2 = el('div', { className: 'frame-hashed-gone' });
const sidebarCol2 = el('div', { className: 'side-unknown' });
const sidebarInner = el('div', { className: 'panel-root' });
const innerRow = el('div', { className: 'panel-row' });
const centerCol2 = el('div', { className: 'center-unknown' });
const dock2 = el('div');
body.appendChild(frame2);
frame2.appendChild(sidebarCol2);
sidebarCol2.appendChild(sidebarInner);
sidebarInner.appendChild(innerRow);
frame2.appendChild(centerCol2);
centerCol2.appendChild(dock2);
frame2.__rect = { left: 0, top: 0, right: 1366, bottom: 900, width: 1366, height: 900 };
sidebarCol2.__rect = { left: 0, top: 0, right: 300, bottom: 900, width: 300, height: 900 };
sidebarInner.__rect = { left: 0, top: 0, right: 300, bottom: 900, width: 300, height: 900 };
innerRow.__rect = { left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40 };
centerCol2.__rect = { left: 300, top: 0, right: 1366, bottom: 900, width: 1066, height: 900 };
dock2.__rect = { left: 300, top: 700, right: 1366, bottom: 780, width: 1066, height: 80 };
global.window.innerWidth = 1366;

const found = mod.findLayout(dock2);
assert('findLayout resolves a layout', !!found);
if (found) {
  assert('frame is the column parent, not body', found.frame === frame2, `frame=${found.frame && found.frame.className}`);
  assert('centre column is the narrow one', found.centerCol === centerCol2, `center=${found.centerCol && found.centerCol.className}`);
  assert('sidebar column found by geometry', found.sidebarCol === sidebarCol2, `side=${found.sidebarCol && found.sidebarCol.className}`);
  assert('sidebar root is the full-height panel', found.sidebarRoot === sidebarInner, `root=${found.sidebarRoot && found.sidebarRoot.className}`);
  assert('inner row is not mistaken for the root', found.sidebarRoot !== innerRow);

  // Surface clearing must be reversible.
  centerCol2.style.backgroundColor = 'rgb(1, 2, 3)';
  const touched = mod.clearSurfaces(found, true);
  assert('clearing makes surfaces transparent', centerCol2.style.backgroundColor === 'transparent' && sidebarCol2.style.backgroundColor === 'transparent');
  mod.restoreSurfaces(touched);
  assert('restore puts the original back', centerCol2.style.backgroundColor === 'rgb(1, 2, 3)' && sidebarCol2.style.backgroundColor === '', `center=${centerCol2.style.backgroundColor} side=${sidebarCol2.style.backgroundColor}`);

  // With the extension off only the conversation column may be cleared.
  const touchedOff = mod.clearSurfaces(found, false);
  assert('extension off leaves the sidebar opaque', sidebarCol2.style.backgroundColor === '' && centerCol2.style.backgroundColor === 'transparent');
  mod.restoreSurfaces(touchedOff);
}

// The real app paints its opaque background on an inner conversation root, not
// on the grid column. Hoisting the canvas to the frame hides it under that
// surface unless the whole fill chain is cleared — the exact bug reported.
const frame3 = el('div', { className: 'mP3x-q_frame' });
const side3 = el('div', { className: 'mP3x-q_sidebarCol' });
const slotCol = el('div', {});            // display:contents style anchor
const sideRoot3 = el('div', { className: 'wtg9ga_root' });
const center3 = el('div', { className: 'mP3x-q_centerCol' });
const slotCenter = el('div', {});          // zero-sized slot anchor
const convRoot = el('div', { className: 'conversation_root' });
const viewArea = el('div', { className: 'viewArea' });
const dock3 = el('div', {});
body.appendChild(frame3);
frame3.appendChild(side3);
side3.appendChild(slotCol);
slotCol.appendChild(sideRoot3);
frame3.appendChild(center3);
center3.appendChild(slotCenter);
slotCenter.appendChild(convRoot);
convRoot.appendChild(viewArea);
viewArea.appendChild(dock3);
frame3.__rect = { left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800 };
side3.__rect = { left: 0, top: 0, right: 280, bottom: 800, width: 280, height: 800 };
slotCol.__rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
sideRoot3.__rect = { left: 0, top: 0, right: 280, bottom: 800, width: 280, height: 800 };
center3.__rect = { left: 280, top: 0, right: 1280, bottom: 800, width: 1000, height: 800 };
slotCenter.__rect = { left: 280, top: 0, right: 1280, bottom: 800, width: 1000, height: 800 };
convRoot.__rect = { left: 280, top: 0, right: 1280, bottom: 800, width: 1000, height: 800 };
viewArea.__rect = { left: 280, top: 0, right: 1280, bottom: 740, width: 1000, height: 740 };
dock3.__rect = { left: 320, top: 660, right: 1240, bottom: 740, width: 920, height: 80 };
global.window.innerWidth = 1280;

convRoot.style.backgroundColor = 'rgb(250, 250, 250)';   // the app's own inline paint
center3.style.backgroundColor = 'rgb(10, 10, 10)';
sideRoot3.style.backgroundColor = 'rgb(240, 240, 240)';

const found3 = mod.findLayout(dock3);
assert('deep layout resolves', !!found3 && found3.centerCol === center3, `center=${found3 && found3.centerCol && found3.centerCol.className}`);

const touchedOn = mod.clearSurfaces(found3, true);
assert('inner conversation root is cleared too', convRoot.style.backgroundColor === 'transparent', `root=${convRoot.style.backgroundColor}`);
assert('grid column cleared', center3.style.backgroundColor === 'transparent');
assert('sidebar panel cleared when on', sideRoot3.style.backgroundColor === 'transparent');
assert('viewArea content is untouched', viewArea.style.backgroundColor === '', `view=${viewArea.style.backgroundColor}`);
mod.restoreSurfaces(touchedOn);
assert('restore returns the inner root paint', convRoot.style.backgroundColor === 'rgb(250, 250, 250)', `root=${convRoot.style.backgroundColor}`);
assert('restore returns the sidebar paint', sideRoot3.style.backgroundColor === 'rgb(240, 240, 240)');

const touchedOff3 = mod.clearSurfaces(found3, false);
assert('off still clears the inner root', convRoot.style.backgroundColor === 'transparent');
assert('off leaves the sidebar painted', sideRoot3.style.backgroundColor === 'rgb(240, 240, 240)', `side=${sideRoot3.style.backgroundColor}`);
mod.restoreSurfaces(touchedOff3);

// --- optimisation regressions ---------------------------------------------

// 1. The feather gradient is reused while geometry and alphas hold still.
canvas.__ctx.calls.length = 0;
renderer.sidebarSpan = 280;
renderer.centerAlpha = 0.5;
renderer.sidebarAlpha = 0.35;
renderer.featherKey = '';
renderer.featherGrad = null;
renderer.render(world, 1 / 60);
const gradsFirst = canvas.__ctx.calls.filter((c) => c.name === 'createLinearGradient').length;
canvas.__ctx.calls.length = 0;
renderer.render(world, 1 / 60);
const gradsSecond = canvas.__ctx.calls.filter((c) => c.name === 'createLinearGradient').length;
assert('gradient built once', gradsFirst === 1, `first=${gradsFirst}`);
assert('gradient reused on the next frame', gradsSecond === 0, `second=${gradsSecond}`);

// 2. A changed alpha must rebuild it.
canvas.__ctx.calls.length = 0;
renderer.sidebarAlpha = 0.9;
renderer.render(world, 1 / 60);
const gradsChanged = canvas.__ctx.calls.filter((c) => c.name === 'createLinearGradient').length;
assert('changed alpha rebuilds the gradient', gradsChanged === 1, `built=${gradsChanged}`);

// 3. Both slices fully opaque: the punch is skipped outright.
canvas.__ctx.calls.length = 0;
renderer.centerAlpha = 1;
renderer.sidebarAlpha = 1;
renderer.render(world, 1 / 60);
const puncheAllOpaque = canvas.__ctx.calls.filter((c) => c.op === 'destination-out').length;
assert('no punch when both slices are opaque', puncheAllOpaque === 0, `punches=${puncheAllOpaque}`);

// 4. Spine: the narrowest element covering both columns is chosen.
const shared = mod.findLayout(dock3);
assert('spine is always provided', !!shared && !!shared.spine, `spine=${shared && shared.spine && shared.spine.className}`);

// 5. Collapsed rail still resolves, and reports its collapsed state.
const railFrame = el('div', { className: 'mP3x-q_frame' });
const railSide = el('div', { className: 'mP3x-q_sidebarCol' });
const railCenter = el('div', { className: 'mP3x-q_centerCol' });
const railDock = el('div');
body.appendChild(railFrame);
railFrame.appendChild(railSide);
railFrame.appendChild(railCenter);
railCenter.appendChild(railDock);
railFrame.setAttribute('data-sidebar-collapsed', 'true');
railFrame.__rect = { left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800 };
railSide.__rect = { left: 0, top: 0, right: 56, bottom: 800, width: 56, height: 800 };
railCenter.__rect = { left: 56, top: 0, right: 1280, bottom: 800, width: 1224, height: 800 };
railDock.__rect = { left: 100, top: 700, right: 1240, bottom: 780, width: 1140, height: 80 };
const railLayout = mod.findLayout(railDock);
assert('collapsed rail still resolves a layout', !!railLayout && railLayout.centerCol === railCenter, `center=${railLayout && railLayout.centerCol && railLayout.centerCol.className}`);
assert('collapsed flag readable', railFrame.getAttribute('data-sidebar-collapsed') === 'true');

// 6. Collapsed rail: the sidebar slice must fade out on its own, leaving the
//    conversation slice untouched.
renderer.sidebarSpan = 0;                       // what sync() writes when collapsed
engine.settings = Object.assign({}, engine.settings, { sidebarBackdrop: true, sidebarOpacity: 0.6, heroOpacity: 1 });
engine.sidebarAlpha = 0.6;
engine.opacity = 1;
engine.paintedOpacity = -1;
let t = 1e6;
for (let i = 0; i < 200; i++) { engine.last = t; t += 16; engine.tick(t); }
assert('collapsed fades the sidebar slice out', renderer.sidebarAlpha < 0.02, `side=${renderer.sidebarAlpha.toFixed(4)}`);
assert('collapsed keeps the conversation slice', renderer.centerAlpha > 0.9, `center=${renderer.centerAlpha.toFixed(3)}`);
assert('collapsed hands alpha back to the element', Math.abs(parseFloat(canvas.style.opacity) - renderer.centerAlpha) < 0.05, `opacity=${canvas.style.opacity}`);

// 7. Expanded again: the slice returns to its own slider value.
renderer.sidebarSpan = 280;
t = 2e6;
for (let i = 0; i < 200; i++) { engine.last = t; t += 16; engine.tick(t); }
assert('expanded restores the sidebar slider', Math.abs(renderer.sidebarAlpha - 0.6) < 0.02, `side=${renderer.sidebarAlpha.toFixed(3)}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
