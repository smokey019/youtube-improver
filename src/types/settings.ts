export type QualityLevel =
  | 'auto'
  | 'highres'
  | 'hd2880'
  | 'hd2160'
  | 'hd1440'
  | 'hd1080'
  | 'hd720'
  | 'large'
  | 'medium'
  | 'small'
  | 'tiny'

export const QUALITY_LEVELS: { value: QualityLevel; label: string }[] = [
  { value: 'auto', label: 'Auto (YouTube default)' },
  { value: 'highres', label: '4320p 8K' },
  { value: 'hd2880', label: '2880p 5K' },
  { value: 'hd2160', label: '2160p 4K' },
  { value: 'hd1440', label: '1440p HD' },
  { value: 'hd1080', label: '1080p HD' },
  { value: 'hd720', label: '720p' },
  { value: 'large', label: '480p' },
  { value: 'medium', label: '360p' },
  { value: 'small', label: '240p' },
  { value: 'tiny', label: '144p' },
]

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

export interface Settings {
  homePage: {
    enabled: boolean
    hideShorts: boolean
    hidePlayables: boolean
    /** Case-insensitive shelf-title substrings; a shelf is hidden if its title contains any of these. */
    hideShelvesContaining: string[]
    /** null = leave YouTube's own responsive layout alone */
    videosPerRow: number | null
  }
  subscriptionsPage: {
    enabled: boolean
    hideShorts: boolean
    /** Case-insensitive title substrings; a video is hidden if its title contains any of these. */
    hideVideosContaining: string[]
    /** Read off the red progress bar under the thumbnail, so it only knows what watch history shows there. */
    hideWatched: boolean
    /** 1-100; a video is hidden once its progress bar reaches this percentage */
    hideWatchedPercent: number
    videosPerRow: number | null
  }
  shorts: {
    /** Shorts shelves in browse feeds (Home, Subscriptions, channels) and search results. */
    hideInFeeds: boolean
    /** The Shorts shelf in a watch page's right-hand related column, controlled separately. */
    hideInWatchSidebar: boolean
    defaultQuality: QualityLevel
  }
  video: {
    defaultQuality: QualityLevel
    /** 'auto' means "same as defaultQuality" */
    defaultQualityFullscreen: QualityLevel
    /**
     * false = leave YouTube's own remembered playback rate alone.
     *
     * Speed needs this flag because, unlike quality, it has no neutral value: 1x is a real speed a
     * user might want forced, so it cannot double as "don't touch". Without the flag the shipped
     * default of 1 silently overwrote the rate YouTube restores from its own preference, which looked
     * to the user like YouTube's remember-my-speed feature had broken.
     */
    setDefaultPlaybackSpeed: boolean
    defaultPlaybackSpeed: PlaybackSpeed
  }
  volume: {
    setDefaultVolume: boolean
    /** 0-100 */
    defaultVolume: number
    wheelVolumeEnabled: boolean
    /** 1-25, percentage points per wheel tick */
    wheelVolumeStep: number
  }
  autoplay: {
    disableAutoplay: boolean
    blockBackgroundTabAutoplay: boolean
    blockForegroundTabAutoplay: boolean
    ignoreForPlaylists: boolean
  }
  hide: {
    comments: boolean
    relatedVideos: boolean
  }
  comments: {
    /** Every other top-level comment thread gets a rounded grey bubble, like the description box. */
    alternateBackgrounds: boolean
  }
  theater: {
    autoTheaterMode: boolean
    cinemaMode: boolean
    /** hex color, e.g. #000000 */
    cinemaModeColor: string
    /** 50-100 */
    cinemaModeOpacity: number
  }
}

export const DEFAULT_SETTINGS: Settings = {
  homePage: { enabled: false, hideShorts: false, hidePlayables: true, hideShelvesContaining: [], videosPerRow: null },
  subscriptionsPage: {
    enabled: false,
    hideShorts: false,
    hideVideosContaining: [],
    hideWatched: false,
    hideWatchedPercent: 75,
    videosPerRow: null,
  },
  shorts: { hideInFeeds: false, hideInWatchSidebar: false, defaultQuality: 'auto' },
  video: {
    defaultQuality: 'auto',
    defaultQualityFullscreen: 'auto',
    setDefaultPlaybackSpeed: false,
    defaultPlaybackSpeed: 1,
  },
  volume: { setDefaultVolume: true, defaultVolume: 15, wheelVolumeEnabled: true, wheelVolumeStep: 5 },
  autoplay: {
    disableAutoplay: false,
    blockBackgroundTabAutoplay: false,
    blockForegroundTabAutoplay: false,
    ignoreForPlaylists: true,
  },
  hide: { comments: false, relatedVideos: false },
  comments: { alternateBackgrounds: false },
  theater: { autoTheaterMode: false, cinemaMode: false, cinemaModeColor: '#000000', cinemaModeOpacity: 85 },
}

