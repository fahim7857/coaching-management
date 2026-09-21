// Centralized Frontend API Client & Helper Utilities
// Uses standard JavaScript fetch() for communication with the Node.js SQLite backend

const API_BASE = '/api';

const api = {
  async get(endpoint, params = {}) {
    const url = new URL(window.location.origin + API_BASE + endpoint);
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        url.searchParams.append(key, params[key]);
      }
    });

    try {
      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Server request failed');
      }
      return data;
    } catch (err) {
      console.error(`API GET ${endpoint} Error:`, err);
      throw err;
    }
  },

  async post(endpoint, body = {}) {
    try {
      const res = await fetch(API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Operation failed');
      }
      return data;
    } catch (err) {
      console.error(`API POST ${endpoint} Error:`, err);
      throw err;
    }
  },

  async put(endpoint, body = {}) {
    try {
      const res = await fetch(API_BASE + endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Update failed');
      }
      return data;
    } catch (err) {
      console.error(`API PUT ${endpoint} Error:`, err);
      throw err;
    }
  },

  async patch(endpoint, body = {}) {
    try {
      const res = await fetch(API_BASE + endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Action failed');
      }
      return data;
    } catch (err) {
      console.error(`API PATCH ${endpoint} Error:`, err);
      throw err;
    }
  },

  async delete(endpoint) {
    try {
      const res = await fetch(API_BASE + endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Delete failed');
      }
      return data;
    } catch (err) {
      console.error(`API DELETE ${endpoint} Error:`, err);
      throw err;
    }
  }
};

// UI Toast Notification
function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="material-symbols-outlined" style="font-size: 1.2rem; color: ${type === 'success' ? '#22c55e' : '#ef4444'}">
      ${type === 'success' ? 'check_circle' : 'error'}
    </span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Format Currency
function formatCurrency(num) {
  const val = Number(num) || 0;
  return '৳ ' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Format Short Currency (e.g. ৳ 8.5k or ৳ 1,000)
function formatShortCurrency(num) {
  const val = Number(num) || 0;
  return '৳ ' + val.toLocaleString('en-US');
}

// Format Date to Day/Month/Year (DD/MM/YYYY)
function formatDate(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr).trim();
  if (str.includes('-')) {
    const parts = str.split('T')[0].split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD -> DD/MM/YYYY
        return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
      } else if (parts[2].length === 4) {
        // MM-DD-YYYY -> DD/MM/YYYY
        return `${parts[1].padStart(2, '0')}/${parts[0].padStart(2, '0')}/${parts[2]}`;
      }
    }
  }
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      if (parts[2].length === 4 && parseInt(parts[0], 10) <= 12 && parseInt(parts[1], 10) > 12) {
        return `${parts[1].padStart(2, '0')}/${parts[0].padStart(2, '0')}/${parts[2]}`;
      } else if (parts[2].length === 4) {
        return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
      }
    }
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Modal helper
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// Get dynamic continuous current month name
function getCurrentMonthName() {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[new Date().getMonth()];
}

// Format current present day dynamically (e.g. 21 September 2026)
function formatCurrentDate() {
  const now = new Date();
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  return now.toLocaleDateString('en-GB', options);
}

// Dynamic Academic Year Central Manager
let cachedAcademicYears = [];
let activeAcademicYear = null;
let selectedAcademicYear = null;

