const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'petshop.db');

let sqliteDb = null;
let initPromise = null;
let supabaseClient = null;
let ultimaModificacaoTimestamp = Date.now();

// Registra modificação para polling inteligente
function registrarModificacao() {
  ultimaModificacaoTimestamp = Date.now();
}

function obterVersao() {
  return ultimaModificacaoTimestamp;
}

// Fuso horário fixo oficial do Brasil: America/Sao_Paulo
function obterDataHojeLocal() {
  try {
    const formato = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const partes = formato.formatToParts(new Date());
    const dia = partes.find(p => p.type === 'day').value;
    const mes = partes.find(p => p.type === 'month').value;
    const ano = partes.find(p => p.type === 'year').value;
    return `${ano}-${mes}-${dia}`;
  } catch (e) {
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
}

// Padronizar horário para 2 dígitos (ex: 9:00 -> 09:00)
function padronizarHorario(horario) {
  if (!horario) return '08:00';
  const partes = horario.trim().split(':');
  if (partes.length >= 2) {
    const hora = partes[0].padStart(2, '0');
    const minuto = partes[1].padStart(2, '0');
    return `${hora}:${minuto}`;
  }
  return horario.trim();
}

// Converter e validar valor numérico
function formatarValorNumerico(val) {
  if (val === undefined || val === null || val === '') return 0.0;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.round(val * 100) / 100 : 0.0;
  // Se for string no formato brasileiro (ex: "85,50" ou "R$ 85,00")
  const limpo = String(val).replace('R$', '').trim().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(limpo);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0.0;
}

// A TV recebe somente os campos necessários para exibir o atendimento.
function sanitizarFichaParaTV(ficha) {
  if (!ficha) return null;
  return {
    id: ficha.id,
    nome_cachorro: ficha.nome_cachorro,
    data_atendimento: ficha.data_atendimento,
    horario_atendimento: ficha.horario_atendimento,
    pacote: ficha.pacote,
    servicos: ficha.servicos,
    perfume: ficha.perfume,
    status: ficha.status,
    forma_entrega: ficha.forma_entrega || 'tutor'
  };
}

// Inicializar conexão: Supabase (nuvem / Netlify) OU SQLite (local)
async function initializeDatabase() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      const { createClient } = require('@supabase/supabase-js');
      supabaseClient = createClient(supabaseUrl, supabaseKey);
      console.log('☁️ Conectado ao banco de dados na nuvem (Supabase)');
      return { tipo: 'supabase', client: supabaseClient };
    }

    if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      throw new Error('SUPABASE_URL e SUPABASE_KEY são obrigatórias no ambiente Netlify.');
    }

    // Modo SQLite local
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      sqliteDb = new SQL.Database(fileBuffer);
    } else {
      sqliteDb = new SQL.Database();
    }

    sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS fichas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_cachorro TEXT NOT NULL,
        nome_tutor TEXT NOT NULL,
        telefone_tutor TEXT DEFAULT '',
        data_atendimento TEXT NOT NULL DEFAULT '',
        horario_atendimento TEXT NOT NULL DEFAULT '08:00',
        pacote TEXT NOT NULL DEFAULT 'Não',
        servicos TEXT NOT NULL,
        perfume TEXT NOT NULL DEFAULT 'Não',
        forma_entrega TEXT NOT NULL DEFAULT 'tutor',
        endereco_busca TEXT DEFAULT '',
        valor REAL DEFAULT 0.00,
        observacoes TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'aguardando',
        data_criacao TEXT DEFAULT (datetime('now', 'localtime')),
        data_conclusao TEXT DEFAULT NULL
      )
    `);

    // Migrações seguras no SQLite para colunas que possam não existir
    try { sqliteDb.run("ALTER TABLE fichas ADD COLUMN data_atendimento TEXT NOT NULL DEFAULT ''"); } catch (e) {}
    try { sqliteDb.run("ALTER TABLE fichas ADD COLUMN horario_atendimento TEXT NOT NULL DEFAULT '08:00'"); } catch (e) {}
    try { sqliteDb.run("ALTER TABLE fichas ADD COLUMN telefone_tutor TEXT DEFAULT ''"); } catch (e) {}
    try { sqliteDb.run("ALTER TABLE fichas ADD COLUMN forma_entrega TEXT NOT NULL DEFAULT 'tutor'"); } catch (e) {}
    try { sqliteDb.run("ALTER TABLE fichas ADD COLUMN endereco_busca TEXT DEFAULT ''"); } catch (e) {}
    try { sqliteDb.run("ALTER TABLE fichas ADD COLUMN valor REAL DEFAULT 0.00"); } catch (e) {}

    salvarNoDisco();
    console.log('💾 Conectado ao banco de dados local SQLite (petshop.db)');
    return { tipo: 'sqlite', client: sqliteDb };
  })();

  return initPromise;
}

function salvarNoDisco() {
  if (!sqliteDb) return;
  try {
    const data = sqliteDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {}
}

function queryToObjects(stmt) {
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row);
  }
  stmt.free();
  return results;
}

// ============ MÉTODOS CRUD UNIVERSAIS (SUPABASE + SQLITE) ============

async function criarFicha({
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
}) {
  await initializeDatabase();
  const dataAtend = (data_atendimento && data_atendimento.trim()) ? data_atendimento.trim() : obterDataHojeLocal();
  const horarioAtend = padronizarHorario(horario_atendimento);
  const telefone = telefone_tutor ? telefone_tutor.trim() : '';
  const entrega = forma_entrega === 'driver' ? 'driver' : 'tutor';
  const endereco = entrega === 'driver' && endereco_busca ? endereco_busca.trim() : '';
  const valorNum = formatarValorNumerico(valor);

  registrarModificacao();

  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from('fichas')
      .insert([{
        nome_cachorro: nome_cachorro.trim(),
        nome_tutor: nome_tutor.trim(),
        telefone_tutor: telefone,
        data_atendimento: dataAtend,
        horario_atendimento: horarioAtend,
        pacote: pacote || 'Não',
        servicos,
        perfume: perfume || 'Não',
        forma_entrega: entrega,
        endereco_busca: endereco,
        valor: valorNum,
        observacoes: observacoes ? observacoes.trim() : '',
        status: 'aguardando'
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // SQLite local
  sqliteDb.run(
    `INSERT INTO fichas (
       nome_cachorro, nome_tutor, telefone_tutor, data_atendimento, horario_atendimento,
       pacote, servicos, perfume, forma_entrega, endereco_busca, valor, observacoes, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando')`,
    [
      nome_cachorro.trim(),
      nome_tutor.trim(),
      telefone,
      dataAtend,
      horarioAtend,
      pacote || 'Não',
      servicos,
      perfume || 'Não',
      entrega,
      endereco,
      valorNum,
      observacoes ? observacoes.trim() : ''
    ]
  );

  const lastId = sqliteDb.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
  salvarNoDisco();
  return await buscarFichaPorId(lastId);
}

