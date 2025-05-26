// server.js
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

// CORS
app.use(cors({
  origin: 'http://localhost:5173', // ⚠️ Cambia si usas otro frontend
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Archivos estáticos
app.use(express.static(__dirname));
app.use('/Imagenes', express.static(path.join(__dirname, 'Imagenes')));

// Agregar columnas si no existen
async function agregarColumnas() {
  try {
    await pool.query(`ALTER TABLE hoteles ADD COLUMN IF NOT EXISTS imagen_url TEXT;`);
    await pool.query(`ALTER TABLE hoteles ADD COLUMN IF NOT EXISTS num_habitaciones INTEGER;`);
    await pool.query(`ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS imagen_url TEXT;`);
    await pool.query(`ALTER TABLE puntos_interes ADD COLUMN IF NOT EXISTS imagen_url TEXT;`);
    console.log('✅ Columnas agregadas/verificadas');
  } catch (error) {
    console.error('❌ Error al agregar columnas:', error);
  }
}
agregarColumnas();

// Crear tablas si no existen
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
    console.log('✅ Tablas creadas/verificadas');
  } catch (error) {
    console.error('❌ Error al crear tablas:', error);
  }
})();

// Insertar admin por defecto
(async () => {
  const correo = 'admin@tudeca.com';
  const passwordPlano = 'emirbb18';
  try {
    const result = await pool.query('SELECT * FROM usuariosv2 WHERE correo = $1 AND rol = 1', [correo]);
    if (result.rows.length === 0) {
      const hashed = await bcrypt.hash(passwordPlano, 10);
      await pool.query(`INSERT INTO usuariosv2 (correo, password, rol) VALUES ($1, $2, 1)`, [correo, hashed]);
      console.log('✅ Admin insertado');
    }
  } catch (error) {
    console.error('❌ Error al insertar admin:', error);
  }
})();

// Validaciones
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

function autenticado(req, res, next) {
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
  if (req.usuario?.rol !== 1) return res.status(403).send('Acceso denegado');
  next();
}

// Registro
app.post('/registro', async (req, res) => {
  const { nombre, apellido, telefono, correo, sexo, password } = req.body;
  if (!correo || !password) return res.status(400).send('Correo y contraseña requeridos');
  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query(`
      INSERT INTO usuariosv2 (nombre, apellido, telefono, correo, sexo, password, rol)
      VALUES ($1, $2, $3, $4, $5, $6, 2)
    `, [nombre, apellido, telefono, correo, sexo, hashed]);
    res.send('Usuario registrado');
  } catch (err) {
    if (err.code === '23505') return res.status(400).send('Correo ya registrado');
    res.status(500).send('Error al registrar');
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
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ mensaje: 'Login exitoso', rol: user.rol });
  } catch (e) {
    res.status(500).send('Error de servidor');
  }
});

// Rutas CRUD
app.get('/api/:tipo', validarTipoLugar, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ${req.tabla} ORDER BY id DESC`);
    res.json(result.rows);
  } catch {
    res.status(500).send('Error al obtener');
  }
});

app.get('/api/:tipo/:id', validarTipoLugar, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ${req.tabla} WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).send('No encontrado');
    res.json(result.rows[0]);
  } catch {
    res.status(500).send('Error al obtener');
  }
});

app.post('/api/:tipo', autenticado, validarTipoLugar, async (req, res) => {
  const { nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones } = req.body;
  if (!nombre || !estrellas || !descripcion || !direccion || !iframe_mapa || !imagen_url)
    return res.status(400).send('Campos obligatorios faltantes');
  try {
    if (req.tabla === 'hoteles') {
      await pool.query(`
        INSERT INTO hoteles (nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones]);
    } else {
      await pool.query(`
        INSERT INTO ${req.tabla} (nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url]);
    }
    res.send('Insertado correctamente');
  } catch {
    res.status(500).send('Error al insertar');
  }
});

app.put('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  const { nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones } = req.body;
  try {
    if (req.tabla === 'hoteles') {
      await pool.query(`
        UPDATE hoteles SET nombre=$1, estrellas=$2, descripcion=$3, direccion=$4, iframe_mapa=$5, imagen_url=$6, num_habitaciones=$7
        WHERE id=$8
      `, [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, num_habitaciones, req.params.id]);
    } else {
      await pool.query(`
        UPDATE ${req.tabla} SET nombre=$1, estrellas=$2, descripcion=$3, direccion=$4, iframe_mapa=$5, imagen_url=$6
        WHERE id=$7
      `, [nombre, estrellas, descripcion, direccion, iframe_mapa, imagen_url, req.params.id]);
    }
    res.send('Actualizado correctamente');
  } catch {
    res.status(500).send('Error al actualizar');
  }
});

app.delete('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM ${req.tabla} WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) return res.status(404).send('No encontrado');
    res.send('Eliminado correctamente');
  } catch {
    res.status(500).send('Error al eliminar');
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
});
