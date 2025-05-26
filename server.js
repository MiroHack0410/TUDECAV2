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
const JWT_SECRET = process.env.JWT_SECRET || 'yajdielemirbaxinbaez0410';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// CORS configurado para cookies y frontend
app.use(cors({
  origin: 'http://localhost:5173', // Cambia si usas otro frontend
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Archivos estáticos
app.use(express.static(__dirname));
app.use('/Imagenes', express.static(path.join(__dirname, 'Imagenes')));

// --- Middleware autenticación JWT ---
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

// --- Ruta para obtener datos del usuario logueado ---
app.get('/perfil', autenticado, async (req, res) => {
  try {
    const userId = req.usuario.id;
    const result = await pool.query('SELECT id, nombre, apellido, correo, telefono, sexo, rol FROM usuariosv2 WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(404).send('Usuario no encontrado');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send('Error del servidor');
  }
});

// --- Login ---
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

// --- Logout: elimina la cookie JWT ---
app.post('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax' });
  res.status(200).send('Logout exitoso');
});

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

// Endpoint registro
app.post('/registro', async (req, res) => {
  const { nombre, apellido, telefono, correo, sexo, password } = req.body;

  if (!nombre || !apellido || !correo || !password || !sexo) {
    return res.status(400).json({ success: false, message: 'Faltan datos obligatorios' });
  }

  try {
    // Verificar si ya existe el correo
    const { rowCount } = await pool.query('SELECT 1 FROM usuariosv2 WHERE correo = $1', [correo]);
    if (rowCount > 0) {
      return res.status(409).json({ success: false, message: 'El correo ya está registrado' });
    }

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insertar usuario con rol=2
    await pool.query(
      `INSERT INTO usuariosv2 (nombre, apellido, telefono, correo, sexo, password, rol)
       VALUES ($1, $2, $3, $4, $5, $6, 2)`,
      [nombre, apellido, telefono || '', correo, sexo, hashedPassword]
    );

    return res.json({ success: true, message: 'Usuario registrado correctamente' });
  } catch (error) {
    console.error('Error en /registro:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

(async () => {  // <-- corregido bloque creación tabla reserva
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reserva (
        id SERIAL PRIMARY KEY,
        nombre_huesped TEXT NOT NULL,
        correo TEXT NOT NULL,
        celular TEXT NOT NULL,
        fecha_inicio DATE NOT NULL,
        fecha_fin DATE NOT NULL,
        num_habitacion INTEGER NOT NULL,
        hotel_id INTEGER REFERENCES hoteles(id)
      );
    `);
    console.log('✅ Tabla reserva creada/verificada');
  } catch (error) {
    console.error('❌ Error al crear tabla reserva:', error);
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

app.post('/iniciar-sesion', async (req, res) => {
  const { correo, contrasena } = req.body;

  if (!correo || !contrasena) {
    return res.status(400).send('Faltan datos');
  }

  try {
    const result = await pool.query(
      'SELECT * FROM usuario WHERE correo = $1 AND contrasena = $2',
      [correo, contrasena]
    );

    if (result.rows.length === 0) {
      return res.status(401).send('Credenciales incorrectas');
    }

    const usuario = result.rows[0];

    if (usuario.rol === 1) {
      res.json({ redireccion: 'admin.html' });
    } else if (usuario.rol === 2) {
      res.json({ redireccion: 'index.html' });
    } else {
      res.status(403).send('Rol no válido');
    }

  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).send('Error interno del servidor');
  }
});


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

// Obtener habitaciones reservadas para un hotel específico
app.get('/api/habitaciones/:hotelId', async (req, res) => {
  const hotelId = req.params.hotelId;
  try {
    const result = await pool.query(
      `SELECT num_habitacion FROM reserva WHERE hotel_id = $1`,
      [hotelId]
    );
    const habitacionesReservadas = result.rows.map(row => row.num_habitacion);
    res.json(habitacionesReservadas);
  } catch (error) {
    console.error('Error al obtener habitaciones reservadas:', error);
    res.status(500).send('Error interno del servidor');
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

app.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        console.error(err);
        return res.status(500).send('Error cerrando sesión');
      }
      res.clearCookie('connect.sid'); // cookie por defecto
      return res.status(200).send('Logout exitoso');
    });
  } else {
    res.status(200).send('Logout exitoso');
  }
});

app.post('/reservar', async (req, res) => {
  const { nombre_huesped, correo, celular, fecha_inicio, fecha_fin, num_habitacion, hotel_id } = req.body;

  if (!nombre_huesped || !correo || !celular || !fecha_inicio || !fecha_fin || !num_habitacion || !hotel_id) {
    return res.status(400).send('Faltan campos requeridos');
  }

  try {
    // Verificar si la habitación ya está reservada
    const result = await pool.query(`
      SELECT * FROM reserva
      WHERE hotel_id = $1 AND num_habitacion = $2
        AND (
          (fecha_inicio <= $3 AND fecha_fin >= $3) OR
          (fecha_inicio <= $4 AND fecha_fin >= $4)
        )
    `, [hotel_id, num_habitacion, fecha_inicio, fecha_fin]);

    if (result.rows.length > 0) {
      return res.status(409).send('Habitación ya reservada en ese período');
    }

    // Insertar la reserva
    await pool.query(`
      INSERT INTO reserva (nombre_huesped, correo, celular, fecha_inicio, fecha_fin, num_habitacion, hotel_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [nombre_huesped, correo, celular, fecha_inicio, fecha_fin, num_habitacion, hotel_id]);

    res.send('Reserva realizada con éxito');
  } catch (error) {
    console.error('Error al registrar reserva:', error);
    res.status(500).send('Error interno del servidor');
  }
});

app.get('/ver-hoteles', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM hoteles ORDER BY id DESC');
    res.send(`<pre>${JSON.stringify(result.rows, null, 2)}</pre>`);
  } catch (error) {
    console.error('Error al consultar hoteles:', error);
    res.status(500).send('Error al obtener hoteles');
  }
});



app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
