import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { DATABASE_URL, JWT_SECRET, PORT = 3000, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !JWT_SECRET) {
  console.error('Faltan DATABASE_URL o JWT_SECRET. Revisa tu archivo .env');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use('/api/v1/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 50 }));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const guard = (...roles) => (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Inicia sesión para continuar' });
  }
  if (roles.length && !roles.includes(req.user.rol)) {
    return res.status(403).json({ error: 'Tu rol no permite esta acción' });
  }
  next();
};
const escribe = ['admin', 'encargado'];

const SELECT_BIENES = `
  SELECT b.*, a.nombre AS area, c.nombre AS categoria, c.grupo
  FROM bienes b
  LEFT JOIN areas a ON a.id = b.area_id
  LEFT JOIN categorias c ON c.id = b.categoria_id`;

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/v1/auth/login', wrap(async (req, res) => {
  const { email = '', password = '' } = req.body;
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email.toLowerCase()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  const user = { id: u.id, nombre: u.nombre, rol: u.rol };
  res.json({ token: jwt.sign(user, JWT_SECRET, { expiresIn: '8h' }), user });
}));

app.get('/api/v1/areas', guard(), wrap(async (_req, res) => {
  res.json((await pool.query('SELECT * FROM areas ORDER BY nombre')).rows);
}));
app.get('/api/v1/categorias', guard(), wrap(async (_req, res) => {
  res.json((await pool.query('SELECT * FROM categorias ORDER BY nombre')).rows);
}));

