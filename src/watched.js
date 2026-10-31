// Stremio's watched-episodes field (state.watched), read and written like the official apps.
//
// Format "<anchor video id>:<anchor length>:<base64 zlib bytes>". Bit i is
// (byte[i >> 3] >> (i % 8)) & 1 over the series videos ordered by season, then episode (a missing
// number sorts first, ties keep the metadata order). The anchor is the last watched video and the
// length its index + 1, so episodes added later do not shift the bits.

function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/* 'deflate' in these streams is the zlib format the field uses. */
const deflate = (bytes) => pipe(bytes, new CompressionStream('deflate'));
const inflate = (bytes) => pipe(bytes, new DecompressionStream('deflate'));

export async function decodeField(field) {
  const parts = String(field || '').split(':');
  const b64 = parts.pop() || '';
  const anchorLength = parseInt(parts.pop(), 10) || 0;
  const bits = [];
  try {
    const bytes = await inflate(fromBase64(b64));
    for (let i = 0; i < bytes.length * 8; i++) bits.push((bytes[i >> 3] >> i % 8) & 1);
  } catch {
    // an unreadable field counts as empty
  }
  return { anchor: parts.join(':'), anchorLength, bits };
}

export function orderedIds(videos) {
  const number = (value) => {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? -Infinity : n;
  };
  return (videos || [])
    .map((video, index) => ({ video, index }))
    .filter(({ video }) => video && video.id)
    .sort((a, b) => {
      const seasonA = number(a.video.season);
      const seasonB = number(b.video.season);
      const episodeA = number(a.video.episode ?? a.video.number);
      const episodeB = number(b.video.episode ?? b.video.number);
      if (seasonA !== seasonB) return seasonA < seasonB ? -1 : 1;
      if (episodeA !== episodeB) return episodeA < episodeB ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ video }) => video.id);
}

/* The field with `vids` also marked watched, and how many of them are new. Episodes already
   marked stay marked. A field whose anchor is no longer in the list starts empty, as in core. */
export async function mergeWatched(field, videos, vids) {
  const ids = orderedIds(videos);
  const bits = new Array(ids.length).fill(0);
  if (field) {
    const old = await decodeField(field);
    const anchorAt = ids.indexOf(old.anchor);
    if (anchorAt >= 0) {
      const offset = old.anchorLength - anchorAt - 1;
      for (let i = 0; i < ids.length; i++) {
        const j = i + offset;
        if (j >= 0 && j < old.bits.length) bits[i] = old.bits[j];
      }
    }
  }
  let added = 0;
  for (const vid of vids) {
    const at = ids.indexOf(vid);
    if (at >= 0 && !bits[at]) {
      bits[at] = 1;
      added++;
    }
  }
  if (!added) return { field: field || '', added: 0 };
  const bytes = new Uint8Array(Math.ceil(ids.length / 8));
  let last = 0;
  for (let i = 0; i < ids.length; i++)
    if (bits[i]) {
      bytes[i >> 3] |= 1 << i % 8;
      last = i;
    }
  return { field: `${ids[last]}:${last + 1}:${toBase64(await deflate(bytes))}`, added };
}
