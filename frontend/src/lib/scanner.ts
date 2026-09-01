// Reading a barcode out of a camera frame.
//
// The decoder is WebAssembly, and it is bundled here rather than fetched: the
// content security policy allows nothing from anywhere else, and an app that
// pulls its own code off a content network is an app that stops working the
// day that network does. The `?url` import hands Vite the file to emit and
// gives back the address it emitted it at, which is what the module below is
// told to load instead of its own guess.
//
// Imported lazily, only when a scanner actually opens, so the weight of the
// decoder stays out of the bundle everybody else downloads.

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import type { ReadInputBarcodeFormat, ReadResult } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

import { BARCODE } from './community'

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
