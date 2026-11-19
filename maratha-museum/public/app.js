(() => {
  const $ = (sel) => document.querySelector(sel);
  const form = $('#booking-form');
  const slotsEl = $('#slots');
  const daysEl = $('#days');
  let cfg = null;
  let slots = [];
  let weekStart = null; // Monday of the week shown in the date strip (YYYY-MM-DD)

  const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Dates are handled as YYYY-MM-DD strings in UTC so the visitor's own time zone never shifts them.
  const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
  const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mondayOf = (iso) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));
  const fmt = (iso, opts) => toDate(iso).toLocaleDateString('en-IN', { timeZone: 'UTC', ...opts });
  const longDate = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  async function api(url, options = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data, status: res.status });
    return data;
  }

  const visitors = () => Math.max(1, Math.min(Number(form.visitors.value) || 1, cfg ? cfg.maxGroupSize : 20));
  const selectedSlotId = () => form.querySelector('input[name=slotId]:checked')?.value;

  function bookable(iso) {
    if (iso < cfg.today || iso > cfg.lastBookableDate) return false;
    return !cfg.closedWeekdays.includes(toDate(iso).getUTCDay());
  }

  // ---------- date strip ----------
  function renderWeek() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    daysEl.innerHTML = days.map((iso) => {
      const on = iso === form.date.value;
      return `<button type="button" class="day" data-date="${iso}" aria-pressed="${on}" ${bookable(iso) ? '' : 'disabled'}
          aria-label="${longDate(iso)}"><span class="dow">${fmt(iso, { weekday: 'short' }).toUpperCase()}</span>
          <span class="dnum">${fmt(iso, { day: 'numeric' })}</span></button>`;
    }).join('');
    $('#week-label').textContent = `${fmt(days[0], { day: 'numeric', month: 'short' })} – ${fmt(days[6], { day: 'numeric', month: 'short' })}`;
    $('#week-prev').disabled = weekStart <= mondayOf(cfg.today);
    $('#week-next').disabled = addDays(weekStart, 7) > cfg.lastBookableDate;
  }

  function selectDate(iso) {
    form.date.value = iso;
    weekStart = mondayOf(iso);
    renderWeek();
    updateSummary();
    return loadSlots();
  }

  // ---------- slots ----------
  function renderSlots() {
    const selected = selectedSlotId();
    const need = visitors();
    if (!slots.length) {
      slotsEl.innerHTML = '<div class="slot-placeholder">Choose a date to see available slots.</div>';
      updateSummary();
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
      slotsEl.insertAdjacentHTML('beforeend', '<div class="slot-placeholder">No slot on this date has room for your group. Try another date or a smaller group.</div>');
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
    const slot = slots.find((s) => s.id === selectedSlotId());
    const total = n * (cfg ? cfg.feePerPerson : 50);
    $('#sum-date').textContent = form.date.value ? longDate(form.date.value) : 'Choose a date';
    $('#sum-slot').textContent = slot ? `${slot.start}h – ${slot.end}h` : 'not chosen yet';
    $('#sum-visitors').textContent = n;
    $('#sum-plural').textContent = n === 1 ? '' : 's';
    $('#sum-total').textContent = total.toLocaleString('en-IN');
    $('#sum-total-2').textContent = rupees(total);
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
      <div class="pass-top">
        <div><div class="eyebrow">Visit pass · Booking ID</div><div class="code">${escapeHtml(b.id)}</div></div>
        <span class="badge ${b.status}">${b.status}</span>
      </div>
      <dl>
        <dt>Name</dt><dd>${escapeHtml(b.name)}</dd>
        <dt>Date</dt><dd>${longDate(b.date)}</dd>
        <dt>Time slot</dt><dd>${escapeHtml(b.slotLabel)}</dd>
        <dt>Visitors</dt><dd>${b.visitors}</dd>
      </dl>
      <div class="tear"></div>
      <div class="pay"><span>Pay at the counter<br><small>₹${cfg ? cfg.feePerPerson : 50} × ${b.visitors}</small></span><strong>${rupees(b.amount)}</strong></div>
      <p class="fine">Please reach the counter at least 10 minutes before your slot. Entry closes once the slot begins.</p>`;
    form.classList.add('hidden');
    $('#confirm-view').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- events ----------
  daysEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-date]');
    if (btn && !btn.disabled) selectDate(btn.dataset.date);
  });
  $('#week-prev').addEventListener('click', () => { weekStart = addDays(weekStart, -7); renderWeek(); });
  $('#week-next').addEventListener('click', () => { weekStart = addDays(weekStart, 7); renderWeek(); });

  form.visitors.addEventListener('input', renderSlots);
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
      slotId: selectedSlotId() || '',
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
      form.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const btn = $('#submit-btn');
    btn.disabled = true;
    $('#submit-text').textContent = 'Confirming…';
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
      $('#submit-text').textContent = 'Confirm booking';
    }
  });

  $('#book-another').addEventListener('click', () => {
    form.reset();
    $('#confirm-view').classList.add('hidden');
    form.classList.remove('hidden');
    selectDate(form.date.value || cfg.today);
  });

  $('#lookup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#lookup-result');
    const id = $('#lk-id').value.trim();
    const mobile = $('#lk-mobile').value.trim();
    if (!id || !mobile) { out.innerHTML = '<p class="error">Enter both the booking ID and the mobile number.</p>'; return; }
    try {
      const { booking: b } = await api(`/api/bookings/${encodeURIComponent(id)}?mobile=${encodeURIComponent(mobile)}`);
      out.innerHTML = `<p><strong>${escapeHtml(b.id)}</strong> · ${escapeHtml(b.name)} · ${longDate(b.date)}, ${escapeHtml(b.slotLabel)} ·
        ${b.visitors} visitor(s) · ${rupees(b.amount)} · <span class="badge ${b.status}">${b.status}</span></p>`;
    } catch (err) {
      out.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    }
  });

  // ---------- init ----------
  (async () => {
    cfg = await api('/api/config');
    form.visitors.max = cfg.maxGroupSize;
    await selectDate(cfg.today);
    // Late in the day every slot has started; jump to the next bookable day instead.
    if (slots.length && slots.every((s) => s.status === 'closed')) {
      let next = addDays(cfg.today, 1);
      while (next <= cfg.lastBookableDate && !bookable(next)) next = addDays(next, 1);
      if (next <= cfg.lastBookableDate) await selectDate(next);
    }
  })();
})();