async function loadAcademicYearContext() {
  try {
    const [activeRes, allRes] = await Promise.all([
      api.get('/academic-years/active'),
      api.get('/academic-years')
    ]);

    activeAcademicYear = activeRes.data || { id: 1, year: new Date().getFullYear(), is_active: 1 };
    cachedAcademicYears = allRes.data || [activeAcademicYear];

    // Check if user previously selected a year in this session
    const stored = sessionStorage.getItem('selected_academic_year');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const match = cachedAcademicYears.find(y => y.id === parsed.id || y.year === parsed.year);
        if (match) {
          selectedAcademicYear = match;
        }
      } catch (e) {}
    }

    if (!selectedAcademicYear) {
      selectedAcademicYear = activeAcademicYear;
    }

    applyAcademicYearToUI();
    return { activeAcademicYear, selectedAcademicYear, cachedAcademicYears };
  } catch (err) {
    console.warn('Could not load academic year context:', err.message);
    const fallbackYear = new Date().getFullYear();
    activeAcademicYear = { id: 1, year: fallbackYear, is_active: 1 };
    selectedAcademicYear = activeAcademicYear;
    cachedAcademicYears = [activeAcademicYear];
    applyAcademicYearToUI();
    return { activeAcademicYear, selectedAcademicYear, cachedAcademicYears };
  }
}

function getSelectedAcademicYear() {
  return selectedAcademicYear || activeAcademicYear || { id: 1, year: new Date().getFullYear(), is_active: 1 };
}

function getActiveAcademicYearData() {
  return activeAcademicYear || { id: 1, year: new Date().getFullYear(), is_active: 1 };
}

function setSelectedAcademicYear(yearObj, shouldReload = true) {
  selectedAcademicYear = yearObj;
  sessionStorage.setItem('selected_academic_year', JSON.stringify(yearObj));
  applyAcademicYearToUI();
  window.dispatchEvent(new CustomEvent('academicYearChanged', { detail: yearObj }));
  if (shouldReload) {
    window.location.reload();
  }
}

function applyAcademicYearToUI() {
  const currentYear = getSelectedAcademicYear();
  const yearNum = currentYear.year;

  // Render topbar selector if not already created
  let topbarActions = document.querySelector('.topbar-actions');
  if (topbarActions && !document.getElementById('topbar-ay-select')) {
    const selectorContainer = document.createElement('div');
    selectorContainer.className = 'topbar-ay-selector';
    selectorContainer.innerHTML = `
      <select id="topbar-ay-select" class="badge-tag-select" title="Switch Academic Year">
        ${cachedAcademicYears.map(y => `
          <option value="${y.id}" ${y.id === currentYear.id ? 'selected' : ''}>
            AY ${y.year} ${y.is_active ? '● Active' : '(Archive)'}
          </option>
        `).join('')}
      </select>
    `;
    const oldBadge = topbarActions.querySelector('.badge-tag');
    if (oldBadge) {
      oldBadge.replaceWith(selectorContainer);
    } else {
      topbarActions.insertBefore(selectorContainer, topbarActions.firstChild);
    }

    const selectEl = document.getElementById('topbar-ay-select');
    if (selectEl) {
      selectEl.addEventListener('change', (e) => {
        const chosenId = parseInt(e.target.value, 10);
        const chosen = cachedAcademicYears.find(y => y.id === chosenId);
        if (chosen) {
          setSelectedAcademicYear(chosen, true);
        }
      });
    }
  } else if (document.getElementById('topbar-ay-select')) {
    const selectEl = document.getElementById('topbar-ay-select');
    selectEl.innerHTML = cachedAcademicYears.map(y => `
      <option value="${y.id}" ${y.id === currentYear.id ? 'selected' : ''}>
        AY ${y.year} ${y.is_active ? '● Active' : '(Archive)'}
      </option>
    `).join('');
  }

  // Update any other AY badges, titles, form labels
  document.querySelectorAll('.badge-tag').forEach(badge => {
    if (badge.textContent.includes('2026')) {
      badge.textContent = badge.textContent.replace('2026', String(yearNum));
    }
  });

  // Update input fields with 'Academic Year ...'
  document.querySelectorAll('input').forEach(inp => {
    if (inp.value && inp.value.includes('Academic Year')) {
      inp.value = `Academic Year ${yearNum}`;
    }
  });

  // Update student registration AY input if present
  const addStudentAy = document.getElementById('modal-add-student-ay');
  if (addStudentAy) {
    addStudentAy.value = `Academic Year ${yearNum}`;
  }
}

