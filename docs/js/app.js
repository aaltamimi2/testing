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
    renderSidebar();
    refreshMarkers();
  }

  function showDetail(loc) {
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
    document.getElementById('detailPanel').classList.add('hidden');
  };

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

  try {
    const counts = await (window.__COUNTS_READY__ || window.__refreshLiveCounts__());
    applyCounts(counts || window.__LIVE_COUNTS__ || {});
  } catch (e) {
    console.warn('live counts failed', e);
    const footer = document.getElementById('countsFooter');
    if (footer) footer.textContent = 'Live counts unavailable — retrying…';
    renderSidebar();
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
