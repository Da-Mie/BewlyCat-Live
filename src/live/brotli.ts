import { BrotliDecompress, BrotliDecompressedSize } from 'brotli/dec/decode'
import { BrotliInput } from 'brotli/dec/streams'

export function decodeBrotli(bytes: Uint8Array, limit: number): Uint8Array {
  const size = BrotliDecompressedSize(bytes)
  if (!Number.isSafeInteger(size) || size < 0 || size > limit)
    throw new Error('Expanded live packet exceeds bounds')
  let buffer: Uint8Array = new Uint8Array(size)
  let length = 0
  BrotliDecompress(new BrotliInput(bytes), {
    get buffer() { return buffer },
    set buffer(value: Uint8Array) {
      // 后续元块也必须遵守累计输出上限。
      if (value.length > limit)
        throw new Error('Expanded live packet exceeds bounds')
      buffer = value
    },
    write(value: Uint8Array, count: number) {
      if (length + count > limit || length + count > buffer.length)
        throw new Error('Expanded live packet exceeds bounds')
      buffer.set(value.subarray(0, count), length)
      length += count
      return count
    },
  })
  return buffer.subarray(0, length)
}
