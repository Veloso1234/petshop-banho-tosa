const express = require('express');
const path = require('path');
const db = require('./database/db');

const app = express();

// Middleware para JSON e arquivos estáticos
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ ROTAS DA API ============

// Obter a data atual do servidor (fuso America/Sao_Paulo) e versão da base para polling
app.get(['/api/hoje', '/.netlify/functions/api/hoje'], (req, res) => {
  res.json({
    dataHoje: db.obterDataHojeLocal(),
    versao: db.obterVersao()
  });
});

// Endpoint ultraleve de versão para polling inteligente
app.get(['/api/versao', '/.netlify/functions/api/versao'], (req, res) => {
  res.json({
    versao: db.obterVersao(),
    dataHoje: db.obterDataHojeLocal()
  });
});

// Criar nova ficha / agendamento (com novos campos: telefone, valor, entrega, endereco)
app.post(['/api/fichas', '/.netlify/functions/api/fichas'], async (req, res) => {
  try {
    const {
      nome_cachorro,
      nome_tutor,
      telefone_tutor,
      data_atendimento,
      horario_atendimento,
      pacote,
      servicos,
      perfume,
      forma_entrega,
      endereco_busca,
      valor,
      observacoes
    } = req.body;

    if (!nome_cachorro || !nome_cachorro.trim()) {
      return res.status(400).json({ erro: 'O nome do cachorro é obrigatório.' });
    }
    if (!nome_tutor || !nome_tutor.trim()) {
      return res.status(400).json({ erro: 'O nome do tutor é obrigatório.' });
    }
    if (!data_atendimento || !data_atendimento.trim()) {
      return res.status(400).json({ erro: 'A data do atendimento é obrigatória.' });
    }
    if (!horario_atendimento || !horario_atendimento.trim()) {
      return res.status(400).json({ erro: 'O horário do atendimento é obrigatório.' });
    }
    if (!servicos || !servicos.trim()) {
      return res.status(400).json({ erro: 'Selecione pelo menos um serviço.' });
    }
    if (forma_entrega === 'driver' && !(endereco_busca || '').trim()) {
      return res.status(400).json({ erro: 'Informe o endereço para busca do pet.' });
    }

    const ficha = await db.criarFicha({
      nome_cachorro,
      nome_tutor,
      telefone_tutor,
      data_atendimento,
      horario_atendimento,
      pacote: pacote || 'Não',
      servicos,
      perfume: perfume || 'Não',
      forma_entrega: forma_entrega || 'tutor',
      endereco_busca: endereco_busca || '',
      valor: valor || 0,
      observacoes: observacoes || ''
    });

    const io = req.app.get('io');
    if (io) {
      io.to('caixa').emit('nova-ficha', ficha);
      io.to('tv').emit('nova-ficha-tv', db.sanitizarFichaParaTV(ficha));
    }

    res.status(201).json({ mensagem: 'Ficha salva com sucesso! 🐶', ficha });
  } catch (error) {
    console.error('Erro ao criar ficha:', error);
    res.status(500).json({ erro: 'Erro ao salvar a ficha. Tente novamente.' });
  }
});

// Editar agendamento / ficha
app.put(['/api/fichas/:id', '/.netlify/functions/api/fichas/:id'], async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nome_cachorro,
      nome_tutor,
      telefone_tutor,
      data_atendimento,
      horario_atendimento,
      pacote,
      servicos,
      perfume,
      forma_entrega,
      endereco_busca,
      valor,
      observacoes
    } = req.body;

    if (!nome_cachorro || !nome_cachorro.trim()) {
      return res.status(400).json({ erro: 'O nome do cachorro é obrigatório.' });
    }
    if (!nome_tutor || !nome_tutor.trim()) {
      return res.status(400).json({ erro: 'O nome do tutor é obrigatório.' });
    }
    if (!data_atendimento || !data_atendimento.trim()) {
      return res.status(400).json({ erro: 'A data do atendimento é obrigatória.' });
    }
    if (!horario_atendimento || !horario_atendimento.trim()) {
      return res.status(400).json({ erro: 'O horário do atendimento é obrigatório.' });
    }
    if (!servicos || !servicos.trim()) {
      return res.status(400).json({ erro: 'Selecione pelo menos um serviço.' });
    }
    if (forma_entrega === 'driver' && !(endereco_busca || '').trim()) {
      return res.status(400).json({ erro: 'Informe o endereço para busca do pet.' });
    }

    const fichaAtualizada = await db.atualizarFicha(parseInt(id), {
      nome_cachorro,
      nome_tutor,
      telefone_tutor,
      data_atendimento,
      horario_atendimento,
      pacote,
      servicos,
      perfume,
      forma_entrega,
      endereco_busca,
      valor,
      observacoes
    });

    if (!fichaAtualizada) {
      return res.status(404).json({ erro: 'Ficha não encontrada.' });
    }

    const io = req.app.get('io');
    if (io) {
      io.to('caixa').emit('ficha-atualizada', fichaAtualizada);
      io.to('tv').emit('ficha-atualizada-tv', db.sanitizarFichaParaTV(fichaAtualizada));
    }

    res.json({ mensagem: 'Agendamento atualizado com sucesso! ✨', ficha: fichaAtualizada });
  } catch (error) {
    console.error('Erro ao editar ficha:', error);
    res.status(500).json({ erro: 'Erro ao atualizar a ficha.' });
  }
});

