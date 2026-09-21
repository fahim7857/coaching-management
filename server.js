import express from 'express';
import path from 'node:path';
import 'dotenv/config';
import { initDatabase } from './backend/database.js';
import { apiRouter } from './backend/api.js';

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Initialize SQLite database
  initDatabase();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API routes FIRST
  app.use('/api', apiRouter);

  // Serve static files from frontend/ directory
  const frontendPath = path.join(process.cwd(), 'frontend');
  app.use(express.static(frontendPath));

  // Explicit page routes
  const pages = [
    'dashboard',
    'students',
    'student-details',
    'payments',
    'monthly-overview',
    'expenses',
    'reports',
    'settings'
  ];

  pages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
      res.sendFile(path.join(frontendPath, `${page}.html`));
    });
    app.get(`/${page}.html`, (req, res) => {
      res.sendFile(path.join(frontendPath, `${page}.html`));
    });
  });

  // Root redirect/render to dashboard.html
  app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'dashboard.html'));
  });

  // Fallback for any other route
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'dashboard.html'));
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
