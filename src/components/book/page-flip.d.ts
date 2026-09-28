// page-flip 2.0.7 ships no type declarations; this covers the part the book
// reader uses (node_modules/page-flip/src/PageFlip.ts is the source).
declare module 'page-flip' {
  export interface FlipEvent<T = number | string> {
    data: T
    object: PageFlip
  }

  export class PageFlip {
    constructor(block: HTMLElement, settings: Record<string, number | string | boolean>)
    loadFromHTML(items: HTMLElement[]): void
    on(event: 'flip', callback: (event: FlipEvent<number>) => void): this
    on(event: 'changeOrientation', callback: (event: FlipEvent<'portrait' | 'landscape'>) => void): this
    on(event: 'changeState' | 'init' | 'update', callback: (event: FlipEvent) => void): this
    flipNext(corner?: 'top' | 'bottom'): void
    flipPrev(corner?: 'top' | 'bottom'): void
    flip(page: number, corner?: 'top' | 'bottom'): void
    turnToPage(page: number): void
    turnToNextPage(): void
    turnToPrevPage(): void
    getCurrentPageIndex(): number
    getPageCount(): number
    getOrientation(): 'portrait' | 'landscape'
    getBoundsRect(): { left: number; top: number; width: number; height: number; pageWidth: number }
    // The live settings object: page-flip reads these two on every pointer event.
    getSettings(): { disableFlipByClick: boolean; showPageCorners: boolean }
    /** Ends a press; with `isSwipe` it only forgets it, without turning. */
    userStop(pos: { x: number; y: number }, isSwipe?: boolean): void
    update(): void
    destroy(): void
  }
}
