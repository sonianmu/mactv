// Fig. 1 of the MacTV page: a study and a living room in cutaway. The Mac in the study runs a separate desktop
// for the TV in the living room. Writes .build/fig.svg (the drawing) and .build/fig.json (screen-space routes
// and outline points used by the page). Run: node site/src/build.mjs, then node site/src/assemble.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../vendor/anatomy/iso-kit.mjs";
import * as G from "../vendor/anatomy/lathe.mjs";
import { tubePieces, tubeSvg } from "../vendor/anatomy/tube.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", ".build");
const WIDTH = 1000, HEIGHT = 600;

/* ---------- world (drawing units, roughly 2 cm each) ---------- */
const BASE = { x: -314, y: -134, w: 660, d: 258, r: 6 };
const BACK_Y = -120, LEFT_X = -300, WALL_T = 10, WALL_H = 140;
const STUDY = { x: LEFT_X, y: BACK_Y, w: 290, d: 240, r: 0 };
const LIVING = { x: 10, y: BACK_Y, w: 330, d: 240, r: 0 };
const PART_H = 34;                                   // partition cut height
const DOOR = [36, 82];                               // doorway in the partition (y range)

const DESK = { x: -262, y: -118, w: 150, d: 56, r: 1.5, z: 70 };
const MON = { x0: -228, x1: -180, y: -114, d: 24, z0: 73, z1: 113 };
const MON_SCR = { x0: -222, x1: -186, z0: 80, z1: 107 };
const MINI = { x: -144, y: -104, w: 22, d: 22, r: 3.8, h: 8.7 };
const KBD = { x: -226, y: -82, w: 46, d: 14, r: 1.4 };

const CAB = { x: 96, y: -118, w: 160, d: 34, r: 1.5, h: 30 };
const TV = { x0: 92, x1: 260, y: -110, d: 5, z0: 35, z1: 131 };
const TV_SCR = { x0: 95, x1: 257, z0: 40, z1: 128 };
const TABLE = { x: 169, y: 40, w: 20, d: 20, r: 1.2, z: 19 };
const SOFA = [{ x: 124, y: 32, w: 36, d: 36 }, { x: 198, y: 32, w: 36, d: 36 }];
const REMOTE = { x: 176, y: 43, w: 6, d: 14, r: 2.4 };

