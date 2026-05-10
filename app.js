// ── CONFIG ──
const SUPABASE_URL = 'https://pdvnkdwbeuizgphmxenn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkdm5rZHdiZXVpemdwaG14ZW5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNzU3MDgsImV4cCI6MjA5Mzk1MTcwOH0.DmXGuLDKTQJyPHlQI3h-9uC-yT9sRMbsTW3UL0zBHsg';
const MAPS_KEY = 'AIzaSyDL_ldswg0cv4kw7DdDjwmdDmuTBOKN1W8';

const RATING_COLORS = { 5:'#2D6A4F', 4:'#52B788', 3:'#F9C74F', 2:'#F4A261', 1:'#E63946' };
const RATING_LABELS = { 5:'Excellent', 4:'Good', 3:'Decent', 2:'Forgettable', 1:'Bad' };

// ── STATE ──
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let map, user, placelists = [], pins = [], markers = {};
let activeListId = null, selectedRating = 5, editingPinId = null, editingListId = null;
let addPinMode = false, searchTimeout = null;
let sheetExpanded = false;

// ── INIT ──
window.addEventListener('DOMContentLoaded', async () => {
  setTimeout(() => {
    const splash = document.getElementById('splash');
    splash.style.opacity = '0';
    setTimeout(() => splash.classList.add('hidden'), 400);
  }, 1200);

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    user = session.user;
    initApp();
  } else {
    document.getElementById('auth-screen').classList.remove('hidden');
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      user = session.user;
      document.getElementById('auth-screen').classList.add('hidden');
      initApp();
    }
    if (event === 'SIGNED_OUT') {
      location.reload();
    }
  });
});

async function initApp() {
  document.getElementById('app').classList.remove('hidden');
  initMap();
  await loadUserProfile();
  await loadLists();
}

// ── MAP ──
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: false })
    .setView([-33.868, 151.209], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  map.on('click', onMapClick);
}

function onMapClick(e) {
  if (!addPinMode) return;
  cancelAddPin();
  document.getElementById('pin-lat').value = e.latlng.lat;
  document.getElementById('pin-lng').value = e.latlng.lng;
  reverseGeocode(e.latlng.lat, e.latlng.lng);
  openAddPin();
}

// ── AUTH ──
function showAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('auth-signin').classList.toggle('hidden', tab !== 'signin');
  document.getElementById('auth-signup').classList.toggle('hidden', tab !== 'signup');
  hideAuthError();
}

async function signIn() {
  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  if (!email || !password) return showAuthError('Please enter email and password');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) showAuthError(error.message);
}

async function signUp() {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!name || !email || !password) return showAuthError('Please fill in all fields');
  if (password.length < 6) return showAuthError('Password must be at least 6 characters');

  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
  if (error) return showAuthError(error.message);

  if (data.user) {
    await sb.from('profiles').upsert({ id: data.user.id, full_name: name, email });
  }
  showAuthError('Check your email to confirm your account, then sign in!');
}

async function signOut() {
  await sb.auth.signOut();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideAuthError() {
  document.getElementById('auth-error').classList.add('hidden');
}

// ── USER PROFILE ──
async function loadUserProfile() {
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).single();
  const name = data?.full_name || user.email?.split('@')[0] || 'You';
  document.getElementById('drawer-name').textContent = name;
  document.getElementById('drawer-email').textContent = user.email;
  document.getElementById('drawer-avatar').textContent = name.charAt(0).toUpperCase();
}

// ── LISTS ──
async function loadLists() {
  const { data, error } = await sb.from('placelists').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) { showToast('Error loading lists'); return; }
  placelists = data || [];
  renderDrawerLists();

  if (placelists.length > 0) {
    selectList(placelists[0].id);
  } else {
    document.getElementById('top-list-name').textContent = 'Create a placelist';
  }
}

function renderDrawerLists() {
  const container = document.getElementById('drawer-lists');
  if (placelists.length === 0) {
    container.innerHTML = '<div class="empty-state">No placelists yet.<br>Create your first one below.</div>';
    return;
  }
  container.innerHTML = placelists.map(l => `
    <div class="drawer-list-item ${l.id === activeListId ? 'active' : ''}" onclick="selectList('${l.id}'); closeDrawer()">
      <div class="drawer-list-dot" style="background:${l.is_public ? '#52B788' : '#666'}"></div>
      <span class="drawer-list-name">${escHtml(l.name)}</span>
      ${l.is_public ? '<span class="drawer-list-public">Public</span>' : ''}
    </div>
  `).join('');
}

