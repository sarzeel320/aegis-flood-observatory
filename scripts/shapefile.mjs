// Minimal ESRI Shapefile (.shp/.dbf) reader with no dependencies.
// Supports shape types 3 (PolyLine), 5 (Polygon) and 1 (Point) and produces GeoJSON.
// Reference: ESRI Shapefile Technical Description (July 1998).
import { openSync, readSync, closeSync, fstatSync, readFileSync } from 'node:fs';

function ringArea(ring) {
  let area = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return area / 2; // negative = clockwise (shapefile outer ring), positive = counter-clockwise
}
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Assign clockwise rings as outer polygons and counter-clockwise rings as holes of the containing outer ring.
function ringsToGeometry(rings) {
  const outers = [], holes = [];
  for (const ring of rings) (ringArea(ring) < 0 ? outers : holes).push(ring);
  if (outers.length === 0 && holes.length) outers.push(...holes.splice(0));
  const polygons = outers.map(ring => [ring.slice().reverse()]); // GeoJSON outer rings are counter-clockwise
  for (const hole of holes) {
    const target = polygons.find(([outer]) => pointInRing(hole[0], outer)) || polygons[0];
    target.push(hole.slice().reverse());
  }
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
}
function readParts(buffer, offset) {
  const numParts = buffer.readInt32LE(offset + 36), numPoints = buffer.readInt32LE(offset + 40);
  const parts = [];
  for (let i = 0; i < numParts; i++) parts.push(buffer.readInt32LE(offset + 44 + i * 4));
  const pointsStart = offset + 44 + numParts * 4;
  const rings = [];
  for (let p = 0; p < numParts; p++) {
    const start = parts[p], end = p + 1 < numParts ? parts[p + 1] : numPoints, ring = [];
    for (let i = start; i < end; i++) ring.push([buffer.readDoubleLE(pointsStart + i * 16), buffer.readDoubleLE(pointsStart + i * 16 + 8)]);
    rings.push(ring);
  }
  const bbox = [buffer.readDoubleLE(offset + 4), buffer.readDoubleLE(offset + 12), buffer.readDoubleLE(offset + 20), buffer.readDoubleLE(offset + 28)];
  return { rings, bbox };
}
// Iterate over records of a .shp file. Each yields {index, bbox, geometry|null}. Skipped (null) shapes yield geometry null.
export function* readShapes(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const header = Buffer.alloc(100);
    readSync(fd, header, 0, 100, 0);
    if (header.readInt32BE(0) !== 9994) throw new Error('Not a shapefile');
    let position = 100, index = 0;
    const recordHeader = Buffer.alloc(8);
    while (position + 8 <= size) {
      readSync(fd, recordHeader, 0, 8, position);
      const contentLength = recordHeader.readInt32BE(4) * 2;
      const body = Buffer.alloc(contentLength);
      readSync(fd, body, 0, contentLength, position + 8);
      position += 8 + contentLength;
      const type = body.readInt32LE(0);
      let geometry = null, bbox = null;
      if (type === 5 || type === 3) {
        const { rings, bbox: box } = readParts(body, 0);
        bbox = box;
        geometry = type === 5 ? ringsToGeometry(rings) : rings.length === 1 ? { type: 'LineString', coordinates: rings[0] } : { type: 'MultiLineString', coordinates: rings };
      } else if (type === 1) {
        const point = [body.readDoubleLE(4), body.readDoubleLE(12)];
        geometry = { type: 'Point', coordinates: point }; bbox = [...point, ...point];
      }
      yield { index: index++, bbox, geometry };
    }
  } finally { closeSync(fd); }
}
// Read .dbf attribute records as plain objects. Character fields are trimmed; numeric fields parsed.
export function readDbf(path, { encoding = 'latin1', filter } = {}) {
  const buffer = readFileSync(path);
  const recordCount = buffer.readUInt32LE(4), headerLength = buffer.readUInt16LE(8), recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let offset = 32; buffer[offset] !== 0x0d && offset < headerLength; offset += 32) {
    const name = buffer.toString('ascii', offset, offset + 11).replace(/\0.*$/, '').trim();
    fields.push({ name, type: String.fromCharCode(buffer[offset + 11]), length: buffer[offset + 16], decimals: buffer[offset + 17] });
  }
  const records = new Array(filter ? 0 : recordCount);
  for (let i = 0; i < recordCount; i++) {
    const start = headerLength + i * recordLength;
    const deleted = buffer[start] === 0x2a;
    const record = { __index: i, __deleted: deleted };
    let offset = start + 1;
    for (const field of fields) {
      const raw = buffer.toString(encoding, offset, offset + field.length).trim();
      offset += field.length;
      if (field.type === 'N' || field.type === 'F') record[field.name] = raw === '' ? null : Number(raw);
      else if (field.type === 'L') record[field.name] = /[YyTt]/.test(raw);
      else record[field.name] = raw;
    }
    if (filter) { if (filter(record)) records.push(record); } else records[i] = record;
  }
  return { fields, records, recordCount };
}
export function readPrj(path) { try { return readFileSync(path, 'utf8').trim(); } catch { return null; } }
export function pointInGeometry(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(([outer, ...holes]) => pointInRing(point, outer) && !holes.some(hole => pointInRing(point, hole)));
}
export function inBbox([x, y], [minX, minY, maxX, maxY]) { return x >= minX && x <= maxX && y >= minY && y <= maxY; }
