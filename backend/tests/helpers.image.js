// Synthetic JPEG/PNG builders for tests (structure only, not decodable pictures).
const zlib = require('zlib');

const seg = (marker, payload) => {
  const len = Buffer.alloc(2); len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
};

// EXIF with an Orientation tag, a GPS-looking string and a device string that must NOT survive sanitising
function exifPayload({ orientation = 6, little = false } = {}) {
  const u16 = (v) => { const b = Buffer.alloc(2); little ? b.writeUInt16LE(v) : b.writeUInt16BE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); little ? b.writeUInt32LE(v) : b.writeUInt32BE(v); return b; };
  const secret = Buffer.from('SECRETGPS 13.0827N 80.2707E Pixel-9');
  const ifd = Buffer.concat([
    u16(2),
    u16(0x0112), u16(3), u32(1), u16(orientation), u16(0),
    u16(0x010f), u16(2), u32(secret.length), u32(8 + 2 + 24 + 4),
    u32(0),
    secret,
  ]);
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from(little ? 'II' : 'MM'), u16(42), u32(8), ifd]);
}

function jpeg({ width = 640, height = 480, exif = true, orientation = 6, little = false, icc = false, mpf = false, trailing = true, eoi = true } = {}) {
  const sof = Buffer.alloc(9); sof[0] = 8; sof.writeUInt16BE(height, 1); sof.writeUInt16BE(width, 3); sof[5] = 1; sof[6] = 1; sof[7] = 0x11; sof[8] = 0;
  const parts = [Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'))];
  if (exif) parts.push(seg(0xe1, exifPayload({ orientation, little })));
  parts.push(seg(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>SECRETXMP</x:xmpmeta>')));
  parts.push(seg(0xed, Buffer.from('Photoshop 3.0\0SECRETIPTC')));
  parts.push(seg(0xfe, Buffer.from('SECRETCOMMENT')));
  if (icc) parts.push(seg(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0\x01\x01', 'latin1'), Buffer.from('PROFILEDATA')])));
  if (mpf) parts.push(seg(0xe2, Buffer.from('MPF\0SECRETMPF', 'latin1')));
  parts.push(seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 3)])));
  parts.push(seg(0xc0, sof));
  parts.push(seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])));
  parts.push(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]));  // entropy data with stuffing + RST
  if (eoi) parts.push(Buffer.from([0xff, 0xd9]));
  if (trailing) parts.push(Buffer.from('TRAILING_SECRET_AFTER_EOI'));
  return Buffer.concat(parts);
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png({ width = 640, height = 480, iend = true, idat = true } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  parts.push(chunk('tEXt', Buffer.from('Comment\0SECRETTEXT GPS 13.08')));
  parts.push(chunk('eXIf', Buffer.from('SECRETEXIF')));
  parts.push(chunk('tIME', Buffer.alloc(7)));
  parts.push(chunk('sRGB', Buffer.from([0])));
  parts.push(chunk('prVt', Buffer.from('PRIVATECHUNK')));
  if (idat) parts.push(chunk('IDAT', zlib.deflateSync(Buffer.from('pixels'))));
  if (iend) parts.push(chunk('IEND', Buffer.alloc(0)));
  parts.push(Buffer.from('TRAILING_SECRET_AFTER_IEND'));
  return Buffer.concat(parts);
}

module.exports = { jpeg, png, seg, chunk };
