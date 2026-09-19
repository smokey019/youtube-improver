# Verification checklist

Every feature in this extension has, at some point, looked implemented while doing nothing at all. The
player-API bug survived for months because a broken feature and a working one were indistinguishable
from the outside. This file exists so that stops being possible: each check below is a look-at-the-screen
test with a deliberately extreme setting, so a failure is obvious rather than something you measure.

**Before starting:** `bun run build`, click the reload icon for the extension on `chrome://extensions`,
and close every open YouTube tab. Content scripts only reload on a fresh page load.

**One rule throughout:** do **not** verify anything by pasting a snippet into the DevTools console. The
console evaluates in the *page* world and will happily confirm capabilities the extension does not have
— that is precisely the habit that hid the original bug. Every check here is visual for that reason.

## 1. Default video quality — does the forced quality land, and can it be released?

**Priority:** high

**Set up:** Options → Video playback → Default quality = "240p". Leave "Default quality (fullscreen)" on Auto.

**Do:** Open a video that offers 1080p in a fresh tab. Let it run 5 seconds, then click the gear → Quality and read the line at the top. Now click a suggested video (do not reload — stay inside YouTube's own navigation) and check the gear again. Then go back to Options, set Default quality to "Auto (YouTube default)", return to the YouTube tab and click through to another video.

**Pass:** Both videos are obviously blocky and the gear reads 240p. After switching the option back to Auto, the very next video is sharp again and the gear reads Auto. Optional confirmation in the page console: JSON.parse(localStorage['yt-player-quality']).quality should be 0 after the switch back.

**Fail:** Video plays sharp while 240p is selected → the quality write is not reaching the player at all, i.e. the original isolated-world bug is back. Video stays stuck at 240p after you set the option to Auto, on this and every later video → "auto" is still a no-op and YouTube's own stored preference is now pinned for ~360 days (clear it with localStorage.removeItem('yt-player-quality') and reload).

## 2. Default playback speed — forced value works, and the "leave my speed alone" value really leaves it alone

**Priority:** high

**Set up:** Options → Video playback → Default playback speed = 1.75x. Later in the same check, set it back to its do-nothing value (1x, or a "Don't change" entry if the fix added one).

**Do:** Open a watch page and listen — voices should be audibly fast; confirm the gear → Playback speed reads 1.75. Click a suggested video and check again. Now set the option to its do-nothing value. Open a video, set 2x by hand from YouTube's gear menu, then click through to the next video. If you can find a video with a mid-roll ad, let the ad play through and watch the speed when the content resumes.

**Pass:** At 1.75x both videos are audibly fast and the gear reads 1.75. With the do-nothing value selected, the 2x you set by hand survives both the navigation to the next video and the mid-roll ad.

**Fail:** Audio sounds normal at 1.75x → the rate command is not landing. Speed snaps back to 1x after a navigation or after an ad while the option is at its neutral value → the extension is still asserting rate 1 on every load and YouTube's own remembered speed is effectively disabled.

## 3. Default Shorts quality across a run of clips (including fast, gapless scrolls)

**Priority:** high

**Set up:** Options → Shorts → Default Shorts quality = "144p". A deliberately terrible value so a miss is visible at a glance.

**Do:** Open youtube.com/shorts and scroll through at least 10 clips. Look at each one for a second. Do three or four of the scrolls fast, back-to-back, to force gapless transitions. Spot-check two or three clips via the ⋮ menu → Quality.

**Pass:** Every clip is unmistakably blocky. No clip in the run of 10 comes up sharp.

**Fail:** Any clip plays at normal sharpness → quality was not re-sent for that clip. Note its number and whether you had just scrolled fast: a miss only on fast scrolls means the gapless transition fires neither of the two triggers the README relies on. A miss on the very first clip means the cold-load path is failing instead.

## 4. Fullscreen quality, including navigating to the next video while still fullscreen

**Priority:** high

**Set up:** Options → Video playback → Default quality = "240p", Default quality (fullscreen) = "1080p HD".

**Do:** Open a video that offers 1080p. Confirm it is blocky in the window. Press f. Wait 5 seconds and check the gear → Quality. Then, without leaving fullscreen, click a suggested video from the end screen (or let the video finish and autoplay the next one). Check the quality again, still fullscreen. Now press f to exit and click through to another video.

**Pass:** Fullscreen goes sharp and reads 1080p; after the in-fullscreen navigation it is still 1080p; after exiting fullscreen the next video drops back to blocky 240p.

**Fail:** Quality falls to 240p while you are still fullscreen after the navigation → fullscreen quality is only applied on the enter/exit edge, so a fullscreen viewing session silently reverts to windowed quality. Quality stays at 1080p after you exit fullscreen → the exit path is not releasing it, and you are now streaming 1080p in a small window for the rest of the session.

## 5. Default volume actually survives the start of playback

**Priority:** high

**Set up:** Options → Audio & volume → "Set a default volume on every video" ticked, Default volume = 50%. Prep first: with the extension's toolbar switched off or that option unticked, drag YouTube's own volume slider to maximum on a video and reload, so YouTube remembers 100%. Then re-tick the option.

**Do:** Open a fresh watch page. The instant audio starts, hover YouTube's own speaker icon to open its slider and read where the handle sits. Read it again 20 seconds later. Then open a long video or one with a mid-roll ad, and read the slider once more after the ad finishes or a minute into playback. Use YouTube's own slider as the reference, not the extension's centred overlay.

**Pass:** YouTube's own slider sits at about half within the first second of audio and is still there 20 seconds later and after the ad. Loudness is obviously about half of what YouTube's remembered 100% sounded like.

**Fail:** The slider reads full (YouTube's remembered value), or it briefly shows half and then jumps back as soon as you hear audio → YouTube is reverting the write at playback start, which is the reported "15% setting, 5% actual" symptom. Also a fail: the extension's overlay says 50% while YouTube's slider clearly says something else → the two are still on different scales.

## 6. Mouse-wheel volume: agrees with YouTube's own number, works on a muted player, and does not skip Shorts

**Priority:** high

**Set up:** Options → Audio & volume → "Change volume with the mouse wheel over the player" ticked, Mouse wheel volume step = 5.

**Do:** On a watch page, put the pointer over the video. Scroll up 4 notches, then down 4 notches, noting both the extension's overlay number and YouTube's own slider position at each end. Watch whether the page behind scrolls. Then press m to mute (speaker icon shows crossed out) and scroll up 3 notches while listening. Finally open a Short and scroll 3 notches up with the pointer over the player.

**Pass:** Overlay number and YouTube's slider agree within a point or two, and each notch moves it by about 5. The page never scrolls while the pointer is over the player. After mute + scroll up, sound actually returns and YouTube's speaker icon un-crosses. On the Short the volume changes and the feed does not advance to the next clip.

**Fail:** Overlay climbs (25% → 30% → 35%) while YouTube's slider does not move, or the two numbers are far apart (overlay 33%, slider 100%) → still writing the loudness-scaled element value, so the step size also means something different on every video. Silence after mute + scroll up while the number rises → unmute is still dead, and the only way back is YouTube's own mute button, which throws away everything the wheel just did. Short advances while you scroll → the wheel handler lost the race to YouTube's reel scroller.

## 7. Cinema mode — dims the page around the player, not the player

**Priority:** high

**Set up:** Options → Theater & Cinema mode → tick "Enable Cinema mode (dim the page around the player)". Leave colour black and dimming at 85%.

**Do:** Open any watch page. Look first at the video image itself, then at the comments, the right-hand sidebar and the top bar. Move the pointer over the player to bring up the controls and try clicking the timeline. Turn captions on. Press f for fullscreen, then f again.

**Pass:** The video is at normal, full brightness and perfectly readable; everything around it — comments, sidebar and the masthead at the top — is visibly dimmed; player controls and captions are crisp and clickable; fullscreen is not dimmed at all.

**Fail:** The video itself is a dark smear behind the dimming → the backdrop is still covering the player, which was the original defect. Nothing at all looks dimmed → the backdrop is sitting behind YouTube's opaque page background. Either way, this is not fixed by changing the z-index number, so report exactly which of the two you see.

## 8. Home page customization: Shorts shelf, keyword shelves, videos per row, and whether unticking really undoes it

**Priority:** high

**Set up:** Options → Home page → tick "Enable Home page customization", tick "Hide Shorts shelf", tick "Hide YouTube Playables shelf", type "mixes" into "Hide shelves containing", set Videos per row = 3. Make sure Shorts → "Hide Shorts in feeds" is UNTICKED for this check, so only the Home path is under test.

**Do:** Open youtube.com in a new tab. Scroll the whole first screenful looking for a Shorts row and any "Mixes" row. Count how many videos sit in a row. Now click Subscriptions in the sidebar and come back to Home via the YouTube logo (no reload), and look again. Then scroll far enough to load two or three more batches of rows and look for a Shorts row appearing in the new content. Finally untick "Enable Home page customization" and reload Home.

**Pass:** No Shorts row and no "Mixes" row anywhere, including in the rows loaded by scrolling and after the Subscriptions round trip. No blank gap where they were. Exactly 3 videos per row, with the avatar strip and the filter-chip bar still spanning the full width. After unticking the master toggle and reloading, the Shorts row, the Mixes row and YouTube's own row count are all back.

**Fail:** Shorts row present on the first load → the wrapper element the hiding is anchored on is not there. Present only in the rows loaded by scrolling, or only after the Subscriptions round trip → the watcher is not covering new content or has bound to the cached copy of the feed. A blank strip left behind → the wrong element is being hidden. Row count unchanged → the per-row override lost the cascade. Anything still hidden after unticking the master toggle → something else is hiding it (see the next item). Note: if you see no Playables row, that proves nothing — YouTube does not show it on every load, so record Playables as untested rather than passed unless you saw one disappear.

## 9. Subscriptions page, and the overlap with the separate "Hide Shorts in feeds" switch

**Priority:** medium

**Set up:** First pass: Options → Subscriptions page → tick "Enable Subscriptions page customization" and "Hide Shorts shelf", Videos per row = 4. Second pass: untick both of those, and instead tick Shorts → "Hide Shorts in feeds".

**Do:** First pass: open youtube.com/feed/subscriptions, look for a Shorts row and count videos per row. Second pass: reload Home, reload Subscriptions, and open a watch page and look down the right-hand sidebar for a Shorts row. Then untick "Hide Shorts in feeds" and reload all three.

**Pass:** First pass: Shorts row gone, 4 per row, and the full-width rows (avatar strip, chip bar) still span the width rather than collapsing into one narrow column. Second pass: Shorts rows gone on Home, on Subscriptions and in the watch-page sidebar, with no leftover empty strip. Unticking brings them back on all three.

**Fail:** Subscriptions hides its Shorts row but Home did not in the previous item → the two identically-labelled checkboxes still have different coverage. A leftover blank strip where the row was → only the inner shelf is hidden and its wrapper is still taking up layout. Decide too whether removing the watch-page sidebar Shorts row is what you want from a switch labelled "in feeds" — that is a product call, not a bug.

## 10. Automatic theater mode — and that it never kicks you OUT of theater

**Priority:** medium

**Set up:** Prep with the option OFF: press t on a watch page to put YouTube itself into theater, reload, and confirm YouTube comes back in theater on its own. Then Options → Theater & Cinema mode → tick "Automatically enter theater mode".

**Do:** (a) With YouTube still remembering theater, load a watch page and watch the player for the first two seconds. (b) Press t to leave theater, then click a suggested video. (c) Set YouTube back to the default small player, then hard-reload a watch page with Ctrl+Shift+R.

**Pass:** (a) The page stays in theater and the player never shrinks. (b) The next video comes up in theater. (c) The cold-loaded page settles into theater within a second or two.

**Fail:** (a) The player visibly shrinks out of theater a moment after load → the attribute the feature reads is wrong and it is acting as an auto-EXIT for anyone whose YouTube remembers theater. (c) Cold load stays small while step (b) worked → the click is losing the race against the player mounting, and nothing anywhere reports the failure.

## 11. Autoplay blocking on cold load, and no listener pile-up across navigation

**Priority:** medium

**Set up:** Options → Autoplay → tick "Block autoplay in the active tab" and "Block autoplay in background tabs". Leave the other two unticked for this item.

**Do:** Hard-reload a watch page (Ctrl+Shift+R) three times and watch each load. Then open DevTools → Network, tick "Disable cache", and hard-reload twice more. Next, middle-click a video to open it in a background tab, wait 10 seconds, then switch to that tab. Finally do watch → Shorts → watch → Shorts → watch (four round trips), then press play on the watch video yourself and let it run 15 seconds.

**Pass:** All five cold loads land paused, with the big play button showing and the timer at or near 0:00. The background tab is paused at 0:00 when you switch to it. After the four round trips, your manual press of play plays normally and the video is not paused out from under you.

**Fail:** Any load plays straight through → the listener was attached after the play it exists to catch, and nothing logs it; note whether it was the cache-disabled loads that failed, since that is the slow cold load. The video gets yanked back to paused right after you press play, especially after several round trips → duplicate listeners have accumulated across navigations.

## 12. "Disable autoplay of the next video" and the playlist exemption

**Priority:** medium

**Set up:** Options → Autoplay → tick "Disable autoplay of the next video" and tick "Ignore these rules for playlists". Untick the two blocking options so they cannot muddy the result.

**Do:** Open a normal watch page and look at YouTube's autoplay slider in the player's bottom control bar (left of the subtitles/settings buttons) — note whether it is on or off. Then open a playlist (any watch URL with &list= in it) and look at the same slider there. Let a short item in the playlist finish and see whether it advances.

**Pass:** On the normal watch page the slider reads off. On the playlist page the slider is left exactly as you had it, and the playlist advances to the next item on its own.

**Fail:** The playlist page's autoplay slider gets switched off, or the playlist stops dead at the end of an item → the "Ignore these rules for playlists" checkbox is not being applied to this option. It is worth catching because YouTube persists that toggle, so the damage outlives the page and you will have to switch it back on by hand.

## 13. Options page integrity: settings survive a reload, an early click does not wipe them, and a failed save is visible

**Priority:** medium

**Set up:** No YouTube settings needed — this is about the options page itself.

**Do:** (a) Set several distinctive values: Default quality 1080p, Default volume 60, and a short keyword list. Close the options tab, go to chrome://extensions and click the reload icon on the extension, then reopen options. (b) Restart Chrome, open options, and click the very first checkbox the instant the page appears, before it has visibly settled; then look at all the other settings. (c) Paste a very long comma-separated keyword list into "Hide shelves containing" — a few thousand characters, e.g. one word repeated several hundred times — and tab out of the field. (d) Close options and reopen it.

**Pass:** (a) Everything is exactly as you left it after the extension reload. (b) Once the page settles, every value matches what was stored, and your quick click changed only that one thing. (c) Either it saves cleanly, or you get a visible error message. (d) Whatever the page claimed in (c) is what you actually find on reopen.

**Fail:** Settings back to defaults after reloading the extension → the on-install write is clobbering stored settings, which on a second machine would wipe your synced ones. "Default playback speed" briefly showing 0.25x, or a quick click resetting unrelated settings → the form is live before it has been populated. The long list flashes "Saved" and is gone when you reopen → save failures are still completely silent, which is the same invisible-failure shape as the rest of this list.

## 14. Hide comments and hide related videos, on watch pages and Shorts

**Priority:** low

**Set up:** Options → Hide elements → tick "Hide comments" and "Hide related videos".

**Do:** Open a watch page and scroll down past the description. Then look at the area to the right of the player. Open a Short and click its comment button. Untick both and reload to confirm they come back.

**Pass:** No comment section and no empty space where it was. The related list is gone and either the player area widens or there is no obvious dead gutter down the right. On the Short, clicking comments does nothing visible and the Short stays centred and the same size. Unticking restores both.

**Fail:** A blank ~400px column down the right of the video → the list is hidden but its container still holds the layout open. The Short jumps sideways or shrinks when you click comments → the panel is hidden but YouTube's layout shift still runs. Live chat or a playlist panel disappearing along with the related list → the hiding is too broad.

## Notes

Before starting: run `bun run build`, then click the reload icon for the extension on chrome://extensions, and close every open YouTube tab. Content scripts only reload on a fresh page load.

Do the items in order. The first eight are the ones where a broken feature and a working one look identical from the outside, which is exactly how the player-API bug survived for months. Items 1-6 all use a deliberately extreme value (240p, 144p, 1.75x) so a failure is visible at a glance rather than something you have to measure.

One rule throughout: do NOT verify anything by pasting a snippet into the DevTools console. The console evaluates in the page world and will happily confirm things the extension cannot see — that is precisely the habit that hid the original bug. Every check above is a look-at-the-screen check for that reason. The two optional console reads I do include (localStorage['yt-player-quality'] in item 1) are reading page state, not testing what the extension can reach.

Two places where absence proves nothing, so record them as untested rather than passed: the Playables shelf in item 8 (YouTube does not show it on every load, so a feed with no Playables row and a feed where the selector missed look identical), and any Shorts-quality clip you skipped past too fast to see in item 3.

Two open questions the checklist deliberately surfaces rather than answers, because they are product calls: whether "Hide Shorts in feeds" should also strip the Shorts row from the watch-page sidebar (item 9), and whether a default volume of 15% should be applied out of the box to users who never opened the settings page — if item 5 passes, that behaviour is real and it is currently the only setting that changes YouTube on a fresh install.

If item 8 or 9 fails, note whether it failed on first paint, after infinite scroll, or only after a Home→Subscriptions→Home round trip. Those three are different bugs and the distinction is most of the diagnosis.