const P = k.fitProjection(
  [...k.boxCorners(BASE, -10, 0), [LEFT_X - WALL_T, BACK_Y - WALL_T, WALL_H], [BASE.x + BASE.w, BACK_Y - WALL_T, WALL_H], [LEFT_X - WALL_T, BASE.y + BASE.d, WALL_H]],
  WIDTH, HEIGHT, { pad: 16, azimuth: 56 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const slab = (plan, z, h, tone = "mid", steps = 3, bevel = 0, extra = {}) => S(k.slabOf(plan, z, h, P, steps, bevel), { tone, ...extra });
const halo = (plan, z = 0, h = 4) => `<path class="iso-halo" d="${k.haloOf(plan, z, h, P)}"/>`;
const front = (y) => k.sideMatrix([0, y], 0, P, "left");       // a face at constant y, local (x, -z)
const side = (x) => k.sideMatrix([x, 0], 0, P, "right");       // a face at constant x, local (-y, -z)
const rect = (x0, z0, x1, z1, r = 0, steps = 4) =>
  k.pathOf(k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, steps).map(([u, z]) => [u, -z]), true);
const part = (name, cls, body) => `<g data-part="${name}"${cls ? ` class="${cls}"` : ""}>${body}</g>`;

/* ---------- shell: base, floors, walls ---------- */
function shell() {
  const out = [halo(BASE, -10, 10)];
  out.push(slab(BASE, -10, 10, "lo", 4));
  // the same green carpet in both rooms
  const floor = (room, panels) => {
    const tiles = [];
    for (let x = room.x + 30; x < room.x + room.w - 1; x += 30) tiles.push(k.lineOnTop([x, room.y], [x, room.y + room.d], 0.8, P));
    for (let y = room.y + 30; y < room.y + room.d - 1; y += 30) tiles.push(k.lineOnTop([room.x, y], [room.x + room.w, y], 0.8, P));
    const glow = panels.map(([x, y]) => `<path class="mt-panel-light" d="${k.pathOf(k.roundedPlan({ x, y, w: 56, d: 26, r: 4 }, 3).map(([px, py]) => at([px, py, 0.9])), true)}"/>`).join("");
    return slab({ ...room, r: 0 }, 0, 0.8, "lo", 2, 0, { crease: "none" }) + L(tiles.join(""), { tone: "faint" }) + glow;
  };
  out.push(part("floor-study", "m-carpet", floor(STUDY, [[-262, -40], [-150, -40], [-262, 50], [-150, 50]])));
  out.push(part("floor-living", "m-carpet", floor(LIVING, [[40, -40], [150, -40], [260, -40], [40, 50], [150, 50], [260, 50]])));
  // bare walls, no windows; a low skirting and a framed print in the study
  const walls = [];
  // the back and left walls as one L-shaped solid, so their corner has no seam
  const XR = BASE.x + BASE.w, YF = BASE.y + BASE.d, X0 = LEFT_X - WALL_T, Y0 = BACK_Y - WALL_T;
  walls.push(S(k.extrude([[X0, Y0], [XR, Y0], [XR, BACK_Y], [LEFT_X, BACK_Y], [LEFT_X, YF], [X0, YF]], 0, WALL_H, P, { convex: false }), { tone: "mid" }));
  walls.push(slab({ x: LEFT_X, y: BACK_Y, w: BASE.x + BASE.w - LEFT_X, d: 1.2, r: 0 }, 0, 5, "lo", 2));
  walls.push(slab({ x: LEFT_X, y: BACK_Y + 1.2, w: 1.2, d: BASE.y + BASE.d - BACK_Y - 1.2, r: 0 }, 0, 5, "lo", 2));
  walls.push(framedPrint());
  walls.push(`<g transform="${front(BACK_Y)}"><path class="mt-fitting" d="${rect(-56, 58, -44, 72, 2)}"/><path class="iso-line" data-tone="mid" d="${rect(-56, 58, -44, 72, 2)}"/><circle class="mt-fitting-dot" cx="-50" cy="-66" r="2.6"/>` +
    `<path class="mt-fitting" d="${rect(276, 10, 286, 18, 1)}"/><path class="iso-line" data-tone="mid" d="${rect(276, 10, 286, 18, 1)}M279.5 -13V-15M282.5 -13V-15"/></g>`);
  out.push(part("walls", "m-plaster", walls.join("")));
  return out.join("");
}

function framedPrint() {
  // a framed print on the left wall's inner face (local u runs along -y)
  const u0 = 26, u1 = 80, z0 = 72, z1 = 112;
  const g = [`<g transform="${side(LEFT_X)}">`,
    `<path class="mt-frame" d="${rect(u0, z0, u1, z1)}"/>`,
    `<path class="mt-mat" d="${rect(u0 + 3, z0 + 3, u1 - 3, z1 - 3)}"/>`,
    `<path class="mt-art-sky" d="${rect(u0 + 7, z0 + 16, u1 - 7, z1 - 7)}"/>`,
    `<path class="mt-art-land" d="${rect(u0 + 7, z0 + 7, u1 - 7, z0 + 16)}"/>`,
    `<path class="iso-line" data-tone="mid" d="${rect(u0, z0, u1, z1)}"/>`, `</g>`];
  return g.join("");
}

function partition() {
  const out = [];
  for (const [y0, y1] of [[BACK_Y, DOOR[0]], [DOOR[1], BASE.y + BASE.d]]) {
    out.push(slab({ x: -4, y: y0, w: 8, d: y1 - y0, r: 0 }, 0, PART_H, "mid", 2));
  }
  // network wall plate on the living-room face; the cable leaves it through the socket
  out.push(slab({ x: 4, y: -112, w: 1.2, d: 9, r: 0.6 }, 6, 10, "mid", 2));
  out.push(L(k.planOutline({ x: 5.2, y: -110, w: 0.01, d: 5, r: 0 }, 0, P, 2), { tone: "faint" }));
  return part("walls", "m-plaster", out.join(""));
}

/* ---------- screens ---------- */
function ownerScreen({ x0, x1, z0, z1 }) {
  const w = x1 - x0, h = z1 - z0, out = [];
  out.push(`<path class="mt-crt" d="${rect(x0, z0, x1, z1, 4)}"/>`);
  out.push(`<path class="mt-crt-rule" d="M${x0 + 3} ${-(z1 - 5)}H${x1 - 3}M${x0 + 3} ${-(z0 + 5)}H${x1 - 3}"/>`);
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const cols = 8, rows = 4, gx = (w - 8) / cols, gz = (h - 12) / rows, digits = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const big = rnd() > 0.86;
    digits.push(`<text class="mt-digit${big ? " mt-digit-big" : ""}" x="${(x0 + 4 + gx * (c + 0.5)).toFixed(1)}" y="${(-(z0 + 7 + gz * (r + 0.35))).toFixed(1)}">${Math.floor(rnd() * 10)}</text>`);
  }
  out.push(digits.join(""));
  out.push(`<path class="mt-crt-bar" d="${rect(x0 + 3, z0 + 1.6, x0 + 3 + (w - 6) * 0.62, z0 + 3.2)}"/>`);
  return out.join("");
}

