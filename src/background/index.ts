import { DEFAULT_SETTINGS, saveSettings } from '../types/settings'

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await saveSettings(DEFAULT_SETTINGS)
  }
})

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage()
})
