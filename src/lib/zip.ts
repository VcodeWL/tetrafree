/* Минимальный ZIP (store, без сжатия) для экспорта проекта + чтение store/deflate для импорта */
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function makeZip(files: Record<string, string>): Blob {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const d = new Date()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  for (const [path, content] of Object.entries(files)) {
    const name = enc.encode(path)
    const data = enc.encode(content)
    const crc = crc32(data)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 20, true)
    h.setUint16(6, 0x0800, true)
    h.setUint16(8, 0, true)
    h.setUint16(10, time, true)
    h.setUint16(12, date, true)
    h.setUint32(14, crc, true)
    h.setUint32(18, data.length, true)
    h.setUint32(22, data.length, true)
    h.setUint16(26, name.length, true)
    h.setUint16(28, 0, true)
    chunks.push(new Uint8Array(h.buffer), name, data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), name)
    offset += 30 + name.length + data.length
  }
  const csize = central.reduce((a, b) => a + b.length, 0)
  const e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, Object.keys(files).length, true)
  e.setUint16(10, Object.keys(files).length, true)
  e.setUint32(12, csize, true)
  e.setUint32(16, offset, true)
  return new Blob([...chunks, ...central, new Uint8Array(e.buffer)] as BlobPart[], {
    type: 'application/zip',
  })
}

export async function readZip(buf: ArrayBuffer): Promise<Record<string, string>> {
  const v = new DataView(buf)
  const dec = new TextDecoder()
  const out: Record<string, string> = {}
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('Это не ZIP-архив')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  for (let k = 0; k < count; k++) {
    const method = v.getUint16(p + 10, true)
    const csize = v.getUint32(p + 20, true)
    const nlen = v.getUint16(p + 28, true)
    const elen = v.getUint16(p + 30, true)
    const clen = v.getUint16(p + 32, true)
    const lho = v.getUint32(p + 42, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen))
    p += 46 + nlen + elen + clen
    if (name.endsWith('/')) continue
    const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true)
    const raw = new Uint8Array(buf, start, csize)
    if (method === 0) out[name] = dec.decode(raw)
    else if (method === 8)
      out[name] = await new Response(
        new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
      ).text()
  }
  return out
}
