(() => {
  const $ = (sel) => document.querySelector(sel);
  let pin = '';
  try { pin = sessionStorage.getItem('mm-pin') || ''; } catch { /* storage blocked: sign in each visit */ }
  let data = { slots: [], bookings: [] };
  let today = '';

  const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const longDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const remember = (value) => { try { value ? sessionStorage.setItem('mm-pin', value) : sessionStorage.removeItem('mm-pin'); } catch { /* ignore */ } };

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
    const day = $('#day').value;
    $('#stats-title').textContent = day === today ? `Today · ${longDate(day)}` : longDate(day);
    $('#stats').innerHTML = [
      ['Active bookings', active.length],
      ['Expected visitors', sum(active, 'visitors')],
      ['Arrived and paid', sum(paid, 'visitors')],
      ['Collected', rupees(sum(paid, 'amount'))],
      ['Still to collect', rupees(sum(active, 'amount') - sum(paid, 'amount'))],
    ].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');

    $('#slot-overview').innerHTML = data.slots.map((s) => {
      const pct = Math.round((s.booked / s.capacity) * 100);
      const cls = s.remaining === 0 ? 'full' : s.remaining <= 5 ? 'low' : '';
      return `<div class="slot ${cls}"><label><span class="time">${s.start}h – ${s.end}h</span>
        <span class="avail">${s.booked} of ${s.capacity} booked${s.remaining === 0 ? ' · Full' : ''}</span>
        <span class="bar"><i style="width:${pct}%"></i></span></label></div>`;
    }).join('');

    const q = $('#search').value.trim().toLowerCase();
    const rows = data.bookings.filter((b) => !q || [b.id, b.name, b.mobile].some((v) => v.toLowerCase().includes(q)));
    $('#rows').innerHTML = rows.length ? rows.map((b) => {
      const actions = b.status === 'confirmed'
        ? `<button class="btn small" data-id="${b.id}" data-status="paid">Mark paid</button>
           <button class="btn small danger" data-id="${b.id}" data-status="cancelled">Cancel</button>`
        : `<button class="btn small ghost" data-id="${b.id}" data-status="confirmed">Undo</button>`;
      const extra = [b.city, b.assistance ? 'Needs assistance' : '', b.notes].filter(Boolean).map(escapeHtml).join(' · ');
      return `<tr class="${b.status}">
        <td class="nowrap">${escapeHtml(b.slotLabel)}</td>
        <td><strong>${escapeHtml(b.id)}</strong></td>
        <td>${escapeHtml(b.name)}${extra ? `<span class="sub">${extra}</span>` : ''}</td>
        <td class="num nowrap">${escapeHtml(b.mobile)}</td>
        <td class="num">${b.visitors}</td>
        <td class="num">${rupees(b.amount)}</td>
        <td><span class="badge ${b.status}">${b.status}</span></td>
        <td><div class="row-actions">${actions}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="sub">${q ? 'No bookings match your search.' : 'No bookings for this date yet.'}</td></tr>`;
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
    return undefined;
  }

  function logout(msg) {
    pin = '';
    remember('');
    $('#desk').classList.add('hidden');
    $('#logout').classList.add('hidden');
    $('#login').classList.remove('hidden');
    $('#login-error').textContent = msg || '';
  }

  async function open() {
    const cfg = await fetch('/api/config').then((r) => r.json());
    today = cfg.today;
    if (!$('#day').value) $('#day').value = cfg.today;
    $('#login').classList.add('hidden');
    $('#desk').classList.remove('hidden');
    $('#logout').classList.remove('hidden');
    await load();
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    pin = $('#pin').value;
    remember(pin);
    open();
  });
  $('#logout').addEventListener('click', () => logout(''));
  $('#day').addEventListener('change', load);
  $('#refresh').addEventListener('click', load);
  $('#search').addEventListener('input', render);
  $('#rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    // Cancelling releases the places, so it takes a second tap to confirm.
    if (btn.dataset.status === 'cancelled' && !btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Tap again to cancel';
      return;
    }
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
