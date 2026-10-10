"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * PaddyEyes
 *
 * The paddy mascot eyes: two thick, mirrored curves that bow outward
 * like ( ), or straight bars with `curve={0}`. They blink at random, glance
 * around the square and follow the pointer, staying inside its bounds. The
 * background is transparent.
 *
 * The curve is soft: as the eyes move, the ends trail behind and swing past
 * when they stop, and each eye bows toward where it is looking.
 *
 * Geometry is traced from the login mockup (Auth split panel) and
 * matches it to the pixel. Animation runs on requestAnimationFrame and
 * writes transforms straight to the SVG nodes, so it never re-renders
 * React. It pauses while off screen or in a background tab.
 *
 * Usage
 *   <PaddyEyes className="size-full" />                     // fills parent
 *   <PaddyEyes size={32} eyeSize={0.62} roam={0.5} />       // nav icon
 *   <PaddyEyes closed={passwordFocused} />                  // shut eyes on demand
 *   <PaddyEyes lookAt={{ x: -1, y: 0.2 }} />                // look toward the form
 *   <PaddyEyes curve={0} />                                 // straight eyes
 *   <PaddyEyes followPointer={false} />                     // ignore the mouse
 */

const fmt = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
// Geometry, in source units (pixels of the 2880px mockup). Pair is centred
// on (0, 0). Each eye is a quadratic stroke with round caps, drawn around
// its own centre so blinks squash it in place.
// ---------------------------------------------------------------------------
const EYE_END_X = 13; // endpoint x, relative to the eye centre
const EYE_END_Y = 192.25; // endpoint y (cap centres)
const EYE_CTRL_X = -40; // quadratic control point x
/** Offsets (source units) for the top end, control point and bottom end. */
type Bend = {
  tx: number;
  ty: number;
  cx: number;
  cy: number;
  bx: number;
  by: number;
};
const NO_BEND: Bend = { tx: 0, ty: 0, cx: 0, cy: 0, bx: 0, by: 0 };

/**
 * Eye centreline. `dir` 1 = left eye, -1 = right.
 * `k` shrinks it toward its centre (1 = full length, used by the blink).
 * `curve` sets the bow: 1 = mockup curve, 0 = straight, up to 1.5 for extra.
 * `bend` adds the fluid deformation on top.
 */
const eyePath = (dir: 1 | -1, k = 1, curve = 1, bend: Bend = NO_BEND) => {
  const c = clampCurve(curve);
  const ex = EYE_END_X * c * dir;
  const cx = EYE_CTRL_X * c * dir;
  return (
    `M${fmt((ex + bend.tx) * k)} ${fmt((-EYE_END_Y + bend.ty) * k)}` +
    `Q${fmt((cx + bend.cx) * k)} ${fmt(bend.cy * k)} ` +
    `${fmt((ex + bend.bx) * k)} ${fmt((EYE_END_Y + bend.by) * k)}`
  );
};
function clampCurve(curve: number) {
  return Math.min(1.5, Math.max(0, curve));
}
const STROKE_WIDTH = 183.5;
const EYE_OFFSET_X = 205.5; // distance from pair centre to each eye centre
const PAIR_HALF_W = 310.5; // half width of the pair, stroke included
const PAIR_HALF_H = 284; // half height, caps included
const PAIR_W = PAIR_HALF_W * 2;

const VIEWBOX = 512;
const CENTRE = VIEWBOX / 2;
const EDGE_PADDING = 8; // viewBox units kept clear at every edge
const MAX_TILT_DEG = 6;

// Fluid curve tuning (source units).
const GAZE_BEND_X = 48; // how far the curve bows toward a sideways look
const GAZE_BEND_Y = 60; // how far the bulge slides up or down with the look
const JELLY_MAX_X = 50; // max sideways trail of the ends
const JELLY_MAX_Y = 26; // max vertical trail
// Extra room the bending can take, kept clear of the edges.
const FLEX_X = JELLY_MAX_X + GAZE_BEND_X * 0.5;
const FLEX_Y = JELLY_MAX_Y;

// Pointer: seconds without movement before the eyes go back to wandering.
const POINTER_IDLE = 2.5;

// ---------------------------------------------------------------------------

