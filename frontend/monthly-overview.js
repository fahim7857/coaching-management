// Monthly Fee Overview & 12-Month Matrix Frontend Logic
let currentClassId = null;
let currentMonth = getCurrentMonthName();
let matrixData = null;
let allClasses = [];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

document.addEventListener('DOMContentLoaded', async () => {
  const mSelect = document.getElementById('overview-month-select');
  if (mSelect) {
    mSelect.value = currentMonth;
  }
  await loadClasses();
  await loadMatrix();
  await loadDueList();
  setupEventListeners();
});

async function loadClasses() {
  try {
    const res = await api.get('/classes');
    allClasses = res.data;

    // Check URL params
    const urlParams = new URLSearchParams(window.location.search);
    const urlCls = urlParams.get('class_id');

    // Default to Class 5 or first class
    const cls5 = allClasses.find(c => c.class_number === 5) || allClasses[0];
    currentClassId = urlCls ? parseInt(urlCls, 10) : (cls5 ? cls5.id : 1);

    const sel = document.getElementById('matrix-class-select');
    if (sel) {
      sel.innerHTML = allClasses.map(c => `
        <option value="${c.id}" ${c.id === currentClassId ? 'selected' : ''}>
          ${c.name} (${c.student_count || 35} Students)
        </option>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load classes', err);
  }
}

async function loadMatrix() {
  try {
    const res = await api.get('/overview/matrix', {
      class_id: currentClassId,
      month: currentMonth
    });
    matrixData = res;
    renderTargetAnalysis(res.stats, res.classInfo);
    renderMatrixTable(res.rows, res.classInfo);
  } catch (err) {
    showToast('Failed to load matrix: ' + err.message, 'error');
  }
}

async function loadDueList() {
  try {
    const res = await api.get('/overview/due-list', {
      class_id: currentClassId,
      month: currentMonth
    });
    renderDueListTable(res.data);
  } catch (err) {
    console.error(err);
  }
}

function renderTargetAnalysis(stats, classInfo) {
  document.getElementById('cycle-target-title').textContent = `Target Cycle Analysis (${currentMonth} 2026)`;
  document.getElementById('stat-cycle-enrolled').textContent = `${stats.totalEnrolled} Students`;
  document.getElementById('stat-cycle-enrolled-sub').textContent = `${classInfo.name} active cohort`;

  document.getElementById('stat-cycle-cleared').textContent = `${stats.clearedCount} (${stats.clearedPercent}%)`;
  document.getElementById('stat-cycle-cleared-sub').textContent = 'Paid on schedule';

  document.getElementById('stat-cycle-due').textContent = `${stats.dueCount} (${stats.duePercent}%)`;
  document.getElementById('stat-cycle-due-sub').textContent = 'Defaulting this cycle';

  document.getElementById('stat-cycle-collected').textContent = formatCurrency(stats.grossCollected);
  document.getElementById('stat-cycle-collected-sub').textContent = '+৳6,000 this week';

  document.getElementById('stat-cycle-expected').textContent = formatCurrency(stats.expectedTarget);
  document.getElementById('stat-cycle-expected-sub').textContent = `Unsettled: ${formatCurrency(stats.unsettledAmount)}`;
}

function renderMatrixTable(rows, classInfo) {
  const tbody = document.getElementById('matrix-tbody');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align: center; color: #64748b; padding: 2rem;">No students in this class.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const cells = MONTH_NAMES.map(mName => {
      const cell = r.months[mName];
      if (!cell || cell.status === 'NOT_APPLICABLE') {
        return `<td><span class="matrix-cell-na">—</span></td>`;
      }
      if (cell.status === 'PAID') {
        return `
          <td>
            <span class="matrix-cell-paid" title="Paid on ${cell.date} (${cell.receipt})" onclick="viewReceiptFromMatrix('${cell.receipt}', '${r.name.replace(/'/g, "\\'")}', ${r.roll}, '${mName}', ${cell.amount}, '${classInfo.name}')">
              ${cell.label}
            </span>
          </td>
        `;
      }
      if (cell.status === 'DUE') {
        return `
          <td>
            <span class="matrix-cell-due" title="Due for ${mName}" onclick="openQuickPayMatrix(${r.id}, '${r.name.replace(/'/g, "\\'")}', ${r.roll}, '${mName}', ${cell.amount})">
              DUE
            </span>
          </td>
        `;
      }
      return `<td><span class="matrix-cell-na">—</span></td>`;
    }).join('');

    return `
      <tr>
        <td style="font-weight: 700; color: #004ac6;">
          <a href="student-details.html?id=${r.id}" style="color: inherit; text-decoration: none;">
            #${r.roll}
          </a>
        </td>
        <td style="font-weight: 600; text-align: left;">
          <a href="student-details.html?id=${r.id}" style="color: var(--on-surface); text-decoration: none;">
            ${r.name}
          </a>
        </td>
        ${cells}
      </tr>
    `;
  }).join('');
}

function renderDueListTable(dueStudents) {
  const tbody = document.getElementById('due-list-tbody');
  const countBadge = document.getElementById('due-list-count-badge');
  if (!tbody) return;

  if (countBadge) {
    countBadge.textContent = `${dueStudents.length} Defaulters`;
  }

  if (!dueStudents || dueStudents.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #16a34a; font-weight: 600; padding: 2rem;">All students have cleared fees for ${currentMonth}! 🎉</td></tr>`;
    return;
  }

  tbody.innerHTML = dueStudents.map(st => `
    <tr>
      <td style="font-weight: 700; color: #004ac6;">#${st.roll_number}</td>
      <td>
        <div style="font-weight: 600;">${st.name}</div>
        <div style="font-size: 0.72rem; color: #64748b;">Adm: ${st.admission_date}</div>
      </td>
      <td style="color: #334155; font-weight: 500;">${st.phone}</td>
      <td style="font-weight: 600; color: #dc2626;">${formatCurrency(st.monthly_fee)}</td>
      <td>
        ${st.unpaidMonthsCount > 1 ? `
          <span class="badge-tag" style="background: #fef2f2; color: #b91c1c; font-size: 0.7rem;">
            ${st.unpaidMonthsCount} Months Due (${st.unpaidMonths.join(', ')})
          </span>
        ` : `
          <span class="badge-tag" style="font-size: 0.7rem;">${currentMonth} Only</span>
        `}
      </td>
      <td style="font-weight: 700; color: #dc2626;">${formatCurrency(st.totalDueAmount)}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-primary btn-sm" onclick="openQuickPayMatrix(${st.id}, '${st.name.replace(/'/g, "\\'")}', ${st.roll_number}, '${currentMonth}', ${st.monthly_fee})">
          Collect Payment
        </button>
        <button class="btn btn-secondary btn-sm" onclick="sendReminderSMS('${st.name.replace(/'/g, "\\'")}', '${st.phone}', '${formatCurrency(st.totalDueAmount)}')">
          <span class="material-symbols-outlined" style="font-size: 1rem;">sms</span>
        </button>
      </td>
    </tr>
  `).join('');
}

