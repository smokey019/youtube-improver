/**
 * With many videos per row the cards get narrow, and YouTube puts channel name, verified badge, views and
 * upload time all in ONE nowrap row, so the tail gets clipped. Making that row a wrapping flex container and
 * turning the first delimiter (the one after the channel) into a full-width line break gives two lines: the
 * channel (ellipsized if it alone is too long) and "views · time" below it.
 */
export function wrappingMetadataCSS(browseSelector: string): string {
  const row = `${browseSelector} ytd-rich-grid-renderer .ytContentMetadataViewModelMetadataRow`
  return `${row} {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center;
  overflow: visible !important;
  white-space: normal !important;
}
${row} > .ytContentMetadataViewModelMetadataText:first-child {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap !important;
}
${row} > .ytContentMetadataViewModelIcon {
  flex: none;
}
${row} > .ytContentMetadataViewModelDelimiter:nth-child(-n+3) {
  flex: 0 0 100%;
  height: 0;
  margin: 0 !important;
  overflow: hidden;
}`
}
