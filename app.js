(function () {
  'use strict';

  const CATEGORIES = ['toiletries', 'food', 'house'];
  const CATEGORY_LABELS = { toiletries: 'Toiletries', food: 'Food', house: 'House' };
  const STORAGE_KEY = 'home-stock-items-v1';

  const SEED_ITEMS = [
    { category: 'toiletries', name: "Aquafresh", count: 10, notes: '' },
    { category: 'toiletries', name: "Tom's of Maine", count: 1, notes: '' },
    { category: 'toiletries', name: "Negev's toothpaste", count: 3, notes: '' },
    { category: 'toiletries', name: "Necca 7", count: 44, notes: '' },
    { category: 'toiletries', name: "Toilet paper", count: 1, notes: '' },
    { category: 'toiletries', name: "Noam's deodorant", count: 7, notes: '' },
    { category: 'toiletries', name: "Tamar's deodorant", count: 8, notes: '' },
    { category: 'food', name: "BBQ Sauce", count: 6, notes: '' },
    { category: 'food', name: "Olive oil", count: 1, notes: '' },
    { category: 'food', name: "Pine nuts", count: 1, notes: '' },
    { category: 'food', name: "Sugar", count: 1, notes: '' },
    { category: 'food', name: "Flour", count: 1, notes: '' },
    { category: 'food', name: "Paper Towels", count: 2, notes: '' },
  ];

  const config = window.HOMESTOCK_CONFIG || {};
  let items = [];

  const syncNote = document.getElementById('sync-note');
  const undoBar = document.getElementById('undo-bar');
  const undoLabel = document.getElementById('undo-label');
  const undoBtn = document.getElementById('undo-btn');
  undoBtn.addEventListener('click', undoDelete);

  function uid() {
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function stepUp(count) {
    if (count < 1) return Math.min(1, count + 0.5);
    return count + 1;
  }

  function stepDown(count) {
    if (count <= 0) return 0;
    if (count <= 1) return Math.max(0, count - 0.5);
    return count - 1;
  }

  function formatCount(count) {
    return count === 0.5 ? '½' : String(count);
  }

  function showSyncNote(text) {
    syncNote.textContent = text;
    syncNote.hidden = false;
  }

  function hideSyncNote() {
    syncNote.hidden = true;
  }

  // ---------- Backend: local storage ----------
  function localLoad() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      const seeded = SEED_ITEMS.map((it) => ({ id: uid(), ...it }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    try {
      return JSON.parse(raw) || [];
    } catch (e) {
      return [];
    }
  }
  function localSave(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  // ---------- Backend: shared list (Firebase) ----------
  // Two modes. "local" (the default): the list lives in this browser's
  // localStorage and nothing leaves the phone. "cloud": the list lives in one
  // Firestore document, families/{code}, in the same Firebase project Showtime
  // uses, so every phone with the code sees the same items.
  //
  // Items are a map on that document (stock.<itemId> = {category, name, count,
  // notes}) rather than a subcollection: the project's security rules only open
  // `tickets` beneath a family, while a field on the family document itself
  // needs no rule changes. Field-level merges touch a single item, so two
  // phones editing different items never overwrite each other.
  const FAMILY_KEY = 'keeping-stock-family-code';
  const CLOUD_CACHE_KEY = 'keeping-stock-cloud-cache';
  // No 0/O or 1/I/L — codes get typed by hand on a phone keyboard.
  const FAMILY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const NETWORK_TIMEOUT_MS = 15000;
  const OFFLINE_MESSAGE = 'Could not reach the server — check your connection.';

  let familyCode = null;
  try { familyCode = localStorage.getItem(FAMILY_KEY); } catch (e) { /* storage blocked — stays local */ }

  let firestoreDb = null;
  let authReady = null;
  let unsubscribeFamily = null;

  const isCloud = () => !!familyCode;

  function generateFamilyCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return [...bytes].map((b) => FAMILY_CODE_ALPHABET[b % FAMILY_CODE_ALPHABET.length]).join('');
  }

  function withTimeout(promise, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(message)), NETWORK_TIMEOUT_MS)),
    ]);
  }

  function ensureFirebase() {
    if (typeof firebase === 'undefined' || !config.firebase) {
      return Promise.reject(new Error('Sharing is unavailable right now (Firebase did not load).'));
    }
    if (!firestoreDb) {
      firebase.initializeApp(config.firebase);
      firestoreDb = firebase.firestore();
      firestoreDb.enablePersistence({ synchronizeTabs: true }).catch(() => {
        // Another tab holds the offline cache, or the browser can't — syncing still works.
      });
    }
    if (!authReady) {
      authReady = new Promise((resolve, reject) => {
        firebase.auth().onAuthStateChanged((user) => { if (user) resolve(user); });
        firebase.auth().signInAnonymously().catch((err) => { authReady = null; reject(err); });
      });
    }
    return authReady;
  }

  const familyRef = (code) => firestoreDb.collection('families').doc(code);

  function itemsFromSnapshot(snap) {
    const stock = (snap.exists && snap.data().stock) || {};
    return Object.keys(stock)
      .filter((id) => stock[id] && typeof stock[id] === 'object')
      .map((id) => ({
        id,
        category: stock[id].category,
        name: stock[id].name,
        count: Number(stock[id].count) || 0,
        notes: stock[id].notes || '',
      }))
      .filter((it) => CATEGORIES.includes(it.category) && typeof it.name === 'string' && it.name);
  }

  // Last list seen from the cloud, so the app paints instantly on launch (and
  // offline) instead of flashing an empty list while the first sync arrives.
  function readCloudCache() {
    try { return JSON.parse(localStorage.getItem(CLOUD_CACHE_KEY)) || []; } catch (e) { return []; }
  }
  function writeCloudCache(list) {
    try { localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(list)); } catch (e) { /* storage blocked/full */ }
  }

  function stopCloud() {
    if (unsubscribeFamily) { unsubscribeFamily(); unsubscribeFamily = null; }
  }

  function startCloud() {
    stopCloud();
    if (!items.length) showSyncNote('Loading the shared list…');
    const unreachable = (err) => {
      console.error(err);
      showSyncNote("Can't reach the shared list right now — showing the last copy on this phone.");
    };
    ensureFirebase()
      .then(() => {
        unsubscribeFamily = familyRef(familyCode).onSnapshot((snap) => {
          hideSyncNote();
          items = itemsFromSnapshot(snap);
          // A swiped-away item stays hidden until its undo window closes.
          if (pendingDelete) items = items.filter((it) => it.id !== pendingDelete.item.id);
          writeCloudCache(items);
          render();
        }, unreachable);
      })
      .catch(unreachable);
  }

  function reportSyncError(err) {
    console.error(err);
    showSyncNote("Couldn't save to the shared list — check your connection.");
  }

  // Writes are deliberately not awaited by the UI: offline, Firestore queues
  // them and finishes once the connection is back, so waiting would freeze
  // the screen. The `code` is captured now in case the phone leaves the list
  // before the write goes out.
  function cloudSaveFields(id, fields) {
    const code = familyCode;
    ensureFirebase()
      .then(() => familyRef(code).set({ stock: { [id]: fields } }, { merge: true }))
      .catch(reportSyncError);
  }

  function cloudRemove(id) {
    const code = familyCode;
    ensureFirebase()
      .then(() => familyRef(code).set({ stock: { [id]: firebase.firestore.FieldValue.delete() } }, { merge: true }))
      .catch(reportSyncError);
  }

  function stockMap(list) {
    const stock = {};
    list.forEach((it) => {
      stock[it.id] = { category: it.category, name: it.name, count: it.count, notes: it.notes || '' };
    });
    return stock;
  }

  // ---------- Init ----------
  function init() {
    if (isCloud()) {
      items = readCloudCache();
      render();
      startCloud();
    } else {
      items = localLoad();
      render();
    }
    renderSyncState();
  }

  // ---------- Mutations ----------
  // Each change updates the screen immediately, then saves: to this phone's
  // storage in local mode, or merged into the shared document in cloud mode.
  function persistFields(item, fields) {
    if (isCloud()) cloudSaveFields(item.id, fields);
    else localSave(items);
  }

  function persistRemove(id) {
    if (isCloud()) cloudRemove(id);
    else localSave(items);
  }

  function addItem(category, name, count) {
    name = name.trim();
    if (!name) return;
    count = Number(count);
    if (!Number.isFinite(count) || count < 0) count = 0;
    count = Math.round(count * 2) / 2;

    const existing = items.find(
      (it) => it.category === category && it.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      setCount(existing.id, existing.count + count);
      return;
    }

    const item = { id: uid(), category, name, count, notes: '' };
    items.push(item);
    render();
    persistFields(item, { category, name, count, notes: '' });
  }

  function setCount(id, count) {
    count = Math.max(0, count);
    const item = items.find((it) => it.id === id);
    if (!item) return;
    item.count = count;
    render();
    persistFields(item, { count });
  }

  function updateItemDetails(id, name, notes, category) {
    name = name.trim();
    notes = notes.trim();
    if (!name) return;
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const conflict = items.find(
      (it) => it.id !== id && it.category === category && it.name.toLowerCase() === name.toLowerCase()
    );
    if (conflict) {
      alert(`"${name}" already exists in ${CATEGORY_LABELS[category]}.`);
      return;
    }
    item.name = name;
    item.notes = notes;
    item.category = category;
    render();
    persistFields(item, { name, notes, category });
  }

  function deleteItem(id) {
    items = items.filter((it) => it.id !== id);
    persistRemove(id);
  }

  // ---------- Swipe-to-delete with undo ----------
  let pendingDelete = null;

  function showUndoBar(name) {
    undoLabel.textContent = `Deleted "${name}"`;
    undoBar.hidden = false;
  }

  function hideUndoBar() {
    undoBar.hidden = true;
  }

  function finalizePendingDelete() {
    if (!pendingDelete) return;
    const { item, timer } = pendingDelete;
    clearTimeout(timer);
    pendingDelete = null;
    hideUndoBar();
    deleteItem(item.id);
  }

  function swipeDeleteItem(item) {
    finalizePendingDelete();
    items = items.filter((it) => it.id !== item.id);
    render();
    showUndoBar(item.name);
    pendingDelete = {
      item,
      timer: setTimeout(finalizePendingDelete, 4000),
    };
  }

  function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    const { item } = pendingDelete;
    pendingDelete = null;
    items.push(item);
    render();
    hideUndoBar();
  }

  function attachSwipeToDelete(row, item) {
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let swiping = false;
    let hideStripTimer = null;
    const wrap = row.parentElement;

    row.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
      swiping = false;
      row.style.transition = 'none';
    });

    row.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!swiping) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          swiping = true;
          clearTimeout(hideStripTimer);
          wrap.classList.add('is-swiping');
          row.setPointerCapture(e.pointerId);
        } else if (Math.abs(dy) > 8) {
          dragging = false;
          return;
        } else {
          return;
        }
      }
      const clamped = Math.max(0, Math.min(dx, row.offsetWidth));
      row.style.transform = `translateX(${clamped}px)`;
      e.preventDefault();
    });

    function finishDrag(e) {
      if (!dragging) return;
      dragging = false;
      if (!swiping) return;
      swiping = false;
      const dx = e.clientX - startX;
      const threshold = row.offsetWidth * 0.4;
      row.style.transition = 'transform 0.2s ease';
      if (dx > threshold) {
        row.style.transform = 'translateX(100%)';
        setTimeout(() => swipeDeleteItem(item), 150);
      } else {
        row.style.transform = 'translateX(0)';
        // hide the red strip again once the row has slid back over it
        hideStripTimer = setTimeout(() => wrap.classList.remove('is-swiping'), 250);
      }
    }

    row.addEventListener('pointerup', finishDrag);
    row.addEventListener('pointercancel', finishDrag);
  }

  // ---------- Rendering ----------
  function render() {
    CATEGORIES.forEach((category) => {
      const list = document.getElementById(`list-${category}`);
      const emptyState = document.getElementById(`empty-${category}`);
      const rows = items
        .filter((it) => it.category === category)
        .sort((a, b) => a.name.localeCompare(b.name));

      list.innerHTML = '';
      emptyState.hidden = rows.length > 0;

      rows.forEach((item) => {
        const wrap = document.createElement('li');
        wrap.className = 'item-row-wrap';
        wrap.dataset.id = item.id;

        const deleteBg = document.createElement('div');
        deleteBg.className = 'item-row-delete-bg';
        deleteBg.textContent = 'Delete';
        deleteBg.setAttribute('aria-hidden', 'true');

        const row = document.createElement('div');
        row.className = 'item-row';

        const info = document.createElement('div');
        info.className = 'item-info';
        info.tabIndex = 0;
        info.addEventListener('click', () => openRenameModal(item));

        const nameRow = document.createElement('span');
        nameRow.className = 'item-name-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'item-name';
        nameSpan.textContent = item.name;
        nameRow.appendChild(nameSpan);

        if (item.count <= 0.5) {
          const flag = document.createElement('span');
          flag.className = 'low-flag';
          flag.textContent = '❗';
          flag.setAttribute('aria-hidden', 'true');
          nameRow.appendChild(flag);
        }

        info.appendChild(nameRow);

        if (item.notes) {
          const notesSpan = document.createElement('span');
          notesSpan.className = 'item-notes';
          notesSpan.textContent = item.notes;
          info.appendChild(notesSpan);
        }

        const controls = document.createElement('div');
        controls.className = 'item-controls';

        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'step-btn minus';
        minusBtn.textContent = '−';
        minusBtn.setAttribute('aria-label', `Remove one ${item.name}`);
        minusBtn.disabled = item.count <= 0;
        minusBtn.addEventListener('click', () => setCount(item.id, stepDown(item.count)));

        const countSpan = document.createElement('span');
        countSpan.className = 'item-count';
        countSpan.textContent = formatCount(item.count);

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'step-btn plus';
        plusBtn.textContent = '+';
        plusBtn.setAttribute('aria-label', `Add one ${item.name}`);
        plusBtn.addEventListener('click', () => setCount(item.id, stepUp(item.count)));

        controls.append(minusBtn, countSpan, plusBtn);
        row.append(info, controls);
        wrap.append(deleteBg, row);
        attachSwipeToDelete(row, item);
        list.appendChild(wrap);
      });
    });
  }

  // ---------- Tabs ----------
  const TAB_KEY = 'keeping-stock-tab';
  function switchTab(view) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
    document.querySelectorAll('.view').forEach((v) => {
      v.hidden = v.id !== `view-${view}`;
    });
    document.body.classList.remove(...CATEGORIES.map((c) => `theme-${c}`));
    document.body.classList.add(`theme-${view}`);
    try { sessionStorage.setItem(TAB_KEY, view); } catch (e) { /* storage blocked — tab just won't survive a refresh */ }
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.view);
    });
  });

  // Pull-to-refresh reloads the page, which would otherwise dump you back on
  // the first tab. sessionStorage (not localStorage) survives a reload but not
  // closing the app, so a fresh launch still starts on the default tab.
  try {
    const savedTab = sessionStorage.getItem(TAB_KEY);
    if (savedTab && document.getElementById(`view-${savedTab}`)) switchTab(savedTab);
  } catch (e) { /* storage blocked — start on the default tab */ }

  // ---------- Add-item modal ----------
  const addModal = document.getElementById('add-modal');
  const addForm = document.getElementById('add-form');
  const nameInput = document.getElementById('name-input');
  const countInput = document.getElementById('count-input');
  const headerAddBtn = document.getElementById('header-add-btn');
  let addCategory = 'toiletries';

  function openAddModal(category) {
    addCategory = category;
    document.getElementById('modal-title').textContent =
      `Add item to ${CATEGORY_LABELS[addCategory]}`;
    nameInput.value = '';
    countInput.value = '1';
    addModal.hidden = false;
    nameInput.focus();
  }

  document.querySelectorAll('.add-item-btn').forEach((btn) => {
    btn.addEventListener('click', () => openAddModal(btn.dataset.category));
  });

  headerAddBtn.addEventListener('click', () => {
    const activeTab = document.querySelector('.tab.is-active');
    openAddModal(activeTab.dataset.view);
  });

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addItem(addCategory, nameInput.value, countInput.value);
    addModal.hidden = true;
  });

  addModal.querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', () => { addModal.hidden = true; })
  );

  // ---------- Rename modal ----------
  const renameModal = document.getElementById('rename-modal');
  const renameForm = document.getElementById('rename-form');
  const renameInput = document.getElementById('rename-input');
  const renameNotesInput = document.getElementById('rename-notes-input');
  const renameCategoryInput = document.getElementById('rename-category-input');
  const renameDeleteBtn = document.getElementById('rename-delete-btn');
  let renameId = null;

  CATEGORIES.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = CATEGORY_LABELS[category];
    renameCategoryInput.appendChild(option);
  });

  function openRenameModal(item) {
    renameId = item.id;
    renameInput.value = item.name;
    renameNotesInput.value = item.notes || '';
    renameCategoryInput.value = item.category;
    renameModal.hidden = false;
    renameInput.focus();
    renameInput.select();
  }

  renameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (renameId) {
      await updateItemDetails(renameId, renameInput.value, renameNotesInput.value, renameCategoryInput.value);
    }
    renameModal.hidden = true;
  });

  renameDeleteBtn.addEventListener('click', () => {
    const item = items.find((it) => it.id === renameId);
    if (item && confirm(`Delete "${item.name}" from the list?`)) {
      deleteItem(item.id);
      render();
      renameModal.hidden = true;
    }
  });

  renameModal.querySelectorAll('[data-rename-close]').forEach((el) =>
    el.addEventListener('click', () => { renameModal.hidden = true; })
  );

  // ---------- Backup & restore ----------
  // Local-only mode keeps everything in this browser's storage, so a new phone
  // starts empty. Backup produces a block of text that can be pasted into
  // Restore on another device.
  const backupBtn = document.getElementById('backup-btn');
  const backupModal = document.getElementById('backup-modal');
  const backupExport = document.getElementById('backup-export');
  const backupImport = document.getElementById('backup-import');
  const backupCopyBtn = document.getElementById('backup-copy-btn');
  const backupShareBtn = document.getElementById('backup-share-btn');
  const backupRestoreBtn = document.getElementById('backup-restore-btn');
  const backupRestoreSection = document.getElementById('backup-restore-section');
  const backupStatus = document.getElementById('backup-status');

  function setBackupStatus(message, isError) {
    backupStatus.textContent = message;
    backupStatus.classList.toggle('is-error', !!isError);
  }

  function buildBackup() {
    return JSON.stringify({
      app: 'keeping-stock',
      version: 1,
      exportedAt: new Date().toISOString(),
      items: items.map(({ category, name, count, notes }) => ({ category, name, count, notes: notes || '' })),
    });
  }

  function parseBackup(text) {
    const notABackup = { error: "That doesn't look like a Keeping Stock backup." };
    let data;
    try { data = JSON.parse(text); } catch (e) { return notABackup; }
    const list = Array.isArray(data) ? data : data && data.items;
    if (!Array.isArray(list)) return notABackup;

    const seen = new Set();
    const parsed = [];
    let skipped = 0;
    list.forEach((raw) => {
      const name = raw && typeof raw.name === 'string' ? raw.name.trim() : '';
      const count = Number(raw && raw.count);
      if (!name || !CATEGORIES.includes(raw.category) || !Number.isFinite(count)) { skipped++; return; }
      const key = `${raw.category}|${name.toLowerCase()}`;
      if (seen.has(key)) { skipped++; return; }
      seen.add(key);
      parsed.push({
        category: raw.category,
        name,
        count: Math.round(Math.max(0, count) * 2) / 2,
        notes: typeof raw.notes === 'string' ? raw.notes.trim() : '',
      });
    });
    if (!parsed.length) return { error: 'No items found in that backup.' };
    return { items: parsed, skipped };
  }

  function openBackupModal() {
    backupExport.value = buildBackup();
    backupImport.value = '';
    setBackupStatus('');
    const shared = isCloud();
    backupRestoreSection.hidden = shared;
    document.getElementById('backup-title').textContent = shared ? 'Back up your list' : 'Backup & restore';
    document.getElementById('backup-help').innerHTML = shared
      ? 'Your list is already saved online, so you don&rsquo;t need this. It just gives you a text copy to keep if you want one.'
      : 'Copy your list from this device, then paste it into <strong>Restore</strong> on your other phone.';
    backupShareBtn.hidden = !navigator.share;
    backupModal.hidden = false;
  }

  async function copyBackup() {
    try {
      await navigator.clipboard.writeText(backupExport.value);
    } catch (e) {
      backupExport.focus();
      backupExport.select();
      if (!(document.execCommand && document.execCommand('copy'))) {
        setBackupStatus('Press and hold the text above to copy it.', true);
        return;
      }
    }
    setBackupStatus('Copied! Paste it somewhere you can reach from your other phone.');
  }

  function restoreBackup() {
    const result = parseBackup(backupImport.value.trim());
    if (result.error) { setBackupStatus(result.error, true); return; }
    if (isCloud()) { setBackupStatus('Restore is only for a list that lives on this phone.', true); return; }
    if (!confirm(`Replace everything on this device with the ${result.items.length} items in this backup?`)) return;
    finalizePendingDelete();
    items = result.items.map((it) => ({ id: uid(), ...it }));
    localSave(items);
    render();
    backupImport.value = '';
    backupExport.value = buildBackup();
    const n = result.items.length;
    setBackupStatus(`Restored ${n} ${n === 1 ? 'item' : 'items'}.` + (result.skipped ? ` (${result.skipped} skipped.)` : ''));
  }

  backupBtn.addEventListener('click', openBackupModal);
  backupCopyBtn.addEventListener('click', copyBackup);
  backupRestoreBtn.addEventListener('click', restoreBackup);
  backupShareBtn.addEventListener('click', async () => {
    try {
      await navigator.share({ title: 'Keeping Stock backup', text: backupExport.value });
    } catch (e) { /* share sheet dismissed */ }
  });
  backupModal.querySelectorAll('[data-backup-close]').forEach((el) =>
    el.addEventListener('click', () => { backupModal.hidden = true; })
  );

  // ---------- Share this list (create / join / leave) ----------
  const syncBtn = document.getElementById('sync-btn');
  const syncModal = document.getElementById('sync-modal');
  const syncLocalView = document.getElementById('sync-local-view');
  const syncCloudView = document.getElementById('sync-cloud-view');
  const syncCodeInput = document.getElementById('sync-code-input');
  const syncCodeDisplay = document.getElementById('sync-code-display');
  const syncStatus = document.getElementById('sync-status');
  const syncCreateBtn = document.getElementById('sync-create-btn');
  const syncJoinBtn = document.getElementById('sync-join-btn');
  const syncInviteBtn = document.getElementById('sync-invite-btn');
  const syncCopyBtn = document.getElementById('sync-copy-btn');
  const syncLeaveBtn = document.getElementById('sync-leave-btn');

  function setSyncStatus(message, isError) {
    syncStatus.textContent = message;
    syncStatus.classList.toggle('is-error', !!isError);
  }

  function renderSyncState() {
    const cloud = isCloud();
    syncBtn.classList.toggle('is-shared', cloud);
    syncBtn.setAttribute('aria-label', cloud ? 'Shared list settings' : 'Share this list');
    syncLocalView.hidden = cloud;
    syncCloudView.hidden = !cloud;
    syncCodeDisplay.textContent = familyCode || '';
    backupBtn.textContent = cloud ? 'Back up list' : 'Backup & restore';
  }

  function openSyncModal() {
    setSyncStatus('');
    renderSyncState();
    syncModal.hidden = false;
  }

  // Switch this phone to a shared list. The local list in storage is left
  // untouched, so it still serves as a backup copy.
  function adoptFamily(code, keepItems) {
    familyCode = code;
    try {
      localStorage.setItem(FAMILY_KEY, code);
      localStorage.removeItem(CLOUD_CACHE_KEY);
    } catch (e) { /* storage blocked — works until the page is closed */ }
    if (!keepItems) items = [];
    render();
    startCloud();
    renderSyncState();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const box = document.createElement('textarea');
      box.value = text;
      box.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(box);
      box.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { /* ignore */ }
      box.remove();
      return ok;
    }
  }

  async function createFamily() {
    syncCreateBtn.disabled = true;
    setSyncStatus('Creating your shared list…');
    try {
      await withTimeout(ensureFirebase(), OFFLINE_MESSAGE);
      finalizePendingDelete();
      const code = generateFamilyCode();
      await withTimeout(familyRef(code).set({
        app: 'keeping-stock',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        stock: stockMap(items),
      }), OFFLINE_MESSAGE);
      adoptFamily(code, true);
      setSyncStatus('Shared! Tap Invite to send the code to someone.');
    } catch (err) {
      console.error(err);
      setSyncStatus(err && err.message ? err.message : 'Something went wrong. Please try again.', true);
    } finally {
      syncCreateBtn.disabled = false;
    }
  }

  async function joinFamily() {
    const code = syncCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 8) { setSyncStatus('Enter the 8-character code.', true); return; }
    syncJoinBtn.disabled = true;
    setSyncStatus('Joining…');
    try {
      await withTimeout(ensureFirebase(), OFFLINE_MESSAGE);
      const snap = await withTimeout(familyRef(code).get({ source: 'server' }), OFFLINE_MESSAGE);
      if (!snap.exists) { setSyncStatus('No shared list found with that code. Check it and try again.', true); return; }
      finalizePendingDelete();
      adoptFamily(code, false);
      syncCodeInput.value = '';
      setSyncStatus('Joined! The shared list will appear in a moment.');
    } catch (err) {
      console.error(err);
      setSyncStatus(err && err.message ? err.message : 'Something went wrong. Please try again.', true);
    } finally {
      syncJoinBtn.disabled = false;
    }
  }

  function leaveFamily() {
    if (!confirm('Stop syncing on this phone? It keeps a copy of the list as it is now, and the shared list stays online for everyone else.')) return;
    finalizePendingDelete();
    stopCloud();
    familyCode = null;
    try {
      localStorage.removeItem(FAMILY_KEY);
      localStorage.removeItem(CLOUD_CACHE_KEY);
    } catch (e) { /* ignore */ }
    localSave(items);
    hideSyncNote();
    render();
    renderSyncState();
    setSyncStatus('This phone is back to its own list.');
  }

  async function inviteToFamily() {
    const url = location.origin + location.pathname;
    const text = `Join my Keeping Stock list! Open ${url}, tap the ☁️ button at the top, and under "Or join one with a code" enter: ${familyCode}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Keeping Stock', text }); } catch (e) { /* share sheet dismissed */ }
    } else {
      setSyncStatus((await copyText(text)) ? 'Invitation copied — paste it into a message.' : 'Could not copy — share the code above by hand.', false);
    }
  }

  syncBtn.addEventListener('click', openSyncModal);
  syncCreateBtn.addEventListener('click', createFamily);
  syncJoinBtn.addEventListener('click', joinFamily);
  syncInviteBtn.addEventListener('click', inviteToFamily);
  syncLeaveBtn.addEventListener('click', leaveFamily);
  syncCopyBtn.addEventListener('click', async () => {
    setSyncStatus((await copyText(familyCode)) ? 'Code copied.' : 'Could not copy — press and hold the code to copy it.', false);
  });
  syncCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinFamily(); });
  syncModal.querySelectorAll('[data-sync-close]').forEach((el) =>
    el.addEventListener('click', () => { syncModal.hidden = true; })
  );

  // ---------- Back-gesture guard (Android) ----------
  // A page with no browser-history entries makes Android's back button/edge-swipe
  // close the app outright instead of doing anything in-page. Keeping one extra
  // history entry armed means that gesture always lands on us as a popstate
  // event instead — closing an open modal first, or returning to Toiletries.

  const BACK_DEFAULT_VIEW = 'toiletries';

  function closeAnyOpenModal() {
    if (!addModal.hidden) { addModal.hidden = true; return true; }
    if (!renameModal.hidden) { renameModal.hidden = true; return true; }
    if (!backupModal.hidden) { backupModal.hidden = true; return true; }
    if (!syncModal.hidden) { syncModal.hidden = true; return true; }
    return false;
  }

  function armBackGuard() {
    try { history.pushState({ stockGuard: true }, ''); } catch (e) { /* ignore */ }
  }

  window.addEventListener('popstate', () => {
    const activeTab = document.querySelector('.tab.is-active');
    if (!closeAnyOpenModal() && activeTab && activeTab.dataset.view !== BACK_DEFAULT_VIEW) switchTab(BACK_DEFAULT_VIEW);
    armBackGuard();
  });

  armBackGuard();

  init();
})();
