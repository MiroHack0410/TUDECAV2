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
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_aqui';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Configurar CORS (ajusta el origen según tu frontend)
app.use(cors({
  origin: 'http://localhost:5173', // Cambia al origen de tu frontend
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Servir archivos estáticos
app.use(express.static(__dirname));
app.use('/Imagenes', express.static(path.join(__dirname, 'Imagenes')));

// 🔧 Agregar columnas imagen_url si no existen
async function agregarColumnasImagen() {
  try {
    await pool.query(`ALTER TABLE hoteles ADD COLUMN IF NOT EXISTS imagen_url TEXT;`);
    await pool.query(`ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS imagen_url TEXT;`);
    await pool.query(`ALTER TABLE puntos_interes ADD COLUMN IF NOT EXISTS imagen_url TEXT;`);
    console.log('✅ Columnas imagen_url agregadas o ya existían');
  } catch (error) {
    console.error('❌ Error al agregar columnas imagen_url:', error);
  }
}
agregarColumnasImagen();

// 🔧 Agregar columna num_habitaciones si no existe
async function agregarColumnaNumHabitaciones() {
  try {
    await pool.query(`ALTER TABLE hoteles ADD COLUMN IF NOT EXISTS num_habitaciones INTEGER;`);
    console.log('✅ Columna num_habitaciones agregada o ya existía');
  } catch (error) {
    console.error('❌ Error al agregar columna num_habitaciones:', error);
  }
}
agregarColumnaNumHabitaciones();

// 🧱 Crear tabla usuariosv2 si no existe
app.post('/crear-tabla-usuariosv2', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuariosv2 (
        id SERIAL PRIMARY KEY,
        nombre TEXT,
        apellido TEXT,
        telefono TEXT,
        correo TEXT UNIQUE NOT NULL,
        sexo TEXT,
        password TEXT NOT NULL,
        rol INTEGER NOT NULL CHECK (rol IN (1, 2))
      );
    `);
    res.send('✅ Tabla usuariosv2 creada/verificada');
  } catch (error) {
    console.error('❌ Error al crear la tabla usuariosv2:', error);
    res.status(500).send('Error al crear la tabla');
  }
});

// 👤 Insertar administrador por defecto (si no existe)
(async () => {
  const adminCorreo = 'admin@tudeca.com';
  const adminPasswordPlano = 'emirbb18';

  try {
    const result = await pool.query('SELECT * FROM usuariosv2 WHERE correo = $1 AND rol = 1', [adminCorreo]);
    if (result.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(adminPasswordPlano, 10);
      await pool.query(`
        INSERT INTO usuariosv2 (correo, password, rol)
        VALUES ($1, $2, 1)
      `, [adminCorreo, hashedPassword]);
      console.log('✅ Administrador insertado automáticamente');
    } else {
      console.log('🔎 El administrador ya existe');
    }
  } catch (err) {
    console.error('❌ Error al insertar administrador:', err);
  }
})();

// 🏨 Crear tablas principales si no existen
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hoteles (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        estrellas TEXT,
        descripcion TEXT,
        direccion TEXT,
        iframe_mapa TEXT,
        imagen_url TEXT,
        num_habitaciones INTEGER
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS restaurantes (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        estrellas TEXT,
        descripcion TEXT,
        direccion TEXT,
        iframe_mapa TEXT,
        imagen_url TEXT
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS puntos_interes (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        estrellas TEXT,
        descripcion TEXT,
        direccion TEXT,
        iframe_mapa TEXT,
        imagen_url TEXT
      );
    `);
    console.log('✅ Tablas hoteles, restaurantes y puntos_interes creadas/verificadas');
  } catch (err) {
    console.error('❌ Error al crear tablas:', err);
  }
})();

// Middleware para validar tipo válido y prevenir inyección SQL
const tablasValidas = {
  hoteles: 'hoteles',
  restaurantes: 'restaurantes',
  puntos_interes: 'puntos_interes',
};
function validarTipoLugar(req, res, next) {
  const { tipo } = req.params;
  if (!tablasValidas[tipo]) {
    return res.status(400).send('Tipo inválido');
  }
  req.tabla = tablasValidas[tipo]; // asignar tabla segura
  next();
}

// Middleware para validar token JWT (autenticación)
function autenticado(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).send('No autenticado');
  try {
    const userData = jwt.verify(token, JWT_SECRET);
    req.usuario = userData;
    next();
  } catch {
    return res.status(401).send('Token inválido');
  }
}

// Middleware para autorizar solo admin (rol=1)
function esAdmin(req, res, next) {
  if (req.usuario?.rol !== 1) {
    return res.status(403).send('Acceso denegado: solo administradores');
  }
  next();
}