export type PaddyEyesProps = {
  /** CSS width/height of the square. Defaults to filling the parent width. */
  size?: number | string;
  /** Eye colour. Defaults to brand black. */
  color?: string;
  /** Bow of each eye: 1 = the mockup curve, 0 = straight bars, up to 1.5. */
  curve?: number;
  /** Width of the eye pair as a fraction of the square (0.15 to 0.9). 0.36 matches the login mockup. */
  eyeSize?: number;
  /** How far the eyes travel, 0 (stay centred) to 1 (reach the edges). */
  roam?: number;
  /** Random glancing around the square. */
  wander?: boolean;
  /** Random blinking. */
  blink?: boolean;
  /** Hold the eyes shut, e.g. while the password field is focused. */
  closed?: boolean;
  /** Follow the mouse or finger anywhere on the page. Wanders again when it stops. */
  followPointer?: boolean;
  /** Override wandering and look toward a point, -1..1 on each axis. */
  lookAt?: { x: number; y: number } | null;
  /** Accessible name. Without it the SVG is treated as decorative. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
};

export function PaddyEyes({
  size,
  color = "#111111",
  curve = 1,
  eyeSize = 0.36,
  roam = 1,
  wander = true,
  blink = true,
  closed = false,
  lookAt = null,
  followPointer = true,
  label,
  className,
  style,
}: PaddyEyesProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pairRef = useRef<SVGGElement>(null);
  const leftRef = useRef<SVGGElement>(null);
  const rightRef = useRef<SVGGElement>(null);
  const leftPathRef = useRef<SVGPathElement>(null);
  const rightPathRef = useRef<SVGPathElement>(null);

  // Live props for the animation loop, so changing a prop never restarts it.
  const props: LiveProps = {
    eyeSize,
    roam,
    wander,
    blink,
    closed,
    lookAt,
    curve,
    followPointer,
  };
  const live = useRef<LiveProps>(props);
  useEffect(() => {
    live.current = props;
  });

  useEffect(() => {
    const svg = svgRef.current;
    const pair = pairRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    const leftPath = leftPathRef.current;
    const rightPath = rightPathRef.current;
    if (!svg || !pair || !left || !right || !leftPath || !rightPath) return;

    const engine = createEyesEngine(
      { pair, left, right, leftPath, rightPath },
      () => live.current,
    );

    // Respect reduced motion: no wandering or tilt, blinking stays.
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => engine.setReducedMotion(mq.matches);
    onMotion();
    mq.addEventListener("change", onMotion);

    // Pause off screen and in background tabs.
    let onScreen = true;
    const sync = () => engine.setRunning(onScreen && !document.hidden);
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      sync();
    });
    io.observe(svg);
    document.addEventListener("visibilitychange", sync);
    sync();

    // Pointer follow: map the pointer to -1..1 around the square's centre,
    // easing off (tanh) so far-away pointers still read as "over there".
    const onPointer = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const half = Math.max(1, r.width / 2) * 0.85;
      engine.setPointer(
        Math.tanh((e.clientX - (r.left + r.width / 2)) / half),
        Math.tanh((e.clientY - (r.top + r.height / 2)) / half),
      );
    };
    const onLeave = () => engine.clearPointer();
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    return () => {
      engine.destroy();
      io.disconnect();
      mq.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  const scale = pairScale(eyeSize);
  const dimension = typeof size === "number" ? `${size}px` : size;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className={cn("block select-none", className)}
      style={{
        width: dimension ?? "100%",
        height: dimension ?? "auto",
        aspectRatio: "1 / 1",
        overflow: "hidden",
        ...style,
      }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g
        ref={pairRef}
        transform={`translate(${CENTRE} ${CENTRE}) scale(${scale})`}
        fill="none"
        stroke={color}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      >
        <g ref={leftRef} transform={`translate(${-EYE_OFFSET_X} 0)`}>
          <path ref={leftPathRef} d={eyePath(1, 1, curve)} />
        </g>
        <g ref={rightRef} transform={`translate(${EYE_OFFSET_X} 0)`}>
          <path ref={rightPathRef} d={eyePath(-1, 1, curve)} />
        </g>
      </g>
    </svg>
  );
}

export default PaddyEyes;

// ---------------------------------------------------------------------------
// Animation engine (framework-free)
// ---------------------------------------------------------------------------

type LiveProps = {
  eyeSize: number;
  roam: number;
  wander: boolean;
  blink: boolean;
  closed: boolean;
  lookAt: { x: number; y: number } | null;
  curve: number;
  followPointer: boolean;
};

type Nodes = {
  pair: SVGGElement;
  left: SVGGElement;
  right: SVGGElement;
  leftPath: SVGPathElement;
  rightPath: SVGPathElement;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
// Pushes random samples toward the edges so glances travel further.
const outward = (u: number) => Math.sign(u) * Math.pow(Math.abs(u), 0.6);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
// Soft limit: linear near zero, eases into +/-max instead of hitting a wall.
const soft = (v: number, max: number) => max * Math.tanh(v / max);

function pairScale(eyeSize: number) {
  return (clamp(eyeSize, 0.15, 0.9) * VIEWBOX) / PAIR_W;
}

/**
 * How far the pair centre can sit from the middle of the square while the
 * whole pair (stroke and bending included) stays inside, for a given tilt
 * and stretch.
 */
function limits(eyeSize: number, tiltDeg = 0, sx = 1.02, sy = 1.02) {
  const s = pairScale(eyeSize);
  const hw = (PAIR_HALF_W + FLEX_X) * s * sx;
  const hh = (PAIR_HALF_H + FLEX_Y) * s * sy;
  const t = (Math.abs(tiltDeg) * Math.PI) / 180;
  const ew = hw * Math.cos(t) + hh * Math.sin(t);
  const eh = hw * Math.sin(t) + hh * Math.cos(t);
  return {
    x: Math.max(0, CENTRE - EDGE_PADDING - ew),
    y: Math.max(0, CENTRE - EDGE_PADDING - eh),
  };
}

// Blink timing in seconds: quick close, short hold, slower open.
const BLINK_CLOSE = 0.075;
const BLINK_HOLD = 0.04;
const BLINK_OPEN = 0.17;
const BLINK_TOTAL = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN;

function blinkAmount(t: number) {
  if (t < 0 || t > BLINK_TOTAL) return 0;
  if (t < BLINK_CLOSE) return Math.pow(t / BLINK_CLOSE, 2);
  if (t < BLINK_CLOSE + BLINK_HOLD) return 1;
  return 1 - easeOutCubic((t - BLINK_CLOSE - BLINK_HOLD) / BLINK_OPEN);
}

/**
 * A point that chases the pair on its own loose spring. The two ends and the
 * middle of each eye hang off three of these, so the curve bends while the
 * eyes travel and wobbles back to rest when they stop.
 */
type Trail = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: number;
  z: number;
};
const makeTrail = (k: number, z: number): Trail => ({
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  k,
  z,
});

