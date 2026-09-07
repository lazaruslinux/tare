// Reading a barcode out of a camera frame.
//
// The decoder is WebAssembly, bundled rather than fetched: the content security
// policy allows nothing from anywhere else, and an app that pulls its own code
// off a content network stops working the day that network does. This module is
// imported only when a scanner opens, so the decoder's weight stays out of the
// bundle everybody else downloads.

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import type { ReadInputBarcodeFormat, ReadResult } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

import { BARCODE } from './community'

// The `?url` import gives back the address Vite emitted the file at, which is
// what the decoder is told to load instead of its own guess.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? wasmUrl : prefix + path,
  },
})

// The formats printed on food packaging, and no others. A decoder told to look
// for everything finds a QR code on a poster behind the shelf.
const FORMATS: ReadInputBarcodeFormat[] = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E']

export async function readCode(frame: ImageData): Promise<string | null> {
  const results: ReadResult[] = await readBarcodes(frame, {
    formats: [...FORMATS],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  })
  const hit = results.find((result) => result.isValid && BARCODE.test(result.text))
  return hit ? hit.text : null
}
