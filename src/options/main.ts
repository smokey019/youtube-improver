import {
  DEFAULT_SETTINGS,
  PLAYBACK_SPEEDS,
  QUALITY_LEVELS,
  getSettings,
  saveSettings,
  type PlaybackSpeed,
  type QualityLevel,
  type Settings,
} from '../types/settings'

let state: Settings = structuredClone(DEFAULT_SETTINGS)
const populators: Array<() => void> = []
let saveStatusTimeout: number | undefined

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content: string): HTMLElementTagNameMap[K] {
  const node = el(tag, className)
  node.textContent = content
  return node
}

function fieldRow(id: string, labelText: string, control: HTMLElement, hint?: string): HTMLDivElement {
  const row = el('div', 'field')
  const label = el('label', 'field-label')
  label.htmlFor = id
  label.textContent = labelText
  const controlCell = el('div', 'field-control')
  controlCell.append(control)
  if (hint) controlCell.append(text('p', 'field-hint', hint))
  row.append(label, controlCell)
  return row
}

async function persist(): Promise<void> {
  await saveSettings(state)
  showSaved()
}

function showSaved(): void {
  const status = document.getElementById('save-status')
  if (!status) return
  status.classList.add('visible')
  window.clearTimeout(saveStatusTimeout)
  saveStatusTimeout = window.setTimeout(() => status.classList.remove('visible'), 1200)
}

function populate(): void {
  for (const populator of populators) populator()
}

function checkboxField(
  id: string,
  labelText: string,
  get: () => boolean,
  set: (checked: boolean) => void,
  hint?: string,
): HTMLDivElement {
  const input = el('input', 'checkbox-input')
  input.type = 'checkbox'
  input.id = id
  input.addEventListener('change', () => {
    set(input.checked)
    void persist()
  })
  populators.push(() => {
    input.checked = get()
  })
  return fieldRow(id, labelText, input, hint)
}

function selectField<T extends string>(
  id: string,
  labelText: string,
  options: readonly { value: T; label: string }[],
  get: () => T,
  set: (value: T) => void,
  hint?: string,
): HTMLDivElement {
  const select = el('select', 'select-input')
  select.id = id
  for (const opt of options) {
    const option = el('option')
    option.value = opt.value
    option.textContent = opt.label
    select.append(option)
  }
  select.addEventListener('change', () => {
    set(select.value as T) // safe: select is only ever populated with T values above
    void persist()
  })
  populators.push(() => {
    select.value = get()
  })
  return fieldRow(id, labelText, select, hint)
}

function playbackSpeedField(id: string, labelText: string): HTMLDivElement {
  const select = el('select', 'select-input')
  select.id = id
  for (const speed of PLAYBACK_SPEEDS) {
    const option = el('option')
    option.value = String(speed)
    option.textContent = `${speed}x`
    select.append(option)
  }
  select.addEventListener('change', () => {
    state.video.defaultPlaybackSpeed = Number(select.value) as PlaybackSpeed
    void persist()
  })
  populators.push(() => {
    select.value = String(state.video.defaultPlaybackSpeed)
  })
  return fieldRow(id, labelText, select)
}

function videosPerRowField(
  id: string,
  labelText: string,
  get: () => number | null,
  set: (value: number | null) => void,
): HTMLDivElement {
  const select = el('select', 'select-input')
  select.id = id
  const defaultOption = el('option')
  defaultOption.value = 'default'
  defaultOption.textContent = 'YouTube default'
  select.append(defaultOption)
  for (let n = 1; n <= 6; n += 1) {
    const option = el('option')
    option.value = String(n)
    option.textContent = String(n)
    select.append(option)
  }
  select.addEventListener('change', () => {
    set(select.value === 'default' ? null : Number(select.value))
    void persist()
  })
  populators.push(() => {
    const value = get()
    select.value = value === null ? 'default' : String(value)
  })
  return fieldRow(id, labelText, select)
}