async function selectList(id) {
  activeListId = id;
  const list = placelists.find(l => l.id === id);
  if (!list) return;
  document.getElementById('top-list-name').textContent = list.name;
  renderDrawerLists();
  await loadPins(id);
}

function openPlacelistPicker() {
  openDrawer();
}

function openCreateList(listId = null) {
  editingListId = listId;
  const list = listId ? placelists.find(l => l.id === listId) : null;
  document.getElementById('modal-list-title').textContent = listId ? 'Edit placelist' : 'New placelist';
  document.getElementById('list-name-input').value = list?.name || '';
  document.getElementById('list-desc-input').value = list?.description || '';
  document.getElementById('list-public-toggle').checked = list?.is_public || false;
  openModal('modal-list');
  closeDrawer();
}

async function saveList() {
  const name = document.getElementById('list-name-input').value.trim();
  if (!name) { showToast('Please enter a name'); return; }
  const desc = document.getElementById('list-desc-input').value.trim();
  const isPublic = document.getElementById('list-public-toggle').checked;

  if (editingListId) {
    const { error } = await sb.from('placelists').update({ name, description: desc, is_public: isPublic, updated_at: new Date().toISOString() }).eq('id', editingListId).eq('user_id', user.id);
    if (error) { showToast('Error saving'); return; }
    showToast('Placelist updated');
  } else {
    const { data, error } = await sb.from('placelists').insert({ user_id: user.id, name, description: desc, is_public: isPublic }).select().single();
    if (error) { showToast('Error creating list'); return; }
    placelists.unshift(data);
    selectList(data.id);
  }

  closeModal('modal-list');
  await loadLists();
}

// ── PINS ──
async function loadPins(listId) {
  clearMarkers();
  const { data, error } = await sb.from('pins').select('*').eq('placelist_id', listId).order('created_at', { ascending: false });
  if (error) { showToast('Error loading pins'); return; }
  pins = data || [];
  renderPinList();
  renderMarkers();
}

function clearMarkers() {
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
}

function renderMarkers() {
  pins.forEach(pin => {
    const color = RATING_COLORS[pin.rating] || '#888';
    const icon = L.divIcon({
      className: '',
      html: `<div class="z-marker" style="background:${color}"></div>`,
      iconSize: [28, 34],
      iconAnchor: [14, 34]
    });
    const marker = L.marker([pin.latitude, pin.longitude], { icon }).addTo(map);
    marker.on('click', () => showPinDetail(pin.id));
    markers[pin.id] = marker;
  });

  if (pins.length > 0) {
    const group = L.featureGroup(Object.values(markers));
    map.fitBounds(group.getBounds().pad(0.2));
  }
}

function renderPinList() {
  const container = document.getElementById('pin-list');
  document.getElementById('sheet-count').textContent = `${pins.length} pin${pins.length !== 1 ? 's' : ''}`;
  document.getElementById('sheet-title').textContent = placelists.find(l => l.id === activeListId)?.name || 'Pins';

  if (pins.length === 0) {
    container.innerHTML = '<div class="empty-state">No pins yet.<br>Tap + to add your first place.</div>';
    return;
  }

  container.innerHTML = pins.map(pin => {
    const color = RATING_COLORS[pin.rating] || '#888';
    return `
      <div class="pin-row" onclick="flyToPin('${pin.id}')">
        <div class="pin-dot" style="background:${color}">${pin.rating}</div>
        <div class="pin-row-info">
          <div class="pin-row-name">${escHtml(pin.name)}</div>
          <div class="pin-row-addr">${escHtml(pin.address || '')}</div>
          ${pin.note ? `<div class="pin-row-note">"${escHtml(pin.note)}"</div>` : ''}
        </div>
        <span class="pin-row-arrow">›</span>
      </div>
    `;
  }).join('');
}

function flyToPin(pinId) {
  const pin = pins.find(p => p.id === pinId);
  if (!pin) return;
  map.flyTo([pin.latitude, pin.longitude], 16, { duration: 0.8 });
  setTimeout(() => showPinDetail(pinId), 500);
  collapseSheet();
}

// ── ADD PIN ──
function startAddPin() {
  if (!activeListId) { showToast('Select a placelist first'); openDrawer(); return; }
  addPinMode = true;
  document.getElementById('crosshair').classList.remove('hidden');
  document.getElementById('add-pin-btn').style.color = '#E63946';
  collapseSheet();
}

function cancelAddPin() {
  addPinMode = false;
  document.getElementById('crosshair').classList.add('hidden');
  document.getElementById('add-pin-btn').style.color = '';
}

