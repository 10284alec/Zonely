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

  if (placelists.length > 0) {
    await selectList(placelists[0].id);
    showMapElements(true);
  } else {
    // show my maps screen with empty state
    document.getElementById('screen-mymaps').classList.remove('hidden');
    renderMyMapsScreen();
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
  updatePlacelistHeader(list);
  setView('map');
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
  document.getElementById('modal-list-delete').classList.toggle('hidden', !listId);
  openModal('modal-list');
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
        ${pin.photo_url
          ? `<div class="pin-thumb" style="background-image:url('${pin.photo_url}')"></div>`
          : `<div class="pin-dot" style="background:${color}">${pin.rating}</div>`
        }
        <div class="pin-row-info">
          <div class="pin-row-name">${escHtml(pin.name)}</div>
          <div class="pin-row-addr">${escHtml(pin.address || '')}</div>
          ${pin.note ? `<div class="pin-row-note">"${escHtml(pin.note)}"</div>` : ''}
        </div>
        <div class="pin-dot-small" style="background:${color}">${pin.rating}</div>
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
  const photoFile = document.getElementById('pin-photo-input').files[0];

  if (!name) { showToast('Please enter a place name'); return; }
  if (!lat || !lng) { showToast('Please select a location on the map'); return; }

  let photo_url = eid ? (pins.find(p => p.id === eid)?.photo_url || null) : null;

  // Upload photo if selected
  if (photoFile) {
    showToast('Uploading photo...');
    const ext = photoFile.name.split('.').pop();
    const path = `pins/${user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('pin-photos').upload(path, photoFile, { upsert: true });
    if (!upErr) {
      const { data: urlData } = sb.storage.from('pin-photos').getPublicUrl(path);
      photo_url = urlData.publicUrl;
    }
  }

  const payload = {
    placelist_id: activeListId, user_id: user.id,
    name, address, note, rating: selectedRating,
    latitude: lat, longitude: lng, photo_url
  };

  if (eid) {
    const { error } = await sb.from('pins').update(payload).eq('id', eid).eq('user_id', user.id);
    if (error) { showToast('Error updating pin'); return; }
    showToast('Pin updated');
  } else {
    const { error } = await sb.from('pins').insert(payload);
    if (error) { showToast('Error saving pin'); return; }
    // Update pin_count on placelist
    const list = placelists.find(l => l.id === activeListId);
    if (list) {
      list.pin_count = (list.pin_count || 0) + 1;
      await sb.from('placelists').update({ pin_count: list.pin_count }).eq('id', activeListId);
    }
    showToast('Pin saved!');
  }

  closeModal('modal-pin');
  document.getElementById('pin-photo-input').value = '';
  document.getElementById('pin-photo-preview').classList.add('hidden');
  await loadPins(activeListId);
}

// ── PIN DETAIL ──
let viewingPinId = null;

function showPinDetail(pinId) {
  const pin = pins.find(p => p.id === pinId);
  if (!pin) return;
  viewingPinId = pinId;
  const color = RATING_COLORS[pin.rating] || '#888';
  const label = RATING_LABELS[pin.rating] || '';
  document.getElementById('detail-rating-bar').style.background = color;
  document.getElementById('detail-rating-label').textContent = `${pin.rating}/5 — ${label}`;
  document.getElementById('detail-rating-label').style.color = color;
  document.getElementById('detail-name').textContent = pin.name;
  document.getElementById('detail-addr').textContent = pin.address || '';
  document.getElementById('detail-note').textContent = pin.note ? `"${pin.note}"` : 'No note added.';
  const photo = document.getElementById('detail-photo');
  if (pin.photo_url) {
    photo.style.backgroundImage = `url('${pin.photo_url}')`;
    photo.classList.remove('hidden');
  } else {
    photo.classList.add('hidden');
  }
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

// ── MAIN SEARCH BAR (Google Places JS API) ──
let autocompleteService = null;
let placesService = null;

function initPlacesServices() {
  if (window.google && window.google.maps && window.google.maps.places) {
    autocompleteService = new google.maps.places.AutocompleteService();
    const dummy = document.createElement('div');
    placesService = new google.maps.places.PlacesService(dummy);
  }
}

function mainSearch(query) {
  clearTimeout(searchTimeout);
  const results = document.getElementById('search-bar-results');
  if (!query || query.length < 2) { results.classList.add('hidden'); return; }

  searchTimeout = setTimeout(function() {
    if (!activeListId) {
      results.innerHTML = '<div class="sb-result" style="padding:12px 14px"><div style="font-size:14px;color:#888">Open a placelist first, then search to add a pin</div></div>';
      results.classList.remove('hidden'); return;
    }
    if (!autocompleteService) initPlacesServices();
    if (!autocompleteService) { showToast('Search loading, try again'); return; }

    autocompleteService.getPlacePredictions({ input: query, language: 'en' }, function(predictions, status) {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions || !predictions.length) {
        results.classList.add('hidden'); return;
      }
      results.innerHTML = predictions.slice(0, 6).map(function(p) {
        var main = escHtml((p.structured_formatting && p.structured_formatting.main_text) || p.description);
        var sec = escHtml((p.structured_formatting && p.structured_formatting.secondary_text) || '');
        return '<div class="sb-result" onclick="mainSearchSelect(\'' + p.place_id + '\')">' +
          '<div class="sb-result-icon">📍</div>' +
          '<div style="min-width:0;flex:1">' +
          '<div class="sb-result-name">' + main + '</div>' +
          '<div class="sb-result-addr">' + sec + '</div>' +
          '</div></div>';
      }).join('');
      results.classList.remove('hidden');
    });
  }, 300);
}

function mainSearchSelect(placeId) {
  document.getElementById('search-bar-results').classList.add('hidden');
  document.getElementById('main-search-input').value = '';
  if (!placesService) initPlacesServices();
  if (!placesService) { showToast('Search not ready'); return; }

  placesService.getDetails({ placeId: placeId, fields: ['name','formatted_address','geometry'] }, function(place, status) {
    if (status === google.maps.places.PlacesServiceStatus.OK && place) {
      document.getElementById('pin-name-input').value = place.name || '';
      document.getElementById('pin-addr-input').value = place.formatted_address || '';
      document.getElementById('pin-lat').value = place.geometry.location.lat();
      document.getElementById('pin-lng').value = place.geometry.location.lng();
      map.setView([place.geometry.location.lat(), place.geometry.location.lng()], 16);
    }
    document.getElementById('pin-editing-id').value = '';
    document.getElementById('pin-note-input').value = '';
    document.getElementById('pin-search-input').value = '';
    setRating(5);
    openModal('modal-pin');
  });
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

// ── PLACELIST HEADER ──
function updatePlacelistHeader(list) {
  if (!list) {
    document.getElementById('placelist-header').classList.add('hidden');
    document.getElementById('search-bar-wrap').classList.remove('with-header');
    document.getElementById('view-controls').style.top = `calc(var(--safe-top) + 128px)`;
    return;
  }
  document.getElementById('plh-name').textContent = list.name;
  document.getElementById('plh-desc').textContent = list.description || '';
  document.getElementById('plh-author').textContent = document.getElementById('drawer-name').textContent;
  const badge = document.getElementById('plh-badge');
  badge.textContent = list.is_public ? 'Public' : 'Private';
  badge.className = list.is_public ? 'plh-public' : 'plh-private';
  document.getElementById('placelist-header').classList.remove('hidden');
  document.getElementById('search-bar-wrap').classList.add('with-header');
}

// ── VIEW TOGGLE ──
let currentView = 'map';

function setView(view) {
  currentView = view;
  document.getElementById('btn-map-view').classList.toggle('active', view === 'map');
  document.getElementById('btn-list-view').classList.toggle('active', view === 'list');
  document.getElementById('list-view-screen').classList.toggle('hidden', view !== 'list');
  document.getElementById('pin-sheet').style.display = view === 'list' ? 'none' : '';
  document.getElementById('search-bar-wrap').style.display = view === 'list' ? 'none' : '';
  if (view === 'list') renderListView();
}

function renderListView() {
  const container = document.getElementById('list-view-content');
  if (!pins.length) {
    container.innerHTML = '<div class="empty-state" style="padding-top:40px">No pins yet.<br>Switch to Map view and tap + to add your first place.</div>';
    return;
  }

  const sorted = [...pins].sort((a, b) => b.rating - a.rating);
  const groups = [5, 4, 3, 2, 1];
  let html = '';
  let rankCounter = 1;

  groups.forEach(r => {
    const group = sorted.filter(p => p.rating === r);
    if (!group.length) return;
    const color = RATING_COLORS[r];
    const label = RATING_LABELS[r];
    html += `
      <div class="lv-rating-group">
        <div class="lv-group-header">
          <div class="lv-group-dot" style="background:${color}"></div>
          <div class="lv-group-label">${label}</div>
          <div class="lv-group-count">${group.length} place${group.length !== 1 ? 's' : ''}</div>
          <div class="lv-group-line"></div>
        </div>
        ${group.map(pin => `
          <div class="lv-pin-row" onclick="lvTapPin('${pin.id}')">
            <div class="lv-pin-num" style="background:${color}">${rankCounter++}</div>
            <div class="lv-pin-info">
              <div class="lv-pin-name">${escHtml(pin.name)}</div>
              ${pin.note ? `<div class="lv-pin-note">"${escHtml(pin.note)}"</div>` : ''}
              ${pin.address ? `<div class="lv-pin-addr">${escHtml(pin.address)}</div>` : ''}
            </div>
            <span class="lv-pin-arrow">›</span>
          </div>
        `).join('')}
      </div>
    `;
  });
  container.innerHTML = html;
}

function lvTapPin(pinId) {
  setView('map');
  setTimeout(() => flyToPin(pinId), 100);
}

// ── BOTTOM NAV ──
let activeTab = 'mymaps';
// Elements that belong to the map view — hidden when on other tabs
const MAP_ELEMENTS = ['map','top-bar','search-bar-wrap','placelist-header','view-controls','list-view-screen','pin-sheet','crosshair'];

function showMapElements(show) {
  MAP_ELEMENTS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = show ? '' : 'none';
  });
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav-${tab}`)?.classList.add('active');
  document.querySelectorAll('.tab-screen').forEach(s => s.classList.add('hidden'));

  if (tab === 'mymaps') {
    if (activeListId) {
      showMapElements(true);
    } else {
      showMapElements(false);
      document.getElementById('screen-mymaps').classList.remove('hidden');
      renderMyMapsScreen();
    }
  } else {
    showMapElements(false);
    const screen = document.getElementById(`screen-${tab}`);
    if (screen) screen.classList.remove('hidden');
    if (tab === 'profile') updateProfileScreen();
    if (tab === 'search') renderSearchScreen();
  }
}

