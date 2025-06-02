const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'yajdielemirbaxinbaez0410';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(cors({
  origin: 'https://tudecafront.onrender.com',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(__dirname));
app.use('/Imagenes', express.static(path.join(__dirname, 'Imagenes')));

// Middleware JWT
function autenticado(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).send('No autenticado');
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    console.log('Token inválido o expirado:', err.message);
    res.status(401).send('Token inválido');
  }
}

function esAdmin(req, res, next) {
  if (req.usuario?.rol !== 1) return res.status(403).send('Acceso denegado');
  next();
}

const tablasValidas = {
  hoteles: 'hoteles',
  restaurantes: 'restaurantes',
  puntos_interes: 'puntos_interes',
};
function validarTipoLugar(req, res, next) {
  const { tipo } = req.params;
  if (!tablasValidas[tipo]) return res.status(400).send('Tipo inválido');
  req.tabla = tablasValidas[tipo];
  next();
}

// Registro
app.post('/registro', async (req, res) => {
  const { nombre, apellido, telefono, correo, sexo, password } = req.body;
  if (!nombre || !apellido || !correo || !password || !sexo) {
    return res.status(400).json({ success: false, message: 'Faltan datos obligatorios' });
  }
  try {
    const { rowCount } = await pool.query('SELECT 1 FROM usuariosv2 WHERE correo = $1', [correo]);
    if (rowCount > 0) return res.status(409).json({ success: false, message: 'El correo ya está registrado' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO usuariosv2 (nombre, apellido, telefono, correo, sexo, password, rol)
       VALUES ($1, $2, $3, $4, $5, $6, 2)`,
      [nombre, apellido, telefono || '', correo, sexo, hashedPassword]
    );
    res.json({ success: true, message: 'Usuario registrado correctamente' });
  } catch (error) {
    console.error('Error en /registro:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuariosv2 WHERE correo = $1', [usuario]);
    if (result.rows.length === 0) return res.status(401).send('No encontrado');
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send('Contraseña incorrecta');

    const token = jwt.sign({ id: user.id, rol: user.rol }, JWT_SECRET, { expiresIn: '2h' });
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true, // Importante para producción en HTTPS
    });
    res.json({ mensaje: 'Login exitoso', rol: user.rol });
  } catch (e) {
    console.error('Error en /login:', e.message);
    res.status(500).send('Error de servidor');
  }
});

// Logout
app.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
  });
  res.status(200).send('Logout exitoso');
});

// Perfil
app.get('/perfil', autenticado, async (req, res) => {
  try {
    const userId = req.usuario.id;
    const result = await pool.query(
      'SELECT id, nombre, apellido, correo, telefono, sexo, rol FROM usuariosv2 WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) return res.status(404).send('Usuario no encontrado');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en /perfil:', err.message);
    res.status(500).send('Error del servidor');
  }
});

// GET todos
app.get('/api/:tipo', validarTipoLugar, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ${req.tabla} ORDER BY id DESC`);
    res.json(result.rows);
  } catch {
    res.status(500).send('Error al obtener');
  }
});

// GET uno
app.get('/api/:tipo/:id', validarTipoLugar, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ${req.tabla} WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).send('No encontrado');
    res.json(result.rows[0]);
  } catch {
    res.status(500).send('Error al obtener');
  }
});

// POST crear
app.post('/api/:tipo', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const { nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones } = req.body;
  if (!nombre) return res.status(400).send('Falta nombre');

  try {
    const campos = req.tabla === 'hoteles'
      ? [nombre, estrellas || null, descripcion || null, direccion || null, iframe_mapa || null, imagen_url || null, num_habitaciones || null]
      : [nombre, estrellas || null, descripcion || null, direccion || null, iframe_mapa || null, imagen_url || null];
    const query = req.tabla === 'hoteles'
      ? `INSERT INTO hoteles (nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`
      : `INSERT INTO ${req.tabla} (nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`;

    const result = await pool.query(query, campos);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error en POST /api:', error.message);
    res.status(500).send('Error al insertar');
  }
});

// PUT actualizar
app.put('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const { nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones } = req.body;
  const id = req.params.id;

  try {
    const exist = await pool.query(`SELECT * FROM ${req.tabla} WHERE id = $1`, [id]);
    if (exist.rows.length === 0) return res.status(404).send('No encontrado');

    const campos = req.tabla === 'hoteles'
      ? [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones, id]
      : [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, id];
    const query = req.tabla === 'hoteles'
      ? `UPDATE hoteles SET nombre=$1, estrellas=$2, descripcion=$3, direccion=$4, iframe_mapa=$5, imagen_url=$6, num_habitaciones=$7 WHERE id=$8 RETURNING *`
      : `UPDATE ${req.tabla} SET nombre=$1, estrellas=$2, descripcion=$3, direccion=$4, iframe_mapa=$5, imagen_url=$6 WHERE id=$7 RETURNING *`;

    const result = await pool.query(query, campos);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).send('Error al actualizar');
  }
});

// DELETE eliminar
app.delete('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await pool.query(`DELETE FROM ${req.tabla} WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) return res.status(404).send('No encontrado');
    res.json({ success: true, message: 'Eliminado correctamente' });
  } catch {
    res.status(500).send('Error al eliminar');
  }
});

// Crear reserva
app.post('/reservar', async (req, res) => {
  const { nombre, correo, celular, fecha_inicio, fecha_fin, num_habitacion, id_hotel } = req.body;
  if (!nombre || !correo || !celular || !fecha_inicio || !fecha_fin || !num_habitacion || !id_hotel) {
    return res.status(400).json({ success: false, message: 'Faltan datos' });
  }
  try {
    await pool.query(
      `INSERT INTO reserva (nombre_huesped, correo, celular, fecha_inicio, fecha_fin, num_habitacion, hotel_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [nombre, correo, celular, fecha_inicio, fecha_fin, num_habitacion, id_hotel]
    );
    res.json({ success: true, message: 'Reserva creada' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al crear reserva' });
  }
});

// Obtener todas las reservas
app.get('/reservas', autenticado, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reserva ORDER BY id DESC');
    res.json(result.rows);
  } catch {
    res.status(500).send('Error al obtener reservas');
  }
});

// Obtener habitaciones reservadas por hotel
app.get('/reservas/habitaciones/:id_hotel', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT num_habitacion FROM reserva WHERE hotel_id = $1`,
      [req.params.id_hotel]
    );
    res.json(result.rows.map(r => r.num_habitacion));
  } catch (error) {
    res.status(500).send('Error al obtener habitaciones reservadas');
  }
});

// Servidor en escucha
app.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});

