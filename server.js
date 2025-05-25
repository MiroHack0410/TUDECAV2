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
  ssl: { rejectUnauthorized: false }, // Ajusta según tu entorno
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ruta para eliminar la tabla negocios (solo para reset)
app.get('/eliminar-tabla-negocios', async (req, res) => {
  try {
    await pool.query('DROP TABLE IF EXISTS negocios;');
    res.send('Tabla negocios eliminada correctamente.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al eliminar la tabla de negocios');
  }
});

// Ruta para crear la tabla negocios (si no existe)
app.get('/crear-tabla-negocios', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS negocios (
        id SERIAL PRIMARY KEY,
        correo VARCHAR(150) UNIQUE NOT NULL,
        contraseña TEXT NOT NULL,
        tipo_negocio INTEGER NOT NULL CHECK (tipo_negocio IN (1, 2, 3))
      );
    `);
    res.send('Tabla negocios creada correctamente.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al crear la tabla de negocios');
  }
});

// Ruta para insertar hoteles (ejemplo de datos iniciales)
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
        `INSERT INTO negocios (correo, contraseña, tipo_negocio) VALUES ($1, $2, 1)
         ON CONFLICT (correo) DO NOTHING`,
        [hotel.correo, hash]
      );
    }
    res.send('Hoteles insertados correctamente.');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al insertar hoteles.');
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  const { correo, contraseña } = req.body;

  if (!correo || !contraseña) {
    return res.status(400).json({ message: 'Completa todos los campos.' });
  }

  try {
    const result = await pool.query('SELECT * FROM negocios WHERE correo = $1', [correo]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Correo incorrecto' });
    }

    const negocio = result.rows[0];
    const match = await bcrypt.compare(contraseña, negocio.contraseña);

    if (!match) {
      return res.status(401).json({ message: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      { id: negocio.id, correo: negocio.correo, tipo_negocio: negocio.tipo_negocio },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    let tipoNegocioTexto = '';
    switch (negocio.tipo_negocio) {
      case 1:
        tipoNegocioTexto = 'hotel';
        break;
      case 2:
        tipoNegocioTexto = 'restaurante';
        break;
      case 3:
        tipoNegocioTexto = 'otro';
        break;
      default:
        tipoNegocioTexto = 'otro';
    }

    res.json({ token, negocioId: negocio.id, tipo_negocio: tipoNegocioTexto });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
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

// Ruta protegida para obtener negocio por id
app.get('/negocio/:id', authenticateToken, async (req, res) => {
  const negocioId = parseInt(req.params.id);

  try {
    const { rows } = await pool.query(
      'SELECT id, correo, tipo_negocio FROM negocios WHERE id = $1',
      [negocioId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener el negocio' });
  }
});

// Ruta protegida para modificar negocio por id
app.put('/negocio/:id', authenticateToken, async (req, res) => {
  const negocioId = parseInt(req.params.id);
  const { correo, tipo_negocio, contraseña } = req.body;

  try {
    const hash = contraseña ? await bcrypt.hash(contraseña, 10) : undefined;

    const updateFields = [];
    const updateValues = [];
    let idx = 1;

    if (correo) {
      updateFields.push(`correo = $${idx++}`);
      updateValues.push(correo);
    }
    if (tipo_negocio) {
      updateFields.push(`tipo_negocio = $${idx++}`);
      updateValues.push(tipo_negocio);
    }
    if (hash) {
      updateFields.push(`contraseña = $${idx++}`);
      updateValues.push(hash);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No hay datos para actualizar' });
    }

    updateValues.push(negocioId); // para el WHERE

    const query = `UPDATE negocios SET ${updateFields.join(', ')} WHERE id = $${idx}`;

    await pool.query(query, updateValues);

    res.json({ mensaje: 'Negocio actualizado correctamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al actualizar el negocio' });
  }
});

// Servir archivos estáticos
app.use(express.static(__dirname));

// Ruta para manejar cualquier ruta no definida y enviar index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