// Listar fichas de hoje (DESTINADA À TV - RIGOROSAMENTE SANITIZADA NO BACKEND)
// Somente campos de exibição são retornados; nomes/contatos, valores, endereço e observações ficam fora.
app.get(['/api/fichas/hoje', '/.netlify/functions/api/fichas/hoje'], async (req, res) => {
  try {
    const hoje = db.obterDataHojeLocal();
    const fichasBrutas = await db.listarFichasPorData(hoje);
    const fichasSanitizadas = fichasBrutas.map(db.sanitizarFichaParaTV);

    res.json({
      dataHoje: hoje,
      versao: db.obterVersao(),
      fichas: fichasSanitizadas
    });
  } catch (error) {
    console.error('Erro ao listar fichas de hoje:', error);
    res.status(500).json({ erro: 'Erro ao carregar as fichas de hoje.' });
  }
});

// Listar fichas por data específica (completo para o Caixa)
app.get(['/api/fichas/data/:data', '/.netlify/functions/api/fichas/data/:data'], async (req, res) => {
  try {
    const { data } = req.params;
    const fichas = await db.listarFichasPorData(data);
    res.json(fichas);
  } catch (error) {
    console.error('Erro ao listar fichas por data:', error);
    res.status(500).json({ erro: 'Erro ao carregar as fichas da data.' });
  }
});

// Listar todas as fichas ativas (completo para o Caixa)
app.get(['/api/fichas/ativas', '/.netlify/functions/api/fichas/ativas'], async (req, res) => {
  try {
    const fichas = await db.listarTodasFichasAtivas();
    res.json(fichas);
  } catch (error) {
    console.error('Erro ao listar fichas ativas:', error);
    res.status(500).json({ erro: 'Erro ao carregar as fichas.' });
  }
});

// Concluir atendimento
app.put(['/api/fichas/:id/concluir', '/.netlify/functions/api/fichas/:id/concluir'], async (req, res) => {
  try {
    const { id } = req.params;
    const sucesso = await db.concluirFicha(parseInt(id));

    if (sucesso) {
      const io = req.app.get('io');
      if (io) {
        io.to('caixa').emit('ficha-concluida', { id: parseInt(id) });
        io.to('tv').emit('ficha-concluida', { id: parseInt(id) });
      }
      res.json({ mensagem: 'Atendimento concluído com sucesso! ✅' });
    } else {
      res.status(404).json({ erro: 'Ficha não encontrada ou já finalizada.' });
    }
  } catch (error) {
    console.error('Erro ao concluir ficha:', error);
    res.status(500).json({ erro: 'Erro ao concluir a ficha. Tente novamente.' });
  }
});

// Cancelar agendamento
app.put(['/api/fichas/:id/cancelar', '/.netlify/functions/api/fichas/:id/cancelar'], async (req, res) => {
  try {
    const { id } = req.params;
    const sucesso = await db.cancelarFicha(parseInt(id));

    if (sucesso) {
      const io = req.app.get('io');
      if (io) {
        io.to('caixa').emit('ficha-cancelada', { id: parseInt(id) });
        io.to('tv').emit('ficha-cancelada', { id: parseInt(id) });
      }
      res.json({ mensagem: 'Agendamento cancelado com sucesso! ❌' });
    } else {
      res.status(404).json({ erro: 'Ficha não encontrada ou já finalizada.' });
    }
  } catch (error) {
    console.error('Erro ao cancelar ficha:', error);
    res.status(500).json({ erro: 'Erro ao cancelar o agendamento.' });
  }
});

// Listar histórico (completo para o Caixa)
app.get(['/api/fichas/historico', '/.netlify/functions/api/fichas/historico'], async (req, res) => {
  try {
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = parseInt(req.query.limite) || 20;
    const offset = (pagina - 1) * limite;

    const fichas = await db.listarHistorico(limite, offset);
    const total = await db.contarHistorico();
    const totalPaginas = Math.ceil(total / limite);

    res.json({ fichas, total, pagina, totalPaginas });
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    res.status(500).json({ erro: 'Erro ao carregar o histórico.' });
  }
});

// Páginas estáticas para ambiente local
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'caixa.html'));
});

app.get('/caixa.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'caixa.html'));
});

app.get('/tv', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});

app.get('/tv.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv.html'));
});

module.exports = app;