function tvDesk({ x0, x1, z0, z1 }) {
  const w = x1 - x0, h = z1 - z0, out = [];
  out.push(`<path class="mt-glass" d="${rect(x0, z0, x1, z1)}"/>`);
  out.push(`<path class="mt-light-warm" d="${rect(x0, z0, x1, z1)}"/>`);
  out.push(`<path class="mt-rule" d="M${x0 + w * 0.06} ${-(z1 - h * 0.12)}H${x0 + w * 0.3}"/>`);
  const tiles = [];
  for (let i = 0; i < 4; i++) tiles.push(rect(x0 + w * (0.06 + i * 0.225), z0 + h * 0.42, x0 + w * (0.06 + i * 0.225) + w * 0.2, z0 + h * 0.78, 1.6));
  out.push(`<path class="mt-tile" d="${tiles.join("")}"/>`);
  out.push(`<path class="mt-tile mt-tile-on" d="${rect(x0 + w * 0.06, z0 + h * 0.42, x0 + w * 0.26, z0 + h * 0.78, 1.6)}"/>`);
  const shelf = [];
  for (let i = 0; i < 6; i++) shelf.push(rect(x0 + w * (0.06 + i * 0.15), z0 + h * 0.1, x0 + w * (0.06 + i * 0.15) + w * 0.13, z0 + h * 0.32, 1.2));
  out.push(`<path class="mt-win" d="${shelf.join("")}"/>`);
  return out.join("");
}

// the Apple Music interface built for the remote: album art and the playing track on the left, lyrics on the
// right with the current line lit, a shelf of albums along the bottom with the remote's focus on one of them
function tvMusic({ x0, x1, z0, z1 }) {
  const w = x1 - x0, h = z1 - z0, out = [];
  const X = (f) => x0 + w * f, Z = (f) => z0 + h * f;
  out.push(`<path class="mm-bg" d="${rect(x0, z0, x1, z1)}"/>`);
  const art = w * 0.2;
  out.push(`<path class="mm-art" d="${rect(X(0.06), Z(0.34), X(0.06) + art, Z(0.34) + art, 1.4)}"/>`);
  out.push(`<path class="mm-art-2" d="${rect(X(0.06), Z(0.34), X(0.06) + art, Z(0.34) + art * 0.42, 1.4)}"/>`);
  out.push(`<circle class="mm-art-3" cx="${(X(0.06) + art * 0.68).toFixed(1)}" cy="${(-(Z(0.34) + art * 0.68)).toFixed(1)}" r="${(art * 0.13).toFixed(1)}"/>`);
  out.push(`<path class="mm-text" d="${rect(X(0.06), Z(0.27), X(0.06) + art * 0.9, Z(0.27) + h * 0.03, 0.5)}"/>`);
  out.push(`<path class="mm-dim" d="${rect(X(0.06), Z(0.225), X(0.06) + art * 0.6, Z(0.225) + h * 0.022, 0.5)}"/>`);
  out.push(`<path class="mm-dim" d="${rect(X(0.06), Z(0.18), X(0.06) + art, Z(0.18) + h * 0.008)}"/>`);
  out.push(`<path class="mm-text" d="${rect(X(0.06), Z(0.18), X(0.06) + art * 0.38, Z(0.18) + h * 0.008)}"/>`);
  const lines = [[0.86, 0.5, "mm-dim"], [0.78, 0.42, "mm-dim"], [0.68, 0.56, "mm-lyric"], [0.58, 0.46, "mm-dim"], [0.5, 0.38, "mm-dim"], [0.42, 0.5, "mm-faint"]];
  for (const [f, len, cls] of lines) {
    const tall = cls === "mm-lyric" ? 0.05 : 0.035;
    out.push(`<path class="${cls}" d="${rect(X(0.36), Z(f), X(0.36 + len * 0.6), Z(f) + h * tall, 0.8)}"/>`);
  }
  for (let i = 0; i < 6; i++) {
    const a = X(0.06 + i * 0.15), cls = ["mm-t1", "mm-t2", "mm-t3", "mm-t4", "mm-t2", "mm-t3"][i];
    out.push(`<path class="${cls}" d="${rect(a, Z(0.04), a + w * 0.12, Z(0.04) + h * 0.1, 0.8)}"/>`);
  }
  const fa = X(0.06 + 2 * 0.15);
  out.push(`<path class="mm-focus" d="${rect(fa - 1, Z(0.04) - 1, fa + w * 0.12 + 1, Z(0.04) + h * 0.1 + 1, 1.2)}"/>`);
  return out.join("");
}