async function atualizarFicha(id, {
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
}) {
  await initializeDatabase();
  const fichaAtual = await buscarFichaPorId(id);
  if (!fichaAtual) return null;

  registrarModificacao();

  const dataAtend = data_atendimento ? data_atendimento.trim() : fichaAtual.data_atendimento;
  const horarioAtend = horario_atendimento ? padronizarHorario(horario_atendimento) : fichaAtual.horario_atendimento;
  const telefone = telefone_tutor !== undefined ? telefone_tutor.trim() : (fichaAtual.telefone_tutor || '');
  const entrega = forma_entrega !== undefined ? (forma_entrega === 'driver' ? 'driver' : 'tutor') : (fichaAtual.forma_entrega || 'tutor');
  const endereco = entrega === 'driver' ? (endereco_busca !== undefined ? endereco_busca.trim() : (fichaAtual.endereco_busca || '')) : '';
  const valorNum = valor !== undefined ? formatarValorNumerico(valor) : (fichaAtual.valor || 0.0);

  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from('fichas')
      .update({
        nome_cachorro: nome_cachorro.trim(),
        nome_tutor: nome_tutor.trim(),
        telefone_tutor: telefone,
        data_atendimento: dataAtend,
        horario_atendimento: horarioAtend,
        pacote: pacote || fichaAtual.pacote,
        servicos: servicos || fichaAtual.servicos,
        perfume: perfume || fichaAtual.perfume,
        forma_entrega: entrega,
        endereco_busca: endereco,
        valor: valorNum,
        observacoes: observacoes !== undefined ? observacoes.trim() : fichaAtual.observacoes
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // SQLite local
  sqliteDb.run(
    `UPDATE fichas
     SET nome_cachorro = ?,
         nome_tutor = ?,
         telefone_tutor = ?,
         data_atendimento = ?,
         horario_atendimento = ?,
         pacote = ?,
         servicos = ?,
         perfume = ?,
         forma_entrega = ?,
         endereco_busca = ?,
         valor = ?,
         observacoes = ?
     WHERE id = ?`,
    [
      nome_cachorro.trim(),
      nome_tutor.trim(),
      telefone,
      dataAtend,
      horarioAtend,
      pacote || fichaAtual.pacote,
      servicos || fichaAtual.servicos,
      perfume || fichaAtual.perfume,
      entrega,
      endereco,
      valorNum,
      observacoes !== undefined ? observacoes.trim() : fichaAtual.observacoes,
      id
    ]
  );

  salvarNoDisco();
  return await buscarFichaPorId(id);
}

async function buscarFichaPorId(id) {
  await initializeDatabase();

  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from('fichas')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  const stmt = sqliteDb.prepare('SELECT * FROM fichas WHERE id = ?');
  stmt.bind([id]);
  const results = queryToObjects(stmt);
  return results.length > 0 ? results[0] : null;
}

async function listarFichasPorData(data) {
  await initializeDatabase();

  if (supabaseClient) {
    const { data: fichas, error } = await supabaseClient
      .from('fichas')
      .select('*')
      .eq('status', 'aguardando')
      .eq('data_atendimento', data)
      .order('horario_atendimento', { ascending: true })
      .order('id', { ascending: true });

    if (error) throw error;
    return fichas || [];
  }

  const stmt = sqliteDb.prepare(`
    SELECT * FROM fichas
    WHERE status = 'aguardando' AND data_atendimento = ?
    ORDER BY horario_atendimento ASC, id ASC
  `);
  stmt.bind([data]);
  return queryToObjects(stmt);
}

async function listarTodasFichasAtivas() {
  await initializeDatabase();

  if (supabaseClient) {
    const { data: fichas, error } = await supabaseClient
      .from('fichas')
      .select('*')
      .eq('status', 'aguardando')
      .order('data_atendimento', { ascending: true })
      .order('horario_atendimento', { ascending: true })
      .order('id', { ascending: true });

    if (error) throw error;
    return fichas || [];
  }

  const stmt = sqliteDb.prepare(`
    SELECT * FROM fichas
    WHERE status = 'aguardando'
    ORDER BY data_atendimento ASC, horario_atendimento ASC, id ASC
  `);
  return queryToObjects(stmt);
}

async function concluirFicha(id) {
  await initializeDatabase();
  registrarModificacao();

  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from('fichas')
      .update({
        status: 'concluido',
        data_conclusao: new Date().toISOString()
      })
      .eq('id', id)
      .eq('status', 'aguardando')
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }

  sqliteDb.run(
    `UPDATE fichas
     SET status = 'concluido', data_conclusao = datetime('now', 'localtime')
     WHERE id = ? AND status = 'aguardando'`,
    [id]
  );
  salvarNoDisco();
  const ficha = await buscarFichaPorId(id);
  return ficha && ficha.status === 'concluido';
}

async function cancelarFicha(id) {
  await initializeDatabase();
  registrarModificacao();

  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from('fichas')
      .update({
        status: 'cancelado',
        data_conclusao: new Date().toISOString()
      })
      .eq('id', id)
      .eq('status', 'aguardando')
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }

  sqliteDb.run(
    `UPDATE fichas
     SET status = 'cancelado', data_conclusao = datetime('now', 'localtime')
     WHERE id = ? AND status = 'aguardando'`,
    [id]
  );
  salvarNoDisco();
  const ficha = await buscarFichaPorId(id);
  return ficha && ficha.status === 'cancelado';
}

