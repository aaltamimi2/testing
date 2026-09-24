(async function () {
  const statusColor = { neutral: '#8a8a8a', green: '#22c55e', yellow: '#eab308', red: '#ef4444' };

  const res = await fetch('data/locations.json?t=' + Date.now(), { cache: 'no-store' });
  const data = await res.json();
  const locations = data.locations;

  const map = L.map('map', { zoomControl: true }).setView(
    [data.meta.center.lat, data.meta.center.lng],
    data.meta.zoom
  );

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  }).addTo(map);

  const markers = {};
  const batchMarkers = {};
  let cardBatches = [];
  let batchesState = 'loading';
  let countsState = 'loading';
  let latestCounts = {};
  let openBatch = null;

  function hoursSince(iso) {
    if (!iso) return Infinity;
    return (Date.now() - new Date(iso).getTime()) / 36e5;
  }

  function formatWhen(iso) {
    if (!iso) return 'Never scanned';
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  function agoLabel(iso) {
    if (!iso) return 'not yet active';
    return Math.floor(hoursSince(iso)) + 'h ago';
  }

  function deriveStatus(loc) {
    if (!loc.totalScans) return 'neutral';
    if (!loc.lastScanAt) return 'green';
    const h = hoursSince(loc.lastScanAt);
    if (h < 48) return 'green';
    if (h < 72) return 'yellow';
    return 'red';
  }

  function deriveAlert(loc) {
    if (loc.removed) return 'Flyer missing / pulled — do not rehang this spot';
    if (loc.status === 'yellow') return 'No scan in 48+ hours';
    if (loc.status === 'red') return 'No scan in 72+ hours — check if flyer fell or was removed';
    return null;
  }

  function makeIcon(status, id) {
    const color = statusColor[status] || '#999';
    return L.divIcon({
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      html: `<div style="width:32px;height:32px;border-radius:50%;background:${color};border:2px solid #0a0a0a;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#0a0a0a;font-weight:700;font-size:10px;font-family:IBM Plex Mono, ui-monospace, monospace;">${id.replace('L', '')}</div>`,
    });
  }

  function applyCounts(counts) {
    let withScans = 0;
    locations.forEach((loc) => {
      if (!Object.prototype.hasOwnProperty.call(counts, loc.id)) return;
      const next = Number(counts[loc.id]) || 0;
      if (next > (loc.totalScans || 0)) loc.lastScanAt = new Date().toISOString();
      loc.totalScans = next;
      if (next > 0) withScans += 1;
      if (loc.removed) {
        loc.status = 'red';
        loc.staleAlert = deriveAlert(loc);
      } else {
        loc.status = deriveStatus(loc);
        loc.staleAlert = deriveAlert(loc);
      }
    });
    const footer = document.getElementById('countsFooter');
    if (footer) {
      footer.textContent = withScans
        ? `Live counts · ${withScans} location${withScans === 1 ? '' : 's'} with scans`
        : 'Live counts · no scans yet';
    }
    latestCounts = counts || {};
    countsState = 'ready';
    renderSidebar();
    renderConversion();
    refreshMarkers();
  }

  const CARD_TOTAL = 500;
  const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function cardId(n) {
    return 'C' + String(n).padStart(3, '0');
  }

  function cardNumber(id) {
    const match = /^C(\d{3})$/.exec(String(id || ''));
    return match ? Number(match[1]) : null;
  }

  function cardsInRange(from, to) {
    const a = cardNumber(from);
    const b = cardNumber(to);
    if (a == null || b == null) return [];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const ids = [];
    for (let n = lo; n <= hi; n++) ids.push(cardId(n));
    return ids;
  }

  function weekdayOf(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
  }

  function wilsonInterval(successes, n, z) {
    const trials = Number(n);
    if (!(trials > 0)) return null;
    const wins = Math.min(Math.max(Number(successes) || 0, 0), trials);
    const zed = z || 1.96;
    const p = wins / trials;
    const z2 = zed * zed;
    const denom = 1 + z2 / trials;
    const center = (p + z2 / (2 * trials)) / denom;
    const margin = (zed * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
    return { p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
  }

  function formatPct(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    const pct = value * 100;
    if (pct === 0) return '0%';
    if (pct < 1) return pct.toFixed(2) + '%';
    return pct.toFixed(1) + '%';
  }

  function formatCi(interval) {
    if (!interval) return '—';
    return formatPct(interval.low) + '\u2013' + formatPct(interval.high);
  }

  function formatCount(value) {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
    return value.toFixed(1);
  }

  function formatCards(value) {
    if (!Number.isFinite(value)) return '—';
    return Math.ceil(value).toLocaleString('en-US');
  }

  function countScans(id) {
    return Number(latestCounts && latestCounts[id]) || 0;
  }

  function distinctScanned(batch) {
    let n = 0;
    cardsInRange(batch.cardFrom, batch.cardTo).forEach((id) => {
      if (countScans(id) > 0) n += 1;
    });
    return n;
  }

  function batchDates(batch) {
    return (Array.isArray(batch.dates) ? batch.dates : []).filter((iso) => weekdayOf(iso));
  }

  function allCardSummary() {
    let scanned = 0;
    const rows = [];
    for (let n = 1; n <= CARD_TOTAL; n++) {
      const id = cardId(n);
      const scans = countScans(id);
      if (scans > 0) {
        scanned += 1;
        rows.push({ id, scans });
      }
    }
    rows.sort((a, b) => b.scans - a.scans || (a.id < b.id ? -1 : 1));
    return { scanned, rows };
  }

  function poolBatches(list) {
    let handed = 0;
    let starts = 0;
    const seen = new Set();
    list.forEach((batch) => {
      handed += Number(batch.handedOut) || 0;
      starts += Number(batch.inProgressStarts) || 0;
      cardsInRange(batch.cardFrom, batch.cardTo).forEach((id) => {
        if (countScans(id) > 0) seen.add(id);
      });
    });
    return { handed, starts, scanned: seen.size };
  }

  function groupByPlace(list) {
    const groups = new Map();
    list.forEach((batch) => {
      const place = String(batch.place || 'Unknown place');
      if (!groups.has(place)) groups.set(place, { place, handed: 0, starts: 0 });
      const row = groups.get(place);
      row.handed += Number(batch.handedOut) || 0;
      row.starts += Number(batch.inProgressStarts) || 0;
    });
    return [...groups.values()].sort((a, b) => b.handed - a.handed || a.place.localeCompare(b.place));
  }

  function groupByWeekday(list) {
    const groups = new Map();
    list.forEach((batch) => {
      const dates = batchDates(batch);
      if (!dates.length) return;
      const shareHanded = (Number(batch.handedOut) || 0) / dates.length;
      const shareStarts = (Number(batch.inProgressStarts) || 0) / dates.length;
      dates.forEach((iso) => {
        const day = weekdayOf(iso);
        if (!groups.has(day)) groups.set(day, { day, handed: 0, starts: 0 });
        const row = groups.get(day);
        row.handed += shareHanded;
        row.starts += shareStarts;
      });
    });
    return WEEKDAY_ORDER.filter((day) => groups.has(day)).map((day) => groups.get(day));
  }

  function rateCells(handed, starts) {
    const interval = wilsonInterval(starts, handed);
    const rate = handed > 0 ? (Number(starts) || 0) / handed : null;
    return `<td class="num">${esc(formatCount(handed))}</td><td class="num">${esc(formatCount(starts))}</td><td class="num">${esc(formatPct(rate))}</td><td class="num">${esc(formatCi(interval))}</td>`;
  }

  function scanLineHtml() {
    if (countsState === 'loading') return '<p class="card-line">Loading card counts…</p>';
    if (countsState === 'error') return '<p class="card-line">Card counts unavailable</p>';
    const summary = allCardSummary();
    const top = summary.rows.slice(0, 5);
    const list = top.length
      ? `<ol class="rank-list card-list">${top.map((row) => `
      <li><span class="id">${esc(row.id)}</span><span class="metric">${esc(row.scans)}</span></li>`).join('')}</ol>`
      : '';
    return `<p class="card-line">${summary.scanned} of ${CARD_TOTAL} cards scanned</p>${list}`;
  }

  function renderGoal(pooled) {
    const el = document.getElementById('cardGoalResult');
    const input = document.getElementById('cardGoal');
    if (!el) return;
    if (batchesState !== 'ready' || !cardBatches.length || !pooled) {
      el.innerHTML = '<p class="muted">Add a batch to estimate how many cards to hand out.</p>';
      return;
    }
    const target = Number(input && input.value);
    if (!(target > 0)) {
      el.innerHTML = '<p class="muted">Enter a target number of in-progress signups.</p>';
      return;
    }
    const interval = wilsonInterval(pooled.starts, pooled.handed);
    if (!(pooled.starts > 0) || !interval || !(interval.low > 0)) {
      el.innerHTML = '<p class="card-line">Not enough data</p>';
      return;
    }
    const point = target / interval.p;
    const conservative = target / interval.low;
    const z = 1.96;
    const precisionN = (z * z * interval.p * (1 - interval.p)) / (0.01 * 0.01);
    el.innerHTML = `
      <p class="card-line">Point estimate: ${esc(formatCards(point))} cards</p>
      <p class="card-line">Conservative (CI lower bound): ${esc(formatCards(conservative))} cards</p>
      <p class="muted">About ${esc(formatCards(precisionN))} cards for a ±1 percentage point margin at this rate.</p>
    `;
  }

  function renderConversion() {
    const el = document.getElementById('cardSummary');
    if (!el) return;
    const scans = scanLineHtml();
    if (batchesState === 'loading') {
      el.innerHTML = `<p class="empty-state">Loading handout batches…</p>${scans}`;
      renderGoal(null);
      return;
    }
    if (batchesState === 'error') {
      el.innerHTML = `<p class="empty-state">Couldn’t load handout batches.</p>${scans}`;
      renderGoal(null);
      return;
    }
    if (!cardBatches.length) {
      el.innerHTML = `<p class="empty-state">No handout batches yet.</p>${scans}`;
      renderGoal(null);
      if (openBatch) showBatchDetail(openBatch);
      return;
    }
    const pooled = poolBatches(cardBatches);
    const interval = wilsonInterval(pooled.starts, pooled.handed);
    const rate = pooled.handed > 0 ? pooled.starts / pooled.handed : null;
    const scanRate = pooled.handed > 0 ? pooled.scanned / pooled.handed : null;
    const places = groupByPlace(cardBatches);
    const days = groupByWeekday(cardBatches);
    const placeTable = places.length ? `<table class="conv-table"><thead><tr><th>Place</th><th class="num">n</th><th class="num">Starts</th><th class="num">Rate</th><th class="num">95% CI</th></tr></thead><tbody>${places.map((row) => `<tr><td>${esc(row.place)}</td>${rateCells(row.handed, row.starts)}</tr>`).join('')}</tbody></table>` : '';
    const dayTable = days.length ? `<table class="conv-table"><thead><tr><th>Weekday</th><th class="num">n</th><th class="num">Starts</th><th class="num">Rate</th><th class="num">95% CI</th></tr></thead><tbody>${days.map((row) => `<tr><td>${esc(row.day)}</td>${rateCells(row.handed, row.starts)}</tr>`).join('')}</tbody></table>` : '';
    el.innerHTML = `
      <div class="stats card-summary">
        <div class="stat"><div class="n">${esc(formatPct(rate))}</div><div class="l">Conversion</div></div>
        <div class="stat"><div class="n">${esc(formatCount(pooled.handed))}</div><div class="l">Handed out</div></div>
        <div class="stat"><div class="n">${countsState === 'ready' ? esc(String(pooled.scanned)) : '—'}</div><div class="l">Cards scanned</div></div>
        <div class="stat"><div class="n">${countsState === 'ready' ? esc(formatPct(scanRate)) : '—'}</div><div class="l">Scan rate</div></div>
      </div>
      <p class="card-line">95% CI ${esc(formatCi(interval))} · n=${esc(formatCount(pooled.handed))}</p>
      <h2>By location</h2>
      ${placeTable}
      <h2>By weekday</h2>
      ${dayTable || '<p class="empty-state">No dates on these batches yet.</p>'}
      ${scans}
    `;
    renderGoal(pooled);
    if (openBatch) showBatchDetail(openBatch);
  }

  function makeBatchIcon() {
    return L.divIcon({
      className: 'batch-marker',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      html: '<div style="width:16px;height:16px;margin:3px;background:#4ade80;transform:rotate(45deg);border:2px solid #0a0a0a;box-shadow:0 2px 8px rgba(0,0,0,0.35)"></div>',
    });
  }

  function showBatchDetail(batch) {
    openBatch = batch;
    const panel = document.getElementById('detailPanel');
    const body = document.getElementById('detailBody');
    const handed = Number(batch.handedOut) || 0;
    const starts = Number(batch.inProgressStarts) || 0;
    const scanned = countsState === 'ready' ? distinctScanned(batch) : null;
    const interval = wilsonInterval(starts, handed);
    const rate = handed > 0 ? starts / handed : null;
    const scanRate = scanned != null && handed > 0 ? scanned / handed : null;
    const perScan = scanned > 0 ? starts / scanned : null;
    const dates = batchDates(batch);
    const when = dates.length
      ? dates.map((iso) => esc(iso) + ' (' + esc(weekdayOf(iso)) + ')').join('<br>')
      : '—';
    const notes = String(batch.notes || '').trim();
    body.innerHTML = `
      <span class="badge green">Handout batch</span>
      <h3>${esc(batch.id || 'Batch')}<br><span style="font-weight:500;font-size:0.95rem;color:var(--text-secondary)">${esc(batch.place || 'Handout')}</span></h3>
      <div class="meta">${esc(batch.cardFrom || '?')}\u2013${esc(batch.cardTo || '?')}</div>
      <div class="kv">
        <div class="muted">When</div><div>${when}</div>
        <div class="muted">Handed out</div><div>${esc(formatCount(handed))}</div>
        <div class="muted">Cards scanned</div><div>${scanned == null ? '—' : esc(String(scanned))}</div>
        <div class="muted">Scan rate</div><div>${scanRate == null ? '—' : esc(formatPct(scanRate))}</div>
        <div class="muted">In progress</div><div>${esc(formatCount(starts))}</div>
        <div class="muted">Conversion</div><div>${esc(formatPct(rate))}</div>
        <div class="muted">95% CI</div><div>${esc(formatCi(interval))}</div>
        <div class="muted">Starts / scan</div><div>${perScan == null ? '—' : esc(perScan.toFixed(2))}</div>
      </div>
      ${notes ? `<div class="muted">${esc(notes)}</div>` : ''}
    `;
    panel.classList.remove('hidden');
  }

  function placeBatchMarkers() {
    Object.keys(batchMarkers).forEach((id) => {
      map.removeLayer(batchMarkers[id]);
      delete batchMarkers[id];
    });
    const placed = [];
    cardBatches.forEach((batch, index) => {
      const lat = Number(batch.lat);
      const lng = Number(batch.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const id = batch.id || ('B' + (index + 1));
      const marker = L.marker([lat, lng], { icon: makeBatchIcon(), zIndexOffset: 500 })
        .addTo(map)
        .bindTooltip(`${batch.place || id} · handout`, { direction: 'top' });
      marker.on('click', () => showBatchDetail(batch));
      batchMarkers[id] = marker;
      placed.push([lat, lng]);
    });
    if (placed.length && locations.length) {
      const bounds = L.latLngBounds(locations.map((loc) => [loc.lat, loc.lng]).concat(placed));
      map.fitBounds(bounds.pad(0.35));
    }
  }

  function showDetail(loc) {
    openBatch = null;
    const panel = document.getElementById('detailPanel');
    const body = document.getElementById('detailBody');
    const maxTrend = Math.max(1, ...(loc.scanTrend7d || [0]));
    const bars = (loc.scanTrend7d || [0, 0, 0, 0, 0, 0, 0]).map((n) => {
      const h = Math.round((n / maxTrend) * 100);
      return `<div class="bar"><div class="fill" style="height:${h}%"></div></div>`;
    }).join('');
    const statusLabel = loc.removed ? 'Missing / pulled' : ({ neutral: 'Not yet active', green: 'Scanning', yellow: 'Quiet', red: 'Stale' }[loc.status] || loc.status);
    body.innerHTML = `
      <span class="badge ${loc.status}">${statusLabel}</span>
      <h3>${loc.id}<br><span style="font-weight:500;font-size:0.95rem;color:var(--text-secondary)">${loc.name}</span></h3>
      <div class="meta">${loc.type === 'coffee' ? 'Coffee shop' : 'Campus building'} · UW–Madison</div>
      ${loc.staleAlert ? `<div class="alert">${loc.staleAlert}</div>` : ''}
      <div class="kv">
        <div class="muted">Track link</div><div><a href="${loc.shortUrl}" target="_blank" rel="noopener">${loc.shortUrl}</a></div>
        <div class="muted">Total scans</div><div><strong>${loc.totalScans}</strong> <span class="muted">(live)</span></div>
        <div class="muted">Last scan</div><div>${formatWhen(loc.lastScanAt)} <span class="muted">(${agoLabel(loc.lastScanAt)})</span></div>
        <div class="muted">Coords</div><div>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</div>
      </div>
      <div class="muted">7-day scan trend</div>
      <div class="trend">${bars}</div>
      <div class="trend-label">Oldest day → today</div>
    `;
    panel.classList.remove('hidden');
  }

  function renderSidebar() {
    const counts = { neutral: 0, green: 0, yellow: 0, red: 0 };
    locations.forEach((l) => { counts[l.status] = (counts[l.status] || 0) + 1; });
    document.getElementById('summaryStats').innerHTML = `
      <div class="stat"><div class="n" style="color:var(--muted)">${counts.neutral}</div><div class="l">Not yet</div></div>
      <div class="stat"><div class="n" style="color:var(--green)">${counts.green}</div><div class="l">Active</div></div>
      <div class="stat"><div class="n" style="color:var(--yellow)">${counts.yellow}</div><div class="l">Quiet</div></div>
      <div class="stat"><div class="n" style="color:var(--red)">${counts.red}</div><div class="l">Stale</div></div>
    `;
    const top = [...locations].sort((a, b) => b.totalScans - a.totalScans).slice(0, 8);
    const allZero = top.every((l) => l.totalScans === 0);
    document.getElementById('topList').innerHTML = allZero
      ? '<li class="empty-state" style="grid-column:1/-1">No scans yet — open a track link or scan a QR</li>'
      : top.map((l, i) => `
      <li data-id="${l.id}">
        <span class="rank-num">${String(i + 1).padStart(2, '0')}</span>
        <span><span class="id">${l.id}</span><span class="name">${l.name.split('—')[0].trim()}</span></span>
        <span class="metric">${l.totalScans}</span>
      </li>`).join('');
    const flagged = locations.filter((l) => l.status === 'red' || l.status === 'yellow')
      .sort((a, b) => hoursSince(b.lastScanAt) - hoursSince(a.lastScanAt));
    document.getElementById('flagList').innerHTML = flagged.length
      ? flagged.map((l) => `
      <li data-id="${l.id}">
        <span class="dot ${l.status}" style="justify-self:center"></span>
        <span><span class="id">${l.id}</span><span class="name">${l.status}</span></span>
        <span class="metric">${Math.floor(hoursSince(l.lastScanAt))}h</span>
      </li>`).join('')
      : '<li class="empty-state" style="grid-column:1/-1">Nothing flagged — all clear</li>';
    document.querySelectorAll('#topList li[data-id], #flagList li[data-id]').forEach((el) => {
      el.onclick = () => focusId(el.dataset.id);
    });
  }

  function refreshMarkers() {
    locations.forEach((loc) => {
      const m = markers[loc.id];
      if (!m) return;
      m.setIcon(makeIcon(loc.status, loc.id));
      m.setTooltipContent(`${loc.id} · ${loc.totalScans} scans`);
    });
  }

  function placeMarkers() {
    locations.forEach((loc) => {
      if (markers[loc.id]) map.removeLayer(markers[loc.id]);
      const m = L.marker([loc.lat, loc.lng], { icon: makeIcon(loc.status, loc.id) })
        .addTo(map)
        .bindTooltip(`${loc.id} · ${loc.totalScans} scans`, { direction: 'top' });
      m.on('click', () => showDetail(loc));
      markers[loc.id] = m;
    });
  }

  function focusId(id) {
    const loc = locations.find((l) => l.id === id);
    if (!loc) return;
    map.setView([loc.lat, loc.lng], 17);
    markers[id].openTooltip();
    showDetail(loc);
  }

  document.getElementById('closeDetail').onclick = () => {
    openBatch = null;
    document.getElementById('detailPanel').classList.add('hidden');
  };

  const goalInput = document.getElementById('cardGoal');
  if (goalInput) goalInput.addEventListener('input', () => renderConversion());

  const batchesPromise = fetch('data/card-batches.json?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    })
    .then((data) => {
      cardBatches = (data && Array.isArray(data.batches)) ? data.batches.filter((batch) => batch && typeof batch === 'object') : [];
      batchesState = 'ready';
    })
    .catch((e) => {
      console.warn('handout batches failed', e);
      cardBatches = [];
      batchesState = 'error';
    });

  // Draw hung pins immediately — do not block on Mantle (slow/CORS left the map blank)
  placeMarkers();
  if (locations.length) {
    const bounds = L.latLngBounds(locations.map((l) => [l.lat, l.lng]));
    map.fitBounds(bounds.pad(0.35));
  }
  // Keep removed Locs red even before counts land
  locations.forEach((loc) => {
    if (loc.removed) {
      loc.status = 'red';
      loc.staleAlert = deriveAlert(loc);
    }
  });
  renderSidebar();
  document.getElementById('topList').innerHTML =
    '<li class="empty-state" style="grid-column:1/-1">Loading live scan counts…</li>';
  renderConversion();
  batchesPromise.then(() => {
    placeBatchMarkers();
    renderConversion();
  });

  try {
    const counts = await (window.__COUNTS_READY__ || window.__refreshLiveCounts__());
    applyCounts(counts || window.__LIVE_COUNTS__ || {});
  } catch (e) {
    console.warn('live counts failed', e);
    const footer = document.getElementById('countsFooter');
    if (footer) footer.textContent = 'Live counts unavailable — retrying…';
    countsState = 'error';
    renderSidebar();
    renderConversion();
  }

  window.addEventListener('livecounts', (ev) => applyCounts(ev.detail || {}));
  window.addEventListener('pageshow', (ev) => {
    // Refetch when browser restores a soft-cached page
    if (window.__refreshLiveCounts__) window.__refreshLiveCounts__();
  });
  setInterval(function () {
    if (window.__refreshLiveCounts__) window.__refreshLiveCounts__();
  }, 10000);
})();
