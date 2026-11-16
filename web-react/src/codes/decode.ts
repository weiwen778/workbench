import {
  BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource,
} from '@zxing/library'
import { decodeImageFile } from '@/convert/image'

export interface DecodedCode {
  text: string
  format: string
  supported: boolean
}

const FORMAT_LABEL: Record<number, string> = {
  [BarcodeFormat.QR_CODE]: 'QR Code',
  [BarcodeFormat.CODE_128]: 'Code 128',
  [BarcodeFormat.EAN_13]: 'EAN-13',
} as Record<number, string>

const MAX_PIXELS = 24_000_000

export async function decodeCodeImage(file: File): Promise<DecodedCode> {
  const decoded = await decodeImageFile(file)
  try {
    if (decoded.width * decoded.height > MAX_PIXELS) throw new Error('图片像素过多（最多 2400 万），请先缩小后再识别')
    const canvas = document.createElement('canvas')
    canvas.width = decoded.width
    canvas.height = decoded.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('浏览器无法读取图片像素')
    context.drawImage(decoded.drawable as CanvasImageSource, 0, 0, decoded.width, decoded.height)
    const data = context.getImageData(0, 0, decoded.width, decoded.height).data
    const luminances = new Uint8ClampedArray(decoded.width * decoded.height)
    for (let index = 0; index < luminances.length; index += 1) {
      const offset = index * 4
      luminances[index] = (data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000
    }
    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.EAN_13])
    hints.set(DecodeHintType.TRY_HARDER, true)
    const source = new RGBLuminanceSource(luminances, decoded.width, decoded.height)

    const attempt = (input: RGBLuminanceSource, withHints = true) => {
      const reader = new MultiFormatReader()
      const bitmap = new BinaryBitmap(new HybridBinarizer(input))
      return withHints ? reader.decode(bitmap, hints) : reader.decode(bitmap)
    }

    let result
    try { result = attempt(source) }
    catch {
      try { result = attempt(source.invert() as RGBLuminanceSource) }
      catch { result = attempt(source, false) }
    }
    const formatNumber = result.getBarcodeFormat()
    return {
      text: result.getText(),
      format: FORMAT_LABEL[formatNumber] || `格式 ${formatNumber}`,
      supported: Boolean(FORMAT_LABEL[formatNumber]),
    }
  } finally {
    decoded.dispose()
  }
}