app.get('/api/v1/bienes', guard(), wrap(async (req, res) => {
  const { q, area, estado } = req.query;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const where = [], vals = [];
  if (q) { vals.push(`%${q}%`); where.push(`(b.descripcion ILIKE $${vals.length} OR b.codigo ILIKE $${vals.length} OR b.responsable ILIKE $${vals.length})`); }
  if (area) { vals.push(area); where.push(`b.area_id = $${vals.length}`); }
  if (estado) { vals.push(estado); where.push(`b.estado = $${vals.length}`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await pool.query(`SELECT count(*) FROM bienes b ${w}`, vals)).rows[0].count;
  vals.push(20, (page - 1) * 20);
  const { rows } = await pool.query(
    `${SELECT_BIENES} ${w} ORDER BY b.id DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`, vals);
  res.json({ total: Number(total), page, items: rows });
}));

app.post('/api/v1/bienes', guard(...escribe), wrap(async (req, res) => {
  const { descripcion, categoria_id, area_id, responsable, estado = 'bueno', valor, fecha_adquisicion } = req.body;
  if (!descripcion || !area_id) return res.status(400).json({ error: 'Descripción y área son obligatorias' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `INSERT INTO bienes (descripcion, categoria_id, area_id, responsable, estado, valor, fecha_adquisicion)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [descripcion, categoria_id || null, area_id, responsable || null, estado, valor || null, fecha_adquisicion || null]);
    await c.query(
      `INSERT INTO movimientos (bien_id, tipo, area_destino, usuario_id, observacion) VALUES ($1,'alta',$2,$3,'Registro inicial')`,
      [rows[0].id, area_id, req.user.id]);
    await c.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}));

app.get('/api/v1/bienes/:id', guard(), wrap(async (req, res) => {
  const { rows } = await pool.query(`${SELECT_BIENES} WHERE b.id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Bien no encontrado' });
  const mov = await pool.query(
    `SELECT m.*, ao.nombre AS origen, ad.nombre AS destino, u.nombre AS usuario
     FROM movimientos m
     LEFT JOIN areas ao ON ao.id = m.area_origen
     LEFT JOIN areas ad ON ad.id = m.area_destino
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.bien_id = $1 ORDER BY m.fecha DESC`, [req.params.id]);
  res.json({ ...rows[0], movimientos: mov.rows });
}));

app.put('/api/v1/bienes/:id', guard(...escribe), wrap(async (req, res) => {
  const { descripcion, categoria_id, responsable, estado, valor, fecha_adquisicion } = req.body;
  const { rows } = await pool.query(
    `UPDATE bienes SET descripcion = COALESCE($1, descripcion), categoria_id = COALESCE($2, categoria_id),
       responsable = COALESCE($3, responsable), estado = COALESCE($4, estado),
       valor = COALESCE($5, valor), fecha_adquisicion = COALESCE($6, fecha_adquisicion)
     WHERE id = $7 AND estado <> 'baja' RETURNING *`,
    [descripcion, categoria_id, responsable, estado, valor, fecha_adquisicion, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Bien no encontrado o ya dado de baja' });
  if (estado === 'en_reparacion') {
    await pool.query(`INSERT INTO movimientos (bien_id, tipo, usuario_id, observacion) VALUES ($1,'mantenimiento',$2,$3)`,
      [req.params.id, req.user.id, req.body.observacion || 'Enviado a reparación']);
  }
  res.json(rows[0]);
}));

app.post('/api/v1/bienes/:id/traslado', guard(...escribe), wrap(async (req, res) => {
  const { area_destino, responsable, observacion } = req.body;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const cur = (await c.query('SELECT area_id, estado FROM bienes WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur || cur.estado === 'baja') { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Bien no disponible' }); }
    if (!area_destino || Number(area_destino) === cur.area_id) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'Elige un área distinta a la actual' }); }
    await c.query('UPDATE bienes SET area_id = $1, responsable = COALESCE($2, responsable) WHERE id = $3',
      [area_destino, responsable || null, req.params.id]);
    await c.query(
      `INSERT INTO movimientos (bien_id, tipo, area_origen, area_destino, usuario_id, observacion) VALUES ($1,'traslado',$2,$3,$4,$5)`,
      [req.params.id, cur.area_id, area_destino, req.user.id, observacion || null]);
    await c.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}));

app.post('/api/v1/bienes/:id/baja', guard('admin'), wrap(async (req, res) => {
  const { observacion } = req.body;
  if (!observacion) return res.status(400).json({ error: 'Indica el motivo de la baja' });
  const { rowCount } = await pool.query(`UPDATE bienes SET estado = 'baja' WHERE id = $1 AND estado <> 'baja'`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Bien no encontrado o ya dado de baja' });
  await pool.query(`INSERT INTO movimientos (bien_id, tipo, usuario_id, observacion) VALUES ($1,'baja',$2,$3)`,
    [req.params.id, req.user.id, observacion]);
  res.json({ ok: true });
}));

app.get('/api/v1/reportes/resumen', guard(), wrap(async (_req, res) => {
  const [estado, area, total] = await Promise.all([
    pool.query('SELECT estado, count(*)::int AS n FROM bienes GROUP BY estado ORDER BY estado'),
    pool.query(`SELECT a.nombre, count(b.id)::int AS n FROM areas a
                LEFT JOIN bienes b ON b.area_id = a.id AND b.estado <> 'baja' GROUP BY a.nombre ORDER BY n DESC`),
    pool.query(`SELECT count(*)::int AS n, COALESCE(sum(valor),0) AS valor FROM bienes WHERE estado <> 'baja'`)]);
  res.json({ por_estado: estado.rows, por_area: area.rows, activos: total.rows[0] });
}));

app.get('/api/v1/reportes/inventario.csv', guard(), wrap(async (_req, res) => {
  const { rows } = await pool.query(`${SELECT_BIENES} ORDER BY b.codigo`);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = 'Código,Descripción,Categoría,Área,Responsable,Estado,Valor,Fecha adquisición';
  const body = rows.map((r) => [r.codigo, r.descripcion, r.categoria, r.area, r.responsable, r.estado, r.valor,
    r.fecha_adquisicion?.toISOString?.().slice(0, 10)].map(cell).join(','));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="inventario.csv"' });
  res.send('\ufeff' + [head, ...body].join('\n'));
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Error interno del servidor' }); });

async function iniciar() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8'));
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Administrador', $1, $2, 'admin') ON CONFLICT (email) DO NOTHING`,
      [ADMIN_EMAIL.toLowerCase(), hash]);
  }
  app.listen(PORT, () => console.log(`SIRBE escuchando en el puerto ${PORT}`));
}
iniciar().catch((e) => { console.error('No se pudo iniciar:', e.message); process.exit(1); });