function openAddPin(lat = null, lng = null) {
  editingPinId = null;
  document.getElementById('modal-pin-title').textContent = 'Add a pin';
  document.getElementById('pin-search-input').value = '';
  document.getElementById('pin-name-input').value = '';
  document.getElementById('pin-addr-input').value = '';
  document.getElementById('pin-note-input').value = '';
  document.getElementById('pin-editing-id').value = '';
  if (lat) document.getElementById('pin-lat').value = lat;
  if (lng) document.getElementById('pin-lng').value = lng;
  setRating(5);
  openModal('modal-pin');
}

function setRating(r) {
  selectedRating = r;
  document.querySelectorAll('.rating-btn').forEach(btn => {
    const br = parseInt(btn.dataset.r);
    btn.classList.toggle('selected', br === r);
    btn.style.background = br === r ? RATING_COLORS[r] : '';
    btn.style.color = br === r ? '#fff' : '';
  });
}

async function savePin() {
  const name = document.getElementById('pin-name-input').value.trim();
  const address = document.getElementById('pin-addr-input').value.trim();
  const note = document.getElementById('pin-note-input').value.trim();
  const lat = parseFloat(document.getElementById('pin-lat').value);
  const lng = parseFloat(document.getElementById('pin-lng').value);
  const eid = document.getElementById('pin-editing-id').value;

  if (!name) { showToast('Please enter a place name'); return; }
  if (!lat || !lng) { showToast('Please select a location on the map'); return; }

  const payload = {
    placelist_id: activeListId,
    user_id: user.id,
    name, address, note,
    rating: selectedRating,
    latitude: lat,
    longitude: lng
  };

  if (eid) {
    const { error } = await sb.from('pins').update(payload).eq('id', eid).eq('user_id', user.id);
    if (error) { showToast('Error updating pin'); return; }
    showToast('Pin updated');
  } else {
    const { error } = await sb.from('pins').insert(payload);
    if (error) { showToast('Error saving pin'); return; }
    showToast('Pin saved!');
  }

  closeModal('modal-pin');
  await loadPins(activeListId);
}

// ── PIN DETAIL ──
let viewingPinId = null;

function showPinDetail(pinId) {
  const pin = pins.find(p => p.id === pinId);
  if (!pin) return;
  viewingPinId = pinId;
  const color = RATING_COLORS[pin.rating] || '#888';
  document.getElementById('detail-rating-bar').style.background = color;
  document.getElementById('detail-name').textContent = pin.name;
  document.getElementById('detail-addr').textContent = pin.address || '';
  document.getElementById('detail-note').textContent = pin.note ? `"${pin.note}"` : 'No note added.';
  openModal('modal-detail');
}

function editCurrentPin() {
  const pin = pins.find(p => p.id === viewingPinId);
  if (!pin) return;
  closeModal('modal-detail');
  editingPinId = pin.id;
  document.getElementById('modal-pin-title').textContent = 'Edit pin';
  document.getElementById('pin-name-input').value = pin.name;
  document.getElementById('pin-addr-input').value = pin.address || '';
  document.getElementById('pin-note-input').value = pin.note || '';
  document.getElementById('pin-lat').value = pin.latitude;
  document.getElementById('pin-lng').value = pin.longitude;
  document.getElementById('pin-editing-id').value = pin.id;
  document.getElementById('pin-search-input').value = '';
  setRating(pin.rating);
  openModal('modal-pin');
}

async function deleteCurrentPin() {
  if (!confirm('Delete this pin?')) return;
  const { error } = await sb.from('pins').delete().eq('id', viewingPinId).eq('user_id', user.id);
  if (error) { showToast('Error deleting'); return; }
  closeModal('modal-detail');
  showToast('Pin deleted');
  await loadPins(activeListId);
}

