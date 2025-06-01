// app.js - Backend completo modularizado pero en un solo archivo para fácil mantenimiento

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'yajdielemirbaxinbaez0410';

// ------------------------------------------------------
// Configuración y conexión a la base de datos PostgreSQL
// ------------------------------------------------------

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tecnomatrix',
  password: process.env.DB_PASSWORD || '1234',
  port: process.env.DB_PORT || 5432,
});

// -----------------------------------
// Middlewares generales de la aplicación
// -----------------------------------

app.use(cors({
  origin: 'http://localhost:5173',  // Cambia esto por la URL de tu frontend
  credentials: true,
}));

app.use(express.json());            // Para interpretar JSON en el body
app.use(express.urlencoded({ extended: true })); // Para formularios URL encoded
app.use(cookieParser());            // Para manejar cookies

// Archivos estáticos, por ejemplo imágenes
app.use(express.static(__dirname));
app.use('/Imagenes', express.static(path.join(__dirname, 'Imagenes')));

// -----------------------------------
// Middleware para validar JWT y roles
// -----------------------------------

function autenticado(req, res, next) {
  // Verifica token JWT guardado en cookies
  const token = req.cookies.token;
  if (!token) return res.status(401).send('No autenticado');
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).send('Token inválido');
  }
}

function esAdmin(req, res, next) {
  // Solo permite continuar si el usuario es admin (rol === 1)
  if (req.usuario?.rol !== 1) return res.status(403).send('Acceso denegado');
  next();
}

// Middleware para validar tipo de lugar en rutas (hoteles, restaurantes, puntos_interes)
const tiposValidos = ['hoteles', 'restaurantes', 'puntos_interes'];
function validarTipoLugar(req, res, next) {
  const tipo = req.params.tipo;
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de lugar inválido' });
  }
  next();
}

// -----------------------------------
// Rutas y lógica de autenticación
// -----------------------------------

// Registro de usuario
app.post('/auth/registro', async (req, res) => {
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
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// Login de usuario
app.post('/auth/login', async (req, res) => {
  const { usuario, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuariosv2 WHERE correo = $1', [usuario]);
    if (result.rows.length === 0) return res.status(401).send('Usuario no encontrado');
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

// Logout de usuario
app.post('/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax' });
  res.status(200).send('Logout exitoso');
});

// -----------------------------------
// Ruta para obtener perfil del usuario autenticado
// -----------------------------------

app.get('/perfil', autenticado, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre, apellido, telefono, correo, sexo, rol FROM usuariosv2 WHERE id = $1', [req.usuario.id]);
    if (result.rows.length === 0) return res.status(404).send('Usuario no encontrado');
    res.json(result.rows[0]);
  } catch {
    res.status(500).send('Error interno');
  }
});

// -----------------------------------
// Rutas para CRUD de hoteles, restaurantes y puntos de interés
// -----------------------------------

// Obtener todos los lugares de un tipo (hotel, restaurante o punto de interés)
app.get('/api/:tipo', validarTipoLugar, async (req, res) => {
  const tipo = req.params.tipo;
  try {
    const result = await pool.query(`SELECT * FROM ${tipo} ORDER BY id`);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener datos' });
  }
});

// Obtener un lugar por ID
app.get('/api/:tipo/:id', validarTipoLugar, async (req, res) => {
  const { tipo, id } = req.params;
  try {
    const result = await pool.query(`SELECT * FROM ${tipo} WHERE id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Error al obtener datos' });
  }
});

// Crear un lugar (solo admin)
app.post('/api/:tipo', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const tipo = req.params.tipo;
  // Campos básicos para todos los tipos (ajusta según tu esquema)
  const { nombre, descripcion, direccion, telefono, correo, latitud, longitud, pagina_web, imagen } = req.body;

  try {
    // Query genérica para insertar, debes ajustarla si tus tablas tienen campos diferentes
    const query = `
      INSERT INTO ${tipo} (nombre, descripcion, direccion, telefono, correo, latitud, longitud, pagina_web, imagen)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`;
    const values = [nombre, descripcion, direccion, telefono, correo, latitud, longitud, pagina_web, imagen];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error al crear el lugar' });
  }
});

// Actualizar un lugar (solo admin)
app.put('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const { tipo, id } = req.params;
  const { nombre, descripcion, direccion, telefono, correo, latitud, longitud, pagina_web, imagen } = req.body;

  try {
    // Actualización genérica
    const query = `
      UPDATE ${tipo}
      SET nombre=$1, descripcion=$2, direccion=$3, telefono=$4, correo=$5, latitud=$6, longitud=$7, pagina_web=$8, imagen=$9
      WHERE id=$10 RETURNING *`;
    const values = [nombre, descripcion, direccion, telefono, correo, latitud, longitud, pagina_web, imagen, id];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Lugar no encontrado' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// Eliminar un lugar (solo admin)
app.delete('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const { tipo, id } = req.params;

  try {
    const result = await pool.query(`DELETE FROM ${tipo} WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Lugar no encontrado' });
    res.json({ mensaje: 'Lugar eliminado correctamente' });
  } catch {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// -----------------------------------
// Rutas para reservas
// -----------------------------------

// Crear reserva para un lugar (usuario autenticado)
app.post('/reserva', autenticado, async (req, res) => {
  const { id_usuario, tipo_lugar, id_lugar, fecha, personas } = {
    id_usuario: req.usuario.id,
    ...req.body,
  };

  if (!tiposValidos.includes(tipo_lugar)) {
    return res.status(400).json({ error: 'Tipo de lugar inválido para reserva' });
  }

  try {
    // Insertar reserva
    const query = `
      INSERT INTO reservas (id_usuario, tipo_lugar, id_lugar, fecha, personas)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const values = [id_usuario, tipo_lugar, id_lugar, fecha, personas];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Error al crear reserva' });
  }
});

// Obtener reservas del usuario autenticado
app.get('/reserva', autenticado, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reservas WHERE id_usuario = $1 ORDER BY fecha DESC', [req.usuario.id]);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Error al obtener reservas' });
  }
});

// -----------------------------------
// Inicio del servidor
// -----------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
