(function () {
  'use strict';

  const CATEGORIES = ['toiletries', 'food'];
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

  function uid() {
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
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
    count = Math.max(0, Math.floor(Number(count)) || 0);

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

  async function updateItemDetails(id, name, notes) {
    name = name.trim();
    notes = notes.trim();
    if (!name) return;
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const conflict = items.find(
      (it) => it.id !== id && it.category === item.category && it.name.toLowerCase() === name.toLowerCase()
    );
    if (conflict) {
      alert(`"${name}" already exists in this list.`);
      return;
    }
    item.name = name;
    item.notes = notes;
    render();
    if (useSupabase) {
      const { error } = await supabase.from('items').update({ name, notes }).eq('id', id);
      if (error) console.error(error);
    } else {
      localSave(items);
    }
  }

  async function deleteItem(id) {
    items = items.filter((it) => it.id !== id);
    render();
    if (useSupabase) {
      const { error } = await supabase.from('items').delete().eq('id', id);
      if (error) console.error(error);
    } else {
      localSave(items);
    }
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
        const li = document.createElement('li');
        li.className = 'item-row';
        li.dataset.id = item.id;

        const info = document.createElement('div');
        info.className = 'item-info';
        info.tabIndex = 0;
        info.addEventListener('click', () => openRenameModal(item));

        const nameSpan = document.createElement('span');
        nameSpan.className = 'item-name';
        nameSpan.textContent = item.name;
        info.appendChild(nameSpan);

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
        minusBtn.addEventListener('click', () => setCount(item.id, item.count - 1));

        const countSpan = document.createElement('span');
        countSpan.className = 'item-count';
        countSpan.textContent = item.count;

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'step-btn plus';
        plusBtn.textContent = '+';
        plusBtn.setAttribute('aria-label', `Add one ${item.name}`);
        plusBtn.addEventListener('click', () => setCount(item.id, item.count + 1));

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'item-delete';
        deleteBtn.textContent = '🗑️';
        deleteBtn.setAttribute('aria-label', `Delete ${item.name}`);
        deleteBtn.addEventListener('click', () => {
          if (confirm(`Delete "${item.name}" from the list?`)) deleteItem(item.id);
        });

        controls.append(minusBtn, countSpan, plusBtn, deleteBtn);
        li.append(info, controls);
        list.appendChild(li);
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
      document.body.classList.remove('theme-toiletries', 'theme-food');
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
        `Add item to ${addCategory === 'toiletries' ? 'Toiletries' : 'Food'}`;
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
  let renameId = null;

  function openRenameModal(item) {
    renameId = item.id;
    renameInput.value = item.name;
    renameNotesInput.value = item.notes || '';
    renameModal.hidden = false;
    renameInput.focus();
    renameInput.select();
  }

  renameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (renameId) await updateItemDetails(renameId, renameInput.value, renameNotesInput.value);
    renameModal.hidden = true;
  });

  renameModal.querySelectorAll('[data-rename-close]').forEach((el) =>
    el.addEventListener('click', () => { renameModal.hidden = true; })
  );

  init();
})();
