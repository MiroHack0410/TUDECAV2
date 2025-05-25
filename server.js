const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Conexión PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// =====================
// CREAR TABLA USUARIOSV2
// =====================
pool.query(`
  CREATE TABLE IF NOT EXISTS usuariosv2 (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    apellido TEXT,
    telefono TEXT,
    correo TEXT UNIQUE NOT NULL,
    sexo TEXT,
    password TEXT NOT NULL,
    rol INTEGER NOT NULL CHECK (rol IN (1, 2))
  )
`, (err) => {
  if (err) {
    console.error('Error al crear tabla usuariosv2:', err);
  } else {
    console.log('Tabla usuariosv2 verificada/creada');
  }
});

// =====================
// REGISTRO DE TURISTA
// =====================
app.post('/registro', async (req, res) => {
  const { nombre, apellido, telefono, correo, sexo, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(`
      INSERT INTO usuariosv2 (nombre, apellido, telefono, correo, sexo, password, rol)
      VALUES ($1, $2, $3, $4, $5, $6, 2)
    `, [nombre, apellido, telefono, correo, sexo, hashedPassword]);

    res.send('Usuario registrado exitosamente');
  } catch (err) {
    console.error('Error al registrar turista:', err);
    res.status(500).send('Error al registrar usuario');
  }
});

// =====================
// INICIO DE SESIÓN
// =====================
app.post('/login', async (req, res) => {
  const { usuario, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM usuariosv2 WHERE correo = $1',
      [usuario]
    );

    if (result.rows.length === 0) {
      return res.status(401).send('Usuario no encontrado');
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).send('Contraseña incorrecta');
    }

    if (user.rol === 1) {
      res.redirect('/admin.html');
    } else if (user.rol === 2) {
      res.redirect('/index.html');
    } else {
      res.status(403).send('Rol no autorizado');
    }
  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).send('Error del servidor');
  }
});

// =====================
// RUTA POR DEFECTO
// =====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