function renderMyMapsScreen() {
  const container = document.getElementById('mymaps-list');
  if (!placelists.length) {
    container.innerHTML = `
      <div class="mymaps-empty">
        <div class="mymaps-empty-icon">🗺️</div>
        <div>No placelists yet.</div>
        <div style="font-size:13px;margin-top:6px">Tap <strong>+ New</strong> above to create your first map.</div>
      </div>`;
    return;
  }
  container.innerHTML = placelists.map(l => `
    <div class="mymaps-card">
      <div class="mymaps-card-icon" onclick="openListFromMyMaps('${l.id}')">🗺️</div>
      <div class="mymaps-card-info" onclick="openListFromMyMaps('${l.id}')">
        <div class="mymaps-card-name">${escHtml(l.name)}</div>
        <div class="mymaps-card-meta">
          <span class="${l.is_public ? 'mymaps-card-public' : 'mymaps-card-private'}">${l.is_public ? 'Public' : 'Private'}</span>
          ${l.pin_count ? `<span class="mymaps-card-pins">· ${l.pin_count} pin${l.pin_count !== 1 ? 's' : ''}</span>` : ''}
          ${l.description ? `<span class="mymaps-card-desc">${escHtml(l.description)}</span>` : ''}
        </div>
      </div>
      <button class="mymaps-card-menu" onclick="openListMenu('${l.id}', event)">•••</button>
    </div>
  `).join('');
}