function setupEventListeners() {
  document.getElementById('matrix-class-select').addEventListener('change', (e) => {
    currentClassId = parseInt(e.target.value, 10);
    loadMatrix();
    loadDueList();
  });

  document.getElementById('matrix-month-select').addEventListener('change', (e) => {
    currentMonth = e.target.value;
    loadMatrix();
    loadDueList();
  });

  const formPay = document.getElementById('form-matrix-pay');
  if (formPay) {
    formPay.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      try {
        const res = await api.post('/payments', {
          student_id: form.student_id.value,
          month: form.month.value,
          payment_method: form.payment_method.value,
          note: form.note.value,
          payment_date: form.payment_date.value || '2026-09-18'
        });
        showToast(res.message, 'success');
        closeModal('modal-matrix-pay');
        await loadMatrix();
        await loadDueList();
        openPrintReceiptModal(res.data);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}

function openQuickPayMatrix(id, name, roll, month, fee) {
  const form = document.getElementById('form-matrix-pay');
  form.student_id.value = id;
  form.student_name_display.value = `#${roll} - ${name}`;
  form.month.value = month;
  form.amount.value = fee;
  openModal('modal-matrix-pay');
}

function viewReceiptFromMatrix(receiptNo, studentName, roll, month, amount, className) {
  openPrintReceiptModal({
    receipt_no: receiptNo,
    student_name: studentName,
    roll_number: roll,
    class_name: className,
    month: month,
    amount: amount,
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'Cash'
  });
}

function sendReminderSMS(name, phone, amount) {
  const msg = `Dear Guardian, fee payment of ${amount} for student ${name} for ${currentMonth} ${new Date().getFullYear()} is due. Please settle at coaching office.`;
  navigator.clipboard.writeText(msg);
  showToast(`SMS reminder copied to clipboard for ${phone}!`, 'success');
}

function exportMatrixToExcel() {
  if (!matrixData || !matrixData.rows) {
    showToast('No matrix data to export', 'error');
    return;
  }

  const headers = ['Roll', 'Student Name', ...MONTH_NAMES];
  const csvRows = [headers.join(',')];

  matrixData.rows.forEach(r => {
    const row = [
      r.roll,
      `"${r.name.replace(/"/g, '""')}"`,
      ...MONTH_NAMES.map(m => {
        const c = r.months[m];
        if (!c) return '—';
        if (c.status === 'PAID') return `PAID (${c.amount})`;
        if (c.status === 'DUE') return `DUE (${c.amount})`;
        return '—';
      })
    ];
    csvRows.push(row.join(','));
  });

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `monthly-fee-matrix-${matrixData.classInfo.name}-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}