function tagsField(
  id: string,
  labelText: string,
  get: () => string[],
  set: (value: string[]) => void,
  hint?: string,
): HTMLDivElement {
  const input = el('input', 'text-input')
  input.type = 'text'
  input.id = id
  input.placeholder = 'e.g. Mixes, Shorts, People also watched'
  input.addEventListener('change', () => {
    set(
      input.value
        .split(',')
        .map((piece) => piece.trim())
        .filter((piece) => piece.length > 0),
    )
    void persist()
  })
  populators.push(() => {
    input.value = get().join(', ')
  })
  return fieldRow(id, labelText, input, hint)
}

function colorField(id: string, labelText: string, get: () => string, set: (value: string) => void): HTMLDivElement {
  const input = el('input', 'color-input')
  input.type = 'color'
  input.id = id
  input.addEventListener('change', () => {
    set(input.value)
    void persist()
  })
  populators.push(() => {
    input.value = get()
  })
  return fieldRow(id, labelText, input)
}

function rangeField(
  id: string,
  labelText: string,
  min: number,
  max: number,
  get: () => number,
  set: (value: number) => void,
): HTMLDivElement {
  const wrap = el('div', 'range-wrap')
  const input = el('input', 'range-input')
  input.type = 'range'
  input.id = id
  input.min = String(min)
  input.max = String(max)
  const valueLabel = el('span', 'range-value')
  input.addEventListener('input', () => {
    valueLabel.textContent = `${input.value}%`
  })
  input.addEventListener('change', () => {
    set(Number(input.value))
    void persist()
  })
  populators.push(() => {
    input.value = String(get())
    valueLabel.textContent = `${input.value}%`
  })
  wrap.append(input, valueLabel)
  return fieldRow(id, labelText, wrap)
}

function section(title: string, ...rows: HTMLElement[]): HTMLElement {
  const sectionEl = el('section', 'settings-section')
  sectionEl.append(text('h2', 'section-title', title))
  const body = el('div', 'section-body')
  body.append(...rows)
  sectionEl.append(body)
  return sectionEl
}

async function resetToDefaults(): Promise<void> {
  state = structuredClone(DEFAULT_SETTINGS)
  await saveSettings(state)
  populate()
  showSaved()
}

function buildHeader(): HTMLElement {
  const header = el('header', 'page-header')
  const titleGroup = el('div', 'title-group')
  titleGroup.append(
    text('h1', 'page-title', 'YouTube Improver'),
    text('p', 'page-subtitle', 'Changes are saved automatically.'),
  )
  const status = el('span', 'save-status')
  status.id = 'save-status'
  status.textContent = 'Saved'
  const resetButton = el('button', 'reset-button')
  resetButton.type = 'button'
  resetButton.textContent = 'Reset to defaults'
  resetButton.addEventListener('click', () => void resetToDefaults())
  const actions = el('div', 'header-actions')
  actions.append(status, resetButton)
  header.append(titleGroup, actions)
  return header
}

