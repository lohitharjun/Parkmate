const test = require('node:test');
const assert = require('node:assert');
const { processImage, readExifOrientation, orientationSegment, detectType } = require('../src/lib/image');
const { jpeg, png } = require('./helpers.image');

const has = (buf, text) => buf.includes(Buffer.from(text));
const code = (fn) => { try { fn(); } catch (e) { return `${e.status}:${e.code}`; } return 'no error'; };

test('JPEG: EXIF, XMP, IPTC, comment, MPF and trailing data are removed', () => {
  const out = processImage(jpeg({ mpf: true }));
  for (const s of ['SECRETGPS', 'Pixel-9', 'SECRETXMP', 'SECRETIPTC', 'SECRETCOMMENT', 'SECRETMPF', 'TRAILING_SECRET']) {
    assert.ok(!has(out.buffer, s), `${s} leaked`);
  }
  assert.strictEqual(out.contentType, 'image/jpeg');
  assert.strictEqual(out.ext, 'jpg');
  assert.deepStrictEqual([out.width, out.height], [640, 480]);
  assert.deepStrictEqual([...out.buffer.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepStrictEqual([...out.buffer.subarray(-2)], [0xff, 0xd9]);
});

test('JPEG: only the Orientation tag survives, and is readable (big and little endian sources)', () => {
  for (const little of [false, true]) {
    const out = processImage(jpeg({ orientation: 6, little }));
    assert.strictEqual(out.orientation, 6);
    const i = out.buffer.indexOf(Buffer.from('Exif\0\0', 'latin1'));
    assert.ok(i > 0, 'minimal EXIF segment missing');
    assert.strictEqual(readExifOrientation(out.buffer.subarray(i + 6, i + 6 + 26)), 6);
    assert.strictEqual(out.buffer.readUInt16BE(i - 2), 34, 'segment length');
    // sanitising twice changes nothing
    assert.ok(processImage(out.buffer).buffer.equals(out.buffer));
  }
});

test('JPEG: no EXIF / orientation 1 -> no EXIF segment at all; scan data and tables are kept', () => {
  for (const o of [jpeg({ exif: false }), jpeg({ orientation: 1 })]) {
    const out = processImage(o);
    assert.ok(!has(out.buffer, 'Exif'));
    assert.ok(out.buffer.includes(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78])), 'entropy data changed');
    assert.ok(out.buffer.includes(Buffer.from([0xff, 0xdb])) && out.buffer.includes(Buffer.from([0xff, 0xc0])));
  }
});

test('JPEG: JFIF stays first, ICC colour profile is kept', () => {
  const out = processImage(jpeg({ icc: true }));
  assert.deepStrictEqual([...out.buffer.subarray(2, 4)], [0xff, 0xe0]);
  assert.ok(has(out.buffer, 'ICC_PROFILE') && has(out.buffer, 'PROFILEDATA'));
});

test('PNG: text/EXIF/time/private chunks and trailing data are removed, structure kept', () => {
  const out = processImage(png());
  for (const s of ['SECRETTEXT', 'SECRETEXIF', 'PRIVATECHUNK', 'TRAILING_SECRET', 'tIME', 'tEXt', 'eXIf']) assert.ok(!has(out.buffer, s), `${s} leaked`);
  for (const s of ['IHDR', 'sRGB', 'IDAT', 'IEND']) assert.ok(has(out.buffer, s), `${s} missing`);
  assert.strictEqual(out.contentType, 'image/png');
  assert.deepStrictEqual([out.width, out.height], [640, 480]);
  assert.ok(processImage(out.buffer).buffer.equals(out.buffer));
});

test('rejects things that are not usable photos', () => {
  assert.strictEqual(code(() => processImage(Buffer.from('hello world, not an image'))), '415:UNSUPPORTED_FILE_TYPE');
  assert.strictEqual(code(() => processImage(Buffer.alloc(0))), '415:UNSUPPORTED_FILE_TYPE');
  assert.strictEqual(code(() => processImage(Buffer.from('GIF89a......'))), '415:UNSUPPORTED_FILE_TYPE');
  assert.strictEqual(code(() => processImage(jpeg({ eoi: false, trailing: false }))), '400:VALIDATION_ERROR');   // truncated
  assert.strictEqual(code(() => processImage(jpeg().subarray(0, 40))), '400:VALIDATION_ERROR');
  assert.strictEqual(code(() => processImage(jpeg({ width: 50, height: 50 }))), '400:VALIDATION_ERROR');          // too small
  assert.strictEqual(code(() => processImage(jpeg({ width: 20000, height: 20000 }))), '400:VALIDATION_ERROR');   // too large
  assert.strictEqual(code(() => processImage(png({ iend: false }))), '400:VALIDATION_ERROR');
  assert.strictEqual(code(() => processImage(png({ idat: false }))), '400:VALIDATION_ERROR');
  assert.strictEqual(code(() => processImage(png({ width: 10, height: 10 }))), '400:VALIDATION_ERROR');
});

test('type sniffing uses the bytes, not the claim', () => {
  assert.strictEqual(detectType(jpeg()), 'image/jpeg');
  assert.strictEqual(detectType(png()), 'image/png');
  assert.strictEqual(detectType(Buffer.from('<?php echo 1;')), null);
});

test('orientation reader survives garbage without throwing', () => {
  assert.strictEqual(readExifOrientation(Buffer.alloc(3)), null);
  assert.strictEqual(readExifOrientation(Buffer.from('MM\0*\xff\xff\xff\xff', 'latin1')), null);
  assert.strictEqual(readExifOrientation(Buffer.from('MM\0*\0\0\0\x08\xff\xff', 'latin1')), null);
  assert.strictEqual(readExifOrientation(orientationSegment(8).subarray(10)), 8);
});
