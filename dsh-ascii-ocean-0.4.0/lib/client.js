/**
 * ASCII ocean — fish schools and sharks drawn as a grid of character cells.
 *
 * Loaded by the DSH web client as a browser module: the loader calls the
 * factory, the returned `apply` registers one decoration into a conversation
 * slot, and the decoration portals a full-bleed canvas behind the column's
 * own content. Ported and trimmed from the `ascii-sharks` demo.
 */
window.__ModuleLoader__.load({
  id: "dsh-ascii-ocean",
  factory: (require) => {
    "use strict";

    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // ─────────────────────────────────────────────────────────────── math

    const TAU = Math.PI * 2;
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const rand = (lo, hi) => lo + Math.random() * (hi - lo);
    const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));

    function smoothstep(e0, e1, x) {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    }

    /** Shortest signed angle from a to b, in (-PI, PI]. */
    function angleDiff(a, b) {
      let d = (b - a) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    }

    /** Cheap deterministic hash → [0, 1). Keeps the dot field stable. */
    function hash3(x, y, z) {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    }

    const K1 = 1 / 260;
    const K2 = 1 / 310;
    const K3 = 1 / 190;
    const CURRENT_SCALE = 3400;

    /** Divergence-free ocean current: the curl of a drifting stream function. */
    function current(x, y, t, out) {
      const a = x * K1 + t * 0.07;
      const b = y * K2 - t * 0.05;
      const c = (x + y) * K3 + t * 0.11;
      out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
      out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
      return out;
    }

    // ─────────────────────────────────────────────────────────── species

    const SPECIES = [
      { cruise: 36, maxSpeed: 64, minSpeed: 18, weight: 3, schoolSize: [14, 24], spacing: [1.8, 1.1], align: 1.6, cohesion: 1.6, jitter: 40, mill: 70, verticalDrag: 0.5 },
      { cruise: 46, maxSpeed: 78, minSpeed: 22, weight: 3, schoolSize: [16, 26], spacing: [1.5, 1], align: 3.2, cohesion: 0.45, jitter: 30, mill: 0, verticalDrag: 1.4 },
      { cruise: 40, maxSpeed: 70, minSpeed: 20, weight: 2, schoolSize: [10, 18], spacing: [2, 1.1], align: 2.4, cohesion: 1.1, jitter: 35, mill: 0, verticalDrag: 1.6 },
      { cruise: 32, maxSpeed: 60, minSpeed: 16, weight: 1, schoolSize: [5, 9], spacing: [2.6, 1.3], align: 2, cohesion: 0.9, jitter: 25, mill: 0, verticalDrag: 2 },
    ];
    const TOTAL_WEIGHT = SPECIES.reduce((s, sp) => s + sp.weight, 0);

    function pickSpecies() {
      let r = Math.random() * TOTAL_WEIGHT;
      for (let i = 0; i < SPECIES.length; i++) {
        r -= SPECIES[i].weight;
        if (r <= 0) return i;
      }
      return 0;
    }

    // ───────────────────────────────────────────────────────────── world

    const SHARK_NODES = 20;
    const FISH_SEPARATION_K = 420;
    const FISH_ALIGN_K = 1.4;
    const FISH_COHESION_K = 1;
    const FISH_FLEE_K = 1100;
    const BLIND_COS = -0.6;

    const DEFAULT_SHARKS = [
      { kind: "koi", size: 1 },
      { kind: "goldfish", size: 0.72 },
      { kind: "koi", size: 0.84 },
    ];

    /** Roster presets used by the settings panel. */
    function specsFor(species) {
      if (species === "koi") {
        return [
          { kind: "koi", size: 1 },
          { kind: "koi", size: 0.72 },
          { kind: "koi", size: 0.86 },
        ];
      }
      if (species === "goldfish") {
        return [
          { kind: "goldfish", size: 1 },
          { kind: "goldfish", size: 0.7 },
          { kind: "goldfish", size: 0.85 },
        ];
      }
      if (species === "shark") {
        return [
          { kind: "shark", size: 1 },
          { kind: "shark", size: 0.7 },
          { kind: "shark", size: 0.84 },
        ];
      }
      return DEFAULT_SHARKS;
    }

    class World {
      constructor(sharkSpecs) {
        this.sharkSpecs = sharkSpecs && sharkSpecs.length ? sharkSpecs : DEFAULT_SHARKS;
        this.width = 0;
        this.height = 0;
        this.time = 0;
        this.fish = [];
        this.sharks = [];
        this.events = [];
        this.ripples = [];
        this.cellW = 12;
        this.cellH = 16;
        this.pointer = { x: 0, y: 0, active: false };
        this.perception = 60;
        this.sepX = [];
        this.sepY = [];
        this.foreignSep = 40;
        this.tmp = { x: 0, y: 0 };
      }

      /**
       * Left click on the water: an expanding ring of random size, nearby fish
       * scatter, a fish under the cursor bolts, and a struck koi darts away.
       */
      ripple(x, y) {
        const radius = rand(90, 260);
        const power = radius / 260;
        this.ripples.push({
          x,
          y,
          born: this.time,
          life: 0.9 + power * 0.6,
          radius,
        });

        const hitX = this.cellW * 0.9;
        const hitY = this.cellH * 0.9;
        for (const f of this.fish) {
          if (!f.alive) continue;
          const dx = f.x - x;
          const dy = f.y - y;
          const d = Math.hypot(dx, dy);
          const direct = Math.abs(dx) < hitX && Math.abs(dy) < hitY;
          if (direct) {
            // A fish right under the click takes the full scare.
            const away = Math.atan2(dy, dx) || 0;
            f.vx += Math.cos(away) * 260;
            f.vy += Math.sin(away) * 260;
            f.alarm = 1;
            this.events.push({ kind: "startle", x: f.x, y: f.y });
            continue;
          }
          if (d > radius || d < 1e-3) continue;
          const w = Math.pow(1 - d / radius, 1.5);
          f.vx += (dx / d) * 300 * w;
          f.vy += (dy / d) * 300 * w;
          f.alarm = Math.max(f.alarm, 0.5 + 0.5 * w);
        }

        for (const sh of this.sharks) {
          if (this.distanceToSpine(sh, x, y) < sh.length * 0.13) {
            sh.spook = 1;
            sh.spookFrom = { x, y };
          }
        }
      }

      /** Shortest distance from a point to the creature's spine. */
      distanceToSpine(sh, x, y) {
        let best = Infinity;
        for (let k = 0; k < SHARK_NODES - 1; k++) {
          const ax = sh.nodes[k * 2];
          const ay = sh.nodes[k * 2 + 1];
          const bx = sh.nodes[(k + 1) * 2];
          const by = sh.nodes[(k + 1) * 2 + 1];
          const sx = bx - ax;
          const sy = by - ay;
          const len2 = sx * sx + sy * sy || 1;
          const u = clamp(((x - ax) * sx + (y - ay) * sy) / len2, 0, 1);
          const d = Math.hypot(x - (ax + sx * u), y - (ay + sy * u));
          if (d < best) best = d;
        }
        return best;
      }

      resize(width, height, cellW, cellH) {
        const first = this.width === 0;
        this.width = width;
        this.height = height;
        this.cellW = cellW;
        this.cellH = cellH;
        this.sepX = SPECIES.map((sp) => sp.spacing[0] * cellW);
        this.sepY = SPECIES.map((sp) => sp.spacing[1] * cellH);
        this.perception = Math.max(cellH * 3, cellW * 5.5);
        this.foreignSep = cellW * 3;
        if (first || this.fish.length === 0) {
          this.seed();
          return;
        }
        for (const f of this.fish) {
          f.x = clamp(f.x, 0, width);
          f.y = clamp(f.y, 0, height);
        }
      }

      seed() {
        const W = this.width;
        const H = this.height;
        const minSide = Math.min(W, H);
        const baseLength = clamp(minSide * 0.44, 150, 420);
        const count = this.sharkSpecs.length;

        this.sharks = [];
        for (let i = 0; i < count; i++) {
          const size = this.sharkSpecs[i].size;
          const kind = this.sharkSpecs[i].kind || "koi";
          const length = baseLength * size * (kind === "goldfish" ? 0.82 : 1);
          const orbitRadius = minSide * rand(0.28, 0.4);
          const a = (i / count) * TAU + rand(-0.4, 0.4);
          const orbitDir = i % 2 === 0 ? 1 : -1;
          const x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.9;
          const y = H / 2 + Math.sin(a) * orbitRadius;
          const heading = a + (orbitDir * Math.PI) / 2;
          const nodes = new Float32Array(SHARK_NODES * 2);
          const seg = length / (SHARK_NODES - 1);
          for (let n = 0; n < SHARK_NODES; n++) {
            nodes[n * 2] = x - Math.cos(heading) * seg * n;
            nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
          }
          this.sharks.push({
            id: i + 1,
            kind,
            length,
            nodes,
            heading,
            speed: 30,
            phase: rand(0, TAU),
            turn: 0,
            hunger: rand(0.25, 0.75),
            wander: 0,
            orbitDir,
            orbitRadius,
            target: null,
            retargetAt: 0,
            depth: size,
            spook: 0,
            spookFrom: null,
          });
        }
        this.sharks.sort((a, b) => a.length - b.length);

        const total = clamp(Math.round((W * H) / 9000), 60, 150);
        this.fish = [];
        while (this.fish.length < total) {
          const species = pickSpecies();
          const sp = SPECIES[species];
          const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), total - this.fish.length);
          const millDir = Math.random() < 0.5 ? 1 : -1;
          const cx = rand(W * 0.06, W * 0.94);
          const cy = rand(H * 0.08, H * 0.92);
          const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);
          for (let k = 0; k < size; k++) {
            this.fish.push({
              x: cx + rand(-1, 1) * this.sepX[species] * Math.sqrt(size),
              y: cy + rand(-1, 1) * this.sepY[species] * Math.sqrt(size) * 0.6,
              vx: Math.cos(dir) * sp.cruise,
              vy: Math.sin(dir) * sp.cruise,
              species,
              alarm: 0,
              alive: true,
              respawnAt: 0,
              phase: rand(0, TAU),
              turn: 0,
              depth: rand(0.55, 1),
              millDir,
            });
          }
        }
      }

      step(dt) {
        this.time += dt;
        this.stepFish(dt);
        this.stepSharks(dt);
        this.respawn();
        if (this.ripples.length) {
          this.ripples = this.ripples.filter((r) => this.time - r.born < r.life);
        }
      }

      stepFish(dt) {
        const fish = this.fish;
        const sharks = this.sharks;
        const pointer = this.pointer;
        const W = this.width;
        const H = this.height;
        const R = this.perception;
        const R2 = R * R;
        const foreignSep = this.foreignSep;
        const cur = this.tmp;
        const calmDecay = Math.exp(-dt * 0.7);
        const contagion = Math.min(1, dt * 6);

        for (let i = 0; i < fish.length; i++) {
          const f = fish[i];
          if (!f.alive) continue;
          const sp = SPECIES[f.species];
          const spread = 1 + 1.8 * f.alarm;
          const sepX = this.sepX[f.species] * spread;
          const sepY = this.sepY[f.species] * spread;

          const speed = Math.hypot(f.vx, f.vy) || 1;
          const hx = f.vx / speed;
          const hy = f.vy / speed;

          let ax = 0;
          let ay = 0;
          let sx = 0;
          let sy = 0;
          let avx = 0;
          let avy = 0;
          let cx = 0;
          let cy = 0;
          let n = 0;
          let neighbourAlarm = 0;

          for (let j = 0; j < fish.length; j++) {
            if (j === i) continue;
            const o = fish[j];
            if (!o.alive) continue;
            const dx = o.x - f.x;
            const dy = o.y - f.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= R2 || d2 <= 1e-6) continue;
            const d = Math.sqrt(d2);
            if ((dx * hx + dy * hy) / d <= BLIND_COS) continue;
            const qx = dx / sepX;
            const qy = dy / sepY;
            const q2 = qx * qx + qy * qy;
            if (q2 < 1) {
              const q = Math.sqrt(q2) || 1e-3;
              const k = (1 - q) / q;
              sx -= qx * k;
              sy -= qy * k;
            }
            if (o.species === f.species) {
              avx += o.vx;
              avy += o.vy;
              cx += dx;
              cy += dy;
              n++;
            } else if (d < foreignSep) {
              const k = ((1 - d / foreignSep) / d) * 0.6;
              sx -= dx * k;
              sy -= dy * k;
            }
            if (o.alarm > neighbourAlarm) neighbourAlarm = o.alarm;
          }

          ax += sx * FISH_SEPARATION_K;
          ay += sy * FISH_SEPARATION_K;
          if (n > 0) {
            const alignK = FISH_ALIGN_K * sp.align;
            const cohesionK = FISH_COHESION_K * sp.cohesion * (1 - 0.8 * f.alarm);
            ax += (avx / n - f.vx) * alignK + (cx / n) * cohesionK;
            ay += (avy / n - f.vy) * alignK + (cy / n) * cohesionK;
            if (sp.mill > 0) {
              const cl = Math.hypot(cx, cy) || 1;
              ax += (-cy / cl) * f.millDir * sp.mill * (1 - f.alarm);
              ay += (cx / cl) * f.millDir * sp.mill * (1 - f.alarm);
            }
          }

          // Predators: flee the nearest point on the shark's front half.
          let fear = 0;
          for (const sh of sharks) {
            const fearR = sh.length * 0.6 + 60;
            let best = Infinity;
            let bx = 0;
            let by = 0;
            for (let k = 0; k <= 12; k += 3) {
              const nx = sh.nodes[k * 2];
              const ny = sh.nodes[k * 2 + 1];
              const d2 = (f.x - nx) ** 2 + (f.y - ny) ** 2;
              if (d2 < best) {
                best = d2;
                bx = nx;
                by = ny;
              }
            }
            const d = Math.sqrt(best);
            if (d >= fearR || d < 1e-3) continue;
            let w = 1 - d / fearR;
            w *= w;
            const awayX = (f.x - bx) / d;
            const awayY = (f.y - by) / d;
            const shx = Math.cos(sh.heading);
            const shy = Math.sin(sh.heading);
            const side = shx * (f.y - sh.nodes[1]) - shy * (f.x - sh.nodes[0]) >= 0 ? 1 : -1;
            ax += (awayX * 0.7 - shy * side * 0.9) * FISH_FLEE_K * w;
            ay += (awayY * 0.7 + shx * side * 0.9) * FISH_FLEE_K * w;
            fear = Math.max(fear, Math.sqrt(w));
          }

          if (pointer.active) {
            const pr = 130;
            const dx = f.x - pointer.x;
            const dy = f.y - pointer.y;
            const d = Math.hypot(dx, dy);
            if (d < pr && d > 1e-3) {
              const w = (1 - d / pr) ** 2;
              ax += (dx / d) * FISH_FLEE_K * w;
              ay += (dy / d) * FISH_FLEE_K * w;
              fear = Math.max(fear, Math.sqrt(w) * 0.8);
            }
          }

          let alarm = Math.max(f.alarm * calmDecay, fear);
          const relayed = neighbourAlarm * 0.86;
          if (relayed > alarm) alarm += (relayed - alarm) * contagion;
          f.alarm = alarm;

          const m = 36;
          if (f.x < m) ax += (m - f.x) * 7;
          else if (f.x > W - m) ax -= (f.x - (W - m)) * 7;
          if (f.y < m) ay += (m - f.y) * 7;
          else if (f.y > H - m) ay -= (f.y - (H - m)) * 7;

          current(f.x, f.y, this.time, cur);
          ax += cur.x * 0.5 + (Math.random() - 0.5) * sp.jitter;
          ay += cur.y * 0.5 + (Math.random() - 0.5) * sp.jitter;
          ay -= f.vy * sp.verticalDrag * (1 - 0.7 * f.alarm);

          const preferred = sp.cruise * (1 + 1.3 * f.alarm);
          ax += (preferred - speed) * hx * 1.6;
          ay += (preferred - speed) * hy * 1.6;

          const before = Math.atan2(f.vy, f.vx);
          f.vx += ax * dt;
          f.vy += ay * dt;
          const maxSpeed = sp.maxSpeed * (1 + 1.8 * f.alarm);
          const s = Math.hypot(f.vx, f.vy);
          if (s > maxSpeed) {
            f.vx *= maxSpeed / s;
            f.vy *= maxSpeed / s;
          } else if (s < sp.minSpeed && s > 1e-3) {
            f.vx *= sp.minSpeed / s;
            f.vy *= sp.minSpeed / s;
          }
          f.turn += (angleDiff(before, Math.atan2(f.vy, f.vx)) / dt - f.turn) * Math.min(1, dt * 8);
          f.phase += dt * (7 + Math.hypot(f.vx, f.vy) * 0.12);
          f.x = clamp(f.x + f.vx * dt, -60, W + 60);
          f.y = clamp(f.y + f.vy * dt, -60, H + 60);
        }
      }

      stepSharks(dt) {
        const sharks = this.sharks;
        const W = this.width;
        const H = this.height;
        const time = this.time;
        const minSide = Math.min(W, H);
        const cxW = W / 2;
        const cyW = H / 2;

        for (const sh of sharks) {
          const L = sh.length;
          const nodes = sh.nodes;
          const hx = nodes[0];
          const hy = nodes[1];

          sh.hunger = Math.min(1, sh.hunger + dt * 0.03);

          let dx = Math.cos(sh.heading);
          let dy = Math.sin(sh.heading);

          sh.wander = clamp(sh.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
          dx += Math.cos(sh.heading + sh.wander) * 0.45;
          dy += Math.sin(sh.heading + sh.wander) * 0.45;

          if (time >= sh.retargetAt) {
            sh.target = this.findPrey(sh);
            sh.retargetAt = time + 0.45;
          }
          const t = sh.target;
          let hunting = false;
          let closing = 0;
          if (t && t.alive && sh.hunger > 0.3) {
            const tx = t.x + t.vx * 0.35 - hx;
            const ty = t.y + t.vy * 0.35 - hy;
            const d = Math.hypot(tx, ty) || 1;
            const w = 1.4 + 2.6 * sh.hunger;
            dx += (tx / d) * w;
            dy += (ty / d) * w;
            hunting = true;
            closing = clamp(1 - d / (L * 0.9), 0, 1);
          } else {
            const rx = (hx - cxW) / (W / minSide);
            const ry = hy - cyW;
            const r = Math.hypot(rx, ry) || 1;
            const radius = sh.orbitRadius * (1 + 0.15 * Math.sin(time * 0.05 + sh.id));
            const radial = clamp((radius - r) / radius, -1, 1);
            dx += ((-ry / r) * sh.orbitDir + (rx / r) * radial * 0.9) * 0.55;
            dy += ((rx / r) * sh.orbitDir + (ry / r) * radial * 0.9) * 0.55;
          }

          for (const other of sharks) {
            if (other === sh) continue;
            for (let k = 0; k < SHARK_NODES; k += 4) {
              const ox = hx - other.nodes[k * 2];
              const oy = hy - other.nodes[k * 2 + 1];
              const d = Math.hypot(ox, oy);
              const range = (L + other.length) * 0.45;
              if (d < range && d > 1e-3) {
                const w = (1 - d / range) * 3;
                dx += (ox / d) * w;
                dy += (oy / d) * w;
              }
            }
          }

          // Keep the headline mostly clear: a soft elliptical no-swim zone.
          const ex = (hx - cxW) / (W * 0.3);
          const ey = (hy - cyW) / (H * 0.16);
          const e2 = ex * ex + ey * ey;
          if (e2 < 1) {
            const e = Math.sqrt(e2) || 1e-3;
            const w = (1 - e) * (hunting ? 1 : 2.5);
            dx += (ex / e) * w;
            dy += (ey / e) * w;
          }

          const over = Math.max(-hx, hx - W, -hy, hy - H);
          if (over > -L * 0.05) {
            const w = clamp((over + L * 0.05) / (L * 0.35), 0, 1) * 3.5;
            const toX = cxW - hx;
            const toY = cyW - hy;
            const d = Math.hypot(toX, toY) || 1;
            dx += (toX / d) * w;
            dy += (toY / d) * w;
          }

          // A click on the body spooks it: dart away from where it was hit.
          if (sh.spook > 0 && sh.spookFrom) {
            const away = Math.atan2(hy - sh.spookFrom.y, hx - sh.spookFrom.x);
            dx += Math.cos(away) * 3.4 * sh.spook;
            dy += Math.sin(away) * 3.4 * sh.spook;
            sh.spook = Math.max(0, sh.spook - dt * 1.3);
          }

          const desired = Math.atan2(dy, dx);
          const agility = Math.min(hunting ? 1.7 + closing : 0.8, sh.speed / (L * 0.22)) + sh.spook * 1.2;
          const maxTurn = agility * dt;
          const turned = clamp(angleDiff(sh.heading, desired), -maxTurn, maxTurn);
          sh.heading += turned;
          sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);

          const cruise = (30 + L * 0.04) * (1 + sh.spook * 0.9);
          const targetSpeed = hunting ? cruise * (1.45 + closing * 1.5) : cruise;
          sh.speed += (targetSpeed - sh.speed) * Math.min(1, dt * 1.1);
          sh.phase += dt * (2 + sh.speed / 24);

          nodes[0] += Math.cos(sh.heading) * sh.speed * dt;
          nodes[1] += Math.sin(sh.heading) * sh.speed * dt;

          const seg = L / (SHARK_NODES - 1);
          const maxBend = 0.16;
          let prevAngle = sh.heading + Math.PI;
          for (let k = 1; k < SHARK_NODES; k++) {
            const px = nodes[(k - 1) * 2];
            const py = nodes[(k - 1) * 2 + 1];
            let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
            angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
            nodes[k * 2] = px + Math.cos(angle) * seg;
            nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
            prevAngle = angle;
          }

          if (sh.hunger > 0.15) {
            const mouthR = L * 0.05 + 8;
            const mx = nodes[0];
            const my = nodes[1];
            for (const f of this.fish) {
              if (!f.alive) continue;
              if ((f.x - mx) ** 2 + (f.y - my) ** 2 < mouthR * mouthR) {
                f.alive = false;
                f.respawnAt = time + rand(3, 8);
                sh.hunger = Math.max(0, sh.hunger - 0.16);
                this.events.push({ kind: "eat", x: f.x, y: f.y });
              }
            }
          }
        }
      }

      findPrey(sh) {
        const range = sh.length * 0.9 + 160;
        const hx = sh.nodes[0];
        const hy = sh.nodes[1];
        const fx = Math.cos(sh.heading);
        const fy = Math.sin(sh.heading);
        let best = null;
        let bestScore = Infinity;
        for (const f of this.fish) {
          if (!f.alive) continue;
          const dx = f.x - hx;
          const dy = f.y - hy;
          const d = Math.hypot(dx, dy);
          if (d > range || d < 1e-3) continue;
          const cos = (dx * fx + dy * fy) / d;
          if (cos < 0.2) continue;
          const score = d * (1 + (1 - cos) * 0.8);
          if (score < bestScore) {
            bestScore = score;
            best = f;
          }
        }
        return best;
      }

      respawn() {
        const time = this.time;
        const W = this.width;
        const H = this.height;
        const due = [];
        for (const f of this.fish) if (!f.alive && f.respawnAt <= time) due.push(f);
        if (due.length === 0) return;
        const side = randInt(0, 3);
        const along = rand(0.15, 0.85);
        const x = side === 0 ? -20 : side === 1 ? W + 20 : along * W;
        const y = side === 2 ? -20 : side === 3 ? H + 20 : along * H;
        const inward = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);
        const species = pickSpecies();
        const sp = SPECIES[species];
        const millDir = Math.random() < 0.5 ? 1 : -1;
        for (const f of due) {
          f.alive = true;
          f.species = species;
          f.alarm = 0;
          f.turn = 0;
          f.millDir = millDir;
          f.x = x + rand(-1, 1) * this.perception;
          f.y = y + rand(-1, 1) * this.perception;
          f.vx = Math.cos(inward) * sp.cruise * 1.4;
          f.vy = Math.sin(inward) * sp.cruise * 1.4;
        }
      }
    }

    // ────────────────────────────────────────────────────────── renderer

    const EDGE_HEAVY = ":;";
    const EDGE_LIGHT = ".',`";
    const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

    const FLAG_BODY = 1;
    const FLAG_EDGE = 2;
    const FLAG_FIN = 3;
    const FLAG_RIDGE = 4;
    const FLAG_EYE = 5;

    const ALPHA_LEVELS = 6;

    // ───────────────────────────────────────────────────────── settings

    /** Editable defaults. The corner panel writes overrides to localStorage. */
    const DEFAULT_SETTINGS = {
      heroOpacity: 1,
      idleOpacity: 0.1,
      linkOpacity: false, // 首屏与会话共用一个不透明度
      cellSize: 0, // 0 = 跟随窗口自适应
      species: "shark", // shark | mixed | koi | goldfish
      theme: "auto", // auto | dark | light
      transparent: false, // 只画鱼和点阵，不铺底色
      background: "#05080f",
      grid: 0.05,
      koiColor: "#d93a2b",
      goldfishColor: "#f0a02a",
      sharkColor: "#a9c2f2",
      dotPrimary: "#3034eb",
      dotSecondary: "#bed4ff",
      dotDensity: 0.13,
      accent: "#33c8cc",
    };

    const SETTINGS_KEY = "dsh-ascii-ocean/settings/v1";

    function hexToRgb(hex) {
      const raw = String(hex || "").trim().replace(/^#/, "");
      const full = raw.length === 3 ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2] : raw;
      const value = parseInt(full, 16);
      if (full.length !== 6 || !Number.isFinite(value)) return [255, 255, 255];
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }

    /** [r, g, b] → "rgb(r,g,b)" for canvas styles. */
    function cssRgb(rgb) {
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }

    /** Linear blend between two [r, g, b] triplets. */
    function mixRgb(a, b, t) {
      return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
      ];
    }

    function readSettings() {
      const out = Object.assign({}, DEFAULT_SETTINGS);
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        if (raw) Object.assign(out, JSON.parse(raw));
      } catch (err) {
        /* private mode or bad JSON: keep the defaults */
      }
      return out;
    }

    function writeSettings(settings) {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (err) {
        /* storage unavailable: the panel still works for this session */
      }
    }

    /** Koi: blunt head, deep chest, long body, broad fan tail. */
    function koiHalfWidth(s) {
      if (s < 0.2) return 0.022 + 0.088 * smoothstep(0, 0.2, s);
      if (s < 0.44) return 0.11 + 0.012 * smoothstep(0.2, 0.44, s);
      if (s < 0.8) return 0.02 + 0.102 * Math.pow(1 - (s - 0.44) / 0.36, 0.95);
      const k = (s - 0.8) / 0.2;
      return 0.032 * (1 - k) + 0.008 * Math.sin(k * Math.PI);
    }

    /** Goldfish: egg-shaped, short body, big flowing tail. */
    function goldfishHalfWidth(s) {
      if (s < 0.26) return 0.028 + 0.105 * Math.pow(smoothstep(0, 0.26, s), 0.75);
      if (s < 0.52) return 0.133 + 0.016 * Math.sin(((s - 0.26) / 0.26) * Math.PI);
      if (s < 0.82) return 0.022 + 0.112 * Math.pow(1 - (s - 0.52) / 0.3, 0.85);
      const k = (s - 0.82) / 0.18;
      return 0.04 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
    }

    /** Top-down half-width of the classic shark. */
    function classicHalfWidth(s) {
      if (s < 0.13) return 0.09 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.95);
      if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
      if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
      const k = (s - 0.84) / 0.16;
      return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
    }

    // Body glyphs are fish characters; the shape is carried by the cell colour.
    const KOI_GLYPHS = ["鲤", "鱼", "鲫", "鲢", "鳙", "鲷", "鲤", "鳞"];
    const GOLD_GLYPHS = ["金", "鱼", "鲫", "鲤", "鳞", "鱼", "锦", "鲱"];
    const SHARK_GLYPHS = [":", ";", "t", "%", "S", "X", "8", "#", "@"];
    const FIN_GLYPHS_CJK = ["鳍", "尾", "游", "波", "鳞"];
    const PATCH_GLYPHS_CJK = ["锦", "白", "雪", "鳞"];
    const CJK_FONT = '"Microsoft YaHei", "PingFang SC", "Source Han Sans SC", "Noto Sans SC", sans-serif';
    const RIDGE_GLYPHS_CJK = ["锦", "鳞", "金"];

    /**
     * One entry per creature kind. `tail` is a triangle in (s, |v|) space:
     * [rootA, rootB, tipS, reach].
     */
    const SHAPES = {
      koi: {
        halfWidth: koiHalfWidth,
        pectoral: [0.2, 0.38, 0.52, 0.32],
        falcate: true,
        pelvic: [0.54, 0.62, 0.7, 0.13],
        tail: [0.78, 1.04, 0.92, 0.26],
        dorsal: [0.24, 0.48],
        secondDorsal: null,
        eye: [0.07, 0.11],
        gills: null,
        glyphs: { body: KOI_GLYPHS, patch: PATCH_GLYPHS_CJK, fin: FIN_GLYPHS_CJK, ridge: RIDGE_GLYPHS_CJK, eye: "目", edge: ["·", "…", "˙"] },
        swap: { fin: true },
        patch: { color: "#f7efe1", probability: 0.3 },
      },
      goldfish: {
        halfWidth: goldfishHalfWidth,
        pectoral: [0.22, 0.42, 0.56, 0.34],
        falcate: false,
        pelvic: [0.56, 0.66, 0.74, 0.14],
        tail: [0.74, 1.1, 0.9, 0.34],
        dorsal: [0.22, 0.46],
        secondDorsal: null,
        eye: [0.09, 0.14],
        gills: null,
        glyphs: { body: GOLD_GLYPHS, patch: PATCH_GLYPHS_CJK, fin: FIN_GLYPHS_CJK, ridge: RIDGE_GLYPHS_CJK, eye: "目", edge: ["·", "…", "˙"] },
        swap: { fin: true },
        patch: { color: "#ffe9a8", probability: 0.28 },
      },
      shark: {
        halfWidth: classicHalfWidth,
        pectoral: [0.15, 0.43, 0.55, 0.26],
        falcate: true,
        pelvic: [0.57, 0.65, 0.69, 0.085],
        tail: [0.86, 0.95, 1, 0.085],
        dorsal: [0.33, 0.47],
        secondDorsal: [0.71, 0.76],
        eye: [0.1, 0.14],
        gills: [0.19, 0.29],
        glyphs: { body: SHARK_GLYPHS, fin: ["%", ";", "t", "S", ":"], ridge: ["@", "8", "%"], eye: "o", edge: null, ordered: true },
        swap: { fin: false },
        patch: null,
      },
    };

    const KINDS = Object.keys(SHAPES);

    function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
      const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
      const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
      const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(neg && pos);
    }

    class AsciiRenderer {
      constructor(canvas) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("2D canvas unavailable");
        this.ctx = ctx;
        this.dpr = 1;
        this.width = 0;
        this.height = 0;
        this.cw = 12;
        this.ch = 18;
        this.cols = 0;
        this.rows = 0;
        this.fontFamily = "ui-monospace, Menlo, monospace";
        this.dotKind = new Uint8Array(0);
        this.dotPhase = new Float32Array(0);
        this.dotFreq = new Float32Array(0);
        this.energy = new Float32Array(0);
        this.energyTmp = new Float32Array(0);
        this.heat = new Float32Array(0);
        this.sharkFlag = new Uint8Array(0);
        this.sharkShade = new Float32Array(0);
        this.sharkKey = new Uint32Array(0);
        this.sharkDepth = new Float32Array(0);
        this.sharkKind = new Uint8Array(0);
        this.sharkPatch = new Uint8Array(0);
        this.shape = SHAPES.koi;
        this.spine = new Float32Array(SHARK_NODES * 2);
        this.arc = new Float32Array(SHARK_NODES);
        this.arcTotal = 1;
        this.sharkId = 0;
        this.finTipLeft = 0;
        this.finTipRight = 0;
        this.hitFlag = 0;
        this.hitShade = 0;
        this.hitS = 0;
        this.hitV = 0;
        this.hitDist = 0;
        this.settings = readSettings();
        this.light = false;
        this.transparent = false;
        this.dotRGB = [];
        this.dotStyles = [];
        this.accent = "#33c8cc";
        this.bgColor = "#05080f";
        this.gridAlpha = 0.05;
        this.dotDensity = 0.13;
        this.applyPalette();
      }

      /**
       * Rebuild every string derived from the settings (runs on each tweak).
       * `light` comes from the host surface: the same swatches are re-derived
       * for a paper-coloured page, and `transparent` drops the fill entirely.
       */
      applyPalette() {
        const s = this.settings;
        const light = this.light;
        const dots = light
          ? [mixRgb(hexToRgb(s.dotPrimary), [20, 28, 48], 0.45), mixRgb(hexToRgb(s.dotSecondary), [30, 45, 80], 0.55)]
          : [hexToRgb(s.dotPrimary), hexToRgb(s.dotSecondary)];
        this.dotRGB = [dots[0], dots[1], light ? [40, 120, 170] : [110, 230, 255]];
        this.dotStyles = [];
        for (const [r, g, b] of this.dotRGB) {
          for (let l = 0; l < ALPHA_LEVELS; l++) {
            this.dotStyles.push(`rgba(${r},${g},${b},${(((l + 1) / ALPHA_LEVELS)).toFixed(3)})`);
          }
        }
        // Each kind shades from its own base colour into light belly / dark back.
        const bases = {
          koi: s.koiColor || "#d93a2b",
          goldfish: s.goldfishColor || "#f0a02a",
          shark: s.sharkColor || "#a9c2f2",
        };
        for (const key of KINDS) {
          const shape = SHAPES[key];
          const base = hexToRgb(bases[key] || "#d93a2b");
          shape.rgb = light
            ? {
                base,
                dark: mixRgb(base, [30, 10, 6], 0.42),
                light: mixRgb(base, [255, 252, 246], 0.32),
                patch: shape.patch ? hexToRgb(shape.patch.color) : null,
              }
            : {
                base,
                dark: mixRgb(base, [46, 7, 5], 0.55),
                light: mixRgb(base, [255, 236, 218], 0.24),
                patch: shape.patch ? hexToRgb(shape.patch.color) : null,
              };
        }
        this.accent = light ? cssRgb(mixRgb(hexToRgb(s.accent), [10, 40, 80], 0.4)) : s.accent;
        this.transparent = !!s.transparent;
        this.bgColor = this.transparent
          ? null
          : cssRgb(
              light
                ? mixRgb(hexToRgb(s.background), [255, 253, 248], 0.94)
                : hexToRgb(s.background),
            );
        this.gridAlpha = Number(s.grid) || 0;
        this.dotDensity = clamp(Number(s.dotDensity) || 0, 0, 1);
      }

      /** Called by the engine when the host surface changes (theme / transparency). */
      setLight(light) {
        if (this.light === light) return;
        this.light = light;
        this.applyPalette();
      }

      updateSettings(patch) {
        this.settings = Object.assign({}, this.settings, patch);
        this.applyPalette();
        this.refreshDots();
        return this.settings;
      }

      /** Re-place ambient dots after a density change. */
      refreshDots() {
        const n = this.cols * this.rows;
        if (!n) return;
        for (let i = 0; i < n; i++) {
          const col = i % this.cols;
          const row = (i / this.cols) | 0;
          const r = hash3(col, row, 23);
          this.dotKind[i] = r < this.dotDensity ? (hash3(col, row, 11) < 0.58 ? 1 : 2) : 0;
        }
      }

      get cellWidth() {
        return this.cw;
      }

      get cellHeight() {
        return this.ch;
      }

      setFontFamily(family) {
        if (family) this.fontFamily = family;
      }

      resize(width, height, dpr) {
        this.width = width;
        this.height = height;
        this.dpr = dpr;
        const fixedCell = Number(this.settings.cellSize) || 0;
        // Hanzi need wider cells than the ASCII ramp to stay legible.
        const density = this.settings.species === "shark" ? 124 : 88;
        this.cw = fixedCell > 0 ? clamp(Math.round(fixedCell), 6, 24) : clamp(Math.round(width / density), 9, 20);
        // Hanzi read better in near-square cells; the ASCII ramp likes tall ones.
        const tall = this.settings.species === "shark";
        this.ch = Math.round(this.cw * (tall ? 1.45 : 1.18));
        this.cols = Math.ceil(width / this.cw);
        this.rows = Math.ceil(height / this.ch);
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);

        const n = this.cols * this.rows;
        this.dotKind = new Uint8Array(n);
        this.dotPhase = new Float32Array(n);
        this.dotFreq = new Float32Array(n);
        this.energy = new Float32Array(n);
        this.energyTmp = new Float32Array(n);
        this.heat = new Float32Array(n);
        this.sharkFlag = new Uint8Array(n);
        this.sharkShade = new Float32Array(n);
        this.sharkKey = new Uint32Array(n);
        this.sharkDepth = new Float32Array(n);
        this.sharkKind = new Uint8Array(n);
        this.sharkPatch = new Uint8Array(n);

        this.refreshDots();
        for (let i = 0; i < n; i++) {
          const col = i % this.cols;
          const row = (i / this.cols) | 0;
          const r = hash3(col, row, 23);
          this.dotPhase[i] = r * TAU;
          this.dotFreq[i] = 0.3 + hash3(col, row, 37) * 1.1;
        }
      }

      render(world, dt) {
        const ctx = this.ctx;
        const cols = this.cols;
        if (cols === 0) return;
        const t = world.time;

        this.consumeEvents(world);
        this.rasterizeSharks(world.sharks, t);
        this.depositWake(world);
        this.diffuse(dt);

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        if (this.bgColor) {
          ctx.fillStyle = this.bgColor;
          ctx.fillRect(0, 0, this.width, this.height);
        } else {
          ctx.clearRect(0, 0, this.width, this.height);
        }

        this.paintGrid();

        ctx.font = `600 ${Math.round(this.ch * 0.74)}px ${this.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        this.drawDots(t);
        this.drawHeat();
        this.drawFish();
        this.drawSharks(t);
        this.drawRipples(t);
      }

      paintGrid() {
        const ctx = this.ctx;
        const cols = this.cols;
        const rows = this.rows;
        const cw = this.cw;
        const ch = this.ch;
        if (this.gridAlpha <= 0) return;
        ctx.strokeStyle = this.light
          ? `rgba(40,60,100,${this.gridAlpha})`
          : `rgba(150,190,255,${this.gridAlpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let c = 0; c <= cols; c++) {
          const x = Math.round(c * cw) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, rows * ch);
        }
        for (let r = 0; r <= rows; r++) {
          const y = Math.round(r * ch) + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(cols * cw, y);
        }
        ctx.stroke();
      }

      // ── simulation → field ─────────────────────────────────────────

      cellIndex(x, y) {
        const c = Math.floor(x / this.cw);
        const r = Math.floor(y / this.ch);
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
        return r * this.cols + c;
      }

      stamp(field, x, y, radius, amount) {
        const c0 = Math.floor(x / this.cw);
        const r0 = Math.floor(y / this.ch);
        for (let r = r0 - radius; r <= r0 + radius; r++) {
          for (let c = c0 - radius; c <= c0 + radius; c++) {
            if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
            const d = Math.hypot(c - c0, (r - r0) * 1.4);
            if (d > radius + 0.5) continue;
            const i = r * this.cols + c;
            field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
          }
        }
      }

      consumeEvents(world) {
        for (const e of world.events) {
          if (e.kind === "eat") {
            this.stamp(this.heat, e.x, e.y, 2, 1);
            this.stamp(this.energy, e.x, e.y, 3, 0.9);
          } else if (e.kind === "startle") {
            this.stamp(this.energy, e.x, e.y, 2, 0.8);
          } else {
            this.stamp(this.energy, e.x, e.y, 6, 1.4);
          }
        }
        world.events.length = 0;
      }

      depositWake(world) {
        const energy = this.energy;
        for (const f of world.fish) {
          if (!f.alive) continue;
          const i = this.cellIndex(f.x, f.y);
          if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.012 + f.alarm * 0.03);
        }
        for (const sh of world.sharks) {
          for (let k = SHARK_NODES - 6; k < SHARK_NODES; k++) {
            const i = this.cellIndex(sh.nodes[k * 2], sh.nodes[k * 2 + 1]);
            if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.05 + sh.speed * 0.0012);
          }
        }
      }

      /** Blur + decay so wakes spread out like ripples and fade. */
      diffuse(dt) {
        const cols = this.cols;
        const rows = this.rows;
        const energy = this.energy;
        const tmp = this.energyTmp;
        const heat = this.heat;
        const decay = Math.exp(-dt * 1.5);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const l = c > 0 ? energy[i - 1] : energy[i];
            const rt = c < cols - 1 ? energy[i + 1] : energy[i];
            const u = r > 0 ? energy[i - cols] : energy[i];
            const d = r < rows - 1 ? energy[i + cols] : energy[i];
            tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
          }
        }
        this.energy = tmp;
        this.energyTmp = energy;
        const heatDecay = Math.exp(-dt * 2.2);
        for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
      }

      // ── sharks ─────────────────────────────────────────────────────

      sampleShark(px, py, L) {
        const spine = this.spine;
        const arc = this.arc;
        const N = SHARK_NODES;
        let best = Infinity;
        let bestS = 0;
        let bestSign = 1;
        let bestNx = 0;
        let bestNy = 0;
        for (let k = 0; k < N - 1; k++) {
          const ax = spine[k * 2];
          const ay = spine[k * 2 + 1];
          const sx = spine[(k + 1) * 2] - ax;
          const sy = spine[(k + 1) * 2 + 1] - ay;
          const len2 = sx * sx + sy * sy || 1;
          const u = clamp(((px - ax) * sx + (py - ay) * sy) / len2, 0, 1);
          const qx = ax + sx * u;
          const qy = ay + sy * u;
          const d2 = (px - qx) ** 2 + (py - qy) ** 2;
          if (d2 < best) {
            best = d2;
            const len = Math.sqrt(len2);
            bestS = (arc[k] + u * len) / this.arcTotal;
            bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
            bestNx = (-sy / len) * bestSign;
            bestNy = (sx / len) * bestSign;
          }
        }

        const a = Math.sqrt(best);
        const s = bestS;
        const u = s * L;
        const shape = this.shape;
        const w = shape.halfWidth(s) * L;
        this.hitDist = a;
        this.hitS = s;
        this.hitV = a * bestSign;

        if (a <= w) {
          const across = a / (w || 1);
          const facing = (bestNx * -0.6 + bestNy * -0.8) * across;
          let shade = 0.58 - across * across * 0.42 + facing * 0.26;
          let flag = FLAG_BODY;
          if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {
            flag = FLAG_RIDGE;
            shade = 1;
          } else if (shape.secondDorsal && s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {
            shade = Math.max(shade, 0.82);
          } else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) {
            flag = FLAG_EYE;
            shade = 0;
          } else if (shape.gills && s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
            if (Math.floor(((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0])) * 5) % 2 === 0) shade *= 0.45;
          } else if (s < 0.05) {
            shade = Math.max(shade, 0.7);
          }
          this.hitFlag = flag;
          this.hitShade = shade;
          return true;
        }

        const tip = bestSign > 0 ? this.finTipRight : this.finTipLeft;
        const p = shape.pectoral;
        if (
          inTriangle(u, a, L * p[0], 0, L * p[1], 0, L * p[2], tip) &&
          !(shape.falcate && inTriangle(u, a, L * p[1], 0, L * (p[1] + (p[2] - p[1]) * 0.33), tip * 0.55, L * p[2], tip))
        ) {
          this.hitFlag = FLAG_FIN;
          this.hitShade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1));
          return true;
        }
        const v = shape.pelvic;
        const tail = shape.tail;
        if (
          inTriangle(u, a, L * v[0], 0, L * v[1], 0, L * v[2], L * v[3]) ||
          (tail && inTriangle(u, a, L * tail[0], 0, L * tail[1], 0, L * tail[2], L * tail[3]))
        ) {
          this.hitFlag = FLAG_FIN;
          this.hitShade = 0.36;
          return true;
        }
        return false;
      }

      rasterizeSharks(sharks, t) {
        const sharkFlag = this.sharkFlag;
        const sharkShade = this.sharkShade;
        const sharkKey = this.sharkKey;
        const sharkDepth = this.sharkDepth;
        const sharkKind = this.sharkKind;
        const sharkPatch = this.sharkPatch;
        const spine = this.spine;
        const arc = this.arc;
        const cw = this.cw;
        const ch = this.ch;
        const cols = this.cols;
        const rows = this.rows;
        sharkFlag.fill(0);

        for (const sh of sharks) {
          const L = sh.length;
          const N = SHARK_NODES;
          const n = sh.nodes;
          const swim = clamp(sh.speed / 60, 0.4, 1.4);
          const kindIndex = Math.max(0, KINDS.indexOf(sh.kind));
          this.shape = SHAPES[sh.kind] || SHAPES.koi;
          this.sharkId = sh.id;

          for (let k = 0; k < N; k++) {
            const s = k / (N - 1);
            const a = Math.max(0, k - 1);
            const b = Math.min(N - 1, k + 1);
            let tx = n[a * 2] - n[b * 2];
            let ty = n[a * 2 + 1] - n[b * 2 + 1];
            const tl = Math.hypot(tx, ty) || 1;
            tx /= tl;
            ty /= tl;
            const amp = L * 0.05 * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim;
            const off = amp * Math.sin(sh.phase - s * 5.2);
            spine[k * 2] = n[k * 2] - ty * off;
            spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
          }
          arc[0] = 0;
          for (let k = 1; k < N; k++) {
            arc[k] =
              arc[k - 1] +
              Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
          }
          this.arcTotal = arc[N - 1] || 1;

          const bank = clamp(sh.turn * 0.45, -0.35, 0.35);
          const flex = 1 + 0.06 * Math.sin(sh.phase * 0.5);
          const reachFin = this.shape.pectoral[3];
          this.finTipRight = L * reachFin * flex * (1 - bank);
          this.finTipLeft = L * reachFin * flex * (1 + bank);

          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (let k = 0; k < N; k++) {
            minX = Math.min(minX, spine[k * 2]);
            maxX = Math.max(maxX, spine[k * 2]);
            minY = Math.min(minY, spine[k * 2 + 1]);
            maxY = Math.max(maxY, spine[k * 2 + 1]);
          }
          const reach = L * 0.36;
          const c0 = Math.max(0, Math.floor((minX - reach) / cw));
          const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
          const r0 = Math.max(0, Math.floor((minY - reach) / ch));
          const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
          if (c0 > c1 || r0 > r1) continue;

          const skipBeyond = reach + Math.hypot(cw, ch);

          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              const x = c * cw;
              const y = r * ch;
              const centerHit = this.sampleShark(x + cw / 2, y + ch / 2, L);
              if (!centerHit && this.hitDist > skipBeyond) continue;
              const flag = this.hitFlag;
              const shade = this.hitShade;
              const s = this.hitS;
              const v = this.hitV;

              let hits = centerHit ? 1 : 0;
              for (let k = 0; k < SUBSAMPLES.length; k += 2) {
                if (this.sampleShark(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch, L)) hits++;
              }
              if (hits === 0) continue;
              const coverage = hits / 5;

              const i = r * cols + c;
              const key = (hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295) >>> 0;
              sharkKey[i] = key;
              sharkDepth[i] = sh.depth;
              sharkKind[i] = kindIndex;
              sharkPatch[i] =
                this.shape.patch &&
                hash3(Math.floor(s * 7), Math.floor(v / (ch * 1.2)), sh.id + 3) >
                  1 - this.shape.patch.probability
                  ? 1
                  : 0;

              if (centerHit && coverage >= 0.4) {
                sharkFlag[i] = flag;
                const flicker = (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.06;
                sharkShade[i] = clamp(shade + flicker, 0, 1);
              } else {
                sharkFlag[i] = FLAG_EDGE;
                sharkShade[i] = coverage;
              }
            }
          }
        }
      }

      drawSharks(t) {
        const ctx = this.ctx;
        const cols = this.cols;
        const cw = this.cw;
        const ch = this.ch;
        const sharkFlag = this.sharkFlag;
        const sharkShade = this.sharkShade;
        const sharkKey = this.sharkKey;
        const sharkDepth = this.sharkDepth;
        const sharkKind = this.sharkKind;
        const sharkPatch = this.sharkPatch;
        const n = cols * this.rows;

        // One pass per kind: the hanzi face is square and needs a bigger size
        // than the ASCII ramp, so the font is switched once per pass.
        for (let kk = 0; kk < KINDS.length; kk++) {
          const shape = SHAPES[KINDS[kk]];
          if (!shape) continue;
          const rgb = shape.rgb;
          const gl = shape.glyphs;
          const cjk = !gl.ordered;
          ctx.font = `600 ${Math.round(cjk ? cw * 0.82 : ch * 0.74)}px ${cjk ? CJK_FONT : this.fontFamily}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const spark = shape.patch ? "#fff2d6" : this.accent;

          for (let i = 0; i < n; i++) {
            if (sharkKind[i] !== kk) continue;
            const flag = sharkFlag[i];
            if (!flag) continue;
            const col = i % cols;
            const row = (i / cols) | 0;
            const x = col * cw;
            const y = row * ch;
            const key = sharkKey[i];
            const shade = sharkShade[i];
            const dim = 0.7 + 0.3 * sharkDepth[i];

            const tick = Math.floor(t * 2.4 + (key % 997) / 97);
            const roll = hash3(key, tick, 7);

            if (flag === FLAG_EDGE) {
              const g = ((70 + shade * 80) * dim) / 255;
              const edgeSet = gl.edge || (shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT);
              const edge = this.light ? mixRgb(rgb.dark, rgb.light, 0.45) : rgb.light;
              ctx.fillStyle =
                roll < 0.05
                  ? spark
                  : `rgb(${Math.round(edge[0] * g)},${Math.round(edge[1] * g)},${Math.round(edge[2] * g)})`;
              ctx.fillText(edgeSet[(key >>> 8) % edgeSet.length], x + cw / 2, y + ch / 2 + 1);
              continue;
            }

            // Skin: dark back → lit flank, with bright koi/ryukin patches.
            let k = clamp(shade, 0, 1);
            if (flag === FLAG_RIDGE) k = 1;
            else if (flag === FLAG_FIN) k = Math.min(1, k * 0.86 + 0.14);
            k = 0.28 + 0.72 * k * dim;

            let glyph;
            if (flag === FLAG_RIDGE) {
              glyph = gl.ridge[(key >>> 8) % gl.ridge.length];
            } else if (flag === FLAG_EYE) {
              glyph = gl.eye;
            } else if (flag === FLAG_FIN) {
              glyph = gl.fin[(key >>> 8) % gl.fin.length];
            } else if (gl.ordered) {
              const jitter = ((key >>> 4) % 3) - 1;
              glyph = gl.body[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, gl.body.length - 1)];
            } else if (sharkPatch[i] && gl.patch) {
              glyph = gl.patch[(key >>> 8) % gl.patch.length];
            } else {
              glyph = gl.body[(key >>> 8) % gl.body.length];
            }

            // Fish fins stay translucent: glyph only, no cell block, so the
            // solid body keeps a readable outline against them.
            if (flag === FLAG_FIN && shape.patch) {
              const fin = mixRgb(rgb.light, [255, 255, 255], 0.2);
              ctx.fillStyle = `rgb(${fin[0]},${fin[1]},${fin[2]})`;
              ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
              continue;
            }

            let fill;
            if (sharkPatch[i] && rgb.patch) {
              fill = [
                Math.round(rgb.patch[0] * (0.72 + 0.28 * k)),
                Math.round(rgb.patch[1] * (0.72 + 0.28 * k)),
                Math.round(rgb.patch[2] * (0.72 + 0.28 * k)),
              ];
            } else {
              fill = [
                Math.round(rgb.dark[0] + (rgb.light[0] - rgb.dark[0]) * k),
                Math.round(rgb.dark[1] + (rgb.light[1] - rgb.dark[1]) * k),
                Math.round(rgb.dark[2] + (rgb.light[2] - rgb.dark[2]) * k),
              ];
            }
            ctx.fillStyle = `rgb(${fill[0]},${fill[1]},${fill[2]})`;
            ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);

            let color;
            if (flag === FLAG_EYE) color = "#2a1c12";
            else if (roll < 0.02) color = spark;
            else if (roll < 0.045) color = "#ffffff";
            else color = k > 0.55 ? "#170d09" : "#2b1712";
            ctx.fillStyle = color;
            ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
          }
        }
      }

      // ── fish, dots, heat ───────────────────────────────────────────

      /** Expanding rings from a click: two lagging rings of characters. */
      drawRipples(t) {
        const world = this.world;
        if (!world || !world.ripples || world.ripples.length === 0) return;
        const ctx = this.ctx;
        const cols = this.cols;
        const rows = this.rows;
        const cw = this.cw;
        const ch = this.ch;
        const cjk = this.settings.species !== "shark";
        const glyphs = cjk ? ["○", "◎", "·", "˙"] : ["o", "O", ".", "'"];
        ctx.font = `600 ${Math.round(cw * 0.8)}px ${cjk ? CJK_FONT : this.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (const r of world.ripples) {
          const age = t - r.born;
          if (age < 0 || age > r.life) continue;
          const p = clamp(age / r.life, 0, 1);
          const radius = r.radius * (1 - Math.pow(1 - p, 2.4));
          const fade = (1 - p) * (1 - p);
          for (let ring = 0; ring < 2; ring++) {
            const rr = radius * (ring === 0 ? 1 : 0.62);
            if (rr < cw * 1.5) continue;
            const alpha = (ring === 0 ? 0.9 : 0.45) * fade;
            if (alpha < 0.05) continue;
            ctx.fillStyle = `rgba(155,228,255,${alpha.toFixed(3)})`;
            const steps = clamp(Math.round((TAU * rr) / (cw * 1.5)), 16, 72);
            const glyph = glyphs[clamp(Math.floor(p * 3) + ring, 0, glyphs.length - 1)];
            for (let k = 0; k < steps; k++) {
              const a = (k / steps) * TAU + r.born;
              const x = r.x + Math.cos(a) * rr;
              const y = r.y + Math.sin(a) * rr * 0.78;
              const col = Math.floor(x / cw);
              const row = Math.floor(y / ch);
              if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
              ctx.fillText(glyph, col * cw + cw / 2, row * ch + ch / 2 + 1);
            }
          }
        }
      }

      drawFish() {
        const ctx = this.ctx;
        const cols = this.cols;
        const cw = this.cw;
        const ch = this.ch;
        const world = this.world;
        if (!world) return;
        const alphas = [0.28, 0.42, 0.58, 0.74, 0.9];
        for (const f of world.fish) {
          if (!f.alive) continue;
          const i = this.cellIndex(f.x, f.y);
          if (i < 0 || this.sharkFlag[i]) continue;
          const col = i % cols;
          const row = (i / cols) | 0;
          const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);
          const v = 0.3 + (0.4 * (f.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, f.alarm);
          const b = clamp(Math.floor(v * alphas.length), 0, alphas.length - 1);
          ctx.fillStyle = this.light
            ? `rgba(40,60,95,${alphas[b]})`
            : `rgba(230,238,255,${alphas[b]})`;
          ctx.fillText("-", col * cw + cw / 2, row * ch + ch / 2 + 1);
        }
      }

      drawHeat() {
        const ctx = this.ctx;
        const heat = this.heat;
        const cols = this.cols;
        const cw = this.cw;
        const ch = this.ch;
        for (let i = 0; i < heat.length; i++) {
          const h = heat[i];
          if (h < 0.08) continue;
          const col = i % cols;
          const row = (i / cols) | 0;
          ctx.fillStyle = this.light
            ? h > 0.5
              ? `rgba(30,110,170,${h.toFixed(2)})`
              : `rgba(60,120,180,${(h * 1.6).toFixed(2)})`
            : h > 0.5
              ? `rgba(150,225,255,${h.toFixed(2)})`
              : `rgba(90,150,255,${(h * 1.6).toFixed(2)})`;
          ctx.fillText(h > 0.6 ? "*" : "·", col * cw + cw / 2, row * ch + ch / 2 + 1);
        }
      }

      /** Twinkling dots, plus cyan flares where the wake field is strong. */
      drawDots(t) {
        const ctx = this.ctx;
        const cols = this.cols;
        const rows = this.rows;
        const cw = this.cw;
        const ch = this.ch;
        const dotKind = this.dotKind;
        const dotPhase = this.dotPhase;
        const dotFreq = this.dotFreq;
        const energy = this.energy;
        const sharkFlag = this.sharkFlag;
        const n = cols * rows;
        const small = Math.max(2, Math.round(cw * 0.19));

        for (let i = 0; i < n; i++) {
          if (sharkFlag[i]) continue;
          const e = energy[i];
          const kind = dotKind[i];
          if (kind === 0 && e < 0.45) continue;
          const col = i % cols;
          const row = (i / cols) | 0;
          let style;
          let size = small;
          if (e > 0.45) {
            const level = clamp(Math.floor((e - 0.45) * 5), 0, ALPHA_LEVELS - 1);
            style = this.dotStyles[2 * ALPHA_LEVELS + level];
            size = small + 1;
          } else {
            const twinkle = 0.5 + 0.5 * Math.sin(t * dotFreq[i] + dotPhase[i]);
            const caustic = 0.85 + 0.15 * Math.sin(col * 0.11 + t * 0.35) * Math.sin(row * 0.17 - t * 0.27);
            const v = clamp((0.5 + 0.5 * twinkle) * caustic + e * 2, 0, 1);
            const level = clamp(Math.floor(v * ALPHA_LEVELS), 0, ALPHA_LEVELS - 1);
            style = this.dotStyles[(kind - 1) * ALPHA_LEVELS + level];
          }
          ctx.fillStyle = style;
          ctx.fillRect(Math.round(col * cw + cw * 0.66 - size / 2), Math.round(row * ch + ch * 0.64 - size / 2), size, size);
        }
      }
    }

    // ───────────────────────────────────────────────────────────── engine

    const STEP = 1 / 60;
    const MAX_STEPS = 4;

    class OceanEngine {
      constructor(canvas, options) {
        const opts = options || {};
        this.canvas = canvas;
        this.renderer = new AsciiRenderer(canvas);
        // The saved roster must survive a remount: build the world from it,
        // not from the hard-coded default.
        this.world = new World(opts.sharks || specsFor(this.renderer.settings.species));
        this.probe = opts.heroProbe || null;
        this.host = opts.host || null;
        this.raf = 0;
        this.last = 0;
        this.acc = 0;
        this.themeTick = 0;
        this.opacity = opts.fadeIn === false ? 1 : 0;
        this.paintedOpacity = -1;
        this.settings = this.renderer.settings;
        this.disposed = false;
        this.reduced = typeof window !== "undefined" && window.matchMedia
          ? window.matchMedia("(prefers-reduced-motion: reduce)")
          : { matches: false };
        this.resizeObserver =
          typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.resize()) : null;
        if (this.resizeObserver) this.resizeObserver.observe(canvas);
        this.onMotionPreference = () => {
          if (this.reduced.matches) {
            cancelAnimationFrame(this.raf);
            this.drawStill();
          } else {
            this.schedule();
          }
        };
        if (this.reduced.addEventListener) this.reduced.addEventListener("change", this.onMotionPreference);
        this.rafStep = (now) => this.tick(now);
      }

      start() {
        this.refreshSurface();
        this.resize();
        this.canvas.style.opacity = String(this.opacity);
        this.paintedOpacity = Math.round(this.opacity * 100) / 100;
        this.bindPointer();
        this.schedule();
        return this;
      }

      /** True when the surface behind the layer is a light one. */
      detectLight() {
        const mode = this.settings.theme || "auto";
        if (mode === "light") return true;
        if (mode === "dark") return false;
        // Walk outwards: the first ancestor that actually paints a background
        // decides, so transparent panels still resolve to the page colour.
        const luminance = (bg) => {
          const match = /rgba?\(([^)]+)\)/.exec(bg || "");
          if (!match) return null;
          const parts = match[1].split(",").map((v) => parseFloat(v));
          const alpha = parts.length >= 4 ? parts[3] : 1;
          if (!(alpha > 0.2)) return null;
          const [r, g, b] = parts;
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        try {
          let node = this.host || (this.canvas && this.canvas.parentElement);
          while (node && node !== document.documentElement) {
            const value = luminance(window.getComputedStyle(node).backgroundColor);
            if (value !== null) return value > 140;
            node = node.parentElement;
          }
          const bodyValue = luminance(window.getComputedStyle(document.body).backgroundColor);
          if (bodyValue !== null) return bodyValue > 140;
        } catch (err) {
          return false;
        }
        return false;
      }

      /** Re-read the host surface: theme flips and transparency live here. */
      refreshSurface() {
        this.renderer.setLight(this.detectLight());
      }

      /** Host controls keep their clicks; the water takes the rest. */
      isInteractive(target) {
        if (!target || typeof target.closest !== "function") return false;
        const selector =
          'button, a, input, textarea, select, option, label, summary, [contenteditable=""],' +
          '[contenteditable="true"], [role="button"], [role="tab"], [role="menuitem"],' +
          '[role="slider"], [role="switch"], [role="checkbox"], [data-dsh-ascii-ocean-tuner]';
        return target.closest(selector) !== null;
      }

      bindPointer() {
        this.onPointerDown = (event) => {
          if (event.button !== 0 || this.isInteractive(event.target)) return;
          const rect = this.canvas.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
          this.world.ripple(x, y);
          if (this.reduced.matches) {
            this.renderer.world = this.world;
            this.drawStill();
          }
        };
        this.onPointerMove = (event) => {
          const rect = this.canvas.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
          const p = this.world.pointer;
          p.x = x;
          p.y = y;
          p.active =
            inside && event.pointerType !== "touch" && !this.isInteractive(event.target);
        };
        window.addEventListener("pointerdown", this.onPointerDown, true);
        window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      }

      destroy() {
        this.disposed = true;
        cancelAnimationFrame(this.raf);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.reduced.removeEventListener) this.reduced.removeEventListener("change", this.onMotionPreference);
        if (this.onPointerDown) window.removeEventListener("pointerdown", this.onPointerDown, true);
        if (this.onPointerMove) window.removeEventListener("pointermove", this.onPointerMove);
      }

      resize() {
        const rect = this.canvas.getBoundingClientRect();
        const width = rect.width || this.canvas.clientWidth;
        const height = rect.height || this.canvas.clientHeight;
        if (width < 1 || height < 1) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.renderer.resize(width, height, dpr);
        this.world.resize(width, height, this.renderer.cellWidth, this.renderer.cellHeight);
        if (this.reduced.matches) this.drawStill();
      }

      /** Apply a settings patch live: palette, dots, cell size, roster. */
      setSettings(patch) {
        const before = Number(this.settings.cellSize) || 0;
        const beforeSpecies = this.settings.species;
        this.settings = this.renderer.updateSettings(patch);
        const after = Number(this.settings.cellSize) || 0;
        if (patch.species !== undefined && patch.species !== beforeSpecies) {
          this.world = new World(specsFor(this.settings.species));
          this.resize();
        } else if (before !== after) {
          this.resize();
        }
        this.refreshSurface();
        this.paintedOpacity = -1;
        return this.settings;
      }

      /** True while the New Session hero owns the composer. */
      heroActive() {
        const el = this.probe;
        if (!el || !el.closest) return true;
        try {
          return el.closest('[class*="_composerHero"]') !== null;
        } catch (err) {
          return true;
        }
      }

      schedule() {
        cancelAnimationFrame(this.raf);
        if (this.disposed || this.reduced.matches) return;
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.rafStep);
      }

      tick(now) {
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        this.acc += dt;
        let steps = 0;
        while (this.acc >= STEP && steps < MAX_STEPS) {
          this.world.step(STEP);
          this.acc -= STEP;
          steps++;
        }
        if (steps === MAX_STEPS) this.acc = 0;

        // The host can flip theme at any time; re-sample the surface now and then.
        if (++this.themeTick % 45 === 0) this.refreshSurface();

        // Full strength on the hero, a whisper behind an active transcript.
        const heroTarget = Number(this.settings.heroOpacity);
        const idleTarget = Number(this.settings.idleOpacity);
        const target = this.heroActive()
          ? (Number.isFinite(heroTarget) ? heroTarget : 1)
          : (Number.isFinite(idleTarget) ? idleTarget : 0.1);
        this.opacity += (target - this.opacity) * Math.min(1, dt * 3);
        const rounded = Math.round(this.opacity * 100) / 100;
        if (rounded !== this.paintedOpacity) {
          this.paintedOpacity = rounded;
          this.canvas.style.opacity = String(rounded);
        }

        this.renderer.world = this.world;
        this.renderer.render(this.world, dt);
        this.raf = requestAnimationFrame(this.rafStep);
      }

      drawStill() {
        if (this.world.time < 4) {
          for (let i = 0; i < 240; i++) this.world.step(STEP);
        }
        this.renderer.world = this.world;
        this.renderer.render(this.world, STEP);
      }
    }

    // ─────────────────────────────────────────────────────── browser side

    /**
     * The conversation root is the direct child of AppFrame's centre column and
     * owns the column's background, so a negative-index child with
     * `isolation: isolate` paints above that background and below every piece
     * of content, without touching any other surface of the app.
     */
    function findBackdropHost(node) {
      const chain = [];
      let el = node && node.parentElement;
      while (el && el !== document.body) {
        chain.push(el);
        el = el.parentElement;
      }
      if (!chain.length) return null;

      const heightOf = (element) => element.getBoundingClientRect().height;
      let colIndex = -1;
      for (let i = 0; i < chain.length; i++) {
        const cls = typeof chain[i].className === "string" ? chain[i].className : "";
        if (cls.indexOf("_centerCol") >= 0) {
          colIndex = i;
          break;
        }
      }

      if (colIndex > 0) {
        // Anything between the anchor and the column may be a zero-height
        // wrapper; take the outermost ancestor that still fills the column.
        const colHeight = heightOf(chain[colIndex]);
        let host = null;
        if (colHeight > 80) {
          for (let i = colIndex - 1; i >= 0; i--) {
            if (heightOf(chain[i]) >= colHeight * 0.8) host = chain[i];
          }
        }
        if (host || colIndex > 0) return host || chain[colIndex - 1];
      }

      // Fallback: the outermost ancestor that paints an opaque background.
      let opaque = null;
      for (const element of chain) {
        const bg = window.getComputedStyle(element).backgroundColor;
        if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") opaque = element;
      }
      return opaque;
    }

    // ────────────────────────────────────────────────────── tuner panel

    /**
     * Small corner panel that edits the settings live and persists them in
     * localStorage. Plain DOM on purpose: it must not re-render React.
     */
    function createTuner(engine) {
      const el = document.createElement("div");
      el.setAttribute("data-dsh-ascii-ocean-tuner", "");
      el.style.cssText =
        "position:fixed;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:8px;" +
        "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cfd8e8;";

      const gear = document.createElement("button");
      gear.type = "button";
      gear.textContent = "⚙";
      gear.title = "ASCII Ocean 参数";
      gear.setAttribute("aria-label", "ASCII Ocean settings");
      gear.style.cssText =
        "width:30px;height:30px;border-radius:999px;border:1px solid rgba(140,170,220,.28);" +
        "background:rgba(10,14,22,.6);color:#cfe0ff;cursor:pointer;font-size:14px;line-height:1;" +
        "opacity:.4;transition:opacity .18s ease,transform .18s ease;padding:0;";

      const panel = document.createElement("div");
      panel.style.cssText =
        "display:none;width:262px;box-sizing:border-box;padding:12px 12px 10px;border-radius:12px;" +
        "border:1px solid rgba(140,170,220,.22);background:rgba(8,11,18,.94);" +
        "box-shadow:0 14px 36px rgba(0,0,0,.5);backdrop-filter:blur(10px);" +
        "max-height:min(72vh,600px);overflow-y:auto;";

      const title = document.createElement("div");
      title.textContent = "ASCII Ocean";
      title.style.cssText = "font-weight:600;letter-spacing:.04em;color:#9fc2ff;margin-bottom:8px;";

      const inputs = [];
      const row = (labelText, control) => {
        const line = document.createElement("label");
        line.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0;cursor:pointer;";
        const name = document.createElement("span");
        name.textContent = labelText;
        name.style.cssText = "color:#9aa8c2;flex:none;";
        line.append(name, control);
        panel.appendChild(line);
      };

      const slider = (key, labelText, min, max, step) => {
        const box = document.createElement("span");
        box.style.cssText = "display:flex;align-items:center;gap:6px;flex:1;min-width:0;";
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.style.cssText = "flex:1;min-width:70px;accent-color:#4a7dff;height:16px;";
        const out = document.createElement("span");
        out.style.cssText =
          "width:40px;flex:none;text-align:right;color:#9fc2ff;font-variant-numeric:tabular-nums;";
        input.addEventListener("input", () => {
          const value = Math.round(Number(input.value) * 1000) / 1000;
          const patch = { [key]: value };
          // Linked opacities: editing either one writes both.
          if (engine.settings.linkOpacity) {
            if (key === "heroOpacity") patch.idleOpacity = value;
            if (key === "idleOpacity") patch.heroOpacity = value;
          }
          engine.setSettings(patch);
          writeSettings(engine.settings);
          sync();
        });
        inputs.push({ input, key, out, kind: "range", step });
        box.append(input, out);
        row(labelText, box);
        return input;
      };

      const toggle = (key, labelText) => {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.style.cssText = "width:16px;height:16px;flex:none;accent-color:#4a7dff;cursor:pointer;";
        input.addEventListener("change", () => {
          engine.setSettings({ [key]: input.checked });
          writeSettings(engine.settings);
          sync();
        });
        inputs.push({ input, key, kind: "check" });
        row(labelText, input);
        return input;
      };

      const color = (key, labelText) => {
        const input = document.createElement("input");
        input.type = "color";
        input.style.cssText =
          "width:34px;height:18px;border:1px solid rgba(140,170,220,.3);border-radius:4px;background:transparent;padding:0;cursor:pointer;";
        input.addEventListener("input", () => {
          engine.setSettings({ [key]: input.value });
          writeSettings(engine.settings);
        });
        inputs.push({ input, key });
        row(labelText, input);
        return input;
      };

      const choice = (key, labelText, options) => {
        const input = document.createElement("select");
        input.style.cssText =
          "flex:1;min-width:110px;background:rgba(16,22,34,.9);color:#cfd8e8;border:1px solid rgba(140,170,220,.3);" +
          "border-radius:5px;padding:2px 4px;font:inherit;cursor:pointer;";
        for (const [value, text] of options) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          input.appendChild(option);
        }
        input.addEventListener("change", () => {
          engine.setSettings({ [key]: input.value });
          writeSettings(engine.settings);
        });
        inputs.push({ input, key, select: true });
        row(labelText, input);
        return input;
      };

      choice("species", "水里的生物", [
        ["shark", "鲨鱼（原版）"],
        ["mixed", "鲤鱼 + 金鱼"],
        ["koi", "全是鲤鱼"],
        ["goldfish", "全是金鱼"],
      ]);
      choice("theme", "配色", [
        ["auto", "跟随主题"],
        ["dark", "深色"],
        ["light", "浅色"],
      ]);
      toggle("transparent", "透明背景（不铺底色）");
      slider("heroOpacity", "首屏不透明度", 0, 1, 0.02);
      slider("idleOpacity", "会话内不透明度", 0, 1, 0.02);
      toggle("linkOpacity", "首屏与会话联动");
      slider("cellSize", "格子大小 (0=自动)", 0, 20, 1);
      slider("dotDensity", "点阵密度", 0, 0.4, 0.01);
      slider("grid", "网格强度", 0, 0.12, 0.005);
      color("background", "背景色");
      color("koiColor", "鲤鱼颜色");
      color("goldfishColor", "金鱼颜色");
      color("sharkColor", "鲨鱼颜色");
      color("dotPrimary", "点阵主色");
      color("dotSecondary", "点阵副色");
      color("accent", "点缀色");

      const footer = document.createElement("div");
      footer.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.textContent = "恢复默认";
      reset.style.cssText =
        "border:1px solid rgba(140,170,220,.26);background:transparent;color:#9aa8c2;border-radius:6px;" +
        "padding:3px 8px;font:inherit;cursor:pointer;";
      reset.addEventListener("click", () => {
        engine.setSettings(Object.assign({}, DEFAULT_SETTINGS));
        writeSettings(engine.settings);
        sync();
      });
      const hint = document.createElement("span");
      hint.textContent = "改动自动保存";
      hint.style.cssText = "color:#5c6a82;font-size:11px;";
      footer.append(reset, hint);

      panel.append(footer);
      panel.prepend(title);

      const sync = () => {
        const s = engine.settings;
        for (const item of inputs) {
          const value = s[item.key];
          if (item.kind === "check") {
            item.input.checked = !!value;
            continue;
          }
          item.input.value =
            typeof value === "number" ? String(value) : String(value == null ? "" : value);
          if (item.out) {
            item.out.textContent =
              typeof value === "number" ? (item.step >= 1 ? String(Math.round(value)) : value.toFixed(2)) : "";
          }
        }
      };

      let open = false;
      const setOpen = (next) => {
        open = next;
        panel.style.display = open ? "block" : "none";
        gear.style.opacity = open ? "1" : ".4";
        gear.textContent = open ? "×" : "⚙";
        if (open) sync();
      };

      gear.addEventListener("click", () => setOpen(!open));
      gear.addEventListener("mouseenter", () => {
        gear.style.opacity = "1";
      });
      gear.addEventListener("mouseleave", () => {
        if (!open) gear.style.opacity = ".4";
      });

      const onKey = (event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      };
      window.addEventListener("keydown", onKey, true);

      el.append(panel, gear);
      sync();

      return {
        el,
        place(rect) {
          el.style.right = `${Math.max(12, Math.round(window.innerWidth - rect.right) + 14)}px`;
          el.style.bottom = `${Math.max(12, Math.round(window.innerHeight - rect.bottom) + 14)}px`;
        },
        destroy() {
          window.removeEventListener("keydown", onKey, true);
          el.remove();
        },
      };
    }

    function apply(ctx) {
      const react = require("react");
      const useEffect = react.useEffect;
      const useRef = react.useRef;

      function OceanBackdrop() {
        const anchor = useRef(null);

        useEffect(() => {
          const node = anchor.current;
          if (!node) return;
          const host = findBackdropHost(node);
          if (!host) return;

          const canvas = document.createElement("canvas");
          canvas.setAttribute("aria-hidden", "true");
          canvas.setAttribute("data-dsh-ascii-ocean", "");
          // Pinned to the viewport and sized to the column every frame-relevant
          // change: an absolutely positioned layer would scroll away with the
          // transcript, a fixed one keeps covering the column while it scrolls.
          canvas.style.cssText =
            "position:fixed;left:0;top:0;width:100%;height:100%;display:block;" +
            "z-index:-1;pointer-events:none;opacity:0;";

          const prevPosition = host.style.position;
          const prevIsolation = host.style.isolation;
          if (window.getComputedStyle(host).position === "static") host.style.position = "relative";
          // Make the host a stacking context so the layer covers its background.
          host.style.isolation = "isolate";
          host.insertBefore(canvas, host.firstChild);

          let syncFrame = 0;
          let lastKey = "";
          // Keep the layer glued to the column: the conversation body scrolls,
          // and an absolutely positioned layer would ride along with it.
          const sync = () => {
            const rect = host.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return;
            tuner.place(rect);
            const key = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
            if (key === lastKey) return;
            lastKey = key;
            canvas.style.left = `${Math.round(rect.left)}px`;
            canvas.style.top = `${Math.round(rect.top)}px`;
            canvas.style.width = `${Math.round(rect.width)}px`;
            canvas.style.height = `${Math.round(rect.height)}px`;
          };
          const loop = () => {
            sync();
            syncFrame = requestAnimationFrame(loop);
          };

          const engine = new OceanEngine(canvas, { heroProbe: node, host });
          engine.start();

          const tuner = createTuner(engine);
          document.body.appendChild(tuner.el);
          sync();
          syncFrame = requestAnimationFrame(loop);

          return () => {
            engine.destroy();
            cancelAnimationFrame(syncFrame);
            tuner.destroy();
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
            host.style.isolation = prevIsolation;
            host.style.position = prevPosition;
          };
        }, []);

        return react.createElement("span", {
          ref: anchor,
          "data-dsh-ascii-ocean-anchor": "",
          style: { display: "none" },
        });
      }

      ctx.slots.inject("conversation.input.dock", () =>
        ctx.slots.register(
          { name: "conversation.input.dock", id: "ascii-ocean", order: 30 },
          OceanBackdrop,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    exports.OceanEngine = OceanEngine;
    exports.World = World;
    exports.AsciiRenderer = AsciiRenderer;
    return module.exports;
  },
});