const STORAGE_KEY = 'settings'

function mergeDefaults(partial: Partial<Settings> | undefined | null): Settings {
  if (!partial) return structuredClone(DEFAULT_SETTINGS)
  return {
    homePage: { ...DEFAULT_SETTINGS.homePage, ...partial.homePage },
    subscriptionsPage: { ...DEFAULT_SETTINGS.subscriptionsPage, ...partial.subscriptionsPage },
    shorts: { ...DEFAULT_SETTINGS.shorts, ...partial.shorts },
    video: { ...DEFAULT_SETTINGS.video, ...partial.video },
    volume: { ...DEFAULT_SETTINGS.volume, ...partial.volume },
    autoplay: { ...DEFAULT_SETTINGS.autoplay, ...partial.autoplay },
    hide: { ...DEFAULT_SETTINGS.hide, ...partial.hide },
    comments: { ...DEFAULT_SETTINGS.comments, ...partial.comments },
    theater: { ...DEFAULT_SETTINGS.theater, ...partial.theater },
  }
}

/**
 * Settings backup files.
 *
 * Settings live in chrome.storage.sync under this extension's ID, and an unpacked extension's ID is derived
 * from the folder it was loaded from - so removing it, reloading it from another path, or a browser profile
 * reset all land on empty storage that reads as "everything reset to defaults". A file the user keeps is the
 * only thing that survives that.
 */
export const SETTINGS_FILE_APP = 'youtube-improver'
export const SETTINGS_FILE_VERSION = 1

export function serializeSettings(settings: Settings): string {
  return JSON.stringify(
    { app: SETTINGS_FILE_APP, version: SETTINGS_FILE_VERSION, exportedAt: new Date().toISOString(), settings },
    null,
    2,
  )
}

type Json = Record<string, unknown>

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback
}

/** null is a real value here ("leave YouTube's layout alone"), so only a missing or invalid value falls back. */
function columns(value: unknown, fallback: number | null): number | null {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? int(value, 1, 6, 1) : fallback
}

// Sanity bounds so a hostile or hand-edited file stays small to process. They do NOT guarantee the result
// fits in chrome.storage.sync (two full lists come to ~21 KB against an 8 KB item limit), which is why the
// importer also checks settingsFitInStorage and refuses, rather than truncating the user's lists silently.
const MAX_KEYWORDS = 100
const MAX_KEYWORD_LENGTH = 100

/** chrome.storage.sync's QUOTA_BYTES_PER_ITEM. The whole Settings object is stored as a single item. */
const STORAGE_QUOTA_BYTES_PER_ITEM = 8192

/** Mirrors how the quota is counted: the key's length plus the JSON-stringified value's. */
export function settingsFitInStorage(settings: Settings): boolean {
  return STORAGE_KEY.length + new TextEncoder().encode(JSON.stringify(settings)).length <= STORAGE_QUOTA_BYTES_PER_ITEM
}

function keywords(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, MAX_KEYWORD_LENGTH))
    .filter((item) => item.length > 0)
    .slice(0, MAX_KEYWORDS)
}

function hexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

/**
 * Builds a complete, valid Settings from untrusted input.
 *
 * Every field is checked and clamped individually, and anything unknown is dropped, so a hand-edited or
 * future-version file can neither inject stray keys nor put the extension into a state its own options page
 * could not produce. Missing or invalid fields take their default.
 */