// Initialize dynamic dates on all pages
function initDynamicDates() {
  const formattedToday = formatCurrentDate();
  document.querySelectorAll('.topbar-date').forEach(el => {
    el.textContent = formattedToday;
  });

  // Automatically default date inputs to today's date
  const todayIso = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(inp => {
    if (!inp.value || inp.value === '2026-09-18') {
      inp.value = todayIso;
    }
  });
}

// Initialize sidebar controls (search bar and live net balance display)
async function initSidebarControls() {
  // Sidebar Search Box listener
  const sidebarSearch = document.getElementById('sidebar-search-input');
  if (sidebarSearch) {
    sidebarSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = sidebarSearch.value.trim();
        if (val) {
          window.location.href = `students.html?search=${encodeURIComponent(val)}`;
        }
      }
    });
  }

  // Load and update sidebar net balance display
  try {
    const res = await api.get('/dashboard', { period: 'month' });
    if (res && res.stats) {
      const net = res.stats.monthly ? res.stats.monthly.net : (res.stats.today ? res.stats.today.net : 0);
      const balanceEls = document.querySelectorAll('#sidebar-net-balance-val');
      balanceEls.forEach(el => {
        el.textContent = formatCurrency(net);
      });
    }
  } catch (err) {
    console.debug('Sidebar balance sync deferred:', err.message);
  }
}

// Print Money Receipt Modal (Fee Collection)
function openPrintReceiptModal(paymentData) {
  let modal = document.getElementById('modal-print-receipt');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-print-receipt';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 540px;">
        <div class="modal-header">
          <h3 class="modal-title">Fee Money Receipt</h3>
          <button class="modal-close" onclick="closeModal('modal-print-receipt')">&times;</button>
        </div>
        <div class="modal-body" id="receipt-printable-content">
          <!-- Populated dynamically -->
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('modal-print-receipt')">Close</button>
          <button class="btn btn-primary" onclick="window.print()">
            <span class="material-symbols-outlined" style="font-size: 1.1rem;">print</span>
            Print Voucher
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const content = document.getElementById('receipt-printable-content');
  const formattedDate = formatDate(paymentData.payment_date || paymentData.date || new Date().toISOString().split('T')[0]);
  const yearStr = paymentData.year || new Date().getFullYear();
  content.innerHTML = `
    <div style="border: 2px dashed #cbd5e1; padding: 1.5rem; border-radius: 8px; background: #fff;">
      <div style="text-align: center; border-bottom: 2px solid #004ac6; padding-bottom: 0.75rem; margin-bottom: 1rem;">
        <h2 style="color: #004ac6; font-size: 1.25rem; font-weight: 700; margin: 0;">COACHING CENTER MANAGEMENT</h2>
        <p style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">Offline-First Academic Portal • Dhaka, Bangladesh</p>
        <span style="display: inline-block; background: #2563eb; color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 10px; border-radius: 9999px; margin-top: 6px;">
          MONEY RECEIPT (OFFICIAL)
        </span>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.75rem; color: #334155;">
        <div><strong>Receipt No:</strong> ${paymentData.receipt_no || paymentData.receiptNo}</div>
        <div><strong>Date:</strong> ${formattedDate} (${paymentData.payment_time || paymentData.time || '10:00 AM'})</div>
      </div>

      <table style="width: 100%; font-size: 0.82rem; margin-bottom: 1rem; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 0; color: #64748b;">Student Name:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right;">${paymentData.student_name || paymentData.studentName}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 0; color: #64748b;">Roll Number:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right;">#${paymentData.roll_number || paymentData.roll}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 0; color: #64748b;">Class / Cohort:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right;">${paymentData.class_name || 'Class 5'}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 0; color: #64748b;">Billing Month:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #004ac6;">${paymentData.month} ${yearStr}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 0; color: #64748b;">Payment Method:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right;">${paymentData.payment_method || 'Cash'}</td>
        </tr>
      </table>

      <div style="background: #f8faff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <span style="font-weight: 700; font-size: 0.85rem; color: #1e293b;">Total Received:</span>
        <span style="font-weight: 800; font-size: 1.2rem; color: #16a34a;">${formatCurrency(paymentData.amount)}</span>
      </div>

      <div style="display: flex; justify-content: space-between; margin-top: 2rem; font-size: 0.75rem; color: #64748b; padding-top: 1rem; border-top: 1px dashed #e2e8f0;">
        <div style="text-align: center; width: 140px;">
          <div style="border-bottom: 1px solid #94a3b8; height: 30px;"></div>
          <div style="margin-top: 4px;">Student / Guardian</div>
        </div>
        <div style="text-align: center; width: 140px;">
          <div style="border-bottom: 1px solid #94a3b8; height: 30px;"></div>
          <div style="margin-top: 4px; font-weight: 600; color: #004ac6;">Authorized Signature</div>
        </div>
      </div>
    </div>
  `;

  openModal('modal-print-receipt');
}

