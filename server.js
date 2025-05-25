const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configura conexión a PostgreSQL con pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Solo si usas base de datos remota con SSL
});

// Middleware para parsear JSON y urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/insertar-hoteles', async (req, res) => {
  const hoteles = [
    { correo: 'lafinca@catemaco.com', contraseña: 'lafinca123' },
    { correo: 'playacristal@catemaco.com', contraseña: 'cristal123' },
    { correo: 'lasbrisas@catemaco.com', contraseña: 'brisas123' },
    { correo: 'koniapan@catemaco.com', contraseña: 'koniapan123' },
    { correo: 'delangel@catemaco.com', contraseña: 'angel123' },
    { correo: 'dellago@catemaco.com', contraseña: 'lago123' },
    { correo: 'losarcos@catemaco.com', contraseña: 'arcos123' },
    { correo: 'pescador@catemaco.com', contraseña: 'pescador123' },
    { correo: 'irefel@catemaco.com', contraseña: 'irefel123' },
  ];

  try {
    for (const hotel of hoteles) {
      const hash = await bcrypt.hash(hotel.contraseña, 10);
      await pool.query(
        'INSERT INTO negocios (correo, contraseña, tipo_negocio) VALUES ($1, $2, 1) ON CONFLICT (correo) DO NOTHING',
        [hotel.correo, hash]
      );
    }
    res.send('Hoteles insertados correctamente.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al insertar hoteles.');
  }
});

// Registro de usuario
app.post('/register', async (req, res) => {
  const { nombre, apellido, telefono, correo, sexo, contraseña } = req.body;

  if (!nombre || !apellido || !telefono || !correo || !sexo || !contraseña) {
    return res.status(400).send('Completa todos los campos.');
  }

  try {
    const existing = await pool.query('SELECT * FROM usuarios WHERE correo = $1', [correo]);
    if (existing.rows.length > 0) {
      return res.status(400).send('El correo ya está registrado.');
    }

    const hash = await bcrypt.hash(contraseña, 10);

    await pool.query(
      'INSERT INTO usuarios (nombre, apellido, telefono, correo, sexo, contraseña) VALUES ($1, $2, $3, $4, $5, $6)',
      [nombre, apellido, telefono, correo, sexo, hash]
    );

    res.send('Registro completado con éxito');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error del servidor');
  }
});

// Login
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

    const match = await bcrypt.compare(contraseña, usuario.contraseña);
    if (!match) {
      return res.status(400).send('Contraseña incorrecta');
    }

    const token = jwt.sign(
      { id: usuario.id, correo: usuario.correo },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ mensaje: 'Inicio de sesión correcto', token });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error del servidor');
  }
});

// Middleware para validar token JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.status(401).json({ error: 'Token no proporcionado' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
}

// Obtener negocio por ID, solo si es del usuario autenticado
app.get('/negocio/:id', authenticateToken, async (req, res) => {
  const negocioId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    const query = `
      SELECT id, tipo_negocio, correo, nombre, descripcion, direccion, mapa_url 
      FROM negocios 
      WHERE id = $1 AND user_id = $2
    `;
    const { rows } = await pool.query(query, [negocioId, userId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Negocio no encontrado o no autorizado' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el negocio' });
  }
});

// Modificar negocio solo si es del usuario autenticado
app.put('/negocio/:id', authenticateToken, async (req, res) => {
  const negocioId = parseInt(req.params.id);
  const userId = req.user.id;
  const { nombre, descripcion, direccion, mapa_url } = req.body;

  try {
    const check = await pool.query('SELECT * FROM negocios WHERE id = $1 AND user_id = $2', [negocioId, userId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Negocio no encontrado o no autorizado' });
    }

    await pool.query(`
      UPDATE negocios SET nombre = $1, descripcion = $2, direccion = $3, mapa_url = $4 WHERE id = $5
    `, [nombre, descripcion, direccion, mapa_url, negocioId]);

    res.json({ mensaje: 'Negocio actualizado correctamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el negocio' });
  }
});

app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
