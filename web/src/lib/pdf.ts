import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Slide } from '../types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const MAX_SLIDES = 40
const TARGET_WIDTH = 1280

/** Renders every page of a PDF to a JPEG data URL and extracts its text. Runs entirely in the browser. */
export async function loadSlides(file: File, onProgress?: (done: number, total: number) => void): Promise<Slide[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const total = Math.min(doc.numPages, MAX_SLIDES)
  const slides: Slide[] = []
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport }).promise
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    slides.push({ index: i - 1, image: canvas.toDataURL('image/jpeg', 0.82), text })
    onProgress?.(i, total)
  }
  await doc.loadingTask.destroy()
  return slides
}
