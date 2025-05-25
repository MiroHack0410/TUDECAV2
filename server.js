const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const pool = require('./dbPool'); // tu configuración del pool de PostgreSQL
const router = express.Router();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para leer formularios y JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Ruta para crear tabla usuarios
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

app.post('/register', async (req, res) => {
  const { nombre, apellido, telefono, correo, sexo, contraseña } = req.body;

  if (!nombre || !apellido || !telefono || !correo || !sexo || !contraseña) {
    return res.status(400).send('Completa todos los campos.');
  }

  try {
    // Aquí validación para evitar correos repetidos si quieres
    const existing = await pool.query('SELECT * FROM usuarios WHERE correo = $1', [correo]);
    if (existing.rows.length > 0) {
      return res.status(400).send('El correo ya está registrado.');
    }

    await pool.query(
      'INSERT INTO usuarios (nombre, apellido, telefono, correo, sexo, contraseña) VALUES ($1, $2, $3, $4, $5, $6)',
      [nombre, apellido, telefono, correo, sexo, contraseña]
    );

    res.send('Registro completado con éxito');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error del servidor');
  }
});


// Ruta para listar usuarios
app.get('/usuarios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al obtener usuarios');
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

app.use(express.json()); // Importante para parsear JSON en body

app.post('/login', async (req, res) => {
  const { correo, contraseña } = req.body;

  if (!correo || !contraseña) {
    return res.status(400).send('Completa todos los campos.');
  }

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE correo = $1', [correo]);

    if (result.rows.length === 0) {
      return res.status(400).send('Correo incorrecto');
    }

    const usuario = result.rows[0];

    if (usuario.contraseña !== contraseña) {
      return res.status(400).send('Contraseña incorrecta');
    }

    res.send('Inicio de sesión correcto');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error del servidor');
  }
});

// Ruta para crear la tabla negocios
app.get('/crear-tabla-negocios', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS negocios (
        id SERIAL PRIMARY KEY,
        tipo_negocio INTEGER NOT NULL CHECK (tipo_negocio IN (1, 2, 3)), -- 1: Hoteles, 2: Restaurantes, 3: Puntos de interés
        correo VARCHAR(150) UNIQUE NOT NULL,
        contraseña TEXT NOT NULL,
        creado_en TIMESTAMP DEFAULT NOW()
      );
    `);
    res.send('Tabla negocios creada correctamente.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al crear la tabla de negocios');
  }
});

// Middleware para validar token JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.status(401).json({ error: 'Token no proporcionado' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });

    req.user = user; // user contiene los datos del payload del token
    next();
  });
}

// Ruta para obtener negocio por ID
router.get('/negocio/:id', authenticateToken, async (req, res) => {
  const negocioId = parseInt(req.params.id);
  const userId = req.user.id; // Id del usuario almacenado en el token

  try {
    // Verifica que el negocio consultado pertenece al usuario autenticado
    // Supongamos que en tu tabla negocios tienes un campo "user_id" que indica el dueño
    const query = 'SELECT id, tipo_negocio, correo, nombre, descripcion, direccion, mapa_url FROM negocios WHERE id = $1 AND user_id = $2';
    const { rows } = await pool.query(query, [negocioId, userId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Negocio no encontrado o no autorizado' });
    }

    // Retornamos los datos del negocio (excluyendo contraseña y datos sensibles)
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el negocio' });
  }
});

module.exports = router;




