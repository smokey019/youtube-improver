import {
  DEFAULT_SETTINGS,
  PLAYBACK_SPEEDS,
  QUALITY_LEVELS,
  getSettings,
  parseSettingsFile,
  saveSettings,
  serializeSettings,
  settingsFitInStorage,
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

/**
 * Guards against writing before the stored settings have been read.
 *
 * Every control is built from a clone of DEFAULT_SETTINGS and only filled in once getSettings()
 * resolves. A change fired before that would persist the *defaults* plus that one edit, wiping
 * everything the user had saved - and chrome.storage.sync is slow enough on a cold profile for a
 * fast click to land in that window.
 */
let settingsLoaded = false

/** Resolves true only if the write actually landed, so a caller can follow up with its own status. */
async function persist(): Promise<boolean> {
  if (!settingsLoaded) return false
  try {
    await saveSettings(state)
    showStatus('Saved', false)
    return true
  } catch (error) {
    // A rejected write used to be swallowed by the `void persist()` callers, so the only sign of
    // failure was the "Saved" note not appearing - while the control kept showing the value that was
    // never stored. chrome.storage.sync rejects on quota, which is reachable via the keyword list.
    console.error('[ytimprover] failed to save settings', error)
    showStatus('Could not save - see console', true)
    return false
  }
}

function showStatus(message: string, isError: boolean): void {
  const status = document.getElementById('save-status')
  if (!status) return
  status.textContent = message
  status.classList.toggle('error', isError)
  status.classList.add('visible')
  window.clearTimeout(saveStatusTimeout)
  // Errors stay put: they need reading, and clearing them would hide the only evidence of the failure
  if (!isError) saveStatusTimeout = window.setTimeout(() => status.classList.remove('visible'), 1200)
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
  placeholder: string,
  get: () => string[],
  set: (value: string[]) => void,
  hint?: string,
): HTMLDivElement {
  const input = el('input', 'text-input')
  input.type = 'text'
  input.id = id
  input.placeholder = placeholder
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

/**
 * Greys out the other rows of a section while its master checkbox is off.
 *
 * The Home and Subscriptions features are all gated behind an "Enable ... customization" checkbox that ships
 * unticked. Without a visible dependency, setting "Videos per row" while it is off saves fine, shows the
 * chosen value, and does nothing on YouTube - which reads exactly like a broken feature. Disabled controls
 * keep their stored values, so ticking the master brings them straight back.
 */
function gateSectionOnMaster(masterId: string): void {
  const master = document.getElementById(masterId)
  const sectionEl = master?.closest('section')
  if (!(master instanceof HTMLInputElement) || !sectionEl) return
  const rows = Array.from(sectionEl.querySelectorAll<HTMLElement>('.field')).filter((row) => !row.contains(master))
  const sync = (): void => {
    for (const row of rows) {
      row.classList.toggle('field-disabled', !master.checked)
      row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((control) => {
        control.disabled = !master.checked
      })
    }
  }
  master.addEventListener('change', sync)
  // After the controls' own populators (registered while the section was built), so it reads a filled-in master
  populators.push(sync)
}

const BACKUP_HINT = 'Use "Export settings" first if you want a backup.'

/**
 * Asks before throwing everything away. The button used to wipe and save in one click, and since the saved
 * copy syncs, a stray click was both instant and unrecoverable.
 */
async function resetToDefaults(): Promise<void> {
  if (!settingsLoaded) return
  if (!window.confirm(`Reset every setting to its default?\n\nThis replaces all of your saved settings and cannot be undone. ${BACKUP_HINT}`)) {
    return
  }
  state = structuredClone(DEFAULT_SETTINGS)
  populate()
  await persist()
}

function exportSettings(): void {
  // Exporting before the stored settings are read would write out the defaults as if they were the user's
  if (!settingsLoaded) return
  const url = URL.createObjectURL(new Blob([serializeSettings(state)], { type: 'application/json' }))
  const link = el('a')
  link.href = url
  link.download = `youtube-improver-settings-${new Date().toISOString().slice(0, 10)}.json`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  showStatus('Exported', false)
}

/** A real export is a few KB; this only exists to refuse an obviously wrong file before reading it. */
const MAX_IMPORT_BYTES = 256 * 1024

async function importSettings(file: File): Promise<void> {
  if (!settingsLoaded) return
  if (file.size > MAX_IMPORT_BYTES) {
    showStatus('That file is too large to be a settings export', true)
    return
  }
  let contents: string
  try {
    contents = await file.text()
  } catch (error) {
    console.error('[ytimprover] failed to read settings file', error)
    showStatus('Could not read that file', true)
    return
  }
  const imported = parseSettingsFile(contents)
  if (!imported) {
    showStatus('Not a YouTube Improver settings file', true)
    return
  }
  // Checked before the confirm, so the user is never asked to replace their settings with ones that cannot be saved
  if (!settingsFitInStorage(imported)) {
    showStatus('Those settings are too large to save - shorten the keyword lists', true)
    return
  }
  if (!window.confirm(`Replace your current settings with the ones in "${file.name}"?\n\nThis cannot be undone. ${BACKUP_HINT}`)) {
    return
  }
  const previous = state
  state = imported
  populate()
  if (await persist()) {
    showStatus('Imported', false)
    return
  }
  // The write was rejected (persist has already said so). Put the old values back rather than leave the page
  // showing an import that was never stored, which would vanish on the next open.
  state = previous
  populate()
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
  const exportButton = el('button', 'header-button')
  exportButton.type = 'button'
  exportButton.textContent = 'Export settings'
  exportButton.addEventListener('click', exportSettings)
  // The visible control is a button; the real file picker stays hidden and is opened by it
  const importInput = el('input')
  importInput.type = 'file'
  importInput.accept = '.json,application/json'
  importInput.hidden = true
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0]
    // Cleared so picking the same file again still fires `change`
    importInput.value = ''
    if (file) void importSettings(file)
  })
  const importButton = el('button', 'header-button')
  importButton.type = 'button'
  importButton.textContent = 'Import settings'
  importButton.addEventListener('click', () => importInput.click())
  const resetButton = el('button', 'header-button')
  resetButton.type = 'button'
  resetButton.textContent = 'Reset to defaults'
  resetButton.addEventListener('click', () => void resetToDefaults())
  const actions = el('div', 'header-actions')
  actions.append(status, exportButton, importButton, resetButton, importInput)
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
        'Turn this on for the options below to take effect. While it is off they are ignored.',
      ),
      checkboxField(
        'home-hide-shorts',
        'Hide Shorts shelf',
        () => state.homePage.hideShorts,
        (v) => {
          state.homePage.hideShorts = v
        },
      ),
      checkboxField(
        'home-hide-playables',
        'Hide YouTube Playables shelf',
        () => state.homePage.hidePlayables,
        (v) => {
          state.homePage.hidePlayables = v
        },
      ),
      tagsField(
        'home-hide-shelves',
        'Hide shelves containing',
        'e.g. Mixes, Shorts, People also watched',
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
        'Turn this on for the options below to take effect. While it is off they are ignored.',
      ),
      checkboxField(
        'subs-hide-shorts',
        'Hide Shorts shelf',
        () => state.subscriptionsPage.hideShorts,
        (v) => {
          state.subscriptionsPage.hideShorts = v
        },
      ),
      tagsField(
        'subs-hide-videos',
        'Hide videos with titles containing',
        'e.g. Livestream, Trailer, Reaction',
        () => state.subscriptionsPage.hideVideosContaining,
        (v) => {
          state.subscriptionsPage.hideVideosContaining = v
        },
        'Comma-separated keywords; a video is hidden if its title contains any of them (case-insensitive).',
      ),
      checkboxField(
        'subs-hide-watched',
        'Hide videos you have watched',
        () => state.subscriptionsPage.hideWatched,
        (v) => {
          state.subscriptionsPage.hideWatched = v
        },
        'Goes by the red progress bar under the thumbnail, so it needs YouTube watch history turned on.',
      ),
      rangeField(
        'subs-hide-watched-percent',
        'Count as watched at',
        1,
        100,
        () => state.subscriptionsPage.hideWatchedPercent,
        (v) => {
          state.subscriptionsPage.hideWatchedPercent = v
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
        'Shorts shelves on Home, Subscriptions, channel pages and search. Works on its own — it does not need the Home or Subscriptions toggles above, and it will keep hiding them even when those are off.',
      ),
      checkboxField(
        'shorts-hide-in-watch-sidebar',
        'Hide Shorts next to the video you are watching',
        () => state.shorts.hideInWatchSidebar,
        (v) => {
          state.shorts.hideInWatchSidebar = v
        },
        'The Shorts row in the suggestions column on a watch page.',
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
      checkboxField(
        'video-set-default-speed',
        'Force a default playback speed',
        () => state.video.setDefaultPlaybackSpeed,
        (checked) => {
          state.video.setDefaultPlaybackSpeed = checked
        },
        'Off by default: YouTube remembers the speed you pick and restores it, and forcing a speed overrides that on every video.',
      ),
      playbackSpeedField('video-default-speed', 'Default playback speed'),
    ),
    section(
      'Audio & volume',
      checkboxField(
        'volume-set-default',
        'Set a default volume on every video',
        () => state.volume.setDefaultVolume,
        (v) => {
          state.volume.setDefaultVolume = v
        },
        'Applies to both regular videos and Shorts, once per video.',
      ),
      rangeField(
        'volume-default-level',
        'Default volume',
        0,
        100,
        () => state.volume.defaultVolume,
        (v) => {
          state.volume.defaultVolume = v
        },
      ),
      checkboxField(
        'volume-wheel-enabled',
        'Change volume with the mouse wheel over the player',
        () => state.volume.wheelVolumeEnabled,
        (v) => {
          state.volume.wheelVolumeEnabled = v
        },
        'Works on regular videos and Shorts, and suppresses the page scroll (and Shorts skipping) while adjusting.',
      ),
      rangeField(
        'volume-wheel-step',
        'Mouse wheel volume step',
        1,
        25,
        () => state.volume.wheelVolumeStep,
        (v) => {
          state.volume.wheelVolumeStep = v
        },
      ),
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
      'Comments',
      checkboxField(
        'comments-alternate-backgrounds',
        'Alternate comment backgrounds',
        () => state.comments.alternateBackgrounds,
        (v) => {
          state.comments.alternateBackgrounds = v
        },
        'Every other comment gets a grey bubble, like the box around the video description.',
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
  gateSectionOnMaster('home-enabled')
  gateSectionOnMaster('subs-enabled')
}

async function init(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) return
  buildApp(root)
  // Inert until the real settings are in hand - see the note on settingsLoaded
  root.setAttribute('aria-busy', 'true')
  try {
    state = await getSettings()
  } catch (error) {
    console.error('[ytimprover] failed to load settings', error)
    showStatus('Could not load your settings - changes will not be saved', true)
    return
  } finally {
    root.removeAttribute('aria-busy')
  }
  populate()
  settingsLoaded = true
}

void init()
