(() => {
  const $ = (sel) => document.querySelector(sel);
  const form = $('#booking-form');
  const slotsEl = $('#slots');
  let cfg = null;
  let slots = [];

  const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;
  const niceDate = (iso) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(url, options = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data, status: res.status });
    return data;
  }

  const visitors = () => Math.max(1, Math.min(Number(form.visitors.value) || 1, cfg ? cfg.maxGroupSize : 20));

  // ---------- slot rendering ----------
  function renderSlots() {
    const selected = form.querySelector('input[name=slotId]:checked')?.value;
    const need = visitors();
    if (!slots.length) {
      slotsEl.innerHTML = '<div class="slot-placeholder">Choose a date to see available slots.</div>';
      return;
    }
    slotsEl.innerHTML = slots.map((s) => {
      const tooFew = s.status === 'open' && s.remaining < need;
      const disabled = s.status !== 'open' || tooFew;
      const text = s.status === 'closed' ? 'Slot has started'
        : s.status === 'full' ? 'Slot full'
        : tooFew ? `Only ${s.remaining} left`
        : `${s.remaining} of ${s.capacity} places left`;
      const low = !disabled && s.remaining <= 5;
      const pct = Math.round((s.remaining / s.capacity) * 100);
      return `<div class="slot ${disabled ? 'disabled' : ''} ${low ? 'low' : ''}">
          <input type="radio" name="slotId" id="slot-${s.id}" value="${s.id}" ${disabled ? 'disabled' : ''} ${selected === s.id && !disabled ? 'checked' : ''}>
          <label for="slot-${s.id}"><span class="time">${s.start}h – ${s.end}h</span>
            <span class="avail">${text}</span><span class="bar"><i style="width:${pct}%"></i></span></label>
        </div>`;
    }).join('');
    if (slots.every((s) => s.status !== 'open' || s.remaining < need)) {
      slotsEl.insertAdjacentHTML('beforeend', '<div class="slot-placeholder" style="grid-column:1/-1">No slot on this date has room for your group. Please try another date or a smaller group.</div>');
    }
    updateSummary();
  }

  async function loadSlots() {
    const date = form.date.value;
    setFieldError('date', '');
    if (!date) { slots = []; renderSlots(); return; }
    slotsEl.innerHTML = '<div class="slot-placeholder">Checking availability…</div>';
    try {
      slots = (await api(`/api/slots?date=${encodeURIComponent(date)}`)).slots;
    } catch (err) {
      slots = [];
      setFieldError('date', err.message);
    }
    renderSlots();
  }

  function updateSummary() {
    const n = visitors();
    const slot = slots.find((s) => s.id === form.querySelector('input[name=slotId]:checked')?.value);
    $('#sum-date').textContent = form.date.value ? niceDate(form.date.value) : '—';
    $('#sum-slot').textContent = slot ? `${slot.start}h – ${slot.end}h` : '—';
    $('#sum-visitors').textContent = n;
    $('#sum-visitors-2').textContent = n;
    $('#sum-total').textContent = rupees(n * (cfg ? cfg.feePerPerson : 50));
  }

  // ---------- errors ----------
  function setFieldError(field, msg) {
    const wrap = form.querySelector(`[data-field="${field}"]`);
    if (!wrap) return;
    wrap.classList.toggle('invalid', Boolean(msg));
    const err = wrap.querySelector('.error');
    if (err) err.textContent = msg || '';
  }
  function clearErrors() {
    form.querySelectorAll('[data-field]').forEach((el) => setFieldError(el.dataset.field, ''));
    $('#form-alert').textContent = '';
  }

  function clientValidate(body) {
    const errs = {};
    if (!body.date) errs.date = 'Please choose the date of your visit.';
    if (!body.slotId) errs.slotId = 'Please choose a time slot.';
    if (body.name.trim().length < 2) errs.name = 'Please enter your full name.';
    if (!/^(\+91)?[6-9]\d{9}$/.test(body.mobile.replace(/[\s-]/g, ''))) errs.mobile = 'Enter a valid 10-digit mobile number.';
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errs.email = 'Enter a valid email address.';
    if (!body.agree) errs.agree = 'Please accept the visit terms.';
    return errs;
  }

  // ---------- confirmation ----------
  function showPass(b) {
    $('#pass').innerHTML = `
      <header><h2>Maratha Museum · Visit Pass</h2></header>
      <div class="body">
        <p style="margin:0 0 4px;color:var(--muted)">Booking ID</p>
        <div class="code">${escapeHtml(b.id)}</div>
        <dl>
          <dt>Name</dt><dd>${escapeHtml(b.name)}</dd>
          <dt>Date</dt><dd>${niceDate(b.date)}</dd>
          <dt>Time slot</dt><dd>${escapeHtml(b.slotLabel)}</dd>
          <dt>Visitors</dt><dd>${b.visitors}</dd>
          <dt>Status</dt><dd><span class="badge ${b.status}">${b.status}</span></dd>
        </dl>
        <p class="hint" style="margin-bottom:0">Please reach the counter at least 10 minutes before your slot. Entry closes once the slot begins.</p>
      </div>
      <div class="pay"><span>Pay at counter (₹${cfg ? cfg.feePerPerson : 50} × ${b.visitors})</span><strong>${rupees(b.amount)}</strong></div>`;
    $('#form-view').classList.add('hidden');
    $('#confirm-view').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- events ----------
  form.date.addEventListener('change', loadSlots);
  form.visitors.addEventListener('input', () => { renderSlots(); updateSummary(); });
  form.visitors.addEventListener('blur', () => { form.visitors.value = visitors(); renderSlots(); });
  form.querySelectorAll('[data-step]').forEach((btn) => btn.addEventListener('click', () => {
    form.visitors.value = Math.max(1, Math.min(visitors() + Number(btn.dataset.step), cfg.maxGroupSize));
    renderSlots();
  }));
  slotsEl.addEventListener('change', () => { setFieldError('slotId', ''); updateSummary(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const body = {
      date: form.date.value,
      slotId: form.querySelector('input[name=slotId]:checked')?.value || '',
      visitors: visitors(),
      name: form.name.value,
      mobile: form.mobile.value,
      email: form.email.value.trim(),
      city: form.city.value,
      assistance: form.assistance.checked,
      notes: form.notes.value,
      agree: form.agree.checked,
    };
    const errs = clientValidate(body);
    if (Object.keys(errs).length) {
      Object.entries(errs).forEach(([k, v]) => setFieldError(k, v));
      $('#form-alert').textContent = 'Please correct the highlighted fields.';
      form.querySelector('.invalid input, .invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const btn = $('#submit-btn');
    btn.disabled = true;
    btn.textContent = 'Confirming…';
    try {
      const { booking } = await api('/api/bookings', { method: 'POST', body: JSON.stringify(body) });
      showPass(booking);
    } catch (err) {
      $('#form-alert').textContent = err.message;
      Object.entries(err.data?.fields || {}).forEach(([k, v]) => setFieldError(k, v));
      if (err.data?.slots) { slots = err.data.slots; renderSlots(); } else if (err.status === 409) loadSlots();
      $('#form-alert').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirm booking';
    }
  });

  $('#book-another').addEventListener('click', () => {
    form.reset();
    form.date.value = cfg.today;
    $('#confirm-view').classList.add('hidden');
    $('#form-view').classList.remove('hidden');
    loadSlots();
  });

  $('#lookup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#lookup-result');
    const id = $('#lk-id').value.trim();
    const mobile = $('#lk-mobile').value.trim();
    if (!id || !mobile) { out.innerHTML = '<p class="error">Enter both booking ID and mobile number.</p>'; return; }
    try {
      const { booking: b } = await api(`/api/bookings/${encodeURIComponent(id)}?mobile=${encodeURIComponent(mobile)}`);
      out.innerHTML = `<p><strong>${escapeHtml(b.id)}</strong> · ${escapeHtml(b.name)} · ${niceDate(b.date)}, ${escapeHtml(b.slotLabel)} ·
        ${b.visitors} visitor(s) · ${rupees(b.amount)} · <span class="badge ${b.status}">${b.status}</span></p>`;
    } catch (err) {
      out.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  });

  // ---------- init ----------
  (async () => {
    cfg = await api('/api/config');
    form.date.min = cfg.today;
    form.date.max = cfg.lastBookableDate;
    form.date.value = cfg.today;
    form.visitors.max = cfg.maxGroupSize;
    $('#date-hint').textContent = `You can book up to ${cfg.bookingWindowDays} days ahead.`;
    loadSlots();
  })();
})();
