const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos desde ProyectoMasde
app.use(express.static(path.join(__dirname, 'ProyectoMasde')));

// Ruta por defecto (index.html)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'ProyectoMasde', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});