function tvMessage({ x0, x1, z0, z1 }, kind) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const out = [`<path class="mt-glass" d="${rect(x0, z0, x1, z1)}"/>`];
  if (kind === "pin") {
    const boxes = [];
    for (let i = 0; i < 6; i++) boxes.push(rect(cx - 42 + i * 14.5, cz - 7, cx - 42 + i * 14.5 + 11, cz + 7, 1.4));
    out.push(`<path class="mt-win" d="${boxes.join("")}"/><path class="mt-rule" d="M${cx - 22} ${-(cz + 20)}H${cx + 22}"/>`);
    return out.join("");
  }
  out.push(`<path class="mt-rule" d="M${cx - 30} ${-(cz - 12)}H${cx + 30}"/>`);
  if (kind === "search") {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out.push(`<circle class="mt-spin" style="opacity:${(0.2 + 0.8 * (i / 7)).toFixed(2)}" cx="${(cx + Math.cos(a) * 7).toFixed(1)}" cy="${(-(cz + 10) + Math.sin(a) * 7).toFixed(1)}" r="1.2"/>`);
    }
  } else out.push(`<path class="mt-rule" d="M${cx - 18} ${-(cz + 10)}H${cx - 4}M${cx + 4} ${-(cz + 10)}H${cx + 18}"/>`);
  return out.join("");
}

/* ---------- study ---------- */
function desk() {
  const out = [halo(DESK, 0, 6)];
  // closed white end panels, a modesty panel, the top, then green fabric privacy screens on the back and left
  const end = (x) => slab({ x, y: DESK.y, w: 3, d: DESK.d, r: 0.4 }, 0, DESK.z - 2.6, "mid", 2);
  out.push(end(DESK.x));
  out.push(slab({ x: DESK.x + 3, y: DESK.y + 6, w: DESK.w - 6, d: 1.6, r: 0 }, 30, DESK.z - 32.6, "lo", 2));
  out.push(end(DESK.x + DESK.w - 3));
  out.push(slab(DESK, DESK.z - 2.6, 2.6, "mid", 3, 0.6));
  const screen = (plan) => `<g class="m-felt">${slab(plan, DESK.z, 36, "mid", 2)}${slab({ ...plan, x: plan.x - 0.3, y: plan.y - 0.3, w: plan.w + 0.6, d: plan.d + 0.6 }, DESK.z + 36, 1.2, "mid", 2)}</g>`;
  out.push(screen({ x: DESK.x, y: DESK.y, w: DESK.w, d: 3, r: 0.4 }));
  out.push(screen({ x: DESK.x, y: DESK.y + 3, w: 3, d: DESK.d - 3, r: 0.4 }));
  return part("desk", "m-walnut", out.join(""));
}

