// Reading photos: pull the date the picture was taken out of EXIF, honour
// rotation, and shrink for storage.

const DISPLAY_MAX = 1400;   // embedded in the export
const THUMB_MAX = 360;      // shown in the tray
const QUALITY = 0.82;

/**
 * Find DateTimeOriginal in a JPEG's EXIF block.
 *
 * This is the whole point of the date-first workflow: a receipt photo is
 * almost always taken on the day of the purchase, so EXIF usually fills the
 * date in for you and you just confirm it.
 *
 * @returns {string|null} ISO date, or null if there is no EXIF date
 */
export async function exifDate(blob) {
  try {
    const buf = await blob.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;   // not JPEG

    // Walk the JPEG segments looking for APP1 (0xFFE1) holding "Exif\0\0".
    let off = 2, app1 = -1;
    while (off + 4 < v.byteLength) {
      if (v.getUint8(off) !== 0xff) break;
      const marker = v.getUint8(off + 1);
      const len = v.getUint16(off + 2);
      if (marker === 0xe1 && v.getUint32(off + 4) === 0x45786966) {
        app1 = off + 10;
        break;
      }
      if (marker === 0xda) break;                 // start of image data
      off += 2 + len;
    }
    if (app1 < 0 || app1 + 8 > v.byteLength) return null;

    const le = v.getUint16(app1) === 0x4949;      // II = little endian
    const u16 = (p) => v.getUint16(p, le);
    const u32 = (p) => v.getUint32(p, le);
    if (u16(app1 + 2) !== 0x2a) return null;

    const readAscii = (p, n) => {
      let s = "";
      for (let i = 0; i < n && v.getUint8(p + i); i++) s += String.fromCharCode(v.getUint8(p + i));
      return s;
    };

    // 0x9003 DateTimeOriginal, 0x9004 DateTimeDigitized, 0x0132 DateTime
    const scan = (ifd, want) => {
      if (ifd + 2 > v.byteLength) return null;
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > v.byteLength) break;
        const tag = u16(e);
        if (!want.includes(tag)) continue;
        const count = u32(e + 4);
        const ptr = count > 4 ? app1 + u32(e + 8) : e + 8;
        if (ptr + count > v.byteLength) continue;
        const s = readAscii(ptr, Math.min(count, 20));
        // EXIF writes "2026:08:20 14:22:31"
        const m = s.match(/^(\d{4}):(\d{2}):(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      }
      return null;
    };

    const ifd0 = app1 + u32(app1 + 4);
    let date = scan(ifd0, [0x9003, 0x9004]);
    if (date) return date;

    // The date usually lives in the Exif sub-IFD, pointed at by tag 0x8769.
    const n0 = u16(ifd0);
    for (let i = 0; i < n0; i++) {
      const e = ifd0 + 2 + i * 12;
      if (u16(e) === 0x8769) {
        date = scan(app1 + u32(e + 8), [0x9003, 0x9004]);
        if (date) return date;
      }
    }
    return scan(ifd0, [0x0132]);
  } catch {
    return null;
  }
}

async function shrink(bitmap, max) {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", QUALITY));
  return { blob, w, h };
}

/**
 * Turn one picked file into what we store: a display copy, a thumbnail, and
 * the date the photo was taken.
 */
export async function prepare(file) {
  const taken = await exifDate(file);
  // from-image applies the EXIF rotation, without which roughly half of all
  // phone photos come out sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const display = await shrink(bitmap, DISPLAY_MAX);
  const thumb = await shrink(bitmap, THUMB_MAX);
  bitmap.close?.();
  return {
    display: display.blob,
    thumb: thumb.blob,
    width: display.w,
    height: display.h,
    taken,
    name: file.name || "photo.jpg",
  };
}
