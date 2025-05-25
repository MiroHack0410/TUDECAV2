const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_aqui';

// Conexión PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));

// =====================
// CREAR TABLA USUARIOSV2
// =====================
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

// Inserción admin automática (igual que antes)
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
// INICIO DE SESIÓN (login)
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

    // Crear token JWT con datos básicos
    const token = jwt.sign(
      { id: user.id, correo: user.correo, nombre: user.nombre, rol: user.rol },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    // Guardar token en cookie httpOnly (más seguro)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // solo https en prod
      maxAge: 2 * 60 * 60 * 1000, // 2 horas
      sameSite: 'lax'
    });

    res.json({ mensaje: 'Login exitoso', rol: user.rol });

  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).send('Error del servidor');
  }
});

// =====================
// OBTENER DATOS DEL USUARIO LOGUEADO
// =====================
app.get('/me', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).send('No autenticado');

  try {
    const userData = jwt.verify(token, JWT_SECRET);
    res.json(userData);
  } catch (err) {
    res.status(401).send('Token inválido');
  }
});

// =====================
// CERRAR SESIÓN (logout)
// =====================
app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.send('Sesión cerrada');
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
