(() => {
  'use strict';

  const GRID = 'ghw-cameras-grid-view > .grid';
  const TILE = ':scope > .grid__column > .grid__item';
  const TICK = 2_000;
  const STARTUP_GRACE = 35_000;
  const STALL_TIME = 25_000;
  const RETRY_GRACE = 30_000;
  const MAX_RELOADS = 3;
  const STORAGE_PREFIX = 'ghcg:layout:';
  const RELOAD_KEY = 'ghcg:recovery';
  const defaults = { enabled: true, order: null, fill: false, recover: true };

  let grid;
  let homeKey;
  let settings;
  let toolbar;
  let scheduled = false;
  let tiles = [];
  let visibleTiles = [];
  let panelSignature = '';
  let recovering = false;
  let healthySince = 0;
  let reloadState = { count: 0, at: 0, key: null };
  const feeds = new Map();

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function button(text, handler) {
    const element = node('button', '', text);
    element.type = 'button';
    element.addEventListener('click', handler);
    return element;
  }

  function checkbox(text, checked, handler) {
    const label = node('label');
    const input = node('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => handler(input.checked));
    label.append(input, document.createTextNode(text));
    return label;
  }

  function setStatus(text) {
    if (toolbar && toolbar.status.textContent !== text) toolbar.status.textContent = text;
  }

  function setSettings(changes) {
    settings = { ...settings, ...changes };
    chrome.storage.local.set({ [homeKey]: settings }).catch(() => {
      setStatus('Could not save the camera grid.');
    });
    reconcile();
  }

  function buildToolbar() {
    const element = node('div', 'ghcg-controls');
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', 'Camera grid controls');
    const status = node('span', 'ghcg-status');
    status.setAttribute('role', 'status');

    const panel = node('div', 'ghcg-panel');
    panel.id = 'ghcg-camera-settings';
    panel.hidden = true;
    const configure = button('', () => {
      panel.hidden = !panel.hidden;
      configure.setAttribute('aria-expanded', String(!panel.hidden));
      panelSignature = '';
      reconcile();
      if (!panel.hidden) panel.querySelector('input')?.focus();
    });
    configure.dataset.ghcgIcon = 'cameras';
    configure.setAttribute('aria-label', 'Choose cameras');
    configure.title = 'Choose cameras';
    configure.setAttribute('aria-expanded', 'false');
    configure.setAttribute('aria-controls', panel.id);
    const fullscreen = button('', async () => {
      try {
        if (document.fullscreenElement === grid) await document.exitFullscreen();
        else await grid.requestFullscreen();
        if (status.textContent === 'Fullscreen is unavailable.') setStatus('');
      } catch {
        setStatus('Fullscreen is unavailable.');
      }
    });
    fullscreen.dataset.ghcgIcon = 'fullscreen';
    const toggle = button('Camera grid', () => {
      if (document.fullscreenElement === grid) document.exitFullscreen().catch(() => {});
      setSettings({ enabled: !settings.enabled });
    });
    toggle.dataset.ghcgIcon = 'layout';

    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || panel.hidden) return;
      panel.hidden = true;
      configure.setAttribute('aria-expanded', 'false');
      configure.focus();
    });
    element.append(status, configure, fullscreen, toggle, panel);
    grid.append(element);
    return { element, status, panel, configure, fullscreen, toggle };
  }

  function listTiles() {
    const counts = new Map();
    return [...grid.querySelectorAll(TILE)].flatMap((element) => {
      const name = element.querySelector('.footer-name')?.textContent.trim();
      if (!name) return [];
      const occurrence = (counts.get(name) ?? 0) + 1;
      counts.set(name, occurrence);
      return [{ element, name, id: JSON.stringify([name, occurrence]) }];
    });
  }

  function orderTiles() {
    if (settings.order === null) return tiles;
    const byId = new Map(tiles.map((tile) => [tile.id, tile]));
    const selected = settings.order.map((id) => byId.get(id)).filter(Boolean);
    return selected.length ? selected : tiles;
  }

  function renderPanel() {
    const { panel } = toolbar;
    if (panel.hidden) return;
    const chosen = visibleTiles.map(({ id }) => id);
    const available = tiles.map(({ id }) => id);
    const signature = JSON.stringify([chosen, available, settings.fill, settings.recover]);
    if (signature === panelSignature) return;
    panelSignature = signature;

    const focus = panel.contains(document.activeElement) ? document.activeElement.dataset.ghcgFocus : null;
    const list = node('ul');
    const nextOrder = [
      ...chosen,
      ...((settings.order ?? []).filter((id) => !available.includes(id))),
    ];
    const sortedTiles = [...visibleTiles, ...tiles.filter(({ id }) => !chosen.includes(id))];
    sortedTiles.forEach(({ id, name }) => {
      const index = chosen.indexOf(id);
      const item = node('li');
      const selection = checkbox(name, index >= 0, (checked) => {
        setSettings({ order: checked ? [...nextOrder, id] : nextOrder.filter((key) => key !== id) });
      });
      const input = selection.querySelector('input');
      input.dataset.ghcgFocus = id;
      input.disabled = index >= 0 && chosen.length === 1;
      item.append(selection);

      if (index >= 0) {
        for (const [offset, title, icon] of [[-1, 'Move earlier', '↑'], [1, 'Move later', '↓']]) {
          const move = button(icon, () => {
            const order = [...nextOrder];
            const target = index + offset;
            [order[index], order[target]] = [order[target], order[index]];
            setSettings({ order });
          });
          move.disabled = index + offset < 0 || index + offset >= chosen.length;
          move.setAttribute('aria-label', `${title}: ${name}`);
          move.dataset.ghcgFocus = id + offset;
          item.append(move);
        }
      }
      list.append(item);
    });

    const fill = checkbox('Fill tiles (crop edges)', settings.fill, (checked) => setSettings({ fill: checked }));
    fill.querySelector('input').dataset.ghcgFocus = 'fill';
    const recover = checkbox('Automatically reload stalled feeds', settings.recover, (checked) => {
      if (!settings.recover && checked) resetRecovery();
      setSettings({ recover: checked });
    });
    recover.querySelector('input').dataset.ghcgFocus = 'recover';
    panel.replaceChildren(list, fill, recover);
    if (focus) {
      [...panel.querySelectorAll('[data-ghcg-focus]')]
        .find((element) => element.dataset.ghcgFocus === focus && !element.disabled)?.focus();
    }
  }

  function applyLayout() {
    const active = settings.enabled && tiles.length > 0;
    grid.toggleAttribute('data-ghcg-active', active);
    toolbar.configure.hidden = !active;
    toolbar.fullscreen.hidden = !active;
    toolbar.status.hidden = !active;
    const label = active ? 'Google layout' : 'Camera grid';
    if (toolbar.toggle.getAttribute('aria-label') !== label) {
      toolbar.toggle.setAttribute('aria-label', label);
      toolbar.toggle.title = label;
      toolbar.toggle.textContent = active ? '' : label;
    }
    updateFullscreenLabel();
    if (!active) {
      toolbar.panel.hidden = true;
      toolbar.configure.setAttribute('aria-expanded', 'false');
    }

    const count = visibleTiles.length;
    if (active) {
      const width = grid.clientWidth;
      const height = grid.clientHeight;
      let bestArea = -1;
      let bestColumns = 1;
      for (let columns = 1; columns <= count; columns++) {
        const rows = Math.ceil(count / columns);
        const cellWidth = width / columns;
        const cellHeight = Math.max(0, height) / rows;
        const videoWidth = Math.min(cellWidth, cellHeight * 16 / 9);
        const area = videoWidth * videoWidth * 9 / 16;
        if (area > bestArea) {
          bestArea = area;
          bestColumns = columns;
        }
      }
      grid.style.setProperty('--ghcg-columns', bestColumns);
      grid.style.setProperty('--ghcg-rows', Math.ceil(count / bestColumns));
      grid.style.setProperty('--ghcg-fit', settings.fill ? 'cover' : 'contain');
    }

    const positions = new Map(visibleTiles.map(({ element }, index) => [element, index]));
    for (const { element } of tiles) {
      const position = positions.get(element);
      element.toggleAttribute('data-ghcg-tile', active && position !== undefined);
      element.toggleAttribute('data-ghcg-hidden', active && position === undefined);
      if (active && position !== undefined) element.style.setProperty('--ghcg-order', position);
      else element.style.removeProperty('--ghcg-order');
    }
  }

  function updateFullscreenLabel() {
    if (!toolbar) return;
    const fullscreen = document.fullscreenElement === grid;
    const label = fullscreen ? 'Exit fullscreen' : 'Fullscreen';
    if (toolbar.fullscreen.getAttribute('aria-label') !== label) {
      toolbar.fullscreen.setAttribute('aria-label', label);
      toolbar.fullscreen.title = label;
      toolbar.fullscreen.setAttribute('aria-pressed', String(fullscreen));
    }
  }

  function clearLayout() {
    if (!grid) return;
    grid.removeAttribute('data-ghcg-active');
    for (const key of ['columns', 'rows', 'fit']) grid.style.removeProperty(`--ghcg-${key}`);
    for (const { element } of tiles) {
      element.removeAttribute('data-ghcg-tile');
      element.removeAttribute('data-ghcg-hidden');
      element.style.removeProperty('--ghcg-order');
    }
    if (document.fullscreenElement === grid) document.exitFullscreen().catch(() => {});
    toolbar?.element.remove();
    toolbar = null;
  }

  function readReloadState() {
    try {
      const state = JSON.parse(sessionStorage.getItem(RELOAD_KEY));
      if (state?.key === homeKey) return state;
    } catch {
      // A fresh watch can still use per-camera retry when session storage is unavailable.
    }
    return { count: 0, at: 0, key: homeKey };
  }

  function resetRecovery() {
    feeds.clear();
    healthySince = 0;
    reloadState = { count: 0, at: 0, key: homeKey };
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      // Per-camera retries do not need session storage.
    }
  }

  function reconcile() {
    const nextGrid = document.querySelector(GRID);
    const route = location.pathname.match(/^(.*)\/cameras\/grid\/?$/);
    const nextKey = route ? STORAGE_PREFIX + route[1] : null;
    const nextTilesExist = nextGrid?.querySelector(TILE);
    if (!nextTilesExist || !nextKey || nextGrid !== grid || nextKey !== homeKey) {
      if (!grid && (!nextTilesExist || !nextKey)) return;
      clearLayout();
      grid = nextTilesExist && nextKey ? nextGrid : null;
      homeKey = grid ? nextKey : null;
      settings = null;
      feeds.clear();
      healthySince = 0;
      tiles = [];
      visibleTiles = [];
      if (!grid) return;
      reloadState = readReloadState();
      const requestedGrid = grid;
      chrome.storage.local.get(nextKey).then((stored) => {
        if (grid !== requestedGrid || homeKey !== nextKey) return;
        settings = { ...defaults, ...stored[nextKey] };
        reconcile();
        if (reloadState.count) setStatus('Page reloaded. Checking camera feeds…');
      }).catch(() => {
        if (grid !== requestedGrid || homeKey !== nextKey) return;
        settings = { ...defaults, recover: false };
        reconcile();
        setStatus('Camera settings could not be loaded.');
      });
      return;
    }

    if (!settings) return;
    if (!toolbar?.element.isConnected) {
      toolbar = buildToolbar();
      panelSignature = '';
    }
    tiles = listTiles();
    visibleTiles = orderTiles();
    applyLayout();
    renderPanel();
  }

  function scheduleLayout() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      reconcile();
    });
  }

  function retryControl(tile) {
    return [...tile.querySelectorAll('button, [role="button"]')].find((control) => {
      if (control.matches(':disabled, [aria-disabled="true"]') || !control.getClientRects().length
        || getComputedStyle(control).visibility !== 'visible') return false;
      const name = control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent.trim();
      return /^(?:try again|retry|reload|reconnect)(?:[.! ]|$)/i.test(name);
    });
  }

  function checkFeeds() {
    if (!settings?.enabled || !settings.recover || !grid?.isConnected || recovering) {
      feeds.clear();
      return;
    }
    if (document.hidden) {
      feeds.clear();
      healthySince = 0;
      return;
    }

    const now = Date.now();
    const visibleIds = new Set(visibleTiles.map(({ id }) => id));
    for (const id of feeds.keys()) {
      if (!visibleIds.has(id)) feeds.delete(id);
    }

    let healthy = 0;
    let expected = 0;
    let failure;
    for (const tile of visibleTiles) {
      const status = tile.element.querySelector('.status-text');
      const label = status?.getAttribute('aria-label') || status?.textContent.trim() || '';
      const retry = retryControl(tile.element);
      const intentionallyIdle = /\b(idle|off|paused)\b/i.test(label)
        || Boolean(tile.element.querySelector('button[aria-label^="Live video of"]'));
      if (intentionallyIdle && !retry) {
        feeds.delete(tile.id);
        continue;
      }

      const video = tile.element.querySelector('video');
      const live = /\blive\b/i.test(label);
      const error = Boolean(video?.error || retry || /\b(error|offline|unavailable)\b/i.test(label));
      // Require evidence that the tile is expected to play before recovering it.
      if (!video?.videoWidth && !live && !error && !video?.srcObject && !feeds.has(tile.id)) continue;
      expected++;
      let state = feeds.get(tile.id);
      if (!state) {
        state = { video, frame: null, lastFrame: now, since: now, triedAt: 0 };
        feeds.set(tile.id, state);
      }
      if (state.video !== video) {
        state.video = video;
        state.frame = null;
      }
      const frame = video?.videoWidth
        ? (video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.currentTime)
        : null;
      if (!error && frame !== null && frame !== state.frame && !video.paused && !video.ended) {
        if (state.frame !== null) state.triedAt = 0;
        state.frame = frame;
        state.lastFrame = now;
      }

      if (!error && frame !== null && !video.paused && now - state.lastFrame < TICK * 3) healthy++;
      if (now - state.since < STARTUP_GRACE || now - state.lastFrame < STALL_TIME) continue;
      if (!state.triedAt && retry) {
        state.triedAt = now;
        setStatus(`Reconnecting ${tile.name}…`);
        retry.click();
        return;
      }
      if (!state.triedAt || now - state.triedAt >= RETRY_GRACE) failure ??= tile;
    }

    if (expected && healthy === expected) {
      healthySince ||= now;
      if (toolbar.status.textContent.startsWith('Reconnecting') || reloadState.count) {
        setStatus('');
      }
      if (reloadState.count && now - healthySince >= 60_000) resetRecovery();
      return;
    }
    healthySince = 0;
    if (!failure) return;

    if (reloadState.count >= MAX_RELOADS) {
      setStatus(`${failure.name} is unavailable. Automatic page reload paused.`);
      return;
    }

    const delay = 60_000 * 2 ** reloadState.count;
    if (now - reloadState.at < delay) {
      setStatus(`${failure.name} is stalled. Waiting to reload…`);
      return;
    }

    const next = { key: homeKey, count: reloadState.count + 1, at: now };
    try {
      sessionStorage.setItem(RELOAD_KEY, JSON.stringify(next));
    } catch {
      setStatus('Automatic page reload needs browser session storage.');
      return;
    }
    recovering = true;
    setStatus(`Reloading Google Home to recover ${failure.name}…`);
    location.reload();
  }

  new MutationObserver((records) => {
    if (records.some(({ target }) => !toolbar?.element.contains(target))) scheduleLayout();
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('popstate', scheduleLayout);
  document.addEventListener('fullscreenchange', () => {
    updateFullscreenLabel();
    scheduleLayout();
  });
  document.addEventListener('visibilitychange', () => {
    feeds.clear();
    healthySince = 0;
    scheduleLayout();
  });
  window.setInterval(() => {
    reconcile();
    checkFeeds();
  }, TICK);
  reconcile();
})();
