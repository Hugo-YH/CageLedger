export type Point = { x: number; y: number };
/** Decoder order, including when the code is rotated in the camera frame. */
export type Quad = readonly [Point, Point, Point, Point];

const EPSILON = 1e-8;
const MAX_TEXTURE_SIZE = 1024;

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Point>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validQuad(quad: Quad): boolean {
  if (quad.length !== 4 || !quad.every(isPoint)) return false;
  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  const scale = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!Number.isFinite(scale) || scale < EPSILON) return false;
  let direction = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = quad[index];
    const b = quad[(index + 1) % 4];
    const c = quad[(index + 2) % 4];
    const cross = ((b.x - a.x) / scale) * ((c.y - b.y) / scale) - ((b.y - a.y) / scale) * ((c.x - b.x) / scale);
    if (Math.abs(cross) < EPSILON) return false;
    if (direction && Math.sign(cross) !== direction) return false;
    direction = Math.sign(cross);
  }
  return true;
}

function insideFrame(quad: Quad, width: number, height: number): boolean {
  return quad.every((point) => point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height);
}

export function getQrCorners(location: unknown, width: number, height: number): Quad | null {
  if (!location || typeof location !== "object" || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  const value = location as Record<string, unknown>;
  const points = [value.topLeftCorner, value.topRightCorner, value.bottomRightCorner, value.bottomLeftCorner];
  if (!points.every(isPoint)) return null;
  const copied = points.map(({ x, y }) => ({ x, y }));
  const quad: Quad = [copied[0], copied[1], copied[2], copied[3]];
  return validQuad(quad) && insideFrame(quad, width, height) ? quad : null;
}

/** Solve the normalized homography with partial pivoting, rejecting singular systems. */
function solve(rows: number[][]): number[] | null {
  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < EPSILON) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index <= 8; index += 1) rows[column][index] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= 8; index += 1) rows[row][index] -= factor * rows[column][index];
    }
  }
  const result = rows.map((row) => row[8]);
  return result.every(Number.isFinite) ? result : null;
}

/** CSS column-major matrix3d. Apply with transform-origin: 0 0. */
export function rectangleToQuad(width: number, height: number, quad: Quad): number[] | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= EPSILON || height <= EPSILON) return null;
  if (!validQuad(quad)) return null;
  const originX = Math.min(...quad.map((point) => point.x));
  const originY = Math.min(...quad.map((point) => point.y));
  const scale = Math.max(...quad.map((point) => Math.max(point.x - originX, point.y - originY)));
  const unitCorners: Quad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const rows = unitCorners.flatMap(({ x: u, y: v }, index) => {
    const x = (quad[index].x - originX) / scale;
    const y = (quad[index].y - originY) / scale;
    return [
      [u, v, 1, 0, 0, 0, -u * x, -v * x, x],
      [0, 0, 0, u, v, 1, -u * y, -v * y, y],
    ];
  });
  const solution = solve(rows);
  if (!solution) return null;
  const [a, b, c, d, e, f, g, h] = solution;
  // The whole rectangle must stay in front of the projective horizon.
  if ([1, 1 + g, 1 + g + h, 1 + h].some((value) => value <= EPSILON)) return null;
  const matrix = [
    (scale * a + originX * g) / width,
    (scale * d + originY * g) / width,
    0,
    g / width,
    (scale * b + originX * h) / height,
    (scale * e + originY * h) / height,
    0,
    h / height,
    0,
    0,
    1,
    0,
    scale * c + originX,
    scale * f + originY,
    0,
    1,
  ];
  return matrix.every(Number.isFinite) ? matrix : null;
}

export function projectPoint(matrix: readonly number[], point: Point): Point | null {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite) || !isPoint(point)) return null;
  const denominator = matrix[3] * point.x + matrix[7] * point.y + matrix[15];
  if (Math.abs(denominator) < EPSILON) return null;
  const result = {
    x: (matrix[0] * point.x + matrix[4] * point.y + matrix[12]) / denominator,
    y: (matrix[1] * point.x + matrix[5] * point.y + matrix[13]) / denominator,
  };
  return isPoint(result) ? result : null;
}

/** Resample the actual frozen frame. No QR regeneration or added quiet-zone pixels. */
export function rectifyQr(image: ImageData, quad: Quad, size = 512): ImageData | null {
  if (!Number.isFinite(size) || size < 2) return null;
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (data.length < width * height * 4 || !validQuad(quad) || !insideFrame(quad, width, height)) return null;
  const side = Math.min(MAX_TEXTURE_SIZE, Math.floor(size));
  const matrix = rectangleToQuad(side, side, quad);
  if (!matrix) return null;
  const pixels = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const u = x + 0.5;
      const v = y + 0.5;
      const denominator = matrix[3] * u + matrix[7] * v + 1;
      // Coordinates describe pixel edges; sample the center of each output pixel.
      const sourceX = Math.min(
        width - 1,
        Math.max(0, (matrix[0] * u + matrix[4] * v + matrix[12]) / denominator - 0.5),
      );
      const sourceY = Math.min(
        height - 1,
        Math.max(0, (matrix[1] * u + matrix[5] * v + matrix[13]) / denominator - 0.5),
      );
      const left = Math.floor(sourceX);
      const top = Math.floor(sourceY);
      const right = Math.min(width - 1, left + 1);
      const bottom = Math.min(height - 1, top + 1);
      const dx = sourceX - left;
      const dy = sourceY - top;
      const target = (y * side + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const upper =
          data[(top * width + left) * 4 + channel] * (1 - dx) + data[(top * width + right) * 4 + channel] * dx;
        const lower =
          data[(bottom * width + left) * 4 + channel] * (1 - dx) + data[(bottom * width + right) * 4 + channel] * dx;
        pixels[target + channel] = upper * (1 - dy) + lower * dy;
      }
    }
  }
  // The pixel math also runs without a document (for tests or non-browser consumers).
  const colorSpace = image.colorSpace || "srgb";
  if (typeof ImageData === "undefined") return { data: pixels, width: side, height: side, colorSpace };
  return new ImageData(pixels, side, side, { colorSpace });
}