// Print Expense Receipt Modal (Debit Voucher)
function openPrintExpenseReceiptModal(expenseData) {
  let modal = document.getElementById('modal-print-expense-receipt');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-print-expense-receipt';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 540px;">
        <div class="modal-header">
          <h3 class="modal-title">Expense Payment Receipt</h3>
          <button class="modal-close" onclick="closeModal('modal-print-expense-receipt')">&times;</button>
        </div>
        <div class="modal-body" id="expense-receipt-printable-content">
          <!-- Populated dynamically -->
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('modal-print-expense-receipt')">Close</button>
          <button class="btn btn-primary" onclick="window.print()">
            <span class="material-symbols-outlined" style="font-size: 1.1rem;">print</span>
            Print Voucher
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const content = document.getElementById('expense-receipt-printable-content');
  const formattedDate = formatDate(expenseData.expense_date || expenseData.date || new Date().toISOString().split('T')[0]);
  const voucherNo = expenseData.voucher_no || expenseData.voucherNo || ('EXP-' + String(expenseData.id || '0000').padStart(4, '0'));
  const categoryName = expenseData.category_name || expenseData.categoryName || 'General Expense';
  const description = expenseData.description || 'Institutional expenditure';
  const amount = expenseData.amount || 0;
  const time = expenseData.expense_time || expenseData.time || '10:00 AM';

  content.innerHTML = `
    <div style="border: 2px dashed #cbd5e1; padding: 1.5rem; border-radius: 8px; background: #fff;">
      <div style="text-align: center; border-bottom: 2px solid #dc2626; padding-bottom: 0.75rem; margin-bottom: 1rem;">
        <h2 style="color: #004ac6; font-size: 1.25rem; font-weight: 700; margin: 0;">COACHING CENTER MANAGEMENT</h2>
        <p style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">Offline-First Academic Portal • Dhaka, Bangladesh</p>
        <span style="display: inline-block; background: #dc2626; color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 10px; border-radius: 9999px; margin-top: 6px;">
          DEBIT VOUCHER / EXPENSE RECEIPT (OFFICIAL)
        </span>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.75rem; color: #334155;">
        <div><strong>Voucher No:</strong> ${voucherNo}</div>
        <div><strong>Date:</strong> ${formattedDate} (${time})</div>
      </div>

      <table style="width: 100%; font-size: 0.82rem; margin-bottom: 1rem; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 0; color: #64748b;">Expense Category:</td>
          <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #004ac6;">${categoryName}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 0; color: #64748b;">Particulars / Description:</td>
          <td style="padding: 6px 0; font-weight: 500; text-align: right; max-width: 250px;">${description}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 0; color: #64748b;">Disbursement Method:</td>
          <td style="padding: 6px 0; font-weight: 600; text-align: right;">Cash / Institutional Account</td>
        </tr>
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 6px 0; color: #64748b;">Settlement Status:</td>
          <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #16a34a;">Approved & Settled</td>
        </tr>
      </table>

      <div style="background: #fef2f2; border: 1px solid #fee2e2; border-radius: 6px; padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <span style="font-weight: 700; font-size: 0.85rem; color: #1e293b;">Total Disbursed:</span>
        <span style="font-weight: 800; font-size: 1.2rem; color: #dc2626;">${formatCurrency(amount)}</span>
      </div>

      <div style="display: flex; justify-content: space-between; margin-top: 2rem; font-size: 0.75rem; color: #64748b; padding-top: 1rem; border-top: 1px dashed #e2e8f0;">
        <div style="text-align: center; width: 140px;">
          <div style="border-bottom: 1px solid #94a3b8; height: 30px;"></div>
          <div style="margin-top: 4px;">Paid To / Receiver</div>
        </div>
        <div style="text-align: center; width: 140px;">
          <div style="border-bottom: 1px solid #94a3b8; height: 30px;"></div>
          <div style="margin-top: 4px; font-weight: 600; color: #004ac6;">Authorized Signatory</div>
        </div>
      </div>
    </div>
  `;

  openModal('modal-print-expense-receipt');
}

