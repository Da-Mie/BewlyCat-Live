const encoder = new TextEncoder()
const decoder = new TextDecoder()
const MAX_BYTES = 8 * 1024 * 1024
let decompressBrotli: typeof import('brotli/decompress').default | undefined

export function encodeLivePacket(operation: number, value: unknown = ''): ArrayBuffer {
  const body = encoder.encode(typeof value === 'string' ? value : JSON.stringify(value))
  const bytes = new Uint8Array(16 + body.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  view.setUint16(4, 16)
  view.setUint16(6, 1)
  view.setUint32(8, operation)
  view.setUint32(12, 1)
  bytes.set(body, 16)
  return bytes.buffer
}

export interface LivePacket { operation: number, data: any }

/** Own connection only. Native WebSocket, fetch and XMLHttpRequest are never patched. */
export async function decodeLivePackets(bytes: Uint8Array, depth = 0): Promise<LivePacket[]> {
  if (bytes.length > MAX_BYTES || depth > 4)
    throw new Error('Live packet exceeds bounds')
  const packets: LivePacket[] = []
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 16 > bytes.length)
      throw new Error('Truncated live packet')
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset)
    const length = view.getUint32(0)
    const header = view.getUint16(4)
    const version = view.getUint16(6)
    const operation = view.getUint32(8)
    if (header < 16 || length < header || offset + length > bytes.length)
      throw new Error('Invalid live packet')
    const body = bytes.subarray(offset + header, offset + length)
    offset += length
    if (operation === 5 && (version === 2 || version === 3)) {
      let expanded: Uint8Array
      if (version === 3) {
        decompressBrotli ??= (await import('brotli/decompress')).default
        expanded = decompressBrotli(body)
      }
      else {
        const reader = new Blob([new Uint8Array(body)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
        const parts: Uint8Array[] = []
        let size = 0
        while (true) {
          const result = await reader.read()
          if (result.done)
            break
          size += result.value.length
          if (size > MAX_BYTES) {
            await reader.cancel()
            throw new Error('Expanded live packet exceeds bounds')
          }
          parts.push(result.value)
        }
        expanded = new Uint8Array(size)
        let start = 0
        for (const part of parts) {
          expanded.set(part, start)
          start += part.length
        }
      }
      packets.push(...await decodeLivePackets(expanded, depth + 1))
    }
    else if (operation === 3) {
      packets.push({ operation, data: body.length >= 4 ? new DataView(body.buffer, body.byteOffset).getUint32(0) : 0 })
    }
    else if ((operation === 5 || operation === 8) && version <= 1) {
      const text = decoder.decode(body).replace(/\0+$/g, '')
      if (text)
        packets.push({ operation, data: JSON.parse(text) })
    }
  }
  return packets
}