function openListMenu(id, e) {
  e.stopPropagation();
  const list = placelists.find(l => l.id === id);
  if (!list) return;
  editingListId = id;
  document.getElementById('modal-list-title').textContent = 'Edit placelist';
  document.getElementById('list-name-input').value = list.name;
  document.getElementById('list-desc-input').value = list.description || '';
  document.getElementById('list-public-toggle').checked = list.is_public || false;
  // Show delete button
  document.getElementById('modal-list-delete').classList.remove('hidden');
  openModal('modal-list');
}

async function deleteList() {
  if (!confirm('Delete this placelist and all its pins?')) return;
  const { error } = await sb.from('placelists').delete().eq('id', editingListId).eq('user_id', user.id);
  if (error) { showToast('Error deleting'); return; }
  closeModal('modal-list');
  showToast('Placelist deleted');
  activeListId = null;
  showMapElements(false);
  await loadLists();
  if (!placelists.length) {
    document.getElementById('screen-mymaps').classList.remove('hidden');
    renderMyMapsScreen();
  }
}

async function openListFromMyMaps(id) {
  await selectList(id);
  document.querySelectorAll('.tab-screen').forEach(s => s.classList.add('hidden'));
  showMapElements(true);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('nav-mymaps').classList.add('active');
  activeTab = 'mymaps';
}

function updateProfileScreen() {
  document.getElementById('profile-avatar').textContent = document.getElementById('drawer-avatar')?.textContent || 'A';
  document.getElementById('profile-name').textContent = document.getElementById('drawer-name')?.textContent || '';
  document.getElementById('profile-email').textContent = user?.email || '';
}

// ── PHOTO HELPERS ──
function previewPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('pin-photo-img').src = e.target.result;
    document.getElementById('pin-photo-preview').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearPhoto() {
  document.getElementById('pin-photo-input').value = '';
  document.getElementById('pin-photo-preview').classList.add('hidden');
  document.getElementById('pin-photo-img').src = '';
}
