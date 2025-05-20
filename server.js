const express = require('express');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Ruta de prueba para verificar conexión con la base de datos
app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.send(`La hora actual en la base de datos es: ${result.rows[0].now}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al conectar a la base de datos');
  }
});

// Servir archivos estáticos desde la raíz
app.use(express.static(__dirname));

// Ruta comodín para redirigir todo a index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

app.get('/crear-tabla-usuarios', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        apellido VARCHAR(100),
        telefono VARCHAR(20),
        correo VARCHAR(150) UNIQUE NOT NULL,
        sexo CHAR(1),
        contraseña TEXT NOT NULL,
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);
    res.send('Tabla usuarios creada correctamente.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al crear la tabla de usuarios');
  }
});

