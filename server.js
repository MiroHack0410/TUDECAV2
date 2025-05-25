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
  ssl: { rejectUnauthorized: false }, // Ajusta esto según Render/local
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================
// RUTAS PARA ADMINISTRAR DB
// ==========================

// Crear tabla administrador
app.get('/crear-tabla-admin', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        correo VARCHAR(150) UNIQUE NOT NULL,
        contraseña TEXT NOT NULL
      );
    `);
    res.send('Tabla admin creada correctamente.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al crear la tabla admin');
  }
});

app.get('/insertar-admin', async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO admin (nombre, correo, contraseña)
      VALUES ($1, $2, $3)
    `, ['emir', 'emirbaxin@gmai.com', 'emirb0410']);

    res.send('Administrador insertado correctamente.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al insertar el administrador');
  }
});


// =====================
// ARCHIVOS ESTÁTICOS
// =====================
app.use(express.static(__dirname));

// Redirección para rutas no definidas (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// =====================
// INICIAR SERVIDOR
// =====================
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});


