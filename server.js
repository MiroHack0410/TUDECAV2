const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'yajdielemirbaxinbaez0410';

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

app.use(cors({
  origin: 'https://tudecafront.onrender.com', // Cambia a tu frontend real
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(__dirname));
app.use('/Imagenes', express.static(path.join(__dirname, 'Imagenes')));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: 'https://tudecafront.onrender.com',
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

io.on('connection', (socket) => {
  console.log('Usuario conectado con socket id:', socket.id);

  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
  });
});

// Crear tablas si no existen
async function crearTablas() {
  try {
    // Tabla de hoteles
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hoteles (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        direccion TEXT,
        estrellas INTEGER,
        imagen_url TEXT,
        iframe_mapa TEXT,
        num_habitaciones INTEGER NOT NULL
      );
    `);

    // Tabla de usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuariosv2 (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        apellido TEXT NOT NULL,
        telefono TEXT,
        correo TEXT UNIQUE NOT NULL,
        sexo TEXT NOT NULL,
        password TEXT NOT NULL,
        rol INTEGER DEFAULT 2
      );
    `);

    // Tabla de reservas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reservas (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuariosv2(id),
        hotel_id INTEGER REFERENCES hoteles(id),
        num_habitacion INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        correo TEXT NOT NULL,
        celular TEXT NOT NULL,
        fecha_inicio DATE NOT NULL,
        fecha_fin DATE NOT NULL
      );
    `);

    console.log('✔ Tablas creadas correctamente (si no existían)');
  } catch (err) {
    console.error('❌ Error al crear tablas:', err);
  }
}

crearTablas(); // Ejecutar la función al iniciar


// Middleware para validar JWT en cookie
function autenticado(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).send('No autenticado');
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    console.log('Token inválido o expirado:', err.message);
    res.status(401).send('Token inválido');
  }
}

function esAdmin(req, res, next) {
  if (req.usuario?.rol !== 1) return res.status(403).send('Acceso denegado');
  next();
}

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

// Registro de usuario
app.post('/registro', async (req, res) => {
  const { nombre, apellido, telefono, correo, sexo, password } = req.body;
  if (!nombre || !apellido || !correo || !password || !sexo) {
    return res.status(400).json({ success: false, message: 'Faltan datos obligatorios' });
  }
  try {
    const { rowCount } = await pool.query('SELECT 1 FROM usuariosv2 WHERE correo = $1', [correo]);
    if (rowCount > 0) return res.status(409).json({ success: false, message: 'El correo ya está registrado' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO usuariosv2 (nombre, apellido, telefono, correo, sexo, password, rol)
       VALUES ($1, $2, $3, $4, $5, $6, 2)`,
      [nombre, apellido, telefono || '', correo, sexo, hashedPassword]
    );
    res.json({ success: true, message: 'Usuario registrado correctamente' });
  } catch (error) {
    console.error('Error en /registro:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
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
    res.cookie('token', token, {
      httpOnly: false,
      sameSite: isProduction ? 'None' : 'Lax',
      secure: isProduction,
      maxAge: 2 * 60 * 60 * 1000,
    });

    res.json({ mensaje: 'Login exitoso', rol: user.rol });
  } catch (e) {
    console.error('Error en /login:', e.message);
    res.status(500).send('Error de servidor');
  }
});

// Logout
app.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: false,
    sameSite: isProduction ? 'None' : 'Lax',
    secure: isProduction,
  });
  res.status(200).send('Logout exitoso');
});

// Perfil
app.get('/perfil', autenticado, async (req, res) => {
  try {
    const userId = req.usuario.id;
    const result = await pool.query(
      'SELECT id, nombre, apellido, correo, telefono, sexo, rol FROM usuariosv2 WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) return res.status(404).send('Usuario no encontrado');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en /perfil:', err.message);
    res.status(500).send('Error del servidor');
  }
});

// Listar todos los usuarios (solo admin)
app.get('/usuarios', autenticado, esAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuariosv2');
    res.json(result.rows);
  } catch (e) {
    res.status(500).send('Error del servidor');
  }
});

// Obtener un usuario por id (solo admin)
app.get('/usuarios/:id', autenticado, esAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM usuariosv2 WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).send('Usuario no encontrado');
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).send('Error del servidor');
  }
});

// Editar usuario (solo admin)
app.put('/usuarios/:id', autenticado, esAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nombre, apellido, telefono, correo, sexo, rol } = req.body;
    const result = await pool.query(
      `UPDATE usuariosv2 SET nombre=$1, apellido=$2, telefono=$3, correo=$4, sexo=$5, rol=$6 WHERE id=$7 RETURNING *`,
      [nombre, apellido, telefono, correo, sexo, rol, id]
    );
    if (result.rows.length === 0) return res.status(404).send('Usuario no encontrado');
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).send('Error del servidor');
  }
});

// Eliminar usuario (solo admin)
app.delete('/usuarios/:id', autenticado, esAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query('DELETE FROM usuariosv2 WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).send('Usuario no encontrado');
    res.send('Usuario eliminado');
  } catch (e) {
    res.status(500).send('Error del servidor');
  }
});

// Obtener lista general (hoteles, restaurantes, puntos de interés)
app.get('/api/:tipo', validarTipoLugar, async (req, res) => {
  try {
    const tabla = req.tabla;
    const result = await pool.query(`SELECT * FROM ${tabla}`);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error del servidor');
  }
});