// 👥 Registro de turistas
app.post('/registro', async (req, res) => {
  const { nombre, apellido, telefono, correo, sexo, password } = req.body;
  if (!correo || !password) {
    return res.status(400).send('Correo y contraseña son obligatorios');
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(`
      INSERT INTO usuariosv2 (nombre, apellido, telefono, correo, sexo, password, rol)
      VALUES ($1, $2, $3, $4, $5, $6, 2)
    `, [nombre, apellido, telefono, correo, sexo, hashedPassword]);
    res.send('Usuario registrado exitosamente');
  } catch (err) {
    console.error('Error al registrar turista:', err);
    if (err.code === '23505') {
      // código error unique violation
      return res.status(400).send('El correo ya está registrado');
    }
    res.status(500).send('Error al registrar usuario');
  }
});

// 🔐 Login
app.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).send('Usuario y contraseña son obligatorios');
  }

  try {
    const result = await pool.query('SELECT * FROM usuariosv2 WHERE correo = $1', [usuario]);
    if (result.rows.length === 0) return res.status(401).send('Usuario no encontrado');

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).send('Contraseña incorrecta');

    const token = jwt.sign({ id: user.id, correo: user.correo, nombre: user.nombre, rol: user.rol }, JWT_SECRET, { expiresIn: '2h' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 2 * 60 * 60 * 1000,
      sameSite: 'lax'
    });

    res.json({ mensaje: 'Login exitoso', rol: user.rol });

  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).send('Error del servidor');
  }
});

// 🔍 Obtener usuario autenticado
app.get('/me', autenticado, (req, res) => {
  res.json(req.usuario);
});

// 🚪 Logout
app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.send('Sesión cerrada');
});

// 📄 Obtener lista de lugares (abierto)
app.get('/api/:tipo', validarTipoLugar, async (req, res) => {
  const tabla = req.tabla;
  try {
    const result = await pool.query(`SELECT * FROM ${tabla} ORDER BY id DESC`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener lista:', error);
    res.status(500).send('Error al obtener datos');
  }
});

// ➕ Insertar lugar (solo autenticados)
app.post('/api/:tipo', autenticado, validarTipoLugar, async (req, res) => {
  const tabla = req.tabla;
  const { nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones } = req.body;

  if (!nombre || !estrellas || !descripcion || !direccion || !iframe_mapa || !imagen_url) {
    return res.status(400).send('Faltan campos obligatorios');
  }

  if (tabla === 'hoteles') {
    if (num_habitaciones === undefined || isNaN(num_habitaciones) || parseInt(num_habitaciones) < 0) {
      return res.status(400).send('num_habitaciones debe ser un entero no negativo');
    }
  }

  try {
    if (tabla === 'hoteles') {
      await pool.query(`
        INSERT INTO hoteles (nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones]);
    } else {
      await pool.query(`
        INSERT INTO ${tabla} (nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url]);
    }
    res.send('Insertado correctamente');
  } catch (error) {
    console.error('Error al insertar:', error);
    res.status(500).send('Error al insertar');
  }
});

// ❌ Eliminar lugar (solo admin)
app.delete('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const tabla = req.tabla;
  const { id } = req.params;
  try {
    const result = await pool.query(`DELETE FROM ${tabla} WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      return res.status(404).send('Lugar no encontrado');
    }
    res.send('Eliminado correctamente');
  } catch (error) {
    console.error('Error al eliminar:', error);
    res.status(500).send('Error al eliminar');
  }
});

// ✏️ Actualizar lugar (solo admin)
app.put('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const tabla = req.tabla;
  const { id } = req.params;
  const { nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones } = req.body;

  if (!nombre || !estrellas || !descripcion || !direccion || !iframe_mapa || !imagen_url) {
    return res.status(400).send('Faltan campos obligatorios');
  }

  if (tabla === 'hoteles' && (num_habitaciones === undefined || isNaN(num_habitaciones) || parseInt(num_habitaciones) < 0)) {
    return res.status(400).send('num_habitaciones debe ser un entero no negativo');
  }

  try {
    if (tabla === 'hoteles') {
      const result = await pool.query(`
        UPDATE hoteles
        SET nombre = $1, estrellas = $2, descripcion = $3, direccion = $4, iframe_mapa = $5, imagen_url = $6, num_habitaciones = $7
        WHERE id = $8
      `, [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones, id]);

      if (result.rowCount === 0) return res.status(404).send('Lugar no encontrado');
    } else {
      const result = await pool.query(`
        UPDATE ${tabla}
        SET nombre = $1, estrellas = $2, descripcion = $3, direccion = $4, iframe_mapa = $5, imagen_url = $6
        WHERE id = $7
      `, [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, id]);

      if (result.rowCount === 0) return res.status(404).send('Lugar no encontrado');
    }
    res.send('Actualizado correctamente');
  } catch (error) {
    console.error('Error al actualizar:', error);
    res.status(500).send('Error al actualizar');
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
