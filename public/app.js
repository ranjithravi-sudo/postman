(function () {
  const dateInput = document.getElementById('date');
  const selectAllCheckbox = document.getElementById('selectAll');
  const customerListEl = document.getElementById('customerList');
  const runBtn = document.getElementById('runBtn');
  const resultsSection = document.getElementById('resultsSection');
  const resultsSummary = document.getElementById('resultsSummary');
  const resultsTable = document.getElementById('resultsTable');
  const resultsBody = document.getElementById('resultsBody');
  const errorEl = document.getElementById('error');
  const loadingEl = document.getElementById('loading');
  const timeInput = document.getElementById('time');

  let customers = [];

  function setDefaultDate() {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${y}-${m}-${d}`;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function hideError() {
    errorEl.hidden = true;
  }

  function setLoading(show) {
    loadingEl.hidden = !show;
  }

  function updateRunButton() {
    const hasDate = dateInput.value.trim().length > 0;
    const hasTime = timeInput ? timeInput.value.trim().length > 0 : true;
    const hasSelection = customers.some((c) => c.checked);
    runBtn.disabled = !hasDate || !hasTime || !hasSelection;
  }

  function renderCustomerList() {
    customerListEl.innerHTML = '';
    customers.forEach((c) => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.name = c.name;
      cb.checked = c.checked;
      cb.addEventListener('change', () => {
        c.checked = cb.checked;
        updateSelectAllState();
        updateRunButton();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(c.name));
      customerListEl.appendChild(label);
    });
    updateSelectAllState();
    updateRunButton();
  }

  function updateSelectAllState() {
    const total = customers.length;
    const checked = customers.filter((c) => c.checked).length;
    selectAllCheckbox.checked = total > 0 && checked === total;
    selectAllCheckbox.indeterminate = checked > 0 && checked < total;
  }

  selectAllCheckbox.addEventListener('change', () => {
    const checked = selectAllCheckbox.checked;
    customers.forEach((c) => (c.checked = checked));
    customerListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = checked;
    });
    updateRunButton();
  });

  dateInput.addEventListener('input', updateRunButton);
  if (timeInput) timeInput.addEventListener('input', updateRunButton);

  function loadCustomers() {
    hideError();
    fetch('/api/customers')
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || res.statusText)));
        return res.json();
      })
      .then((data) => {
        customers = (data.customers || []).map((c) => ({ name: c.name, checked: false }));
        renderCustomerList();
      })
      .catch((err) => {
        showError(err.message || 'Failed to load customers.');
        customers = [];
        renderCustomerList();
      });
  }

  function renderResults(data) {
    const results = data.results || [];
    resultsBody.innerHTML = '';

    const passed = results.filter((r) => r.success).length;
    const failed = results.length - passed;

    if (failed === 0) {
      resultsSummary.className = 'results-summary pass';
      resultsSummary.textContent = `All ${results.length} verification(s) passed.`;
    } else if (passed === 0) {
      resultsSummary.className = 'results-summary fail';
      resultsSummary.textContent = `All ${results.length} verification(s) failed.`;
    } else {
      resultsSummary.className = 'results-summary partial';
      resultsSummary.textContent = `${passed} passed, ${failed} failed out of ${results.length} verification(s).`;
    }

    results.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        escapeHtml(r.customerName) +
        '</td>' +
        '<td class="' +
        (r.success ? 'status-pass">Pass' : 'status-fail">Fail') +
        '</td>' +
        '<td class="' +
        (r.holidayMessageFound ? 'yes">Yes' : 'no">No') +
        '</td>' +
        '<td class="holiday-text-cell">' +
        escapeHtml(r.holidayMessageText ? r.holidayMessageText : '—') +
        '</td>' +
        '<td class="' +
        (r.transferredToAgent ? 'yes">Yes' : 'no">No') +
        '</td>' +
        '<td class="details-cell">' +
        escapeHtml(r.message || '') +
        '</td>';
      resultsBody.appendChild(tr);
    });

    resultsSection.hidden = false;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  runBtn.addEventListener('click', () => {
    const dateStr = dateInput.value.trim();
    if (!dateStr) {
      showError('Please select a date.');
      return;
    }
    const selected = customers.filter((c) => c.checked).map((c) => c.name);
    if (selected.length === 0) {
      showError('Please select at least one customer.');
      return;
    }

    hideError();
    setLoading(true);
    resultsSection.hidden = true;

    const timeStr = timeInput ? timeInput.value.trim() : '11:10';
    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr, time: timeStr || '11:10', customerNames: selected }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setLoading(false);
        if (!ok) {
          showError(data.error || 'Run failed.');
          return;
        }
        renderResults(data);
      })
      .catch((err) => {
        setLoading(false);
        showError(err.message || 'Request failed.');
      });
  });

  setDefaultDate();
  loadCustomers();
})();