// Obtener item por id (hoteles, restaurantes, puntos de interés)
app.get('/api/:tipo/:id', validarTipoLugar, async (req, res) => {
  try {
    const tabla = req.tabla;
    const id = parseInt(req.params.id);
    const result = await pool.query(`SELECT * FROM ${tabla} WHERE id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).send('No encontrado');
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).send('Error del servidor');
  }
});

// Agregar nuevo item (solo admin)
app.post('/api/:tipo', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  try {
    const tabla = req.tabla;
    // Para simplificar, asumo que recibes todas las columnas que necesites en req.body
    const cols = Object.keys(req.body);
    const vals = Object.values(req.body);

    const query = `
      INSERT INTO ${tabla} (${cols.join(',')})
      VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})
      RETURNING *`;
    const result = await pool.query(query, vals);
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al insertar');
  }
});

// Editar item (solo admin)
app.put('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  try {
    const tabla = req.tabla;
    const id = parseInt(req.params.id);
    const cols = Object.keys(req.body);
    const vals = Object.values(req.body);
    if (cols.length === 0) return res.status(400).send('No hay datos para actualizar');

    const sets = cols.map((col, i) => `${col}=$${i + 1}`).join(',');
    const query = `UPDATE ${tabla} SET ${sets} WHERE id=$${cols.length + 1} RETURNING *`;
    const result = await pool.query(query, [...vals, id]);
    if (result.rows.length === 0) return res.status(404).send('No encontrado');
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).send('Error al actualizar');
  }
});

// Eliminar item (solo admin)
app.delete('/api/:tipo/:id', autenticado, esAdmin, validarTipoLugar, async (req, res) => {
  try {
    const tabla = req.tabla;
    const id = parseInt(req.params.id);
    const result = await pool.query(`DELETE FROM ${tabla} WHERE id = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) return res.status(404).send('No encontrado');
    res.send('Eliminado');
  } catch (e) {
    res.status(500).send('Error al eliminar');
  }
});

app.post('/api/reservas', autenticado, async (req, res) => {
  try {
    const {
      id_hotel,
      num_habitacion,
      nombre,
      correo,
      celular,
      fecha_inicio,
      fecha_fin
    } = req.body;

    // Validación básica de datos
    if (!id_hotel || !num_habitacion || !nombre || !correo || !celular || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    // Validar que usuario esté autenticado
    const usuario_id = req.usuario?.id;
    if (!usuario_id) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    // Verificar que el hotel exista y obtener habitaciones disponibles
    const hotelRes = await pool.query('SELECT habitaciones FROM hoteles WHERE id = $1', [id_hotel]);
    if (hotelRes.rows.length === 0) {
      return res.status(404).json({ error: 'Hotel no encontrado' });
    }

    const habitaciones = parseInt(hotelRes.rows[0].habitaciones);
    if (isNaN(habitaciones) || habitaciones < 1) {
      return res.status(400).json({ error: 'No hay habitaciones disponibles' });
    }

    // Validar fechas
    const inicio = new Date(fecha_inicio);
    const fin = new Date(fecha_fin);
    if (isNaN(inicio.getTime()) || isNaN(fin.getTime()) || inicio >= fin) {
      return res.status(400).json({ error: 'Fechas inválidas' });
    }

    // Verificar que la habitación no esté ocupada para esas fechas
    const habitacionOcupada = await pool.query(
      `SELECT * FROM reservas WHERE hotel_id = $1 AND num_habitacion = $2
       AND (
         (fecha_inicio <= $3 AND fecha_fin >= $3) OR
         (fecha_inicio <= $4 AND fecha_fin >= $4) OR
         (fecha_inicio >= $3 AND fecha_fin <= $4)
       )`,
      [id_hotel, num_habitacion, fecha_inicio, fecha_fin]
    );
    if (habitacionOcupada.rows.length > 0) {
      return res.status(400).json({ error: 'La habitación ya está reservada para esas fechas' });
    }

    // Insertar nueva reserva con todos los datos
    await pool.query(
      `INSERT INTO reservas (usuario_id, hotel_id, num_habitacion, nombre, correo, celular, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [usuario_id, id_hotel, num_habitacion, nombre, correo, celular, fecha_inicio, fecha_fin]
    );

    // Descontar una habitación disponible
    await pool.query('UPDATE hoteles SET habitaciones = habitaciones - 1 WHERE id = $1', [id_hotel]);

    // Emitir evento en tiempo real para actualizar disponibilidad
    io.emit('actualizarHabitaciones', { id_hotel });

    res.json({ success: true, message: 'Reserva exitosa' });
  } catch (e) {
    console.error('Error al reservar:', e.message, e.stack);
    res.status(500).json({ error: 'Error al reservar' });
  }
});

// Obtener reservas del usuario autenticado
app.get('/misReservas', autenticado, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, h.nombre as hotel_nombre
       FROM reservas r
       JOIN hoteles h ON r.hotel_id = h.id
       WHERE r.usuario_id = $1`,
      [req.usuario.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).send('Error al obtener reservas');
  }
});

// Página 404 para rutas no encontradas
app.use((req, res) => {
  res.status(404).send('Ruta no encontrada');
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});
