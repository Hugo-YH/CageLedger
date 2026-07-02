const VERSION_SPECS = [
  { version: 1, dataCodewords: 19, eccCodewords: 7, alignmentCenters: [] },
  { version: 2, dataCodewords: 34, eccCodewords: 10, alignmentCenters: [6, 18] },
  { version: 3, dataCodewords: 55, eccCodewords: 15, alignmentCenters: [6, 22] },
  { version: 4, dataCodewords: 80, eccCodewords: 20, alignmentCenters: [6, 26] },
  { version: 5, dataCodewords: 108, eccCodewords: 26, alignmentCenters: [6, 30] },
];

export function qrCodeSvg(text: string, ariaLabel = "二维码", quietModules?: number) {
  const modules = qrCodeMatrix(text);
  const quiet = quietModules ?? (text.trim().length <= 4 ? 2 : 4);
  const viewBoxSize = modules.length + quiet * 2;
  const cells: string[] = [];
  modules.forEach((row, rowIndex) =>
    row.forEach((dark, colIndex) => {
      if (dark) cells.push(`<rect x="${colIndex + quiet}" y="${rowIndex + quiet}" width="1" height="1"/>`);
    }),
  );
  return `<svg viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" role="img" aria-label="${escapeAttribute(ariaLabel)}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="${viewBoxSize}" height="${viewBoxSize}" fill="#fff"/><g fill="#000">${cells.join("")}</g></svg>`;
}

export function qrCodeMatrix(text: string) {
  const bytes = new TextEncoder().encode(text);
  const spec =
    VERSION_SPECS.find((item) => encodedByteLength(bytes.length) <= item.dataCodewords) ||
    VERSION_SPECS[VERSION_SPECS.length - 1];
  if (encodedByteLength(bytes.length) > spec.dataCodewords) throw new Error("二维码内容过长");
  const size = spec.version * 4 + 17;
  const matrix = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const setFunction = (row: number, col: number, dark: boolean) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    matrix[row][col] = dark;
    reserved[row][col] = true;
  };
  const drawFinder = (row: number, col: number) => {
    for (let y = -1; y <= 7; y += 1)
      for (let x = -1; x <= 7; x += 1) {
        const inFinder = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const dark = inFinder && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        setFunction(row + y, col + x, dark);
      }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);
  for (let index = 8; index < size - 8; index += 1) {
    setFunction(6, index, index % 2 === 0);
    setFunction(index, 6, index % 2 === 0);
  }
  for (const row of spec.alignmentCenters)
    for (const col of spec.alignmentCenters) {
      if (reserved[row][col]) continue;
      for (let y = -2; y <= 2; y += 1)
        for (let x = -2; x <= 2; x += 1) setFunction(row + y, col + x, Math.max(Math.abs(x), Math.abs(y)) !== 1);
    }
  setFunction(size - 8, 8, true);
  reserveFormatAreas(reserved, size);
  const data = encodeData(bytes, spec.dataCodewords);
  const codewords = [...data, ...reedSolomonRemainder(data, spec.eccCodewords)];
  placeData(matrix, reserved, codewords);
  applyMask(matrix, reserved);
  drawFormatBits(matrix, reserved);
  return matrix;
}

function encodedByteLength(byteLength: number) {
  return Math.ceil((4 + 8 + byteLength * 8) / 8);
}

function reserveFormatAreas(reserved: boolean[][], size: number) {
  for (let index = 0; index <= 8; index += 1)
    if (index !== 6) {
      reserved[8][index] = true;
      reserved[index][8] = true;
    }
  for (let index = 0; index < 8; index += 1) {
    reserved[size - 1 - index][8] = true;
    reserved[8][size - 1 - index] = true;
  }
}

function encodeData(bytes: Uint8Array, capacity: number) {
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, 8);
  bytes.forEach((byte) => append(byte, 8));
  const totalBits = capacity * 8;
  for (let index = 0; index < Math.min(4, totalBits - bits.length); index += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8)
    data.push(bits.slice(index, index + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  for (let pad = 0; data.length < capacity; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11);
  return data;
}

function reedSolomonRemainder(data: number[], degree: number) {
  const divisor = reedSolomonDivisor(degree);
  const result = Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() || 0);
    result.push(0);
    for (let index = 0; index < degree; index += 1) result[index] ^= gfMultiply(divisor[index], factor);
  }
  return result;
}

function reedSolomonDivisor(degree: number) {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let term = 0; term < degree; term += 1) {
      result[term] = gfMultiply(result[term], root);
      if (term + 1 < degree) result[term] ^= result[term + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function gfMultiply(x: number, y: number) {
  let product = 0;
  for (let index = 7; index >= 0; index -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((y >>> index) & 1) * x;
  }
  return product & 0xff;
}

function placeData(matrix: boolean[][], reserved: boolean[][], codewords: number[]) {
  const bits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let right = matrix.length - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < matrix.length; vertical += 1) {
      const row = upward ? matrix.length - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        if (reserved[row][col]) continue;
        matrix[row][col] = bitIndex < bits.length ? Boolean(bits[bitIndex]) : false;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function applyMask(matrix: boolean[][], reserved: boolean[][]) {
  for (let row = 0; row < matrix.length; row += 1)
    for (let col = 0; col < matrix.length; col += 1) {
      if (!reserved[row][col] && (row + col) % 2 === 0) matrix[row][col] = !matrix[row][col];
    }
}

function drawFormatBits(matrix: boolean[][], reserved: boolean[][]) {
  const size = matrix.length;
  const bits = formatBits();
  const set = (row: number, col: number, index: number) => {
    matrix[row][col] = Boolean((bits >>> index) & 1);
    reserved[row][col] = true;
  };
  for (let index = 0; index <= 5; index += 1) set(index, 8, index);
  set(7, 8, 6);
  set(8, 8, 7);
  set(8, 7, 8);
  for (let index = 9; index < 15; index += 1) set(8, 14 - index, index);
  for (let index = 0; index < 8; index += 1) set(8, size - 1 - index, index);
  for (let index = 8; index < 15; index += 1) set(size - 15 + index, 8, index);
  matrix[size - 8][8] = true;
}

function formatBits() {
  const data = 1 << 3;
  let value = data << 10;
  for (let index = 14; index >= 10; index -= 1) if ((value >>> index) & 1) value ^= 0x537 << (index - 10);
  return ((data << 10) | value) ^ 0x5412;
}

function escapeAttribute(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character,
  );
}