// ── MAIN SEARCH BAR ──
function mainSearch(query) {
  clearTimeout(searchTimeout);
  const results = document.getElementById('search-bar-results');
  if (!query || query.length < 2) { results.classList.add('hidden'); return; }

  searchTimeout = setTimeout(async () => {
    if (!activeListId) {
      results.innerHTML = `<div class="sb-result"><div class="sb-result-name" style="color:#666">Select a placelist first</div></div>`;
      results.classList.remove('hidden'); return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${MAPS_KEY}&language=en`;
      const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!data.predictions?.length) { results.classList.add('hidden'); return; }
      results.innerHTML = data.predictions.slice(0, 6).map(p => `
        <div class="sb-result" onclick="mainSearchSelect('${p.place_id}', '${escHtml(p.description).replace(/'/g,"\\'")}')">
          <div class="sb-result-icon">📍</div>
          <div>
            <div class="sb-result-name">${escHtml(p.structured_formatting?.main_text || p.description)}</div>
            <div class="sb-result-addr">${escHtml(p.structured_formatting?.secondary_text || '')}</div>
          </div>
        </div>
      `).join('');
      results.classList.remove('hidden');
    } catch { results.classList.add('hidden'); }
  }, 350);
}

async function mainSearchSelect(placeId, description) {
  document.getElementById('search-bar-results').classList.add('hidden');
  document.getElementById('main-search-input').value = '';
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry&key=${MAPS_KEY}`;
    const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
    const data = await res.json();
    const r = data.result;
    if (r) {
      document.getElementById('pin-name-input').value = r.name || '';
      document.getElementById('pin-addr-input').value = r.formatted_address || '';
      document.getElementById('pin-lat').value = r.geometry.location.lat;
      document.getElementById('pin-lng').value = r.geometry.location.lng;
      map.setView([r.geometry.location.lat, r.geometry.location.lng], 16);
    }
  } catch {
    const parts = description.split(',');
    document.getElementById('pin-name-input').value = parts[0]?.trim() || description;
    document.getElementById('pin-addr-input').value = description;
  }
  document.getElementById('pin-editing-id').value = '';
  document.getElementById('pin-note-input').value = '';
  document.getElementById('pin-search-input').value = '';
  setRating(5);
  openModal('modal-pin');
}

// ── SEARCH (in-modal) ──
function searchPlaces(query) {
  clearTimeout(searchTimeout);
  const results = document.getElementById('search-results');
  if (!query || query.length < 3) { results.classList.add('hidden'); return; }

  searchTimeout = setTimeout(async () => {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${MAPS_KEY}&language=en`;
      const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
      const data = await res.json();

      if (!data.predictions || data.predictions.length === 0) {
        results.classList.add('hidden'); return;
      }

      results.innerHTML = data.predictions.slice(0, 5).map(p => `
        <div class="search-result" onclick="selectPlace('${p.place_id}', '${escHtml(p.description).replace(/'/g,"\\'")}')">
          <div class="search-result-name">${escHtml(p.structured_formatting?.main_text || p.description)}</div>
          <div class="search-result-addr">${escHtml(p.structured_formatting?.secondary_text || '')}</div>
        </div>
      `).join('');
      results.classList.remove('hidden');
    } catch {
      results.classList.add('hidden');
    }
  }, 400);
}

async function selectPlace(placeId, description) {
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('pin-search-input').value = '';

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry&key=${MAPS_KEY}`;
    const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
    const data = await res.json();
    const r = data.result;
    if (r) {
      document.getElementById('pin-name-input').value = r.name || '';
      document.getElementById('pin-addr-input').value = r.formatted_address || '';
      document.getElementById('pin-lat').value = r.geometry.location.lat;
      document.getElementById('pin-lng').value = r.geometry.location.lng;
      map.setView([r.geometry.location.lat, r.geometry.location.lng], 16);
    }
  } catch {
    const parts = description.split(',');
    document.getElementById('pin-name-input').value = parts[0]?.trim() || description;
    document.getElementById('pin-addr-input').value = description;
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${MAPS_KEY}`;
    const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data.results && data.results[0]) {
      document.getElementById('pin-addr-input').value = data.results[0].formatted_address;
      const parts = data.results[0].formatted_address.split(',');
      if (!document.getElementById('pin-name-input').value) {
        document.getElementById('pin-name-input').value = parts[0]?.trim() || '';
      }
    }
  } catch {}
}

// ── DRAWER ──
function openDrawer() {
  document.getElementById('drawer').classList.remove('drawer-closed');
  document.getElementById('drawer').classList.add('drawer-open');
  document.getElementById('drawer-overlay').classList.remove('hidden');
}
function closeDrawer() {
  document.getElementById('drawer').classList.add('drawer-closed');
  document.getElementById('drawer').classList.remove('drawer-open');
  document.getElementById('drawer-overlay').classList.add('hidden');
}

// ── SHEET ──
function toggleSheet() {
  sheetExpanded = !sheetExpanded;
  document.getElementById('pin-sheet').classList.toggle('expanded', sheetExpanded);
}
function collapseSheet() {
  sheetExpanded = false;
  document.getElementById('pin-sheet').classList.remove('expanded');
}

// ── MODALS ──
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  if (id === 'modal-pin') {
    document.getElementById('search-results').classList.add('hidden');
  }
}

// ── TOAST ──
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}

// ── UTILS ──
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