function stepSpring(
  n: { x: number; y: number; vx: number; vy: number },
  tx: number,
  ty: number,
  k: number,
  z: number,
  h: number,
) {
  const c = 2 * z * Math.sqrt(k);
  n.vx += (-k * (n.x - tx) - c * n.vx) * h;
  n.vy += (-k * (n.y - ty) - c * n.vy) * h;
  n.x += n.vx * h;
  n.y += n.vy * h;
}

// How strongly the trailing translates into bending.
const JELLY_GAIN = 0.3;

export function createEyesEngine(nodes: Nodes, read: () => LiveProps) {
  const now = () => performance.now() / 1000;
  const start = now();

  const s = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    tx: 0,
    ty: 0,
    stiffness: 170,
    damping: 0.72,
    tilt: 0,
    lid: 0,
    nextMoveAt: start + rand(0.5, 1.2),
    nextBlinkAt: start + rand(1.2, 3),
    blinks: [] as number[],
    pointer: null as { x: number; y: number } | null,
    pointerAt: -Infinity,
    following: false,
    // Loose top, firmer middle, bottom in between: the eye leans and ripples.
    top: makeTrail(70, 0.36),
    mid: makeTrail(150, 0.5),
    bot: makeTrail(95, 0.42),
    reduced: false,
    running: false,
    raf: 0,
    last: start,
  };

  function queueBlink(at: number, allowDouble = true) {
    s.blinks.push(at);
    if (allowDouble && Math.random() < 0.2) s.blinks.push(at + 0.24);
  }

  function pickGlance(lx: number, ly: number) {
    const r = Math.random();
    // Back to centre now and then.
    if (r < 0.14) return { x: 0, y: 0, big: true };
    // Small flick from where we are.
    if (r < 0.36) {
      return {
        x: clamp(s.x + rand(-0.22, 0.22) * lx, -lx, lx),
        y: clamp(s.y + rand(-0.22, 0.22) * ly, -ly, ly),
        big: false,
      };
    }
    // A real glance: somewhere noticeably far from the current spot.
    let best = { x: 0, y: 0 };
    let bestDist = -1;
    for (let i = 0; i < 6; i++) {
      const c = { x: outward(rand(-1, 1)) * lx, y: outward(rand(-1, 1)) * ly };
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d > bestDist) {
        best = c;
        bestDist = d;
      }
      if (d > 0.45 * Math.max(lx, ly)) break;
    }
    return { ...best, big: true };
  }

  function frame() {
    const t = now();
    const dt = Math.min(0.05, Math.max(0, t - s.last));
    s.last = t;
    const p = read();

    const lim = limits(p.eyeSize); // at rest: used for picking targets
    const roam = clamp(p.roam, 0, 1);
    // Aim a little inside the wall so spring overshoot rarely touches it.
    const lx = lim.x * roam * 0.94;
    const ly = lim.y * roam * 0.94;

    // --- Where to look -----------------------------------------------------
    const pointerLive =
      p.followPointer &&
      !s.reduced &&
      s.pointer !== null &&
      t - s.pointerAt < POINTER_IDLE;

    if (p.lookAt) {
      s.following = false;
      s.tx = clamp(p.lookAt.x, -1, 1) * lx;
      s.ty = clamp(p.lookAt.y, -1, 1) * ly;
      s.stiffness = 140;
      s.damping = 0.85;
      s.nextMoveAt = t + rand(0.6, 1.4);
    } else if (pointerLive && s.pointer) {
      // A pointer that wakes up after a pause sometimes gets a "noticed you" blink.
      if (!s.following && p.blink && Math.random() < 0.35) queueBlink(t, false);
      s.following = true;
      s.tx = s.pointer.x * lx;
      s.ty = s.pointer.y * ly;
      s.stiffness = 120;
      s.damping = 0.78;
      s.nextMoveAt = t + rand(0.4, 1);
    } else if (p.wander && !s.reduced && roam > 0) {
      s.following = false;
      if (t >= s.nextMoveAt) {
        const g = pickGlance(lx, ly);
        s.tx = g.x;
        s.ty = g.y;
        if (g.big) {
          s.stiffness = rand(150, 210);
          s.damping = rand(0.62, 0.78);
          s.nextMoveAt = t + rand(0.9, 2.8);
          // People often blink as they shift gaze.
          if (p.blink && Math.random() < 0.3) {
            queueBlink(t, false);
            s.nextBlinkAt = Math.max(s.nextBlinkAt, t + 1.4);
          }
        } else {
          s.stiffness = 300;
          s.damping = 0.85;
          s.nextMoveAt = t + rand(0.35, 0.9);
        }
      }
    } else {
      s.following = false;
      s.tx = 0;
      s.ty = 0;
      s.stiffness = 120;
      s.damping = 1;
    }

    // --- Springs, in small fixed steps so stiff settings stay stable --------
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    let sx = 1;
    let sy = 1;
    for (let i = 0; i < steps; i++) {
      stepSpring(s, s.tx, s.ty, s.stiffness, s.damping, h);

      // Lean into the motion.
      const tiltTarget = s.reduced
        ? 0
        : clamp(s.vx * 0.008, -MAX_TILT_DEG, MAX_TILT_DEG);
      s.tilt += (tiltTarget - s.tilt) * (1 - Math.exp(-h * 12));

      // Squash and stretch along the direction of travel, gentle breathing at rest.
      const ax = s.reduced ? 0 : Math.min(Math.abs(s.vx) / 1600, 1) * 0.04;
      const ay = s.reduced ? 0 : Math.min(Math.abs(s.vy) / 1600, 1) * 0.04;
      const breathe = s.reduced ? 0 : Math.sin(t * 1.7) * 0.008;
      sx = 1 + ax - ay * 0.5 + breathe;
      sy = 1 + ay - ax * 0.5 + breathe;

      // Hard wall for the current tilt and stretch, so nothing ever clips.
      const wall = limits(p.eyeSize, s.tilt, sx + 0.01, sy + 0.01);
      if (Math.abs(s.x) > wall.x) {
        s.x = Math.sign(s.x) * wall.x;
        s.vx = 0;
      }
      if (Math.abs(s.y) > wall.y) {
        s.y = Math.sign(s.y) * wall.y;
        s.vy = 0;
      }

      // The soft parts chase the pair.
      for (const n of [s.top, s.mid, s.bot]) {
        if (s.reduced) {
          n.x = s.x;
          n.y = s.y;
          n.vx = n.vy = 0;
        } else {
          stepSpring(n, s.x, s.y, n.k, n.z, h);
        }
      }
    }

    // --- Blinks ---------------------------------------------------------------
    if (p.blink && !p.closed && t >= s.nextBlinkAt) {
      queueBlink(t);
      s.nextBlinkAt = t + rand(2.2, 5.5) * (s.reduced ? 1.6 : 1);
    }
    let b = 0;
    s.blinks = s.blinks.filter((bt) => t - bt <= BLINK_TOTAL);
    for (const bt of s.blinks) b = Math.max(b, blinkAmount(t - bt));
    s.lid += ((p.closed ? 1 : 0) - s.lid) * (1 - Math.exp(-dt * 16));
    b = Math.max(b, s.lid);

    render(p, lim, b, sx, sy);
  }

  let lastD = "";

  function render(
    p: LiveProps,
    lim: { x: number; y: number },
    b: number,
    sx: number,
    sy: number,
  ) {
    const scale = pairScale(p.eyeSize);

    // Head-turn depth: the far eye narrows and the pair draws together.
    const nx = lim.x > 0 ? clamp(s.x / lim.x, -1, 1) : 0;
    const ny = lim.y > 0 ? clamp(s.y / lim.y, -1, 1) : 0;
    const sep = 1 - 0.1 * Math.abs(nx);
    const leftW = 1 - 0.16 * Math.max(0, -nx);
    const rightW = 1 - 0.16 * Math.max(0, nx);
    const vert = 1 - 0.06 * Math.abs(ny);

    // Fluid curve: how far each soft point trails the pair (in source units),
    // plus a bow toward where the eyes are looking.
    const unit = scale * sx;
    const off = (n: Trail) => ({
      x: soft(((n.x - s.x) / unit) * JELLY_GAIN, JELLY_MAX_X),
      y: soft(((n.y - s.y) / unit) * JELLY_GAIN, JELLY_MAX_Y),
    });
    const top = off(s.top);
    const mid = off(s.mid);
    const bot = off(s.bot);
    const bend: Bend = {
      tx: top.x,
      ty: top.y,
      cx: mid.x + GAZE_BEND_X * nx,
      cy: mid.y + GAZE_BEND_Y * ny,
      bx: bot.x,
      by: bot.y,
    };

    // Blink: the curve shortens toward its centre while the eye flattens,
    // so it closes into a clean oval instead of a pinched crescent.
    const shape = 1 - Math.min(1, b * 1.35);
    const curve = clampCurve(p.curve);
    const dl = eyePath(1, shape, curve, bend);
    if (dl !== lastD) {
      lastD = dl;
      nodes.leftPath.setAttribute("d", dl);
      nodes.rightPath.setAttribute("d", eyePath(-1, shape, curve, bend));
    }
    const blinkY = 1 - 0.72 * b;
    const blinkX = 1 + 0.12 * b;
    const blinkDrop = 24 * b;

    nodes.pair.setAttribute(
      "transform",
      `translate(${fmt(CENTRE + s.x)} ${fmt(CENTRE + s.y)}) rotate(${fmt(s.tilt)}) scale(${fmt(scale * sx)} ${fmt(scale * sy)})`,
    );
    nodes.left.setAttribute(
      "transform",
      `translate(${fmt(-EYE_OFFSET_X * sep)} ${fmt(blinkDrop)}) scale(${fmt(leftW * blinkX)} ${fmt(vert * blinkY)})`,
    );
    nodes.right.setAttribute(
      "transform",
      `translate(${fmt(EYE_OFFSET_X * sep)} ${fmt(blinkDrop)}) scale(${fmt(rightW * blinkX)} ${fmt(vert * blinkY)})`,
    );
  }

  function loop() {
    frame();
    s.raf = requestAnimationFrame(loop);
  }

  return {
    setRunning(on: boolean) {
      if (on === s.running) return;
      s.running = on;
      if (on) {
        s.last = now();
        s.raf = requestAnimationFrame(loop);
      } else {
        cancelAnimationFrame(s.raf);
      }
    },
    setReducedMotion(on: boolean) {
      s.reduced = on;
    },
    /** Pointer position around the square's centre, -1..1 on each axis. */
    setPointer(x: number, y: number) {
      s.pointer = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
      s.pointerAt = now();
    },
    clearPointer() {
      s.pointer = null;
    },
    /** Trigger a blink now. */
    blink() {
      queueBlink(now(), false);
    },
    destroy() {
      s.running = false;
      cancelAnimationFrame(s.raf);
    },
  };
}
