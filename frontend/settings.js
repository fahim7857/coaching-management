// Settings & Database Maintenance Frontend Logic
let classesList = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadSystemInfo();
  await loadClasses();
  await loadAcademicYears();
  setupEventListeners();
});

async function loadSystemInfo() {
  try {
    const res = await api.get('/settings/system');
    const sys = res.data;
    document.getElementById('sys-app-name').textContent = sys.appName;
    document.getElementById('sys-edition').textContent = sys.edition;
    document.getElementById('sys-runtime').textContent = sys.runtime;
    document.getElementById('sys-database').textContent = sys.database;
    document.getElementById('sys-db-size').textContent = sys.dbSize;
    document.getElementById('sys-last-sync').textContent = sys.lastModified;
  } catch (err) {
    console.error('Failed to load system info', err);
  }
}

async function loadClasses() {
  try {
    const selectedAy = getSelectedAcademicYear();
    const res = await api.get('/classes', { academic_year_id: selectedAy.id });
    classesList = res.data;
    renderClassesTable(classesList);
  } catch (err) {
    showToast('Failed to load classes: ' + err.message, 'error');
  }
}

function renderClassesTable(classes) {
  const tbody = document.getElementById('classes-settings-tbody');
  if (!tbody) return;

  tbody.innerHTML = classes.map(c => `
    <tr>
      <td style="font-weight: 700; color: #004ac6;">${c.name}</td>
      <td style="font-size: 0.8rem; color: #64748b;">Class #${c.class_number}</td>
      <td>
        <span class="badge-tag">${c.student_count || 0} Students</span>
      </td>
      <td style="font-weight: 700; color: #16a34a;">${formatCurrency(c.monthly_fee)} / mo</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-secondary btn-sm" onclick="openEditClassModal(${c.id}, '${c.name.replace(/'/g, "\\'")}', ${c.monthly_fee})">
          <span class="material-symbols-outlined" style="font-size: 1rem;">edit</span>
          Edit Fee
        </button>
        <button class="btn btn-secondary btn-sm" style="color: #dc2626;" title="Delete Class" onclick="deleteClass(${c.id}, '${c.name.replace(/'/g, "\\'")}', ${c.student_count || 0})">
          <span class="material-symbols-outlined" style="font-size: 1rem;">delete</span>
          Delete
        </button>
      </td>
    </tr>
  `).join('');
}