function monitor() {
  // a deep cream terminal: plinth, a box with a slightly smaller rear, a recessed screen
  const box = { x: MON.x0, y: MON.y, w: MON.x1 - MON.x0, d: MON.d, r: 3 };
  const out = [halo(box, DESK.z, 4)];
  out.push(slab({ x: box.x + 8, y: box.y + 5, w: box.w - 16, d: box.d - 8, r: 2 }, DESK.z, 3, "lo", 3));
  out.push(slab({ x: box.x + 5, y: box.y, w: box.w - 10, d: 8, r: 3 }, MON.z0 + 4, MON.z1 - MON.z0 - 9, "mid", 4));
  out.push(slab({ ...box, y: box.y + 6, d: box.d - 6 }, MON.z0, MON.z1 - MON.z0, "mid", 4, 0.6));
  const vents = [];
  for (let i = 0; i < 5; i++) vents.push(k.lineOnTop([box.x + 10, box.y + 11 + i * 2.2], [box.x + box.w - 10, box.y + 11 + i * 2.2], MON.z1, P));
  out.push(L(vents.join(""), { tone: "lo" }));
  const face = MON.y + MON.d;
  out.push(`<g transform="${front(face)}"><path class="mt-bezel" d="${rect(MON_SCR.x0 - 2.5, MON_SCR.z0 - 2.5, MON_SCR.x1 + 2.5, MON_SCR.z1 + 2.5, 5)}"/>${ownerScreen(MON_SCR)}<path class="iso-line" data-tone="lo" d="${rect(MON_SCR.x0, MON_SCR.z0, MON_SCR.x1, MON_SCR.z1, 4)}"/></g>`);
  out.push(D([at([MON.x1 - 6, face, MON.z0 + 4])], { size: 0.7, tone: "hi" }));
  return part("monitor", "m-cream", out.join(""));
}

function keyboard() {
  const out = [halo(KBD, DESK.z, 2), slab(KBD, DESK.z, 3, "mid", 3, 0.4)];
  const keys = [], u = 3.5;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) keys.push(k.planOutline({ x: KBD.x + 2 + c * u, y: KBD.y + 2 + r * u, w: u - 0.8, d: u - 0.8, r: 0.4 }, DESK.z + 3, P, 2));
  out.push(L(keys.join(""), { tone: "lo" }));
  // a trackball beside it
  const tb = { x: KBD.x + KBD.w + 5, y: KBD.y + 1, w: 12, d: 12, r: 2.6 };
  out.push(slab(tb, DESK.z, 3.4, "mid", 4, 0.4));
  out.push(S(G.sphereOf([tb.x + tb.w / 2, tb.y + tb.d / 2, DESK.z + 4.2], 3, P), { tone: "hi", className: "mt-ball" }));
  // a closed binder and a mug on the free corner of the desk
  out.push(`<g class="m-felt">${slab({ x: -147, y: -76, w: 18, d: 12, r: 0.8 }, DESK.z, 2.2, "mid", 2, 0.3)}</g>`);
  out.push(L(k.lineOnTop([-145, -73.5], [-131, -73.5], DESK.z + 2.2, P), { tone: "lo" }));
  out.push(`<g class="m-walnut">${S(k.cylinder(-122, -70, 2.8, DESK.z, 6, P, 20, 0.4), { tone: "mid" })}</g>`);
  return part("monitor", "m-cream", out.join(""));
}

function mini() {
  const z = DESK.z, h = MINI.h;
  const out = [halo(MINI, z, 3)];
  out.push(`<g class="m-black">${slab(k.insetPlan(MINI, 1.1), z, 0.7, "mid", 8)}</g>`);
  out.push(slab(MINI, z + 0.7, h - 0.7, "hi", 10, 0.5, { className: "mt-mini" }));
  const face = MINI.y + MINI.d, mid = z + 0.7 + (h - 0.7) * 0.42, ports = [];
  for (const x of [MINI.x + 5.2, MINI.x + 7.6]) ports.push(rect(x - 0.75, mid - 0.24, x + 0.75, mid + 0.24, 0.24, 3));
  ports.push(k.pathOf(k.circleRing(MINI.x + 9.8, -mid, 0.34, 12), true));
  out.push(`<g transform="${front(face)}"><path class="mt-port" d="${ports.join("")}"/></g>`);
  out.push(`<g data-part="mini-led">${D([at([MINI.x + MINI.w - 4.4, face, mid])], { size: 0.5, tone: "hi" })}</g>`);
  return part("mac", "m-alu", out.join(""));
}

