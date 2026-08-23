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
  const useSupabase = !!(config.supabaseUrl && config.supabaseAnonKey);
  let supabase = null;
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

  // ---------- Backend: supabase ----------
  async function refetchFromSupabase() {
    const { data, error } = await supabase.from('items').select('*').order('name', { ascending: true });
    if (error) throw error;
    if (!data.length) {
      const { error: insErr } = await supabase.from('items').insert(SEED_ITEMS);
      if (insErr) throw insErr;
      const again = await supabase.from('items').select('*').order('name', { ascending: true });
      if (again.error) throw again.error;
      items = again.data;
    } else {
      items = data;
    }
  }

  function subscribeRealtime() {
    supabase
      .channel('items-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, async () => {
        try {
          const { data, error } = await supabase.from('items').select('*').order('name', { ascending: true });
          if (error) throw error;
          items = data;
          render();
        } catch (err) {
          console.error(err);
        }
      })
      .subscribe();
  }

  // ---------- Init ----------
  async function init() {
    if (useSupabase) {
      supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      try {
        await refetchFromSupabase();
        subscribeRealtime();
      } catch (err) {
        console.error('Supabase init failed, falling back to local storage', err);
        showSyncNote('Could not connect — using this device only.');
        items = localLoad();
      }
    } else {
      items = localLoad();
    }
    render();
  }

  // ---------- Mutations ----------
  async function addItem(category, name, count) {
    name = name.trim();
    if (!name) return;
    count = Number(count);
    if (!Number.isFinite(count) || count < 0) count = 0;
    count = Math.round(count * 2) / 2;

    const existing = items.find(
      (it) => it.category === category && it.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      await setCount(existing.id, existing.count + count);
      return;
    }

    if (useSupabase) {
      const { data, error } = await supabase
        .from('items')
        .insert({ category, name, count, notes: '' })
        .select()
        .single();
      if (error) { console.error(error); return; }
      items.push(data);
    } else {
      items.push({ id: uid(), category, name, count, notes: '' });
      localSave(items);
    }
    render();
  }

  async function setCount(id, count) {
    count = Math.max(0, count);
    const item = items.find((it) => it.id === id);
    if (!item) return;
    item.count = count;
    render();
    if (useSupabase) {
      const { error } = await supabase.from('items').update({ count }).eq('id', id);
      if (error) console.error(error);
    } else {
      localSave(items);
    }
  }

  async function updateItemDetails(id, name, notes, category) {
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
    if (useSupabase) {
      const { error } = await supabase.from('items').update({ name, notes, category }).eq('id', id);
      if (error) console.error(error);
    } else {
      localSave(items);
    }
  }

  async function deleteItem(id) {
    items = items.filter((it) => it.id !== id);
    if (useSupabase) {
      const { error } = await supabase.from('items').delete().eq('id', id);
      if (error) console.error(error);
    } else {
      localSave(items);
    }
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
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.view').forEach((v) => {
        v.hidden = v.id !== `view-${view}`;
      });
      document.body.classList.remove(...CATEGORIES.map((c) => `theme-${c}`));
      document.body.classList.add(`theme-${view}`);
    });
  });

  // ---------- Add-item modal ----------
  const addModal = document.getElementById('add-modal');
  const addForm = document.getElementById('add-form');
  const nameInput = document.getElementById('name-input');
  const countInput = document.getElementById('count-input');
  let addCategory = 'toiletries';

  document.querySelectorAll('.add-item-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      addCategory = btn.dataset.category;
      document.getElementById('modal-title').textContent =
        `Add item to ${CATEGORY_LABELS[addCategory]}`;
      nameInput.value = '';
      countInput.value = '1';
      addModal.hidden = false;
      nameInput.focus();
    });
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

  init();
})();