export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS
  const root = record(raw)
  const home = record(root.homePage)
  const subs = record(root.subscriptionsPage)
  const shorts = record(root.shorts)
  const video = record(root.video)
  const volume = record(root.volume)
  const autoplay = record(root.autoplay)
  const hide = record(root.hide)
  const comments = record(root.comments)
  const theater = record(root.theater)
  const qualities = QUALITY_LEVELS.map((level) => level.value)

  return {
    homePage: {
      enabled: bool(home.enabled, d.homePage.enabled),
      hideShorts: bool(home.hideShorts, d.homePage.hideShorts),
      hidePlayables: bool(home.hidePlayables, d.homePage.hidePlayables),
      hideShelvesContaining: keywords(home.hideShelvesContaining, d.homePage.hideShelvesContaining),
      videosPerRow: columns(home.videosPerRow, d.homePage.videosPerRow),
    },
    subscriptionsPage: {
      enabled: bool(subs.enabled, d.subscriptionsPage.enabled),
      hideShorts: bool(subs.hideShorts, d.subscriptionsPage.hideShorts),
      hideVideosContaining: keywords(subs.hideVideosContaining, d.subscriptionsPage.hideVideosContaining),
      hideWatched: bool(subs.hideWatched, d.subscriptionsPage.hideWatched),
      hideWatchedPercent: int(subs.hideWatchedPercent, 1, 100, d.subscriptionsPage.hideWatchedPercent),
      videosPerRow: columns(subs.videosPerRow, d.subscriptionsPage.videosPerRow),
    },
    shorts: {
      hideInFeeds: bool(shorts.hideInFeeds, d.shorts.hideInFeeds),
      hideInWatchSidebar: bool(shorts.hideInWatchSidebar, d.shorts.hideInWatchSidebar),
      defaultQuality: oneOf(shorts.defaultQuality, qualities, d.shorts.defaultQuality),
    },
    video: {
      defaultQuality: oneOf(video.defaultQuality, qualities, d.video.defaultQuality),
      defaultQualityFullscreen: oneOf(video.defaultQualityFullscreen, qualities, d.video.defaultQualityFullscreen),
      setDefaultPlaybackSpeed: bool(video.setDefaultPlaybackSpeed, d.video.setDefaultPlaybackSpeed),
      defaultPlaybackSpeed: oneOf<PlaybackSpeed>(video.defaultPlaybackSpeed, PLAYBACK_SPEEDS, d.video.defaultPlaybackSpeed),
    },
    volume: {
      setDefaultVolume: bool(volume.setDefaultVolume, d.volume.setDefaultVolume),
      defaultVolume: int(volume.defaultVolume, 0, 100, d.volume.defaultVolume),
      wheelVolumeEnabled: bool(volume.wheelVolumeEnabled, d.volume.wheelVolumeEnabled),
      wheelVolumeStep: int(volume.wheelVolumeStep, 1, 25, d.volume.wheelVolumeStep),
    },
    autoplay: {
      disableAutoplay: bool(autoplay.disableAutoplay, d.autoplay.disableAutoplay),
      blockBackgroundTabAutoplay: bool(autoplay.blockBackgroundTabAutoplay, d.autoplay.blockBackgroundTabAutoplay),
      blockForegroundTabAutoplay: bool(autoplay.blockForegroundTabAutoplay, d.autoplay.blockForegroundTabAutoplay),
      ignoreForPlaylists: bool(autoplay.ignoreForPlaylists, d.autoplay.ignoreForPlaylists),
    },
    hide: {
      comments: bool(hide.comments, d.hide.comments),
      relatedVideos: bool(hide.relatedVideos, d.hide.relatedVideos),
    },
    comments: {
      alternateBackgrounds: bool(comments.alternateBackgrounds, d.comments.alternateBackgrounds),
    },
    theater: {
      autoTheaterMode: bool(theater.autoTheaterMode, d.theater.autoTheaterMode),
      cinemaMode: bool(theater.cinemaMode, d.theater.cinemaMode),
      cinemaModeColor: hexColor(theater.cinemaModeColor, d.theater.cinemaModeColor),
      cinemaModeOpacity: int(theater.cinemaModeOpacity, 50, 100, d.theater.cinemaModeOpacity),
    },
  }
}

const SECTION_KEYS: (keyof Settings)[] = [
  'homePage',
  'subscriptionsPage',
  'shorts',
  'video',
  'volume',
  'autoplay',
  'hide',
  'comments',
  'theater',
]

/**
 * Reads a backup file's text. Returns null unless it is JSON that contains at least one settings section,
 * so a stray file (or an empty `{}`) is refused rather than silently resetting everything to defaults.
 * Accepts both the wrapped export format and a bare settings object.
 */
export function parseSettingsFile(text: string): Settings | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const root = record(data)
  const body = 'settings' in root ? record(root.settings) : root
  if (!SECTION_KEYS.some((key) => Object.keys(record(body[key])).length > 0)) return null
  return parseSettings(body)
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY)
  return mergeDefaults(stored[STORAGE_KEY] as Partial<Settings> | undefined)
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings })
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return
    callback(mergeDefaults(changes[STORAGE_KEY].newValue as Partial<Settings> | undefined))
  })
}