function chair() {
  const c = { x: -194, y: -36 }, SEAT = 42, K = 1.3;  // K scales the plan; seat height is about 0.6 of the desk
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: c.x - 16 * K, y: c.y - 16 * K, w: 32 * K, d: 32 * K, r: 16 * K }, 0, 4, P)}"/>`];
  const chrome = (svg) => `<g class="m-alu">${svg}</g>`;
  // four-star base on casters
  const spokes = [0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + (i * Math.PI) / 2, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    const tip = [c.x + dx * 15 * K, c.y + dy * 15 * K];
    return { tip, ring: [[c.x + nx * 1.4, c.y + ny * 1.4], [tip[0] + nx * 0.8, tip[1] + ny * 0.8], [tip[0] - nx * 0.8, tip[1] - ny * 0.8], [c.x - nx * 1.4, c.y - ny * 1.4]] };
  }).sort((p, q) => k.depthOf([p.tip[0], p.tip[1], 0], P) - k.depthOf([q.tip[0], q.tip[1], 0], P));
  for (const sp of spokes) {
    out.push(S(k.cylinder(sp.tip[0], sp.tip[1], 2, 0, 3.6, P, 14), { tone: "lo" }));
    out.push(chrome(S(k.extrude(sp.ring, 4.2, 1.6, P, { convex: true }), { tone: "mid" })));
  }
  out.push(chrome(S(k.cylinder(c.x, c.y, 3, 4, 2.6, P, 18), { tone: "mid" })));
  out.push(chrome(S(k.cylinder(c.x, c.y, 1.8, 6.6, SEAT - 9, P, 14), { tone: "mid" })));
  out.push(chrome(slab({ x: c.x - 7, y: c.y - 7, w: 14, d: 14, r: 2 }, SEAT - 2.6, 1.6, "mid", 3)));
  // loop armrest: a front post, a back post and a bar on top, all in polished aluminium
  const arm = (x) => chrome(
    slab({ x: x - 1, y: c.y - 12, w: 2, d: 2, r: 0.6 }, SEAT, 14, "mid", 2) +
    slab({ x: x - 1, y: c.y + 8, w: 2, d: 2, r: 0.6 }, SEAT, 14, "mid", 2) +
    slab({ x: x - 1.1, y: c.y - 13, w: 2.2, d: 27, r: 0.8 }, SEAT + 14, 2, "mid", 3, 0.3));
  out.push(arm(c.x - 17.5));
  // seat: aluminium tray and a black cushion with two stitched channels
  out.push(chrome(slab({ x: c.x - 17, y: c.y - 16, w: 34, d: 31, r: 2.6 }, SEAT, 1.6, "mid", 3)));
  out.push(slab({ x: c.x - 16.4, y: c.y - 16.4, w: 32.8, d: 30, r: 4 }, SEAT + 1.6, 5.6, "mid", 4, 0.5));
  out.push(L([-4, 4].map((dy) => k.lineOnTop([c.x - 14.5, c.y + dy * 1.3], [c.x + 14.5, c.y + dy * 1.3], SEAT + 7.2, P)).join(""), { tone: "lo" }));
  // low curved backrest, joined to the arms
  const ring = [];
  for (let i = 0; i <= 18; i++) { const a = 0.22 * Math.PI + (i / 18) * 0.56 * Math.PI; ring.push([c.x + Math.cos(a) * 19, c.y - 4 + Math.sin(a) * 19]); }
  for (let i = 18; i >= 0; i--) { const a = 0.22 * Math.PI + (i / 18) * 0.56 * Math.PI; ring.push([c.x + Math.cos(a) * 15.6, c.y - 4 + Math.sin(a) * 15.6]); }
  out.push(S(k.extrude(ring, SEAT + 13, 13, P, { convex: false }), { tone: "mid" }));
  out.push(arm(c.x + 17.5));
  return part("chair", "m-black", out.join(""));
}

/* ---------- living room ---------- */
function cabinet() {
  const out = [halo(CAB, 0, 6)];
  out.push(slab(k.insetPlan(CAB, 4), 0, 4, "lo", 2));
  out.push(slab(CAB, 4, CAB.h - 4, "mid", 3, 0.6));
  const face = CAB.y + CAB.d, w = (CAB.w - 8) / 4, doors = [];
  for (let i = 0; i < 4; i++) doors.push(rect(CAB.x + 4 + i * w + 1, 8, CAB.x + 4 + (i + 1) * w - 1, CAB.h - 3, 0.6));
  out.push(`<g transform="${front(face)}"><path class="iso-line" data-tone="lo" d="${doors.join("")}"/></g>`);
  return part("cabinet", "m-oak", out.join(""));
}

