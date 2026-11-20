import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// DATABASE CONNECTION
// ==========================================

const isLocal = process.env.DATABASE_URL?.includes('localhost');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },

  max: 5,
  idleTimeoutMillis: 10000, // close idle connections before the network resets them
  connectionTimeoutMillis: 20000,
  keepAlive: true,
});

// An error on an idle connection must not crash or poison the pool
pool.on('error', (err) => {
  console.error('Idle database connection dropped:', err.code || err.message);
});

// If a stale connection was reset, retry read queries once on a fresh connection.
// Writes are not retried, so an INSERT can never be applied twice.
const rawQuery = pool.query.bind(pool);

pool.query = async (...args) => {
  try {
    return await rawQuery(...args);
  } catch (err) {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text || '';
    const isRead = /^\s*SELECT/i.test(text);
    const isTransient =
      ['ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(err.code) ||
      /Connection terminated/i.test(err.message);

    if (isRead && isTransient) {
      return rawQuery(...args);
    }

    throw err;
  }
};

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '10kb' }));

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Normalize employee fields
const normalizeEmployee = (body = {}) => {
  const data =
    body && typeof body === 'object' && !Array.isArray(body)
      ? body
      : {};

  return {
    name: typeof data.name === 'string' ? data.name.trim() : '',
    email:
      typeof data.email === 'string'
        ? data.email.trim().toLowerCase()
        : '',
    role: typeof data.role === 'string' ? data.role.trim() : '',
  };
};

// Validate employee information
const validateEmployee = (res, employee) => {
  const { name, email, role } = employee;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!name || !email || !role) {
    res.status(400).json({
      error: 'Name, email and role are required',
    });

    return false;
  }

  if (
    name.length > 100 ||
    role.length > 100 ||
    email.length > 150
  ) {
    res.status(400).json({
      error: 'One or more fields exceed the maximum allowed length',
    });

    return false;
  }

  if (!emailRegex.test(email)) {
    res.status(400).json({
      error: 'Please provide a valid email address',
    });

    return false;
  }

  return true;
};

// Validate employee ID
const isValidId = (id) => {
  return /^\d+$/.test(id) && Number(id) > 0;
};

// ==========================================
// ROOT ROUTE
// ==========================================

app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Employee Directory API',
    status: 'Running',
    endpoints: {
      health: '/health',
      employees: '/employees',
      getEmployee: 'GET /employees',
      createEmployee: 'POST /employees',
      updateEmployee: 'PUT /employees/:id',
      deleteEmployee: 'DELETE /employees/:id',
    },
  });
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.status(200).json({
      status: 'OK',
      database: 'Connected',
      message: 'Employee Directory API is running',
    });
  } catch (err) {
    console.error('DATABASE CONNECTION ERROR:', err.message);

    res.status(503).json({
      status: 'Error',
      database: 'Disconnected',
      message: 'Unable to connect to the database',
    });
  }
});

// ==========================================
// GET ALL EMPLOYEES
// GET /employees?search=&page=&limit=
// ==========================================

app.get('/employees', async (req, res, next) => {
  try {
    const requestedPage = Number(req.query.page);
    const requestedLimit = Number(req.query.limit);

    const page =
      Number.isInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;

    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 50)
        : 5;

    const search =
      typeof req.query.search === 'string'
        ? req.query.search.trim()
        : '';

    const searchTerm = `%${search}%`;
    const offset = (page - 1) * limit;

    // Fetch employees
    const employeesResult = await pool.query(
      `SELECT *
       FROM employees
       WHERE
         name ILIKE $1
         OR email ILIKE $1
         OR role ILIKE $1
       ORDER BY id DESC
       LIMIT $2 OFFSET $3`,
      [searchTerm, limit, offset]
    );

    // Fetch total employee count
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM employees
       WHERE
         name ILIKE $1
         OR email ILIKE $1
         OR role ILIKE $1`,
      [searchTerm]
    );

    const total = countResult.rows[0].total;

    res.status(200).json({
      data: employeesResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// CREATE EMPLOYEE
// POST /employees
// ==========================================

app.post('/employees', async (req, res, next) => {
  try {
    const employee = normalizeEmployee(req.body);

    if (!validateEmployee(res, employee)) {
      return;
    }

    const { name, email, role } = employee;

    const result = await pool.query(
      `INSERT INTO employees (name, email, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, email, role]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ==========================================
// UPDATE EMPLOYEE
// PUT /employees/:id
// ==========================================

app.put('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        error: 'Invalid employee ID',
      });
    }

    const employee = normalizeEmployee(req.body);

    if (!validateEmployee(res, employee)) {
      return;
    }

    const { name, email, role } = employee;

    const result = await pool.query(
      `UPDATE employees
       SET name = $1,
           email = $2,
           role = $3
       WHERE id = $4
       RETURNING *`,
      [name, email, role, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Employee not found',
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ==========================================
// DELETE EMPLOYEE
// DELETE /employees/:id
// ==========================================

app.delete('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        error: 'Invalid employee ID',
      });
    }

    const result = await pool.query(
      'DELETE FROM employees WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Employee not found',
      });
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ==========================================
// UNKNOWN ROUTES
// ==========================================

app.use((req, res) => {
  res.status(404).json({
    error: 'API endpoint not found',
    path: req.originalUrl,
  });
});

// ==========================================
// CENTRALIZED ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'An employee with this email already exists',
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Invalid JSON request body',
    });
  }

  console.error('SERVER ERROR:', err);

  res.status(500).json({
    error: 'Something went wrong on the server',
  });
});

// ==========================================
// START SERVER
// ==========================================

const server = app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down server...');

  server.close(async () => {
    await pool.end();
    console.log('Database pool closed.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