function buildApp(root: HTMLElement): void {
  root.append(buildHeader())
  root.append(
    section(
      'Home page',
      checkboxField(
        'home-enabled',
        'Enable Home page customization',
        () => state.homePage.enabled,
        (v) => {
          state.homePage.enabled = v
        },
      ),
      checkboxField(
        'home-hide-shorts',
        'Hide Shorts shelf',
        () => state.homePage.hideShorts,
        (v) => {
          state.homePage.hideShorts = v
        },
      ),
      tagsField(
        'home-hide-shelves',
        'Hide shelves containing',
        () => state.homePage.hideShelvesContaining,
        (v) => {
          state.homePage.hideShelvesContaining = v
        },
        'Comma-separated keywords; a shelf is hidden if its title contains any of them (case-insensitive).',
      ),
      videosPerRowField(
        'home-videos-per-row',
        'Videos per row',
        () => state.homePage.videosPerRow,
        (v) => {
          state.homePage.videosPerRow = v
        },
      ),
    ),
    section(
      'Subscriptions page',
      checkboxField(
        'subs-enabled',
        'Enable Subscriptions page customization',
        () => state.subscriptionsPage.enabled,
        (v) => {
          state.subscriptionsPage.enabled = v
        },
      ),
      selectField<'grid' | 'list'>(
        'subs-default-view',
        'Default view',
        [
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List' },
        ],
        () => state.subscriptionsPage.defaultView,
        (v) => {
          state.subscriptionsPage.defaultView = v
        },
      ),
      checkboxField(
        'subs-hide-shorts',
        'Hide Shorts shelf',
        () => state.subscriptionsPage.hideShorts,
        (v) => {
          state.subscriptionsPage.hideShorts = v
        },
      ),
      videosPerRowField(
        'subs-videos-per-row',
        'Videos per row',
        () => state.subscriptionsPage.videosPerRow,
        (v) => {
          state.subscriptionsPage.videosPerRow = v
        },
      ),
    ),
    section(
      'Shorts',
      checkboxField(
        'shorts-hide-in-feeds',
        'Hide Shorts in feeds',
        () => state.shorts.hideInFeeds,
        (v) => {
          state.shorts.hideInFeeds = v
        },
      ),
      selectField<QualityLevel>(
        'shorts-default-quality',
        'Default Shorts quality',
        QUALITY_LEVELS,
        () => state.shorts.defaultQuality,
        (v) => {
          state.shorts.defaultQuality = v
        },
      ),
    ),
    section(
      'Video playback',
      selectField<QualityLevel>(
        'video-default-quality',
        'Default quality',
        QUALITY_LEVELS,
        () => state.video.defaultQuality,
        (v) => {
          state.video.defaultQuality = v
        },
      ),
      selectField<QualityLevel>(
        'video-default-quality-fullscreen',
        'Default quality (fullscreen)',
        QUALITY_LEVELS,
        () => state.video.defaultQualityFullscreen,
        (v) => {
          state.video.defaultQualityFullscreen = v
        },
        'Auto keeps this the same as Default quality above.',
      ),
      playbackSpeedField('video-default-speed', 'Default playback speed'),
    ),
    section(
      'Autoplay',
      checkboxField(
        'autoplay-disable',
        'Disable autoplay of the next video',
        () => state.autoplay.disableAutoplay,
        (v) => {
          state.autoplay.disableAutoplay = v
        },
      ),
      checkboxField(
        'autoplay-block-background',
        'Block autoplay in background tabs',
        () => state.autoplay.blockBackgroundTabAutoplay,
        (v) => {
          state.autoplay.blockBackgroundTabAutoplay = v
        },
      ),
      checkboxField(
        'autoplay-block-foreground',
        'Block autoplay in the active tab',
        () => state.autoplay.blockForegroundTabAutoplay,
        (v) => {
          state.autoplay.blockForegroundTabAutoplay = v
        },
      ),
      checkboxField(
        'autoplay-ignore-playlists',
        'Ignore these rules for playlists',
        () => state.autoplay.ignoreForPlaylists,
        (v) => {
          state.autoplay.ignoreForPlaylists = v
        },
      ),
    ),
    section(
      'Hide elements',
      checkboxField(
        'hide-comments',
        'Hide comments',
        () => state.hide.comments,
        (v) => {
          state.hide.comments = v
        },
      ),
      checkboxField(
        'hide-related',
        'Hide related videos',
        () => state.hide.relatedVideos,
        (v) => {
          state.hide.relatedVideos = v
        },
      ),
    ),
    section(
      'Theater & Cinema mode',
      checkboxField(
        'theater-auto',
        'Automatically enter theater mode',
        () => state.theater.autoTheaterMode,
        (v) => {
          state.theater.autoTheaterMode = v
        },
      ),
      checkboxField(
        'theater-cinema',
        'Enable Cinema mode (dim the page around the player)',
        () => state.theater.cinemaMode,
        (v) => {
          state.theater.cinemaMode = v
        },
      ),
      colorField(
        'theater-cinema-color',
        'Cinema mode background color',
        () => state.theater.cinemaModeColor,
        (v) => {
          state.theater.cinemaModeColor = v
        },
      ),
      rangeField(
        'theater-cinema-opacity',
        'Cinema mode dimming',
        50,
        100,
        () => state.theater.cinemaModeOpacity,
        (v) => {
          state.theater.cinemaModeOpacity = v
        },
      ),
    ),
  )
}

async function init(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) return
  buildApp(root)
  state = await getSettings()
  populate()
}

void init()
