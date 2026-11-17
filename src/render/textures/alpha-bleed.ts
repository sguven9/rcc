/**
 * Colour bleeding for alpha-cutout textures: fully transparent texels take
 * the colour of their nearest opaque neighbour, so bilinear filtering and
 * mipmaps at leaf edges blend foliage with foliage instead of the white or
 * black background stored in transparent pixels (no white fringes).
 * Pure on an RGBA byte array; unit-tested.
 */
export function bleedAlpha(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  passes = 8,
  threshold = 8,
) {
  let known = new Uint8Array(width * height);
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let i = 0; i < width * height; i++) {
    known[i] = data[i * 4 + 3] > threshold ? 1 : 0;
    if (!known[i]) continue;
    r += data[i * 4];
    g += data[i * 4 + 1];
    b += data[i * 4 + 2];
    n++;
  }
  for (let pass = 0; pass < passes; pass++) {
    const next = known.slice();
    let changed = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (known[i]) continue;
        let sr = 0,
          sg = 0,
          sb = 0,
          sn = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const j = yy * width + xx;
            if (!known[j]) continue;
            sr += data[j * 4];
            sg += data[j * 4 + 1];
            sb += data[j * 4 + 2];
            sn++;
          }
        if (!sn) continue;
        data[i * 4] = sr / sn;
        data[i * 4 + 1] = sg / sn;
        data[i * 4 + 2] = sb / sn;
        next[i] = 1;
        changed++;
      }
    known = next;
    if (!changed) break;
  }
  // Texels still far from foliage take the mean colour of the originally
  // opaque texels, so coarse mip levels never average in the background.
  if (n)
    for (let i = 0; i < width * height; i++)
      if (!known[i]) {
        data[i * 4] = r / n;
        data[i * 4 + 1] = g / n;
        data[i * 4 + 2] = b / n;
      }
  return data;
}
