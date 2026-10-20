import type { HeightSampler, Vec3 } from "./types.js";

export interface HeightfieldDefinition extends HeightSampler {
  readonly nrows: number;
  readonly ncols: number;
  readonly heights: Float32Array;
  readonly scale: Vec3;
}

/** A deterministic, tiny heightfield used only by the sandbox. */
export function createDemoHeightfield(): HeightfieldDefinition {
  const nrows = 5;
  const ncols = 5;
  // Rapier's nrows/ncols describe cells; the sample matrix has one extra
  // vertex in each direction: (nrows + 1) * (ncols + 1).
  const heights = new Float32Array((nrows + 1) * (ncols + 1));

  for (let row = 0; row <= nrows; row += 1) {
    for (let col = 0; col <= ncols; col += 1) {
      const x = col / ncols;
      const z = row / nrows;
      heights[row * (ncols + 1) + col] = 0.12 * Math.sin(x * Math.PI) * Math.cos(z * Math.PI * 0.75);
    }
  }

  const scale = { x: 8, y: 1, z: 8 } satisfies Vec3;
  return {
    nrows,
    ncols,
    heights,
    scale,
    sample(x: number, z: number): number {
      return sampleHeightfield(heights, nrows, ncols, scale, x, z);
    },
  };
}

export function sampleHeightfield(
  heights: Float32Array,
  nrows: number,
  ncols: number,
  scale: Vec3,
  x: number,
  z: number,
): number {
  if (nrows < 1 || ncols < 1 || heights.length !== (nrows + 1) * (ncols + 1)) {
    throw new RangeError("heightfield dimensions and sample count must agree");
  }

  const u = clamp((x / scale.x + 0.5) * ncols, 0, ncols);
  const v = clamp((z / scale.z + 0.5) * nrows, 0, nrows);
  const col0 = Math.floor(u);
  const row0 = Math.floor(v);
  const col1 = Math.min(col0 + 1, ncols);
  const row1 = Math.min(row0 + 1, nrows);
  const tx = u - col0;
  const tz = v - row0;
  const stride = ncols + 1;
  const h00 = heights[row0 * stride + col0];
  const h10 = heights[row0 * stride + col1];
  const h01 = heights[row1 * stride + col0];
  const h11 = heights[row1 * stride + col1];
  const hx0 = h00 + (h10 - h00) * tx;
  const hx1 = h01 + (h11 - h01) * tx;
  return (hx0 + (hx1 - hx0) * tz) * scale.y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