// Global topbar & sidebar search listener, responsive mobile menu, dynamic dates
document.addEventListener('DOMContentLoaded', async () => {
  initDynamicDates();
  await loadAcademicYearContext();
  initSidebarControls();

  const searchInput = document.querySelector('.topbar-search input');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = searchInput.value.trim();
        if (val) {
          window.location.href = `students.html?search=${encodeURIComponent(val)}`;
        }
      }
    });
  }

  // Setup mobile navigation drawer and backdrop
  setupMobileNavigation();
});

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('[PWA] Service Worker registered with scope:', reg.scope);
    }).catch((err) => {
      console.warn('[PWA] Service Worker registration failed:', err);
    });
  });
}

function setupMobileNavigation() {
  const container = document.querySelector('.app-container');
  const sidebar = document.querySelector('.app-sidebar');
  const topbar = document.querySelector('.app-topbar');

  if (!container || !sidebar || !topbar) return;

  // Ensure backdrop exists
  let backdrop = document.querySelector('.sidebar-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    container.appendChild(backdrop);
  }

  // Ensure mobile toggle button exists in topbar
  let mobileBtn = document.querySelector('.mobile-menu-btn');
  if (!mobileBtn) {
    mobileBtn = document.createElement('button');
    mobileBtn.className = 'mobile-menu-btn';
    mobileBtn.setAttribute('aria-label', 'Toggle Navigation Menu');
    mobileBtn.innerHTML = '<span class="material-symbols-outlined">menu</span>';
    
    // Insert at beginning of topbar
    if (topbar.firstChild) {
      topbar.insertBefore(mobileBtn, topbar.firstChild);
    } else {
      topbar.appendChild(mobileBtn);
    }
  }

  const toggleSidebar = (open) => {
    const shouldOpen = open !== undefined ? open : !sidebar.classList.contains('open');
    if (shouldOpen) {
      sidebar.classList.add('open');
      backdrop.classList.add('active');
      document.body.style.overflow = 'hidden';
    } else {
      sidebar.classList.remove('open');
      backdrop.classList.remove('active');
      document.body.style.overflow = '';
    }
  };

  mobileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSidebar();
  });

  backdrop.addEventListener('click', () => {
    toggleSidebar(false);
  });

  // Close when clicking nav links on mobile
  const navLinks = sidebar.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        toggleSidebar(false);
      }
    });
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      toggleSidebar(false);
    }
  });

  // Auto-close on resize to desktop
  window.addEventListener('resize', debounce(() => {
    if (window.innerWidth > 1024 && sidebar.classList.contains('open')) {
      toggleSidebar(false);
    }
  }, 100));
}
