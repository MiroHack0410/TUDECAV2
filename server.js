const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar conexión PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Middleware
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

// =====================
// INSERTAR ADMIN AUTOMÁTICO
// =====================
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
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }

    const token = jwt.sign({
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      correo: user.correo,
      rol: user.rol
    }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Enviar token en cookie httpOnly
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });

    res.json({ success: true, message: 'Inicio de sesión exitoso', role: user.rol });

  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});

// =====================
// OBTENER INFO DEL USUARIO LOGUEADO
// =====================
app.get('/usuario', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ loggedIn: false });

  try {
    const userData = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ loggedIn: true, user: userData });
  } catch {
    res.status(401).json({ loggedIn: false });
  }
});

// =====================
// CERRAR SESIÓN
// =====================
app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
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


