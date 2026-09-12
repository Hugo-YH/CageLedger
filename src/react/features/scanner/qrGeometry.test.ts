import { describe, expect, it } from "vitest";
import { getQrCorners, projectPoint, rectangleToQuad, rectifyQr, type Point, type Quad } from "./qrGeometry";

const square: Quad = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

function location([topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner]: Quad) {
  return { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner };
}

function image(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set([x * 20, y * 30, (x + y) % 2 ? 255 : 0, 255], (y * width + x) * 4);
  }
  return { data, width, height, colorSpace: "srgb" };
}

function pixel(source: ImageData, x: number, y: number) {
  const index = (y * source.width + x) * 4;
  return Array.from(source.data.slice(index, index + 4));
}

function expectPoint(actual: Point | null, expected: Point) {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, 7);
  expect(actual!.y).toBeCloseTo(expected.y, 7);
}

describe("QR frame geometry", () => {
  it("keeps the decoder's ordered real corners and copies them away from mutable results", () => {
    const result = location(square);
    const corners = getQrCorners(result, 4, 4);
    expect(corners).toEqual(square);
    expect(corners![0]).not.toBe(result.topLeftCorner);
    expect(getQrCorners({}, 4, 4)).toBeNull();
    expect(getQrCorners({ topLeftCorner: square[0] }, 4, 4)).toBeNull();
    expect(getQrCorners(null, 4, 4)).toBeNull();
  });

  it.each([
    [
      "perspective",
      [
        { x: 30, y: 20 },
        { x: 220, y: 45 },
        { x: 185, y: 190 },
        { x: 12, y: 145 },
      ],
    ],
    [
      "90 degree rotation",
      [
        { x: 220, y: 20 },
        { x: 220, y: 190 },
        { x: 30, y: 190 },
        { x: 30, y: 20 },
      ],
    ],
    [
      "mirrored orientation",
      [
        { x: 220, y: 20 },
        { x: 30, y: 20 },
        { x: 30, y: 190 },
        { x: 220, y: 190 },
      ],
    ],
  ] as const)("maps all corners for %s without assuming screen top-left", (_, quad) => {
    const matrix = rectangleToQuad(100, 80, quad);
    expect(matrix).not.toBeNull();
    const original: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    original.forEach((point, index) => expectPoint(projectPoint(matrix!, point), quad[index]));
    expect(getQrCorners(location(quad), 240, 200)).toEqual(quad);
  });

  it("maps the center to the diagonals' intersection, not the four-corner average", () => {
    const trapezoid: Quad = [
      { x: 1, y: 1 },
      { x: 7, y: 1 },
      { x: 6, y: 7 },
      { x: 2, y: 7 },
    ];
    const matrix = rectangleToQuad(200, 100, trapezoid)!;
    expectPoint(projectPoint(matrix, { x: 100, y: 50 }), { x: 4, y: 4.6 });
  });

  it.each([
    [
      "crossed",
      [
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        { x: 4, y: 0 },
        { x: 0, y: 4 },
      ],
    ],
    [
      "concave",
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 4 },
      ],
    ],
    [
      "collinear",
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
    ],
    [
      "duplicate",
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 4 },
      ],
    ],
    [
      "non-finite",
      [
        { x: 0, y: 0 },
        { x: NaN, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    ],
  ] as const)("rejects %s corners instead of creating an invalid animation matrix", (_, quad) => {
    expect(getQrCorners(location(quad), 4, 4)).toBeNull();
    expect(rectangleToQuad(4, 4, quad)).toBeNull();
    expect(rectifyQr(image(4, 4), quad, 4)).toBeNull();
  });

  it("rejects out-of-frame detections, invalid dimensions and projective horizons", () => {
    expect(getQrCorners(location(square), 3, 4)).toBeNull();
    expect(getQrCorners(location(square), Infinity, 4)).toBeNull();
    expect(rectifyQr(image(3, 4), square, 4)).toBeNull();
    expect(rectangleToQuad(0, 4, square)).toBeNull();
    expect(rectangleToQuad(NaN, 4, square)).toBeNull();
    const matrix = rectangleToQuad(4, 4, square)!;
    matrix[3] = -1;
    expect(projectPoint(matrix, { x: 1, y: 0 })).toBeNull();
    expect(projectPoint([], { x: 1, y: 0 })).toBeNull();
    expect(projectPoint(matrix, { x: Infinity, y: 0 })).toBeNull();
  });
});

describe("real frame QR rectification", () => {
  it("preserves every RGBA pixel for an identity transform and does not mutate the frozen frame", () => {
    const frame = image(4, 4);
    const before = frame.data.slice();
    const output = rectifyQr(frame, square, 4)!;
    expect(output.data).toEqual(before);
    expect(frame.data).toEqual(before);
    expect(output.data).not.toBe(frame.data);
  });

  it("corrects a rotated code using actual source colors and details", () => {
    const frame = image(4, 4);
    const rotated: Quad = [square[1], square[2], square[3], square[0]];
    const output = rectifyQr(frame, rotated, 4)!;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) expect(pixel(output, x, y)).toEqual(pixel(frame, 3 - y, x));
    }
  });

  it("samples perspective pixels with bilinear interpolation", () => {
    const trapezoid: Quad = [
      { x: 1, y: 1 },
      { x: 7, y: 1 },
      { x: 6, y: 7 },
      { x: 2, y: 7 },
    ];
    const output = rectifyQr(image(8, 8), trapezoid, 3)!;
    // The central ray intersects source (4, 4.6), or pixel-center coordinates (3.5, 4.1).
    const center = pixel(output, 1, 1);
    expect(center[0]).toBe(70);
    expect(center[1]).toBe(123);
    expect(center[3]).toBe(255);
  });

  it("caps texture allocation and rejects malformed pixel buffers and invalid sizes", () => {
    const frame = image(4, 4);
    const output = rectifyQr(frame, square, 100_000)!;
    expect([output.width, output.height, output.data.length]).toEqual([1024, 1024, 1024 * 1024 * 4]);
    expect(rectifyQr(frame, square, 1)).toBeNull();
    expect(rectifyQr(frame, square, NaN)).toBeNull();
    expect(rectifyQr(frame, square, Infinity)).toBeNull();
    expect(rectifyQr({ ...frame, data: frame.data.slice(0, 3) }, square, 4)).toBeNull();
  });
});
