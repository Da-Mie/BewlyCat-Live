declare module 'brotli/dec/decode' {
  export function BrotliDecompressedSize(input: Uint8Array): number
  export function BrotliDecompress(input: unknown, output: { buffer: Uint8Array, write: (value: Uint8Array, count: number) => number }): void
}

declare module 'brotli/dec/streams' {
  export class BrotliInput {
    constructor(input: Uint8Array)
  }
}
