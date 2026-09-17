import type { Settings } from '../../types/settings'
import { waitForElement, setInjectedCSS, clearInjectedCSS } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'

const CSS_ID_SHORTS_SHELF = 'home-hide-shorts-shelf'
const CSS_ID_MATCHED_SHELVES = 'home-hide-matched-shelves'
const CSS_ID_VIDEOS_PER_ROW = 'home-videos-per-row'

const GRID_CONTENTS_SELECTOR = 'ytd-rich-grid-renderer #contents.ytd-rich-grid-renderer'
const SECTION_SELECTOR = 'ytd-rich-section-renderer'
const SHELF_TITLE_SELECTOR = 'span#title-text, #title'
const MATCHED_SHELF_CLASS = 'ytimprover-hidden-shelf'

// is-shorts is a boolean attribute YouTube toggles on the shelf renderer itself, not its section wrapper
const SHORTS_SHELF_CSS = `${SECTION_SELECTOR}:has(ytd-rich-shelf-renderer[is-shorts]) { display: none !important; }`
const MATCHED_SHELF_CSS = `.${MATCHED_SHELF_CLASS} { display: none !important; }`

let shelfObserver: MutationObserver | null = null
let activeNeedles: string[] = []

function disconnectShelfObserver(): void {
  shelfObserver?.disconnect()
  shelfObserver = null
}

function unmarkAllShelves(): void {
  document.querySelectorAll(`.${MATCHED_SHELF_CLASS}`).forEach((el) => el.classList.remove(MATCHED_SHELF_CLASS))
}

function scanShelves(needles: string[]): void {
  const lowerNeedles = needles.map((needle) => needle.toLowerCase())
  document.querySelectorAll(SECTION_SELECTOR).forEach((section) => {
    const titleText = section.querySelector(SHELF_TITLE_SELECTOR)?.textContent?.trim().toLowerCase() ?? ''
    const matches = titleText.length > 0 && lowerNeedles.some((needle) => titleText.includes(needle))
    section.classList.toggle(MATCHED_SHELF_CLASS, matches)
  })
}

async function setupShelfWatcher(needles: string[]): Promise<void> {
  const container = await waitForElement<HTMLElement>(GRID_CONTENTS_SELECTOR)
  if (!container || activeNeedles !== needles) return
  scanShelves(needles)
  disconnectShelfObserver()
  shelfObserver = new MutationObserver(() => scanShelves(activeNeedles))
  shelfObserver.observe(container, { childList: true, subtree: true })
}

function cleanup(): void {
  clearInjectedCSS(CSS_ID_SHORTS_SHELF)
  clearInjectedCSS(CSS_ID_MATCHED_SHELVES)
  clearInjectedCSS(CSS_ID_VIDEOS_PER_ROW)
  disconnectShelfObserver()
  unmarkAllShelves()
  activeNeedles = []
}

export function applyHomePage(settings: Settings['homePage']): void {
  if (getYouTubePageType() !== 'home' || !settings.enabled) {
    cleanup()
    return
  }

  setInjectedCSS(CSS_ID_SHORTS_SHELF, settings.hideShorts ? SHORTS_SHELF_CSS : '')

  if (settings.videosPerRow !== null) {
    setInjectedCSS(
      CSS_ID_VIDEOS_PER_ROW,
      `${GRID_CONTENTS_SELECTOR} { grid-template-columns: repeat(${settings.videosPerRow}, 1fr) !important; }`
    )
  } else {
    clearInjectedCSS(CSS_ID_VIDEOS_PER_ROW)
  }

  if (settings.hideShelvesContaining.length > 0) {
    activeNeedles = settings.hideShelvesContaining
    setInjectedCSS(CSS_ID_MATCHED_SHELVES, MATCHED_SHELF_CSS)
    void setupShelfWatcher(activeNeedles)
  } else {
    activeNeedles = []
    clearInjectedCSS(CSS_ID_MATCHED_SHELVES)
    disconnectShelfObserver()
    unmarkAllShelves()
  }
}
