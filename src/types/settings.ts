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
  subscriptionsPage: { enabled: false, hideShorts: false, videosPerRow: null },
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
    theater: { ...DEFAULT_SETTINGS.theater, ...partial.theater },
  }
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
