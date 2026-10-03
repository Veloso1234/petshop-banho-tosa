const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const db = require('./database/db');

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Disponibiliza a instância do Socket.IO nas rotas do Express
app.set('io', io);

const PORT = process.env.PORT || 3000;

// ============ WEBSOCKET ============

io.on('connection', (socket) => {
  socket.on('registrar-caixa', () => socket.join('caixa'));
  socket.on('registrar-tv', () => socket.join('tv'));

  socket.on('solicitar-fichas-hoje', async () => {
    try {
      const hoje = db.obterDataHojeLocal();
      const fichasBrutas = await db.listarFichasPorData(hoje);
      const fichas = fichasBrutas.map(db.sanitizarFichaParaTV);
      socket.emit('fichas-hoje', { dataHoje: hoje, fichas });
    } catch (e) {
      console.error('Erro ao enviar fichas hoje:', e);
    }
  });

  socket.on('solicitar-todas-ativas', async () => {
    try {
      const fichas = await db.listarTodasFichasAtivas();
      const dados = socket.rooms.has('caixa')
        ? fichas
        : fichas.map(db.sanitizarFichaParaTV);
      socket.emit('todas-ativas', dados);
    } catch (e) {
      console.error('Erro ao enviar todas ativas:', e);
    }
  });
});

// ============ INICIAR SERVIDOR LOCAL ============

async function iniciar() {
  await db.initializeDatabase();

  server.listen(PORT, () => {
    console.log('');
    console.log('🐾 ====================================');
    console.log('🐾  PET SHOP - BANHO E TOSA + AGENDAMENTOS');
    console.log('🐾 ====================================');
    console.log('');
    console.log(`🖥️  Tela do Caixa:  http://localhost:${PORT}/caixa.html`);
    console.log(`📺  Tela da TV:     http://localhost:${PORT}/tv.html`);
    console.log('');
    console.log('🟢 Sistema pronto para uso!');
    console.log('');
  });
}

iniciar().catch(err => {
  console.error('Erro ao iniciar o sistema:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  db.fecharDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.fecharDb();
  process.exit(0);
});
