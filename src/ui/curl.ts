/**
 * The page curl as keyframes on one timeline. Every value is a function of the
 * eased progress `p` (0 to 1): the effect carries the paper ease, so the leaf,
 * its light and the shadows it casts all move together.
 *
 * Geometry: the leaf turns about the gutter by θ = 180°·p. While θ < 90° its
 * free edge projects at cos θ of a half width from the gutter, over the page it
 * uncovers ("near"); past 90° it lies over the facing page ("far").
 */

export const CURL_MS = 450;
export const CURL_REDUCED_MS = 180;
/** The same curve as `--ease-paper` in styles.css. */
export const EASE_PAPER = "cubic-bezier(0.22, 0.7, 0.2, 1)";

const STEPS = 18;

/**
 * The eye's distance from the book, in px. A leaf swinging up toward the eye
 * grows by P / (P − z); at 20 000 px a 540 px half page grows under 3 %, so the
 * sheet reads as lifting, not inflating. BookView sets it on `.book`.
 */
export const CURL_PERSPECTIVE = 20000;
/** How far the hand raises the sheet at most: a few pixels, and the faintest tilt. */
export const LIFT_PX = 3;
export const TILT_DEG = 0.4;

export type CurlFrames = {
  leaf: Keyframe[];
  frontLight: Keyframe[];
  backLight: Keyframe[];
  near: Keyframe[];
  far: Keyframe[];
};

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** How far the hand has lifted the sheet: quick to rise, slow to settle. */
export function lift(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return Math.sin(Math.PI * Math.pow(p, 0.62));
}

export function curlFrames(forward: boolean): CurlFrames {
  const s = forward ? -1 : 1;
  const frames: CurlFrames = { leaf: [], frontLight: [], backLight: [], near: [], far: [] };
  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    const offset = round(p, 4);
    const theta = 180 * p;
    const rad = (theta * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const l = lift(p);
    frames.leaf.push({
      offset,
      transform: `translateY(${round(-LIFT_PX * l, 2)}px) rotateZ(${round(s * TILT_DEG * l, 3)}deg) rotateY(${round(s * theta, 3)}deg)`,
    });
    // The face darkens as it turns away from the light; the back brightens as it lands.
    frames.frontLight.push({ offset, opacity: round(theta <= 90 ? 1 - cos : 1) });
    frames.backLight.push({ offset, opacity: round(theta >= 90 ? 1 + cos : 1) });
    // The shadow on the uncovered page follows the leaf's edge, then lingers by the gutter.
    const nearX = theta <= 90 ? cos : 0;
    const nearO = theta <= 90 ? sin : sin * (1 - (0.45 * (theta - 90)) / 90);
    frames.near.push({ offset, opacity: round(Math.max(0, nearO)), transform: `translateX(${round(-s * nearX * 100, 2)}%)` });
    // Past the upright, the leaf shades the page it is about to cover.
    const farO = theta > 90 ? Math.sin((2 * (theta - 90) * Math.PI) / 180) : 0;
    const farX = theta > 90 ? -cos : 0;
    frames.far.push({ offset, opacity: round(Math.max(0, farO)), transform: `translateX(${round(s * farX * 100, 2)}%)` });
  }
  return frames;
}

/**
 * Where the leaf's free edge appears on screen at eased progress `p`, as the
 * vertical span of its two corners relative to the book's top and bottom (0 and
 * `height`). Mirrors the CSS: the leaf turns about the gutter at the book's
 * middle height, `translateY rotateZ rotateY` applied to the corner, then
 * projected with the perspective origin at the book's centre (the gutter).
 */
export function freeEdgeSpan(
  p: number,
  forward: boolean,
  half: number,
  height: number,
  perspective = CURL_PERSPECTIVE,
): { top: number; bottom: number } {
  const s = forward ? -1 : 1;
  const theta = (s * 180 * p * Math.PI) / 180;
  const phi = (s * TILT_DEG * lift(p) * Math.PI) / 180;
  const ty = -LIFT_PX * lift(p);
  // The free edge, from the axis: forward leaves lie to the right of the gutter, back leaves to the left.
  const x0 = forward ? half : -half;
  const ys = [-height / 2, height / 2].map((y0) => {
    // rotateY
    const x1 = x0 * Math.cos(theta);
    const z1 = -x0 * Math.sin(theta);
    // rotateZ
    const y2 = x1 * Math.sin(phi) + y0 * Math.cos(phi);
    // translateY, then the projection
    const y3 = y2 + ty;
    return (y3 * perspective) / (perspective - z1) + height / 2;
  });
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}
