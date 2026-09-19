/**
 * No onInstalled seeding of DEFAULT_SETTINGS.
 *
 * getSettings() routes every read through mergeDefaults(), which returns a full defaults clone when
 * the storage key is absent, so materialising that record changes nothing. It could only do harm:
 * installing on a second machine under the same Chrome profile fires onInstalled with reason
 * 'install' while chrome.storage.sync is restoring the existing record, and an unconditional write
 * would replace the user's real settings with defaults - then sync that back to every other machine.
 */
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage()
})
