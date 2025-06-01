// Importación de librerías necesarias
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

// Configuración conexión a base de datos PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Configuración CORS para permitir cookies y comunicación con frontend en localhost:5173
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));

// Middleware para parsear JSON y datos urlencoded, cookies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Servir archivos estáticos (HTML, JS, CSS, imágenes)
app.use(express.static(__dirname));
app.use('/Imagenes', express.static(path.join(__dirname, 'Imagenes')));

// Middleware para verificar autenticación por JWT desde cookies
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

// Middleware para verificar que usuario sea admin (rol = 1)
function esAdmin(req, res, next) {
  if (req.usuario?.rol !== 1) return res.status(403).send('Acceso denegado');
  next();
}

// Valida que el parámetro tipo coincida con una tabla válida
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

// --- RUTAS ---

// Registro de usuario (rol 2 por defecto)
app.post('/registro', async (req, res) => {
  const { nombre, apellido, telefono, correo, sexo, password } = req.body;
  if (!nombre || !apellido || !correo || !password || !sexo) {
    return res.status(400).json({ success: false, message: 'Faltan datos obligatorios' });
  }
  try {
    const { rowCount } = await pool.query('SELECT 1 FROM usuariosv2 WHERE correo = $1', [correo]);
    if (rowCount > 0) {
      return res.status(409).json({ success: false, message: 'El correo ya está registrado' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO usuariosv2 (nombre, apellido, telefono, correo, sexo, password, rol)
       VALUES ($1, $2, $3, $4, $5, $6, 2)`,
      [nombre, apellido, telefono || '', correo, sexo, hashedPassword]
    );
    return res.json({ success: true, message: 'Usuario registrado correctamente' });
  } catch (error) {
    console.error('Error en /registro:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// Login: valida usuario y genera JWT
app.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuariosv2 WHERE correo = $1', [usuario]);
    if (result.rows.length === 0) return res.status(401).send('No encontrado');
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send('Contraseña incorrecta');
    const token = jwt.sign({ id: user.id, rol: user.rol }, JWT_SECRET, { expiresIn: '2h' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ mensaje: 'Login exitoso', rol: user.rol });
  } catch (e) {
    res.status(500).send('Error de servidor');
  }
});

// Logout: elimina cookie JWT
app.post('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax' });
  res.status(200).send('Logout exitoso');
});

// Obtener perfil usuario autenticado
app.get('/perfil', autenticado, async (req, res) => {
  try {
    const userId = req.usuario.id;
    const result = await pool.query('SELECT id, nombre, apellido, correo, telefono, sexo, rol FROM usuariosv2 WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(404).send('Usuario no encontrado');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send('Error del servidor');
  }
});

// CRUD para hoteles, restaurantes y puntos de interés

// Obtener lista (todos registros) por tipo
app.get('/api/:tipo', validarTipoLugar, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ${req.tabla} ORDER BY id DESC`);
    res.json(result.rows);
  } catch {
    res.status(500).send('Error al obtener');
  }
});

// Obtener un registro por ID
app.get('/api/:tipo/:id', validarTipoLugar, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ${req.tabla} WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).send('No encontrado');
    res.json(result.rows[0]);
  } catch {
    res.status(500).send('Error al obtener');
  }
});

// Insertar nuevo registro (solo admin)
app.post('/api/:tipo', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const { nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones } = req.body;

  if (!nombre) return res.status(400).send('Falta nombre');

  let query = '';
  let params = [];

  if (req.tabla === 'hoteles') {
    query = `INSERT INTO hoteles (nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;
    params = [nombre, estrellas || null, descripcion || null, direccion || null, iframe_mapa || null, imagen_url || null, num_habitaciones || null];
  } else {
    query = `INSERT INTO ${req.tabla} (nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`;
    params = [nombre, estrellas || null, descripcion || null, direccion || null, iframe_mapa || null, imagen_url || null];
  }

  try {
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).send('Error al insertar');
  }
});

// Actualizar registro (solo admin)
app.put('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const { nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones } = req.body;
  const id = req.params.id;

  try {
    // Verificar que el registro exista
    const exist = await pool.query(`SELECT * FROM ${req.tabla} WHERE id = $1`, [id]);
    if (exist.rows.length === 0) return res.status(404).send('No encontrado');

    let query = '';
    let params = [];

    if (req.tabla === 'hoteles') {
      query = `
        UPDATE hoteles SET
          nombre = $1,
          estrellas = $2,
          descripcion = $3,
          direccion = $4,
          iframe_mapa = $5,
          imagen_url = $6,
          num_habitaciones = $7
        WHERE id = $8 RETURNING *`;
      params = [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones, id];
    } else {
      query = `
        UPDATE ${req.tabla} SET
          nombre = $1,
          estrellas = $2,
          descripcion = $3,
          direccion = $4,
          iframe_mapa = $5,
          imagen_url = $6
        WHERE id = $7 RETURNING *`;
      params = [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, id];
    }

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).send('Error al actualizar');
  }
});

// Eliminar registro (solo admin)
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

// Reservas

// Crear reserva (abierto, no requiere login)
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

// Obtener reservas (solo admin)
app.get('/reservas', autenticado, esAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reserva ORDER BY id DESC');
    res.json(result.rows);
  } catch {
    res.status(500).send('Error al obtener reservas');
  }
});

// --- Servidor escucha ---
app.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});
