(() => {
  const $ = (sel) => document.querySelector(sel);
  let pin = sessionStorage.getItem('mm-pin') || '';
  let data = { slots: [], bookings: [] };

  const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': pin } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || 'Request failed'), { status: res.status });
    return body;
  }

  function render() {
    const active = data.bookings.filter((b) => b.status !== 'cancelled');
    const paid = data.bookings.filter((b) => b.status === 'paid');
    const sum = (list, key) => list.reduce((t, b) => t + b[key], 0);
    $('#stats').innerHTML = `
      <div><strong>${active.length}</strong>Active bookings</div>
      <div><strong>${sum(active, 'visitors')}</strong>Expected visitors</div>
      <div><strong>${sum(paid, 'visitors')}</strong>Checked in (paid)</div>
      <div><strong>${rupees(sum(paid, 'amount'))}</strong>Collected</div>
      <div><strong>${rupees(sum(active, 'amount') - sum(paid, 'amount'))}</strong>Still to collect</div>`;

    $('#slot-overview').innerHTML = data.slots.map((s) => {
      const pct = Math.round((s.booked / s.capacity) * 100);
      const cls = s.remaining === 0 ? 'disabled' : s.remaining <= 5 ? 'low' : '';
      return `<div class="slot ${cls}"><label><span class="time">${s.start}h – ${s.end}h</span>
        <span class="avail">${s.booked}/${s.capacity} booked${s.remaining === 0 ? ' · FULL' : ''}</span>
        <span class="bar"><i style="width:${pct}%"></i></span></label></div>`;
    }).join('');

    const q = $('#search').value.trim().toLowerCase();
    const rows = data.bookings.filter((b) => !q || [b.id, b.name, b.mobile].some((v) => v.toLowerCase().includes(q)));
    $('#rows').innerHTML = rows.length ? rows.map((b) => {
      const actions = b.status === 'confirmed'
        ? `<button class="btn small" data-id="${b.id}" data-status="paid">Mark paid</button>
           <button class="btn small secondary" data-id="${b.id}" data-status="cancelled">Cancel</button>`
        : `<button class="btn small secondary" data-id="${b.id}" data-status="confirmed">Undo</button>`;
      const extra = [b.assistance ? '♿ assistance' : '', b.notes].filter(Boolean).map(escapeHtml).join(' · ');
      return `<tr class="${b.status}">
        <td>${escapeHtml(b.slotLabel)}</td>
        <td><strong>${escapeHtml(b.id)}</strong></td>
        <td>${escapeHtml(b.name)}${b.city ? `<br><span class="hint">${escapeHtml(b.city)}</span>` : ''}${extra ? `<br><span class="hint">${extra}</span>` : ''}</td>
        <td>${escapeHtml(b.mobile)}</td>
        <td>${b.visitors}</td>
        <td>${rupees(b.amount)}</td>
        <td><span class="badge ${b.status}">${b.status}</span></td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="8" class="hint">No bookings for this date.</td></tr>';
  }

  async function load() {
    $('#desk-alert').textContent = '';
    try {
      data = await api(`/api/admin/bookings?date=${encodeURIComponent($('#day').value)}`);
      render();
    } catch (err) {
      if (err.status === 401) return logout(err.message);
      $('#desk-alert').textContent = err.message;
    }
  }

  function logout(msg) {
    pin = '';
    sessionStorage.removeItem('mm-pin');
    $('#desk').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#login-error').textContent = msg || '';
  }

  async function open() {
    const cfg = await fetch('/api/config').then((r) => r.json());
    if (!$('#day').value) $('#day').value = cfg.today;
    $('#login').classList.add('hidden');
    $('#desk').classList.remove('hidden');
    await load();
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    pin = $('#pin').value;
    sessionStorage.setItem('mm-pin', pin);
    open();
  });
  $('#day').addEventListener('change', load);
  $('#refresh').addEventListener('click', load);
  $('#search').addEventListener('input', render);
  $('#rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    if (btn.dataset.status === 'cancelled' && !confirm(`Cancel booking ${btn.dataset.id}? Its places will be released.`)) return;
    btn.disabled = true;
    try {
      await api(`/api/admin/bookings/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
      await load();
    } catch (err) {
      $('#desk-alert').textContent = err.message;
      btn.disabled = false;
    }
  });

  if (pin) open();
})();