function setupEventListeners() {
  // Add Class Form
  const formAddClass = document.getElementById('form-add-class');
  if (formAddClass) {
    formAddClass.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      try {
        await api.post('/classes', {
          name: form.class_name.value,
          class_number: form.class_number.value,
          monthly_fee: form.monthly_fee.value
        });
        showToast('New class created successfully', 'success');
        closeModal('modal-add-class-dialog');
        form.reset();
        await loadClasses();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Edit Class Form
  const formEditClass = document.getElementById('form-edit-class');
  if (formEditClass) {
    formEditClass.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const id = form.class_id.value;
      try {
        await api.put(`/classes/${id}`, {
          name: form.class_name.value,
          monthly_fee: form.monthly_fee.value
        });
        showToast('Class fee updated successfully', 'success');
        closeModal('modal-edit-class-dialog');
        await loadClasses();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
}

function downloadDatabaseBackup() {
  window.location.href = '/api/backup';
  showToast('Database backup download initiated', 'success');
}

async function triggerDatabaseReseed() {
  if (!confirm('Are you sure you want to reset and re-seed the SQLite database with realistic default records? Current changes will be replaced.')) {
    return;
  }

  try {
    const res = await api.post('/seed', {});
    showToast(res.message, 'success');
    await loadSystemInfo();
    await loadClasses();
    await loadAcademicYears();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function clearOperationalData() {
  if (!confirm('This will permanently delete ALL students, payments, and expenses. Classes and academic year settings will stay. Continue?')) {
    return;
  }
  try {
    const res = await api.post('/reset-operational', {});
    showToast(res.message, 'success');
    await loadSystemInfo();
    await loadClasses();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAcademicYears() {
  const box = document.getElementById('academic-years-list');
  if (!box) return;
  try {
    const res = await api.get('/academic-years');
    const years = res.data || [];
    if (years.length === 0) {
      box.textContent = 'No academic years found.';
      return;
    }

    const activeYear = years.find(y => y.is_active) || years[0];
    const activeBadge = document.getElementById('settings-active-ay-badge');
    if (activeBadge) {
      activeBadge.textContent = `AY ${activeYear.year} Active`;
    }

    const newYearInput = document.getElementById('new-academic-year-input');
    if (newYearInput && (!newYearInput.value || newYearInput.value === '2027')) {
      newYearInput.value = activeYear.year + 1;
    }

    box.innerHTML = years.map(y => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.45rem 0; border-bottom: 1px solid #dbeafe;">
        <span style="font-weight: 600;">
          ${y.name || 'Academic Year ' + y.year}
          ${y.is_active ? '<span class="badge-tag" style="background:#dcfce7;color:#15803d;margin-left:6px;">● Active</span>' : ''}
        </span>
        <div style="display: flex; gap: 0.35rem; align-items: center;">
          ${y.is_active ? '' : `<button class="btn btn-secondary btn-sm" onclick="activateAcademicYear(${y.id})">Activate</button>`}
          ${y.is_active ? '' : `<button class="btn btn-secondary btn-sm" style="color: #dc2626;" title="Delete Academic Year" onclick="deleteAcademicYear(${y.id}, ${y.year})"><span class="material-symbols-outlined" style="font-size: 1rem;">delete</span></button>`}
        </div>
      </div>
    `).join('');
  } catch (err) {
    box.textContent = 'Could not load academic years.';
  }
}

async function createAcademicYear() {
  const input = document.getElementById('new-academic-year-input');
  const year = parseInt(input && input.value ? input.value : '', 10);
  if (!year) {
    showToast('Enter a valid year', 'error');
    return;
  }
  try {
    const res = await api.post('/academic-years', {
      year,
      name: `Academic Year ${year}`,
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`
    });
    showToast(res.message || `Academic Year ${year} created. Activate it to start enrolling students.`, 'success');
    await loadAcademicYearContext();
    await loadAcademicYears();
    await loadClasses();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function activateAcademicYear(id) {
  try {
    const res = await api.post(`/academic-years/${id}/activate`, {});
    showToast(res.message || 'Academic year activated', 'success');
    await loadAcademicYearContext();
    await loadAcademicYears();
    await loadClasses();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteAcademicYear(id, year) {
  if (!confirm(`Are you sure you want to permanently delete Academic Year ${year} and all its classes, student rosters, and ledgers? This action cannot be undone.`)) {
    return;
  }
  try {
    const res = await api.delete(`/academic-years/${id}`);
    showToast(res.message || `Academic Year ${year} deleted successfully`, 'success');
    await loadAcademicYearContext();
    await loadAcademicYears();
    await loadClasses();
  } catch (err) {
    showToast('Failed to delete academic year: ' + err.message, 'error');
  }
}

function openEditClassModal(id, name, fee) {
  const form = document.getElementById('form-edit-class');
  form.class_id.value = id;
  form.class_name.value = name;
  form.monthly_fee.value = fee;
  openModal('modal-edit-class-dialog');
}

async function deleteClass(id, name, studentCount) {
  const warningText = studentCount > 0 
    ? `\n\nWARNING: This class has ${studentCount} enrolled student(s). Deleting this class will permanently remove all those students and their payment history!`
    : '';

  if (!confirm(`Are you sure you want to permanently delete class "${name}"?${warningText}`)) {
    return;
  }

  try {
    const res = await api.delete(`/classes/${id}`);
    showToast(res.message || 'Class deleted successfully', 'success');
    await loadClasses();
  } catch (err) {
    showToast('Failed to delete class: ' + err.message, 'error');
  }
}
