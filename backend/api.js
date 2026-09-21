import express from 'express';
import { db, getNextRollNumber, seedDefaultDataIfEmpty, getMonthsList, DB_PATH, DB_DIR } from './database.js';
import fs from 'node:fs';
import path from 'node:path';

export const apiRouter = express.Router();

const MONTHS = getMonthsList();

export function getCurrentMonth() {
  const months = getMonthsList();
  return months[new Date().getMonth()];
}

export function getCurrentMonthIndex() {
  return new Date().getMonth();
}

export function getActiveAcademicYear() {
  const row = db.prepare('SELECT * FROM academic_years WHERE is_active = 1 ORDER BY year DESC LIMIT 1').get();
  if (row) return row;
  const fallback = db.prepare('SELECT * FROM academic_years ORDER BY year DESC LIMIT 1').get();
  if (fallback) return fallback;
  return { id: 1, year: new Date().getFullYear(), name: `Academic Year ${new Date().getFullYear()}`, is_active: 1 };
}

function getActiveAcademicYearId() {
  return getActiveAcademicYear().id;
}

// ----------------------------------------------------
// ACADEMIC YEARS
// ----------------------------------------------------
apiRouter.get('/academic-years', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM academic_years ORDER BY year DESC').all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.get('/academic-years/active', (req, res) => {
  try {
    const activeYear = getActiveAcademicYear();
    res.json({ success: true, data: activeYear });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/academic-years', (req, res) => {
  try {
    const { year, name, start_date, end_date, copy_classes_from } = req.body;
    if (!year || !name) {
      return res.status(400).json({ success: false, error: 'Year and name are required' });
    }

    const yearNum = parseInt(year, 10);
    const existing = db.prepare('SELECT id FROM academic_years WHERE year = ?').get(yearNum);
    if (existing) {
      return res.status(400).json({ success: false, error: `Academic Year ${yearNum} already exists` });
    }

    const startDate = start_date || `${yearNum}-01-01`;
    const endDate = end_date || `${yearNum}-12-31`;

    const insertYear = db.prepare(`
      INSERT INTO academic_years (year, name, start_date, end_date, is_active)
      VALUES (?, ?, ?, ?, 0)
    `);
    const result = insertYear.run(yearNum, name, startDate, endDate);
    const newYearId = Number(result.lastInsertRowid);

    // Fresh Class Structure for the new academic year
    // Do NOT copy any students, rolls, payments, or fee receipts!
    const sourceYearId = copy_classes_from ? parseInt(copy_classes_from, 10) : getActiveAcademicYearId();
    let sourceClasses = db.prepare('SELECT name, class_number, monthly_fee FROM classes WHERE academic_year_id = ? ORDER BY class_number ASC').all(sourceYearId);

    if (!sourceClasses || sourceClasses.length === 0) {
      sourceClasses = [
        { name: 'Class 3', class_number: 3, monthly_fee: 800 },
        { name: 'Class 4', class_number: 4, monthly_fee: 900 },
        { name: 'Class 5', class_number: 5, monthly_fee: 1000 },
        { name: 'Class 6', class_number: 6, monthly_fee: 1100 },
        { name: 'Class 7', class_number: 7, monthly_fee: 1200 }
      ];
    }

    const classInsert = db.prepare(`
      INSERT INTO classes (academic_year_id, name, class_number, monthly_fee)
      VALUES (?, ?, ?, ?)
    `);

    for (const c of sourceClasses) {
      classInsert.run(newYearId, c.name, c.class_number, c.monthly_fee);
    }

    res.json({
      success: true,
      message: `Fresh Academic Year ${yearNum} created with clean class structure`,
      data: { id: newYearId, year: yearNum, name }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.post('/academic-years/:id/activate', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const targetYear = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(id);
    if (!targetYear) {
      return res.status(404).json({ success: false, error: 'Academic year not found' });
    }

    db.prepare('UPDATE academic_years SET is_active = 0').run();
    db.prepare('UPDATE academic_years SET is_active = 1 WHERE id = ?').run(id);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('active_academic_year', String(targetYear.year));

    res.json({ success: true, message: `Academic Year ${targetYear.year} is now active`, data: targetYear });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.delete('/academic-years/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const yearRow = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(id);
    if (!yearRow) {
      return res.status(404).json({ success: false, error: 'Academic year not found' });
    }

    const totalYears = db.prepare('SELECT COUNT(*) as count FROM academic_years').get().count;
    if (totalYears <= 1) {
      return res.status(400).json({ success: false, error: 'Cannot delete the only academic year in the system' });
    }

    // Clean up all associated payments, students, and classes for this academic year
    db.prepare('DELETE FROM payments WHERE academic_year_id = ?').run(id);
    db.prepare('DELETE FROM students WHERE academic_year_id = ?').run(id);
    db.prepare('DELETE FROM classes WHERE academic_year_id = ?').run(id);
    db.prepare('DELETE FROM academic_years WHERE id = ?').run(id);

    // If active year was deleted, activate the latest remaining year
    if (yearRow.is_active) {
      const remaining = db.prepare('SELECT id, year FROM academic_years ORDER BY year DESC LIMIT 1').get();
      if (remaining) {
        db.prepare('UPDATE academic_years SET is_active = 1 WHERE id = ?').run(remaining.id);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('active_academic_year', String(remaining.year));
      }
    }

    res.json({
      success: true,
      message: `Academic Year ${yearRow.year} and all its associated data were deleted successfully`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// CLASSES
// ----------------------------------------------------
apiRouter.get('/classes', (req         , res          ) => {
  try {
    const academicYearId = req.query.academic_year_id ? parseInt(req.query.academic_year_id          , 10) : getActiveAcademicYearId();
    const classes = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as student_count
      FROM classes c
      WHERE c.academic_year_id = ?
      ORDER BY c.class_number ASC
    `).all(academicYearId);
    res.json({ success: true, data: classes });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/classes', (req         , res          ) => {
  try {
    const { academic_year_id, name, class_number, monthly_fee } = req.body;
    const ayId = academic_year_id ? parseInt(academic_year_id, 10) : getActiveAcademicYearId();
    const cNum = parseInt(class_number, 10);
    const fee = parseFloat(monthly_fee);

    if (!name || isNaN(cNum) || isNaN(fee) || fee <= 0) {
      return res.status(400).json({ success: false, error: 'Valid name, class number, and positive monthly fee required' });
    }

    const insert = db.prepare(`
      INSERT INTO classes (academic_year_id, name, class_number, monthly_fee)
      VALUES (?, ?, ?, ?)
    `);
    const resRow = insert.run(ayId, name, cNum, fee);
    res.json({ success: true, data: { id: Number(resRow.lastInsertRowid) } });
  } catch (error     ) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.put('/classes/:id', (req         , res          ) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, monthly_fee } = req.body;
    const fee = parseFloat(monthly_fee);
    if (isNaN(fee) || fee <= 0) {
      return res.status(400).json({ success: false, error: 'Monthly fee must be positive' });
    }

    db.prepare('UPDATE classes SET name = COALESCE(?, name), monthly_fee = ? WHERE id = ?').run(name, fee, id);
    res.json({ success: true, message: 'Class updated' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.delete('/classes/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid class ID' });
    }

    const cls = db.prepare('SELECT id, name FROM classes WHERE id = ?').get(id);
    if (!cls) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }

    // Delete associated payments first
    db.prepare('DELETE FROM payments WHERE class_id = ?').run(id);

    // Delete associated students
    db.prepare('DELETE FROM students WHERE class_id = ?').run(id);

    // Delete the class
    db.prepare('DELETE FROM classes WHERE id = ?').run(id);

    res.json({
      success: true,
      message: `Class "${cls.name}" and all associated student records were deleted successfully`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// STUDENTS & AUTOMATIC ROLL
// ----------------------------------------------------
apiRouter.get('/students/next-roll', (req         , res          ) => {
  try {
    const classId = parseInt(req.query.class_id          , 10);
    const ayId = req.query.academic_year_id ? parseInt(req.query.academic_year_id          , 10) : getActiveAcademicYearId();

    if (isNaN(classId)) {
      return res.status(400).json({ success: false, error: 'class_id is required' });
    }

    const nextRoll = getNextRollNumber(ayId, classId);
    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId)                                                     ;

    res.json({
      success: true,
      nextRoll,
      classFee: cls?.monthly_fee ?? 1000,
      className: cls?.name ?? ''
    });
  } catch (error     ) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.get('/students', (req         , res          ) => {
  try {
    const ayId = req.query.academic_year_id ? parseInt(req.query.academic_year_id          , 10) : getActiveAcademicYearId();
    const classFilter = req.query.class_id ? parseInt(req.query.class_id          , 10) : null;
    const statusFilter = req.query.status           || 'all';
    const paymentFilter = req.query.payment_status           || 'all';
    const search = (req.query.search           || '').trim().toLowerCase();
    const currentMonth = (req.query.month          ) || getCurrentMonth();

    let query = `
      SELECT s.*, c.name as class_name, c.class_number, c.monthly_fee, ay.year as academic_year,
        EXISTS (
          SELECT 1 FROM payments p 
          WHERE p.student_id = s.id 
            AND p.academic_year_id = s.academic_year_id 
            AND p.month = ?
        ) as is_paid_current_month
      FROM students s
      JOIN classes c ON s.class_id = c.id
      JOIN academic_years ay ON s.academic_year_id = ay.id
      WHERE s.academic_year_id = ?
    `;
    const params = [currentMonth, ayId];

    if (classFilter) {
      query += ' AND s.class_id = ?';
      params.push(classFilter);
    }

    if (statusFilter !== 'all') {
      query += ' AND s.status = ?';
      params.push(statusFilter);
    }

    if (search) {
      let searchRoll = null;
      const cleanSearch = search.replace(/^#/, '').trim();
      const stuMatch = cleanSearch.match(/^stu[-_]?(?:20\d{2})?[-_]?0*(\d+)$/i) || cleanSearch.match(/^stu[-_]?0*(\d+)$/i);
      if (stuMatch) {
        searchRoll = parseInt(stuMatch[1], 10);
      } else {
        const rawDigits = cleanSearch.replace(/[^0-9]/g, '');
        if (rawDigits.length > 0 && rawDigits.length <= 6) {
          searchRoll = parseInt(rawDigits, 10);
        }
      }

      query += ` AND (
        LOWER(s.name) LIKE ? OR 
        CAST(s.roll_number AS TEXT) LIKE ? OR 
        s.phone LIKE ? OR 
        LOWER(s.father_name) LIKE ? OR
        LOWER(s.mother_name) LIKE ? OR
        ('stu-' || ay.year || '-' || substr('0000' || s.roll_number, -4)) LIKE ? OR
        ('stu-' || substr('0000' || s.roll_number, -4)) LIKE ? OR
        ('stu-' || s.roll_number) LIKE ?
      `;
      const wild = `%${cleanSearch}%`;
      params.push(wild, wild, wild, wild, wild, wild, wild, wild);

      if (searchRoll !== null) {
        query += ` OR s.roll_number = ?`;
        params.push(searchRoll);
      }
      query += ` )`;
    }

    query += ' ORDER BY c.class_number ASC, s.roll_number ASC';

    const rows = db.prepare(query).all(...params);

    // Process payment filter and format response
    const results = rows.map(s => {
      const isPaid = Boolean(s.is_paid_current_month);
      return {
        ...s,
        display_roll: `#${s.roll_number}`,
        current_month_status: isPaid ? 'Paid' : 'Due'
      };
    }).filter(s => {
      if (paymentFilter === 'all') return true;
      if (paymentFilter === 'Paid') return s.current_month_status === 'Paid';
      if (paymentFilter === 'Due') return s.current_month_status === 'Due';
      return true;
    });

    res.json({
      success: true,
      data: results,
      total: results.length,
      currentMonth
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.get('/students/lookup', (req, res) => {
  try {
    const query = (((req.query.query) || (req.query.q) || '')).trim();
    const classId = req.query.class_id ? parseInt(req.query.class_id, 10) : null;
    const currentMonth = (req.query.month) || getCurrentMonth();

    if (!query && !classId) {
      return res.json({ success: true, students: [], exactMatch: null });
    }

    let sql = `
      SELECT s.*, c.name as class_name, c.class_number, c.monthly_fee, ay.year as academic_year
      FROM students s
      JOIN classes c ON s.class_id = c.id
      JOIN academic_years ay ON s.academic_year_id = ay.id
      WHERE 1=1
    `;
    const params = [];

    if (classId) {
      sql += ' AND s.class_id = ?';
      params.push(classId);
    }

    let parsedRoll = null;
    let cleanStuQuery = query.replace(/^#/, '').trim();
    if (cleanStuQuery) {
      const stuMatch = cleanStuQuery.match(/^stu[-_]?(?:20\d{2})?[-_]?0*(\d+)$/i) || cleanStuQuery.match(/^stu[-_]?0*(\d+)$/i);
      if (stuMatch) {
        parsedRoll = parseInt(stuMatch[1], 10);
      } else {
        const pureDigits = cleanStuQuery.replace(/[^0-9]/g, '');
        if (pureDigits.length > 0 && pureDigits.length <= 5) {
          parsedRoll = parseInt(pureDigits, 10);
        }
      }

      sql += ` AND (
        LOWER(s.name) LIKE ? OR 
        LOWER(s.father_name) LIKE ? OR 
        s.phone LIKE ? OR 
        CAST(s.roll_number AS TEXT) LIKE ? OR
        ('stu-' || ay.year || '-' || substr('0000' || s.roll_number, -4)) LIKE ? OR
        ('stu-' || substr('0000' || s.roll_number, -4)) LIKE ? OR
        ('stu-' || s.roll_number) LIKE ?
      `;
      const wild = `%${cleanStuQuery.toLowerCase()}%`;
      params.push(wild, wild, wild, wild, wild, wild, wild);

      if (parsedRoll !== null) {
        sql += ` OR s.roll_number = ?`;
        params.push(parsedRoll);
      }
      sql += ` )`;
    }

    if (cleanStuQuery) {
      sql += ' ORDER BY c.class_number ASC, s.roll_number ASC LIMIT 30';
    } else {
      sql += ' ORDER BY s.roll_number ASC LIMIT 200';
    }

    const students = db.prepare(sql).all(...params);

    const enriched = students.map(st => {
      const payment = db.prepare(`
        SELECT * FROM payments 
        WHERE student_id = ? AND month = ? AND academic_year_id = ?
        LIMIT 1
      `).get(st.id, currentMonth, st.academic_year_id);

      return {
        ...st,
        system_id: `STU-${st.academic_year}-${String(st.roll_number).padStart(4, '0')}`,
        current_month_status: payment ? 'Paid' : 'Due',
        payment: payment || null
      };
    });

    // Determine exact match if user typed an exact roll or student ID
    let exactMatch = null;
    if (cleanStuQuery) {
      const lowerQ = cleanStuQuery.toLowerCase();
      exactMatch = enriched.find(s => 
        s.system_id.toLowerCase() === lowerQ || 
        String(s.roll_number) === cleanStuQuery ||
        (parsedRoll !== null && s.roll_number === parsedRoll && (!classId || s.class_id === classId))
      ) || null;

      if (!exactMatch) {
        exactMatch = enriched.find(s => s.name.toLowerCase() === lowerQ) || null;
      }
      if (!exactMatch && enriched.length === 1 && cleanStuQuery.length >= 2) {
        exactMatch = enriched[0];
      }
    }

    res.json({
      success: true,
      students: enriched,
      exactMatch
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.get('/students/:id', (req         , res          ) => {
  try {
    const id = parseInt(req.params.id, 10);
    const student = db.prepare(`
      SELECT s.*, c.name as class_name, c.class_number, c.monthly_fee, ay.year as academic_year
      FROM students s
      JOIN classes c ON s.class_id = c.id
      JOIN academic_years ay ON s.academic_year_id = ay.id
      WHERE s.id = ?
    `).get(id)       ;

    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    // Get all payments for this student
    const payments = db.prepare(`
      SELECT * FROM payments 
      WHERE student_id = ? AND academic_year_id = ?
      ORDER BY payment_date DESC, id DESC
    `).all(id, student.academic_year_id)         ;

    const paymentsByMonth = new Map             ();
    payments.forEach(p => paymentsByMonth.set(p.month, p));

    // Calculate month-by-month status for 12 months
    const admDate = new Date(student.admission_date);
    const admMonthIndex = isNaN(admDate.getTime()) ? 0 : admDate.getMonth(); // 0 = Jan
    const currentMonthIndex = getCurrentMonthIndex();

    let totalPaid = 0;
    let totalDue = 0;
    let paidCount = 0;
    let dueCount = 0;

    const monthlyBreakdown = MONTHS.map((monthName, idx) => {
      const payment = paymentsByMonth.get(monthName);
      let status                                                ;

      if (idx < admMonthIndex) {
        status = 'NOT_APPLICABLE';
      } else if (payment) {
        status = 'PAID';
        totalPaid += payment.amount;
        paidCount++;
      } else if (idx <= currentMonthIndex) {
        status = 'DUE';
        totalDue += student.monthly_fee;
        dueCount++;
      } else {
        status = 'UPCOMING';
      }

      return {
        month: monthName,
        monthIndex: idx + 1,
        status,
        payment: payment || null,
        fee: student.monthly_fee
      };
    });

    res.json({
      success: true,
      data: {
        student: {
          ...student,
          display_roll: `#${student.roll_number}`
        },
        summary: {
          totalPaid,
          totalDue,
          paidCount,
          dueCount,
          monthlyFee: student.monthly_fee
        },
        monthlyBreakdown,
        payments
      }
    });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/students', (req         , res          ) => {
  try {
    const {
      name,
      father_name,
      mother_name,
      phone,
      address,
      class_id,
      admission_date,
      academic_year_id,
      photo_url
    } = req.body;

    if (!name || !phone || !class_id) {
      return res.status(400).json({ success: false, error: 'Student Name, Phone and Class are required' });
    }

    const ayId = academic_year_id ? parseInt(academic_year_id, 10) : getActiveAcademicYearId();
    const classId = parseInt(class_id, 10);
    const admDate = admission_date || new Date().toISOString().split('T')[0];

    // Auto generate next roll inside transaction
    const nextRoll = getNextRollNumber(ayId, classId);

    const insert = db.prepare(`
      INSERT INTO students (
        academic_year_id, class_id, roll_number, name, father_name, mother_name,
        phone, address, admission_date, status, photo_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)
    `);

    const result = insert.run(
      ayId,
      classId,
      nextRoll,
      name.trim(),
      father_name?.trim() || 'N/A',
      mother_name?.trim() || 'N/A',
      phone.trim(),
      address?.trim() || '',
      admDate,
      photo_url || null
    );

    res.json({
      success: true,
      data: {
        id: Number(result.lastInsertRowid),
        roll_number: nextRoll,
        display_roll: `#${nextRoll}`,
        name
      }
    });
  } catch (error     ) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.put('/students/:id', (req         , res          ) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, father_name, mother_name, phone, address, status, admission_date } = req.body;

    db.prepare(`
      UPDATE students SET 
        name = COALESCE(?, name),
        father_name = COALESCE(?, father_name),
        mother_name = COALESCE(?, mother_name),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        status = COALESCE(?, status),
        admission_date = COALESCE(?, admission_date),
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(name, father_name, mother_name, phone, address, status, admission_date, id);

    res.json({ success: true, message: 'Student records updated' });
  } catch (error     ) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.patch('/students/:id/status', (req         , res          ) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!status || !['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be Active or Inactive' });
    }

    db.prepare('UPDATE students SET status = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(status, id);
    res.json({ success: true, message: `Student marked as ${status}` });
  } catch (error     ) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.delete('/students/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid student ID' });
    }

    const student = db.prepare('SELECT id, name, roll_number FROM students WHERE id = ?').get(id);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    // Delete associated payments first to prevent foreign key restrict violations
    db.prepare('DELETE FROM payments WHERE student_id = ?').run(id);

    // Delete student record
    db.prepare('DELETE FROM students WHERE id = ?').run(id);

    res.json({
      success: true,
      message: `Student "${student.name}" (Roll #${student.roll_number}) and all payment history were deleted successfully`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// PAYMENTS & RECEIPT
// ----------------------------------------------------
apiRouter.get('/payments', (req         , res          ) => {
  try {
    const ayId = req.query.academic_year_id ? parseInt(req.query.academic_year_id          , 10) : getActiveAcademicYearId();
    const classId = req.query.class_id ? parseInt(req.query.class_id          , 10) : null;
    const month = req.query.month           || null;
    const studentSearch = (req.query.search           || '').trim().toLowerCase();
    const startDate = req.query.startDate           || null;
    const endDate = req.query.endDate           || null;

    let query = `
      SELECT p.*, s.name as student_name, s.roll_number, s.phone as student_phone,
        c.name as class_name, c.class_number
      FROM payments p
      JOIN students s ON p.student_id = s.id
      JOIN classes c ON p.class_id = c.id
      WHERE p.academic_year_id = ?
    `;
    const params        = [ayId];

    if (classId) {
      query += ' AND p.class_id = ?';
      params.push(classId);
    }
    if (month && month !== 'all') {
      query += ' AND p.month = ?';
      params.push(month);
    }
    if (startDate) {
      query += ' AND p.payment_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND p.payment_date <= ?';
      params.push(endDate);
    }
    if (studentSearch) {
      query += ' AND (LOWER(s.name) LIKE ? OR CAST(s.roll_number AS TEXT) LIKE ? OR p.receipt_no LIKE ?)';
      const wild = `%${studentSearch}%`;
      params.push(wild, wild, wild);
    }

    query += ' ORDER BY p.payment_date DESC, p.id DESC';

    const rows = db.prepare(query).all(...params)         ;
    res.json({ success: true, data: rows });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/payments', (req         , res          ) => {
  try {
    const { student_id, month, payment_method, note, payment_date, payment_time } = req.body;
    if (!student_id || !month) {
      return res.status(400).json({ success: false, error: 'Student and billing month are required' });
    }

    const studentId = parseInt(student_id, 10);
    const student = db.prepare(`
      SELECT s.*, c.monthly_fee, c.name as class_name, ay.year as academic_year
      FROM students s
      JOIN classes c ON s.class_id = c.id
      JOIN academic_years ay ON s.academic_year_id = ay.id
      WHERE s.id = ?
    `).get(studentId)       ;

    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }

    // Check duplicate payment constraint: student + month + academic_year
    const existing = db.prepare(`
      SELECT * FROM payments 
      WHERE student_id = ? AND month = ? AND academic_year_id = ?
    `).get(studentId, month, student.academic_year_id)       ;

    if (existing) {
      return res.status(400).json({
        success: false,
        error: `Fee for ${month} has already been paid on ${existing.payment_date} (Receipt ${existing.receipt_no}). Duplicate payment rejected.`
      });
    }

    // Determine current date and time
    const now = new Date();
    const dateStr = payment_date || now.toISOString().split('T')[0];
    const timeStr = payment_time || now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Generate unique receipt number
    const maxRec = db.prepare("SELECT COUNT(*) as cnt FROM payments").get()                   ;
    const receiptNo = `REC-${student.academic_year}-${String(1000 + maxRec.cnt + 1).padStart(4, '0')}`;

    const rawAmount = req.body.amount !== undefined ? parseFloat(req.body.amount) : student.monthly_fee;
    const finalAmount = (!isNaN(rawAmount) && rawAmount > 0) ? rawAmount : student.monthly_fee;

    const insert = db.prepare(`
      INSERT INTO payments (
        student_id, academic_year_id, class_id, month, year, amount,
        payment_date, payment_time, payment_method, receipt_no, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      studentId,
      student.academic_year_id,
      student.class_id,
      month,
      student.academic_year,
      finalAmount,
      dateStr,
      timeStr,
      payment_method || 'Cash',
      receiptNo,
      note || 'Monthly tuition fee'
    );

    res.json({
      success: true,
      message: `Payment of ৳${finalAmount} recorded successfully`,
      data: {
        paymentId: Number(result.lastInsertRowid),
        receiptNo,
        studentName: student.name,
        roll: student.roll_number,
        month,
        amount: finalAmount,
        date: dateStr,
        time: timeStr
      }
    });
  } catch (error     ) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// MONTHLY OVERVIEW (12-MONTH MATRIX & DUE LIST)
// ----------------------------------------------------
apiRouter.get('/overview/matrix', (req         , res          ) => {
  try {
    const ayId = req.query.academic_year_id ? parseInt(req.query.academic_year_id          , 10) : getActiveAcademicYearId();
    let classId = req.query.class_id ? parseInt(req.query.class_id          , 10) : null;
    const targetMonth = (req.query.month          ) || getCurrentMonth();

    // If no classId provided, default to Class 5 (as in screenshot) or first class
    if (!classId) {
      const cls5 = db.prepare("SELECT id FROM classes WHERE academic_year_id = ? AND class_number = 5").get(ayId)                              ;
      if (cls5) {
        classId = cls5.id;
      } else {
        const firstCls = db.prepare("SELECT id FROM classes WHERE academic_year_id = ? ORDER BY class_number ASC LIMIT 1").get(ayId)                              ;
        classId = firstCls ? firstCls.id : 1;
      }
    }

    const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId)       ;
    if (!cls) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }

    // Get all students in this class
    const students = db.prepare(`
      SELECT s.* FROM students s
      WHERE s.class_id = ? AND s.academic_year_id = ?
      ORDER BY s.roll_number ASC
    `).all(classId, ayId)         ;

    // Get all payments for this class and year
    const payments = db.prepare(`
      SELECT * FROM payments
      WHERE class_id = ? AND academic_year_id = ?
    `).all(classId, ayId)         ;

    const payMap = new Map             (); // key: `${student_id}_${month}`
    payments.forEach(p => {
      payMap.set(`${p.student_id}_${p.month}`, p);
    });

    const targetMonthIdx = MONTHS.indexOf(targetMonth);
    const activeTargetIdx = targetMonthIdx >= 0 ? targetMonthIdx : 8; // default Sep = 8

    let totalEnrolled = students.length;
    let targetClearedCount = 0;
    let targetDueCount = 0;
    let grossCollectedTargetMonth = 0;
    let expectedTargetAmount = totalEnrolled * cls.monthly_fee;

    const rows = students.map(st => {
      const admDate = new Date(st.admission_date);
      const admMonthIdx = isNaN(admDate.getTime()) ? 0 : admDate.getMonth();

      const monthsStatus                      = {};

      MONTHS.forEach((mName, mIdx) => {
        const payment = payMap.get(`${st.id}_${mName}`);
        if (mIdx < admMonthIdx) {
          monthsStatus[mName] = { status: 'NOT_APPLICABLE', label: '—' };
        } else if (payment) {
          monthsStatus[mName] = { status: 'PAID', label: `✓ ৳${cls.monthly_fee / 1000}k`, receipt: payment.receipt_no, amount: payment.amount, date: payment.payment_date };
        } else if (mIdx <= activeTargetIdx) {
          monthsStatus[mName] = { status: 'DUE', label: 'DUE', amount: cls.monthly_fee };
        } else {
          monthsStatus[mName] = { status: 'UPCOMING', label: '—' };
        }
      });

      const targetCell = monthsStatus[targetMonth];
      if (targetCell?.status === 'PAID') {
        targetClearedCount++;
        grossCollectedTargetMonth += cls.monthly_fee;
      } else if (targetCell?.status === 'DUE') {
        targetDueCount++;
      }

      return {
        id: st.id,
        roll: st.roll_number,
        display_roll: `#${st.roll_number}`,
        name: st.name,
        phone: st.phone,
        father: st.father_name,
        status: st.status,
        monthly_fee: cls.monthly_fee,
        months: monthsStatus
      };
    });

    const clearedPercent = totalEnrolled > 0 ? ((targetClearedCount / totalEnrolled) * 100).toFixed(1) : '0';
    const duePercent = totalEnrolled > 0 ? ((targetDueCount / totalEnrolled) * 100).toFixed(1) : '0';
    const unsettledAmount = expectedTargetAmount - grossCollectedTargetMonth;

    res.json({
      success: true,
      classInfo: cls,
      targetMonth,
      stats: {
        totalEnrolled,
        clearedCount: targetClearedCount,
        clearedPercent: parseFloat(clearedPercent),
        dueCount: targetDueCount,
        duePercent: parseFloat(duePercent),
        grossCollected: grossCollectedTargetMonth,
        expectedTarget: expectedTargetAmount,
        unsettledAmount
      },
      rows
    });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.get('/overview/due-list', (req         , res          ) => {
  try {
    const ayId = req.query.academic_year_id ? parseInt(req.query.academic_year_id          , 10) : getActiveAcademicYearId();
    const classId = req.query.class_id ? parseInt(req.query.class_id          , 10) : null;
    const targetMonth = (req.query.month          ) || getCurrentMonth();

    let query = `
      SELECT s.id, s.roll_number, s.name, s.phone, s.admission_date, c.id as class_id, c.name as class_name, c.monthly_fee
      FROM students s
      JOIN classes c ON s.class_id = c.id
      WHERE s.academic_year_id = ? 
        AND NOT EXISTS (
          SELECT 1 FROM payments p 
          WHERE p.student_id = s.id 
            AND p.month = ? 
            AND p.academic_year_id = ?
        )
    `;
    const params        = [ayId, targetMonth, ayId];

    if (classId) {
      query += ' AND s.class_id = ?';
      params.push(classId);
    }

    query += ' ORDER BY c.class_number ASC, s.roll_number ASC';

    const rows = db.prepare(query).all(...params)         ;

    // Calculate total due months for each student
    const targetMonthIdx = MONTHS.indexOf(targetMonth);
    const results = rows.map(st => {
      const admDate = new Date(st.admission_date);
      const admMonthIdx = isNaN(admDate.getTime()) ? 0 : admDate.getMonth();

      // Check how many months between admission and target are unpaid
      let unpaidMonths           = [];
      for (let i = admMonthIdx; i <= targetMonthIdx; i++) {
        const m = MONTHS[i];
        const paid = db.prepare('SELECT 1 FROM payments WHERE student_id = ? AND month = ? AND academic_year_id = ?').get(st.id, m, ayId);
        if (!paid) {
          unpaidMonths.push(m);
        }
      }

      return {
        ...st,
        display_roll: `#${st.roll_number}`,
        targetMonth,
        unpaidMonthsCount: unpaidMonths.length,
        unpaidMonths,
        totalDueAmount: unpaidMonths.length * st.monthly_fee
      };
    });

    res.json({
      success: true,
      targetMonth,
      totalDueStudents: results.length,
      data: results
    });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// EXPENSES & CATEGORIES
// ----------------------------------------------------
const getExpenseCategoriesHandler = (req         , res          ) => {
  try {
    const rows = db.prepare(`
      SELECT ec.*, 
        COUNT(e.id) as expense_count,
        COALESCE(SUM(e.amount), 0) as total_amount
      FROM expense_categories ec
      LEFT JOIN expenses e ON ec.id = e.category_id
      GROUP BY ec.id
      ORDER BY CASE WHEN LOWER(TRIM(ec.name)) IN ('other', 'others') THEN 1 ELSE 0 END ASC, ec.name ASC
    `).all();
    res.json({ success: true, data: rows });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
};

apiRouter.get('/expense-categories', getExpenseCategoriesHandler);
apiRouter.get('/expenses/categories', getExpenseCategoriesHandler);

const postExpenseCategoriesHandler = (req         , res          ) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const insert = db.prepare('INSERT INTO expense_categories (name, is_default) VALUES (?, 0)');
    const resRow = insert.run(name.trim());
    res.json({ success: true, data: { id: Number(resRow.lastInsertRowid), name: name.trim() } });
  } catch (error     ) {
    res.status(400).json({ success: false, error: error.message });
  }
};

apiRouter.post('/expense-categories', postExpenseCategoriesHandler);
apiRouter.post('/expenses/categories', postExpenseCategoriesHandler);

apiRouter.get('/expenses', (req         , res          ) => {
  try {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id          , 10) : null;
    const startDate = req.query.startDate           || null;
    const endDate = req.query.endDate           || null;
    const search = (req.query.search           || '').trim().toLowerCase();

    let query = `
      SELECT e.*, ec.name as category_name
      FROM expenses e
      JOIN expense_categories ec ON e.category_id = ec.id
      WHERE 1=1
    `;
    const params        = [];

    if (categoryId) {
      query += ' AND e.category_id = ?';
      params.push(categoryId);
    }
    if (startDate) {
      query += ' AND e.expense_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND e.expense_date <= ?';
      params.push(endDate);
    }
    if (search) {
      query += ' AND (LOWER(e.description) LIKE ? OR LOWER(ec.name) LIKE ? OR e.voucher_no LIKE ?)';
      const wild = `%${search}%`;
      params.push(wild, wild, wild);
    }

    query += ' ORDER BY e.expense_date DESC, e.id DESC';

    const rows = db.prepare(query).all(...params);
    res.json({ success: true, data: rows });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/expenses', (req         , res          ) => {
  try {
    const { category_id, amount, description, expense_date, expense_time } = req.body;
    const amt = parseFloat(amount);
    const catId = parseInt(category_id, 10);

    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ success: false, error: 'Valid positive amount required' });
    }
    if (!catId || !description) {
      return res.status(400).json({ success: false, error: 'Category and description are required' });
    }

    const now = new Date();
    const dateStr = expense_date || now.toISOString().split('T')[0];
    const timeStr = expense_time || now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Auto voucher number
    const maxVoucher = db.prepare('SELECT COUNT(*) as count FROM expenses').get()                     ;
    const voucherNo = `V-${String(100 + maxVoucher.count + 1)}`;

    const insert = db.prepare(`
      INSERT INTO expenses (category_id, amount, description, expense_date, expense_time, voucher_no)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(catId, amt, description.trim(), dateStr, timeStr, voucherNo);
    const cat = db.prepare('SELECT name FROM expense_categories WHERE id = ?').get(catId);
    res.json({
      success: true,
      data: {
        id: Number(result.lastInsertRowid),
        voucher_no: voucherNo,
        voucherNo,
        category_id: catId,
        category_name: cat ? cat.name : 'General Expense',
        amount: amt,
        description: description.trim(),
        expense_date: dateStr,
        expense_time: timeStr
      }
    });
  } catch (error     ) {
    res.status(400).json({ success: false, error: error.message });
  }
});

apiRouter.get('/expenses/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const expense = db.prepare(`
      SELECT e.*, ec.name as category_name
      FROM expenses e
      JOIN expense_categories ec ON e.category_id = ec.id
      WHERE e.id = ?
    `).get(id);
    if (!expense) {
      return res.status(404).json({ success: false, error: 'Expense not found' });
    }
    res.json({ success: true, data: expense });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.get('/expense-categories/:id/details', (req         , res          ) => {
  try {
    const id = parseInt(req.params.id, 10);
    const category = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(id);
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    const items = db.prepare(`
      SELECT * FROM expenses WHERE category_id = ? ORDER BY expense_date DESC, id DESC
    `).all(id);

    res.json({ success: true, category, data: items });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.delete('/expenses/:id', (req         , res          ) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    res.json({ success: true, message: 'Expense voucher deleted successfully' });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.delete('/payments/:id', (req         , res          ) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM payments WHERE id = ?').run(id);
    res.json({ success: true, message: 'Payment record deleted successfully' });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// FINANCIAL DASHBOARD (DYNAMIC SQLite CALCULATIONS)
// ----------------------------------------------------
apiRouter.get('/dashboard', (req, res) => {
  try {
    const ayId = req.query.academic_year_id ? parseInt(req.query.academic_year_id, 10) : getActiveAcademicYearId();
    const ayRow = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(ayId) || getActiveAcademicYear();
    const currentAcademicYear = ayRow.year;

    // Dynamic dates
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const weekStart = monday.toISOString().split('T')[0];
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const yearStart = `${currentAcademicYear}-01-01`;

    // Income calculations
    const todayIncomeRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(id) as count
      FROM payments WHERE academic_year_id = ? AND payment_date = ?
    `).get(ayId, today)                                    ;

    const weekIncomeRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM payments WHERE academic_year_id = ? AND payment_date >= ? AND payment_date <= ?
    `).get(ayId, weekStart, today)                     ;

    const monthIncomeRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(id) as count
      FROM payments WHERE academic_year_id = ? AND payment_date >= ? AND payment_date <= ?
    `).get(ayId, monthStart, today)                                    ;

    const overallIncomeRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM payments WHERE academic_year_id = ?
    `).get(ayId)                     ;

    // Expense calculations
    const todayExpenseRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(id) as count
      FROM expenses WHERE expense_date = ?
    `).get(today)                                    ;

    const weekExpenseRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expenses WHERE expense_date >= ? AND expense_date <= ?
    `).get(weekStart, today)                     ;

    const monthExpenseRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expenses WHERE expense_date >= ? AND expense_date <= ?
    `).get(monthStart, today)                     ;

    const overallExpenseRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM expenses
    `).get()                     ;

    // Student counts
    const totalStudents = db.prepare('SELECT COUNT(*) as count FROM students WHERE academic_year_id = ?').get(ayId)                     ;
    const activeClasses = db.prepare('SELECT COUNT(*) as count FROM classes WHERE academic_year_id = ?').get(ayId)                     ;

    // Target month for dashboard analysis (defaults to current month)
    const activeMonth = (req.query.month) || getCurrentMonth();

    // Due students count in current active month
    const dueCountRow = db.prepare(`
      SELECT COUNT(*) as count FROM students s
      WHERE s.academic_year_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM payments p 
          WHERE p.student_id = s.id AND p.month = ? AND p.academic_year_id = s.academic_year_id
        )
    `).get(ayId, activeMonth);

    // Net balance calculations: Net = Income - Expense
    const todayNet = todayIncomeRow.total - todayExpenseRow.total;
    const weekNet = weekIncomeRow.total - weekExpenseRow.total;
    const monthNet = monthIncomeRow.total - monthExpenseRow.total;
    const overallNet = overallIncomeRow.total - overallExpenseRow.total;

    // Class Overview & Collection Rates
    const classes = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as student_count,
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.class_id = c.id AND p.month = ?) as collected_amount
      FROM classes c
      WHERE c.academic_year_id = ?
      ORDER BY c.class_number ASC
    `).all(activeMonth, ayId);

    let totalProjected = 0;
    let totalCollectedSeptember = 0;

    const classOverview = classes.map(c => {
      const students = c.student_count || 0;
      const expected = students * c.monthly_fee;
      const collected = c.collected_amount || 0;
      const due = Math.max(0, expected - collected);
      const recoveryRate = expected > 0 ? ((collected / expected) * 100).toFixed(1) : '100';

      totalProjected += expected;
      totalCollectedSeptember += collected;

      return {
        id: c.id,
        name: c.name,
        class_number: c.class_number,
        students,
        monthly_fee: c.monthly_fee,
        expected,
        collected,
        due,
        recoveryRate: parseFloat(recoveryRate)
      };
    });

    const aggregateEfficiency = totalProjected > 0 ? ((totalCollectedSeptember / totalProjected) * 100).toFixed(1) : '0';

    // All due students for current active month
    const priorityDue = db.prepare(`
      SELECT s.id, s.roll_number, s.name, c.name as class_name, c.class_number, c.monthly_fee
      FROM students s
      JOIN classes c ON s.class_id = c.id
      WHERE s.academic_year_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.student_id = s.id AND p.month = ? AND p.academic_year_id = s.academic_year_id
        )
      ORDER BY c.class_number ASC, s.roll_number ASC
    `).all(ayId, activeMonth);

    const dueUnpaidTotal = priorityDue.reduce((sum, st) => sum + (st.monthly_fee || 0), 0);

    // Recent Transactions audit trail (latest payments & expenses combined)
    const recentPayments = db.prepare(`
      SELECT p.id, p.amount, p.payment_date as date, p.payment_time as time, p.receipt_no as ref_no,
        p.created_at, s.name as student_name, c.name as class_name, p.month
      FROM payments p
      LEFT JOIN students s ON p.student_id = s.id
      LEFT JOIN classes c ON p.class_id = c.id
      WHERE p.academic_year_id = ?
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT 15
    `).all(ayId)         ;

    const recentExpenses = db.prepare(`
      SELECT e.id, e.amount, e.expense_date as date, e.expense_time as time, e.voucher_no as ref_no,
        e.created_at, e.description, COALESCE(ec.name, 'Expense') as category_name
      FROM expenses e
      LEFT JOIN expense_categories ec ON e.category_id = ec.id
      ORDER BY e.expense_date DESC, e.id DESC
      LIMIT 15
    `).all()         ;

    const toSortKey = (row) => {
      const datePart = String(row.date || row.created_at || '').slice(0, 10);
      const created = String(row.created_at || '');
      return `${datePart} ${created} ${String(row.id).padStart(8, '0')}`;
    };

    const recentTransactions = [
      ...recentPayments.map(p => ({
        id: `p-${p.id}`,
        title: `${p.student_name || 'Student'} - ${p.class_name || 'Class'} ${p.month || ''} Fee`.trim(),
        subtitle: `Receipt #${p.ref_no || p.id}`,
        amount: p.amount,
        type: 'income',
        date: p.date,
        time: p.time || '',
        sortKey: toSortKey(p)
      })),
      ...recentExpenses.map(e => ({
        id: `e-${e.id}`,
        title: `${e.category_name} - ${e.description}`,
        subtitle: `Voucher #${e.ref_no || e.id}`,
        amount: e.amount,
        type: 'expense',
        date: e.date,
        time: e.time || '',
        sortKey: toSortKey(e)
      }))
    ].sort((a, b) => b.sortKey.localeCompare(a.sortKey)).slice(0, 20);

    // Monthly chart from real income (payments) and expenses
    const chartMonthMeta = [
      { key: 'January', short: 'Jan', num: '01' },
      { key: 'February', short: 'Feb', num: '02' },
      { key: 'March', short: 'Mar', num: '03' },
      { key: 'April', short: 'Apr', num: '04' },
      { key: 'May', short: 'May', num: '05' },
      { key: 'June', short: 'Jun', num: '06' },
      { key: 'July', short: 'Jul', num: '07' },
      { key: 'August', short: 'Aug', num: '08' },
      { key: 'September', short: 'Sep', num: '09' },
      { key: 'October', short: 'Oct', num: '10' },
      { key: 'November', short: 'Nov', num: '11' },
      { key: 'December', short: 'Dec', num: '12' }
    ];

    const incomeByMonthStmt = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE academic_year_id = ? AND month = ?
    `);
    const expenseByMonthStmt = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE strftime('%m', expense_date) = ?
    `);

    const chartData = chartMonthMeta.map(m => {
      const income = incomeByMonthStmt.get(ayId, m.key).total;
      const expense = expenseByMonthStmt.get(m.num).total;
      const net = income - expense;
      const margin = income > 0 ? parseFloat(((net / income) * 100).toFixed(1)) : 0;
      return { month: m.short, income, expense, net, margin };
    });

    res.json({
      success: true,
      academicYear: currentAcademicYear,
      stats: {
        totalStudents: totalStudents.count,
        activeStudents: totalStudents.count,
        activeClasses: activeClasses.count,
        dueStudentsCount: dueCountRow.count,
        today: {
          income: todayIncomeRow.total,
          paymentsCount: todayIncomeRow.count,
          expense: todayExpenseRow.total,
          vouchersCount: todayExpenseRow.count,
          net: todayNet,
          margin: todayIncomeRow.total > 0 ? ((todayNet / todayIncomeRow.total) * 100).toFixed(1) : '0'
        },
        weekly: {
          income: weekIncomeRow.total,
          expense: weekExpenseRow.total,
          net: weekNet
        },
        monthly: {
          income: monthIncomeRow.total,
          expense: monthExpenseRow.total,
          net: monthNet
        },
        overall: {
          income: overallIncomeRow.total,
          expense: overallExpenseRow.total,
          net: overallNet
        }
      },
      classOverview: {
        classes: classOverview,
        totalProjected,
        totalCollectedSeptember,
        aggregateEfficiency: parseFloat(aggregateEfficiency)
      },
      priorityDue,
      dueUnpaidTotal,
      recentTransactions,
      chartData
    });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// REPORTS
// ----------------------------------------------------
apiRouter.get('/reports/summary', (req         , res          ) => {
  try {
    const ayId = req.query.academic_year_id ? parseInt(req.query.academic_year_id          , 10) : getActiveAcademicYearId();

    const classReports = db.prepare(`
      SELECT c.id, c.name, c.class_number, c.monthly_fee,
        COUNT(s.id) as total_students,
        (COUNT(s.id) * c.monthly_fee * 9) as expected_till_sep,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.class_id = c.id AND p.academic_year_id = ?), 0) as total_collected
      FROM classes c
      LEFT JOIN students s ON s.class_id = c.id
      WHERE c.academic_year_id = ?
      GROUP BY c.id
      ORDER BY c.class_number ASC
    `).all(ayId, ayId)         ;

    const expensesByCategory = db.prepare(`
      SELECT ec.name, COALESCE(SUM(e.amount), 0) as total
      FROM expense_categories ec
      LEFT JOIN expenses e ON ec.id = e.category_id
      GROUP BY ec.id
      ORDER BY total DESC
    `).all()         ;

    res.json({
      success: true,
      classReports: classReports.map(c => ({
        ...c,
        due: Math.max(0, c.expected_till_sep - c.total_collected),
        efficiency: c.expected_till_sep > 0 ? ((c.total_collected / c.expected_till_sep) * 100).toFixed(1) : '100'
      })),
      expensesByCategory
    });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.get('/reports/financial', (req, res) => {
  try {
    const period = (req.query.period) || 'month';
    const ayId = req.query.academic_year_id ? parseInt(req.query.academic_year_id, 10) : getActiveAcademicYearId();
    const ayRow = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(ayId) || getActiveAcademicYear();
    const currentYear = ayRow.year;

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const weekStart = monday.toISOString().split('T')[0];

    const currentMonthNum = String(now.getMonth() + 1).padStart(2, '0');
    const monthStart = `${now.getFullYear()}-${currentMonthNum}-01`;
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${now.getFullYear()}-${currentMonthNum}-${String(lastDayOfMonth).padStart(2, '0')}`;
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;

    let startDate = monthStart;
    let endDate = today;

    if (period === 'today') {
      startDate = today;
      endDate = today;
    } else if (period === 'week') {
      startDate = weekStart;
      endDate = today;
    } else if (period === 'month') {
      startDate = monthStart;
      endDate = monthEnd;
    } else if (period === 'year') {
      startDate = yearStart;
      endDate = yearEnd;
    }

    const incomeRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(id) as count
      FROM payments
      WHERE academic_year_id = ? AND payment_date >= ? AND payment_date <= ?
    `).get(ayId, startDate, endDate);

    const expenseRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(id) as count
      FROM expenses
      WHERE expense_date >= ? AND expense_date <= ?
    `).get(startDate, endDate);

    const expenseCategories = db.prepare(`
      SELECT ec.name as category, COALESCE(SUM(e.amount), 0) as total
      FROM expense_categories ec
      JOIN expenses e ON ec.id = e.category_id
      WHERE e.expense_date >= ? AND e.expense_date <= ?
      GROUP BY ec.id
      ORDER BY total DESC
    `).all(startDate, endDate);

    const classRevenue = db.prepare(`
      SELECT c.name as className, COALESCE(SUM(p.amount), 0) as total
      FROM classes c
      JOIN payments p ON c.id = p.class_id
      WHERE p.academic_year_id = ? AND p.payment_date >= ? AND p.payment_date <= ?
      GROUP BY c.id
      ORDER BY total DESC
    `).all(ayId, startDate, endDate);

    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const monthlyTrajectory = months.map(m => {
      const inc = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE academic_year_id = ? AND month = ?
      `).get(ayId, m);

      // Estimated expense distribution for trajectory
      const exp = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE strftime('%m', expense_date) = ? AND strftime('%Y', expense_date) = ?
      `).get(String(months.indexOf(m) + 1).padStart(2, '0'), String(currentYear));

      return {
        month: m,
        income: inc.total,
        expense: exp.total > 0 ? exp.total : 0
      };
    });

    res.json({
      success: true,
      data: {
        academicYear: currentYear,
        period,
        startDate,
        endDate,
        totalIncome: incomeRow.total,
        incomeCount: incomeRow.count,
        totalExpense: expenseRow.total,
        expenseCount: expenseRow.count,
        netBalance: incomeRow.total - expenseRow.total,
        expenseCategories,
        classRevenue,
        monthlyTrajectory
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// BACKUP, RESTORE & SETTINGS
// ----------------------------------------------------
apiRouter.get('/backup', (req, res) => {
  try {
    if (fs.existsSync(DB_PATH)) {
      const activeYear = getActiveAcademicYear();
      res.download(DB_PATH, `coaching-backup-${activeYear.year}-${new Date().toISOString().split('T')[0]}.sqlite`);
    } else {
      res.status(404).json({ success: false, error: 'Database file not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.get('/settings/system', (req, res) => {
  try {
    const stats = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
    res.json({
      success: true,
      data: {
        appName: 'Coaching Center Management System',
        edition: 'Enterprise Desktop v2.6.0',
        platform: 'Windows Desktop (Offline-First)',
        runtime: `Node.js ${process.version}`,
        database: `SQLite 3 (${path.basename(DB_PATH)})`,
        dbPath: DB_PATH,
        dbSize: stats ? `${(stats.size / 1024).toFixed(1)} KB` : 'N/A',
        lastModified: stats ? stats.mtime.toISOString().replace('T', ' ').substring(0, 19) : 'N/A',
        storageMode: 'Single Source of Truth (Zero External Cloud Dependency)'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/seed', (req         , res          ) => {
  try {
    seedDefaultDataIfEmpty(true);
    res.json({ success: true, message: 'Database reset and re-seeded with realistic records successfully' });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/reset-operational', (req         , res          ) => {
  try {
    db.exec(`
      DELETE FROM payments;
      DELETE FROM expenses;
      DELETE FROM students;
    `);
    res.json({
      success: true,
      message: 'All students, payments, and expenses were cleared. Classes and academic year settings were kept.'
    });
  } catch (error     ) {
    res.status(500).json({ success: false, error: error.message });
  }
});