async function listarHistorico(limite = 50, offset = 0) {
  await initializeDatabase();

  if (supabaseClient) {
    const { data: fichas, error } = await supabaseClient
      .from('fichas')
      .select('*')
      .in('status', ['concluido', 'cancelado'])
      .order('data_conclusao', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limite - 1);

    if (error) throw error;
    return fichas || [];
  }

  const stmt = sqliteDb.prepare(`
    SELECT * FROM fichas
    WHERE status IN ('concluido', 'cancelado')
    ORDER BY data_conclusao DESC, id DESC
    LIMIT ? OFFSET ?
  `);
  stmt.bind([limite, offset]);
  return queryToObjects(stmt);
}

async function contarHistorico() {
  await initializeDatabase();

  if (supabaseClient) {
    const { count, error } = await supabaseClient
      .from('fichas')
      .select('*', { count: 'exact', head: true })
      .in('status', ['concluido', 'cancelado']);

    if (error) throw error;
    return count || 0;
  }

  const result = sqliteDb.exec("SELECT COUNT(*) as total FROM fichas WHERE status IN ('concluido', 'cancelado')");
  return result.length > 0 ? result[0].values[0][0] : 0;
}

function fecharDb() {
  if (sqliteDb) {
    salvarNoDisco();
    sqliteDb.close();
    sqliteDb = null;
    initPromise = null;
  }
}

module.exports = {
  initializeDatabase,
  obterDataHojeLocal,
  obterVersao,
  formatarValorNumerico,
  sanitizarFichaParaTV,
  criarFicha,
  atualizarFicha,
  buscarFichaPorId,
  listarFichasPorData,
  listarTodasFichasAtivas,
  concluirFicha,
  cancelarFicha,
  listarHistorico,
  contarHistorico,
  fecharDb
};