function tv() {
  const out = [];
  for (const fx of [TV.x0 + 22, TV.x1 - 30]) {
    out.push(slab({ x: fx, y: -114, w: 8, d: 20, r: 1.6 }, CAB.h, 1.4, "mid", 2));
    out.push(slab({ x: fx + 2.5, y: TV.y - 1, w: 3, d: TV.d + 2, r: 0.6 }, CAB.h + 1.4, TV.z0 - CAB.h + 2, "mid", 2));
  }
  out.push(slab({ x: TV.x0, y: TV.y, w: TV.x1 - TV.x0, d: TV.d, r: 1.4 }, TV.z0, TV.z1 - TV.z0, "mid", 3, 0.5));
  const face = TV.y + TV.d;
  out.push(`<g transform="${front(face)}">` +
    `<g data-screen="desk">${tvDesk(TV_SCR)}</g>` +
    `<g data-screen="owner" style="display:none">${ownerScreen(TV_SCR)}</g>` +
    `<g data-screen="search" style="display:none">${tvMessage(TV_SCR, "search")}</g>` +
    `<g data-screen="pin" style="display:none">${tvMessage(TV_SCR, "pin")}</g>` +
    `<g data-screen="lost" style="display:none">${tvMessage(TV_SCR, "lost")}</g>` +
    `<g data-screen="music" style="display:none">${tvMusic(TV_SCR)}</g>` +
    `<path class="iso-line" data-tone="lo" d="${rect(TV_SCR.x0, TV_SCR.z0, TV_SCR.x1, TV_SCR.z1)}"/></g>`);
  out.push(`<g data-part="tv-led">${D([at([TV.x1 - 8, face, TV.z0 + 2.5])], { size: 0.8, tone: "hi" })}</g>`);
  return part("tv", "m-black", out.join(""));
}

function table() {
  // a white cube side table between the two chairs
  const out = [halo(TABLE, 0, 4), slab(TABLE, 0, TABLE.z, "mid", 2, 0.6)];
  out.push(L(k.sideSeam(TABLE, TABLE.z - 3, P, 2), { tone: "faint" }));
  return part("table", "m-walnut", out.join(""));
}

function remote() {
  const z = TABLE.z, out = [slab(REMOTE, z, 1.6, "mid", 4, 0.3)];
  const cx = REMOTE.x + REMOTE.w / 2;
  out.push(L(k.ring(cx, REMOTE.y + 6, 1.9, z + 1.6, P, 16), { tone: "lo" }));
  out.push(D([at([cx, REMOTE.y + 1.6, z + 1.6])], { size: 0.5, tone: "mid" }));
  return part("remote", "m-black", out.join(""));
}

function lounge(c) {
  // a low lounge chair on chrome sleds, facing the TV
  const out = [halo({ ...c, r: 3 }, 0, 6), `<g class="m-alu">`];
  for (const x of [c.x + 3, c.x + c.w - 4.2]) {
    out.push(slab({ x, y: c.y + 2, w: 1.2, d: c.d - 4, r: 0.6 }, 0, 1.2, "mid", 2));
    for (const y of [c.y + 4, c.y + c.d - 6]) out.push(slab({ x, y, w: 1.2, d: 1.2, r: 0.3 }, 1.2, 5.8, "mid", 2));
  }
  out.push(`</g>`);
  out.push(slab({ x: c.x, y: c.y, w: c.w, d: c.d, r: 3 }, 7, 8, "mid", 4, 0.5));
  out.push(slab({ x: c.x + 5, y: c.y + 1.5, w: c.w - 10, d: c.d - 10, r: 2.4 }, 15, 4, "mid", 4, 0.5));
  out.push(slab({ x: c.x, y: c.y, w: 5, d: c.d - 8, r: 2 }, 15, 9, "mid", 3, 0.4));
  out.push(slab({ x: c.x + c.w - 5, y: c.y, w: 5, d: c.d - 8, r: 2 }, 15, 9, "mid", 3, 0.4));
  out.push(slab({ x: c.x, y: c.y + c.d - 8, w: c.w, d: 8, r: 2.4 }, 15, 22, "mid", 3, 0.5));
  return part("sofa", "m-black", out.join(""));
}

