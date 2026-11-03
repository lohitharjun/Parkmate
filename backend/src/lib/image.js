// Dependency-free image sanitiser for listing photos (JPEG and PNG only).
//
// Why: phone photos carry EXIF (GPS position, device, timestamps), XMP, IPTC and text chunks. Consumers must not
// receive that, and it must never be treated as proof of where a photo was taken (it can be missing or edited).
// We never re-encode pixels: we parse the container, keep only the structural/colour segments and drop the rest.
//   JPEG: keeps JFIF (APP0), ICC colour profile (APP2 "ICC_PROFILE"), Adobe (APP14), tables, frame and scan data.
//         Drops EXIF/XMP (APP1), IPTC/Photoshop (APP13), MPF and other APPn, comments, and anything after EOI.
//         Re-adds a minimal EXIF segment holding ONLY the Orientation tag, so rotated phone photos still display upright.
//   PNG:  keeps critical chunks and colour/transparency/animation chunks. Drops eXIf, tEXt/zTXt/iTXt, tIME,
//         unknown chunks and anything after IEND.
const { ApiError, bad, unsupportedType } = require('../errors');

const MIN_SIDE = 200;       // px, rejects 1x1 trackers and icons
const MAX_SIDE = 16384;     // px per side
const MAX_PIXELS = 120e6;   // total pixels

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'hIST', 'pHYs', 'sPLT', 'acTL', 'fcTL', 'fdAT']);

const invalid = (why) => bad(`The image is not a valid JPEG or PNG (${why})`);

function detectType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  return null;
}

function checkDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw invalid('missing dimensions');
  if (width < MIN_SIDE || height < MIN_SIDE) throw bad(`The image is too small: at least ${MIN_SIDE}x${MIN_SIDE} pixels are required`);
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw bad('The image dimensions are too large');
}

// ---- EXIF orientation (the only EXIF value we keep) ----
function readExifOrientation(t) {
  if (t.length < 8) return null;
  const le = t[0] === 0x49 && t[1] === 0x49;
  const be = t[0] === 0x4d && t[1] === 0x4d;
  if (!le && !be) return null;
  const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > t.length) return null;
  const n = u16(ifd);
  for (let i = 0; i < n; i += 1) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112) {
      if (u16(e + 2) !== 3 || u32(e + 4) !== 1) return null;
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

function orientationSegment(v) {
  return Buffer.from([
    0xff, 0xe1, 0x00, 0x22,                         // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,             // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF header (big endian), IFD0 at offset 8
    0x00, 0x01,                                     // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, v, 0x00, 0x00, // Orientation, SHORT, count 1, value v
    0x00, 0x00, 0x00, 0x00,                         // no next IFD
  ]);
}

const startsWith = (buf, text) => buf.length >= text.length && buf.toString('latin1', 0, text.length) === text;

function keepJpegSegment(marker, payload) {
  if (marker === 0xe0) return true;                                     // JFIF
  if (marker === 0xe2) return startsWith(payload, 'ICC_PROFILE\0');     // colour profile only (not MPF)
  if (marker === 0xee) return startsWith(payload, 'Adobe');             // colour transform flag
  if (marker >= 0xe1 && marker <= 0xef) return false;                  // EXIF/XMP, IPTC, other APPn
  if (marker === 0xfe) return false;                                    // comment
  if (marker >= 0xf0 && marker <= 0xfd) return false;                  // JPEG extension markers
  return true;                                                          // DQT, DHT, SOFn, SOS, DRI, ...
}

const isSof = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function processJpeg(buf) {
  const len = buf.length;
  const segments = [];
  let pos = 2;
  let sawSos = false;
  let sawEoi = false;
  let orientation = null;
  let width = 0;
  let height = 0;

  while (pos < len) {
    if (buf[pos] !== 0xff) throw invalid('bad marker');
    while (pos < len && buf[pos] === 0xff) pos += 1;       // fill bytes
    if (pos >= len) throw invalid('truncated');
    const marker = buf[pos];
    pos += 1;
    if (marker === 0xd9) { sawEoi = true; break; }          // EOI: everything after it is dropped
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // no length field
    if (pos + 2 > len) throw invalid('truncated');
    const segLen = buf.readUInt16BE(pos);
    if (segLen < 2 || pos + segLen > len) throw invalid('bad segment length');
    const payload = buf.subarray(pos + 2, pos + segLen);
    const segment = buf.subarray(pos - 2, pos + segLen);   // FF <marker> <len> <payload>
    pos += segLen;

    if (isSof(marker) && payload.length >= 5 && width === 0) {
      height = payload.readUInt16BE(1);
      width = payload.readUInt16BE(3);
    }
    if (marker === 0xe1 && orientation === null && startsWith(payload, 'Exif\0\0')) {
      orientation = readExifOrientation(payload.subarray(6));
    }
    if (keepJpegSegment(marker, payload)) segments.push({ marker, buf: segment });

    if (marker === 0xda) {                                  // SOS: copy entropy-coded data up to the next real marker
      sawSos = true;
      let q = pos;
      while (q < len) {
        if (buf[q] === 0xff) {
          const next = buf[q + 1];
          if (next === undefined) { q = len; break; }
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { q += 2; continue; }
          if (next === 0xff) { q += 1; continue; }
          break;
        }
        q += 1;
      }
      segments.push({ marker: null, buf: buf.subarray(pos, q) });
      pos = q;
    }
  }
  if (!sawSos || !sawEoi) throw invalid('incomplete or corrupted file');
  checkDimensions(width, height);

  const out = [Buffer.from([0xff, 0xd8])];
  let i = 0;
  while (i < segments.length && segments[i].marker === 0xe0) { out.push(segments[i].buf); i += 1; } // JFIF first
  if (orientation && orientation !== 1) out.push(orientationSegment(orientation));
  for (; i < segments.length; i += 1) out.push(segments[i].buf);
  out.push(Buffer.from([0xff, 0xd9]));
  return { buffer: Buffer.concat(out), contentType: 'image/jpeg', ext: 'jpg', width, height, orientation };
}

function processPng(buf) {
  const len = buf.length;
  const parts = [PNG_SIG];
  let pos = 8;
  let width = 0;
  let height = 0;
  let first = true;
  let sawIdat = false;
  let sawIend = false;

  while (pos + 12 <= len) {
    const clen = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + clen;
    if (end > len) throw invalid('truncated chunk');
    if (first) {
      if (type !== 'IHDR' || clen !== 13) throw invalid('missing header');
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
      first = false;
    }
    if (type === 'IDAT') sawIdat = true;
    if (PNG_KEEP.has(type)) parts.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') { sawIend = true; break; }      // anything after IEND is dropped
  }
  if (first || !sawIdat || !sawIend) throw invalid('incomplete or corrupted file');
  checkDimensions(width, height);
  return { buffer: Buffer.concat(parts), contentType: 'image/png', ext: 'png', width, height, orientation: null };
}

// buf -> { buffer (sanitised), contentType, ext, width, height, orientation }. Throws ApiError (400/415) when unusable.
function processImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw unsupportedType('No image received');
  const type = detectType(buf);
  if (!type) throw unsupportedType('Only JPEG and PNG images are accepted');
  try {
    return type === 'image/jpeg' ? processJpeg(buf) : processPng(buf);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw invalid('unreadable file'); // e.g. RangeError from a malformed length
  }
}

module.exports = { processImage, detectType, readExifOrientation, orientationSegment, MIN_SIDE };
