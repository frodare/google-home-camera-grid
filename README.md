# Google Home Camera Grid

![Google Home Camera Grid icon](extension/icons/icon-128.png)

A Chrome extension that arranges the live camera tiles on Google Home for web. Google Home provides the video and camera controls. The extension stores layout preferences locally and does not send video or preferences anywhere.

## Chrome Web Store package

Create the upload ZIP from the contents of `extension/` so `manifest.json` is at the root of the archive. The package includes the content scripts and the Grid Lens icon in 16, 32, 48, and 128 pixel sizes. The [original icon](icon-concepts/generated-v2/03-grid-lens-transparent.png) has a transparent outer background and an enlarged lens for toolbar visibility. Rebuild the ZIP after changing extension files.

Before submitting:

- Reload the unpacked extension in Chrome and verify camera selection, ordering, fill, fullscreen, and recovery on Google Home with your cameras.
- Register/sign in to the Chrome Web Store developer dashboard and upload the ZIP as a new item.
- Supply the store description, 128 pixel icon, and at least one screenshot of the extension in use. Avoid exposing private camera footage in listing screenshots.
- Complete the Privacy, Distribution, and Test instructions sections. Review the actual data handling when completing the privacy disclosures.

Single-purpose description: Arrange and manage live camera tiles on Google Home for web.

Permission justification: `storage` saves camera selection, ordering, layout, and recovery preferences locally. The content script is limited to `https://home.google.com/*` so it can arrange the camera tiles and operate their existing controls.

This is an independent extension and is not affiliated with or endorsed by Google.

Official guidance: [Publishing](https://developer.chrome.com/docs/webstore/publish) and [store images](https://developer.chrome.com/docs/webstore/images).

## Load in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this project's `extension` folder.
3. Open or refresh [Google Home](https://home.google.com/) and go to the **Cameras** grid.

## Use the grid

The floating dock in the top-right corner holds three icon buttons. Hover over one to see its name.

- **Choose cameras** shows which tiles are selected. Use the arrow buttons to change their order. The extension saves the selection and order per Google Home.
- **Fill tiles** crops video edges to fill each cell. By default, the whole frame is visible.
- **Fullscreen** expands the grid to the display. Use **Exit fullscreen** or press Escape to leave.
- **Google layout** restores the site's original view. Click **Camera grid** to switch back.

## Automatic recovery

While the grid is visible, the extension watches selected feeds for playback that has stopped advancing. It gives new players time to load and leaves cameras that Google Home marks idle or off alone, unless a tile offers an explicit retry.

If the tile provides a **Reload**, **Retry**, or similar button, the extension uses it first. If playback stays stalled or there is no retry button, it reloads the Google Home tab. The saved layout returns after a reload. Click **Fullscreen** again if Chrome exits fullscreen during the reload.

When a failure persists, the extension spaces out whole-page reloads and pauses them after three attempts. Stable playback resets the limit. You can also reset it by toggling **Automatically reload stalled feeds** off and back on.