/* ---------- cables ---------- */
// Mac → along the desk → down beside it → along the back wall → into the partition, out of the wall plate → TV cabinet
const ETH_DRAW = G.fillet([
  [MINI.x + 12, MINI.y + 2, DESK.z + 2], [MINI.x + 12, -112, DESK.z + 2], [-104, -112, DESK.z + 2], [-104, -115, 1.6],
  [0, -115, 1.6], [0, -107.5, 11], [12, -107.5, 11], [16, -103, 1.6], [86, -103, 1.6], [100, -112, 1.6], [100, -112, 30],
], 5, 6);
const MON_CABLE = G.fillet([[MINI.x + 4, MINI.y + 2, DESK.z + 2], [MINI.x + 4, -114, DESK.z + 1.4], [-190, -114, DESK.z + 1.4], [-190, -110, MON.z0 + 6]], 4, 6);

function cable(route, name, tone, r = 1) {
  return part(name, "", tubePieces(route, r, P, { maxLength: 500, caps: [false, false] }).map((p) => tubeSvg(p, { tone })).join(""));
}

/* ---------- assemble, back to front ---------- */
// muting filters: blend a part toward the paper colour without making it see-through
const mix = (a) => { const p = [0.918, 0.922, 0.902]; return `${a} 0 0 0 ${((1 - a) * p[0]).toFixed(3)} 0 ${a} 0 0 ${((1 - a) * p[1]).toFixed(3)} 0 0 ${a} 0 ${((1 - a) * p[2]).toFixed(3)} 0 0 0 1 0`; };
const defs = `<defs><filter id="mute" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${mix(0.3)}"/></filter><filter id="mute-soft" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${mix(0.6)}"/></filter></defs>`;

const body = [
  defs,
  shell(),
  desk(), cable(ETH_DRAW, "eth", "hi", 1.1), cable(MON_CABLE, "monitor", "mid", 0.8), monitor(), mini(), keyboard(), chair(),
  partition(),
  cabinet(), tv(), lounge(SOFA[0]), table(), remote(), lounge(SOFA[1]),
  `<g data-part="packets"></g>`,
];

const svg = k.figureSvg({
  width: WIDTH, height: HEIGHT,
  label: "Two rooms in cutaway. In the study, a Mac mini on a desk with the owner's display, keyboard and chair. In the living room, a TV on a cabinet, two lounge chairs and a side table with the remote. A cable runs from the Mac along the back wall, through the partition, to the TV.",
  body,
});

/* ---------- screen routes for the live page ---------- */
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
const inside = (poly, [x, y]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const wall = hull(k.boxCorners({ x: -4, y: BACK_Y, w: 8, d: DOOR[0] - BACK_Y, r: 0 }, 0, PART_H).map(at));
const route = G.resample(ETH_DRAW, 2.5).filter((p) => !(p[0] > 96) && !(p[2] > 3 && p[0] > 0) && !(p[1] < MINI.y + 4 && p[2] > DESK.z && p[0] > MINI.x - 1 && p[0] < MINI.x + MINI.w + 1 && p[1] > MINI.y - 1));
const eth = route.map((p) => { const s = at(p); return [+s[0].toFixed(1), +s[1].toFixed(1), (p[0] < 4 && inside(wall, s)) || (p[0] > -4 && p[0] < 5) ? 0 : 1]; });
const remoteTip = at([REMOTE.x + REMOTE.w / 2, REMOTE.y, TABLE.z + 2]);
const tvEye = at([TV.x1 - 14, TV.y + TV.d, TV.z0 + 2.5]);

// outline points of the cutaway, for text that wraps around it on the page
const r1 = (p) => p.map((v) => +v.toFixed(1));
const frame = {
  A: r1(at([LEFT_X - WALL_T, BACK_Y - WALL_T, WALL_H])),          // back-left top corner (highest point)
  B: r1(at([BASE.x + BASE.w, BACK_Y - WALL_T, WALL_H])),          // back wall, right end, top
  R: r1(at([BASE.x + BASE.w, BASE.y, -10])),                      // base, back-right corner, bottom
  C: r1(at([BASE.x + BASE.w, BASE.y + BASE.d, -10])),             // base, front-right corner, bottom (lowest)
  D: r1(at([BASE.x, BASE.y + BASE.d, -10])),                      // base, front-left corner, bottom
  E: r1(at([LEFT_X - WALL_T, BASE.y + BASE.d, WALL_H])),          // left wall, front top
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "fig.svg"), svg);
writeFileSync(join(OUT, "fig.json"), JSON.stringify({ eth, ir: [remoteTip, tvEye].map(r1), frame, size: [WIDTH, HEIGHT] }));
console.log("figure:", (svg.length / 1024).toFixed(0), "KB");
