// ============================================
// PET SHOP - CAIXA COM AGENDAMENTOS E HORÁRIOS (Frontend)
// Compatível com Netlify e Servidor Local
// Fuso Horário Oficial: America/Sao_Paulo
// ============================================

// Sincronização local em 0ms entre abas (Caixa ↔ TV)
const petshopCanal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('petshop_realtime_sync') : null;

// Conexão Socket.IO segura (se disponível no ambiente)
let socket = null;
try {
  if (typeof io !== 'undefined') {
    socket = io({
      reconnectionAttempts: 5,
      timeout: 3000,
      autoConnect: true
    });
  }
} catch (e) {
  console.log('Ambiente sem servidor WebSocket contínuo (Netlify). Sincronização ativa via Polling e BroadcastChannel.');
}

let fichaParaConcluir = null;
let fichaParaCancelar = null;
let enviando = false;
let filtroAtual = 'hoje'; // 'hoje', 'amanha', 'todos', 'especifica'
let todasFichasAtivas = [];

// ============ UTILITÁRIOS DE DATA E HORA (America/Sao_Paulo) ============

function obterDataHojeISO() {
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

function adicionarDias(dataISO, dias) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  data.setDate(data.getDate() + dias);
  const novoAno = data.getFullYear();
  const novoMes = String(data.getMonth() + 1).padStart(2, '0');
  const novoDia = String(data.getDate()).padStart(2, '0');
  return `${novoAno}-${novoMes}-${novoDia}`;
}

function obterProximoSabadoISO(dataISO) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  const diaSemana = data.getDay(); // 0 = Domingo, 6 = Sábado
  let diasAteSabado = (6 - diaSemana + 7) % 7;
  if (diasAteSabado === 0) diasAteSabado = 7;
  return adicionarDias(dataISO, diasAteSabado);
}

function formatarDataBr(dataISO) {
  if (!dataISO) return '—';
  try {
    const partes = dataISO.split(' ')[0].split('-');
    if (partes.length === 3) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return dataISO;
  } catch {
    return dataISO;
  }
}

function obterDescricaoDia(dataISO) {
  const hoje = obterDataHojeISO();
  const amanha = adicionarDias(hoje, 1);

  if (dataISO === hoje) {
    return { rotulo: 'Hoje', classe: 'hoje' };
  } else if (dataISO === amanha) {
    return { rotulo: 'Amanhã', classe: 'amanha' };
  } else {
    const [ano, mes, dia] = dataISO.split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);
    const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const diaNome = diasSemana[data.getDay()] || '';
    return { rotulo: `${diaNome}, ${formatarDataBr(dataISO)}`, classe: 'futuro' };
  }
}

function definirDataRapida(opcao, elemento) {
  const hoje = obterDataHojeISO();
  const inputData = document.getElementById('data_atendimento');

  document.querySelectorAll('.btn-quick-date').forEach(b => b.classList.remove('active'));
  if (elemento) elemento.classList.add('active');

  if (opcao === 'hoje') {
    inputData.value = hoje;
  } else if (opcao === 'amanha') {
    inputData.value = adicionarDias(hoje, 1);
  } else if (opcao === 'sabado') {
    inputData.value = obterProximoSabadoISO(hoje);
  }
}

function definirHorarioRapido(horario, elemento) {
  const inputHorario = document.getElementById('horario_atendimento');
  inputHorario.value = horario;

  document.querySelectorAll('.btn-quick-time').forEach(b => b.classList.remove('active'));
  if (elemento) elemento.classList.add('active');
}

// Ordenação: Data ASC, Horário ASC, ID ASC
function ordenarFichas(fichas) {
  return fichas.sort((a, b) => {
    if (a.data_atendimento !== b.data_atendimento) {
      return a.data_atendimento.localeCompare(b.data_atendimento);
    }
    const hA = a.horario_atendimento || '00:00';
    const hB = b.horario_atendimento || '00:00';
    if (hA !== hB) {
      return hA.localeCompare(hB);
    }
    return a.id - b.id;
  });
}

function notificarAtualizacao() {
  if (petshopCanal) {
    try {
      petshopCanal.postMessage({ tipo: 'atualizacao', timestamp: Date.now() });
    } catch (e) {}
  }
}

// ============ ABAS ============

function trocarAba(aba) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  document.getElementById(`tab-${aba}`).classList.add('active');
  document.getElementById(`conteudo-${aba}`).classList.add('active');

  if (aba === 'fichas') {
    carregarFichasAtivas();
  } else if (aba === 'historico') {
    carregarHistorico(1);
  }
}

// ============ MÁSCARAS E FORMATAÇÃO (Telefone e Moeda) ============

function formatarMascaraTelefone(valor) {
  if (!valor) return '';
  let limpo = valor.replace(/\D/g, '').slice(0, 11);
  if (limpo.length <= 2) {
    return limpo.length > 0 ? `(${limpo}` : '';
  } else if (limpo.length <= 6) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2)}`;
  } else if (limpo.length <= 10) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
  } else {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7, 11)}`;
  }
}

function formatarMascaraMoeda(valor) {
  let limpo = String(valor || '').replace(/\D/g, '');
  if (!limpo) return '';
  let centavos = parseInt(limpo, 10);
  if (isNaN(centavos)) return '';
  let numero = (centavos / 100).toFixed(2);
  let partes = numero.split('.');
  let inteira = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  let decimal = partes[1];
  return `R$ ${inteira},${decimal}`;
}

function formatarMoedaExibicao(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const num = Number(valor);
  if (isNaN(num)) return '';
  return `R$ ${num.toFixed(2).replace('.', ',')}`;
}

function alternarCampoEndereco() {
  const isDriver = document.getElementById('entrega_driver')?.checked;
  const container = document.getElementById('container-endereco-busca');
  const inputEndereco = document.getElementById('endereco_busca');
  if (container) {
    container.style.display = isDriver ? 'block' : 'none';
    if (isDriver && inputEndereco) {
      inputEndereco.focus();
    }
  }
}

function alternarCampoEnderecoEdicao() {
  const isDriver = document.getElementById('edit-entrega-driver')?.checked;
  const container = document.getElementById('edit-container-endereco-busca');
  const inputEndereco = document.getElementById('edit-endereco-busca');
  if (container) {
    container.style.display = isDriver ? 'block' : 'none';
    if (isDriver && inputEndereco) {
      inputEndereco.focus();
    }
  }
}

function atualizarMascarasCampos() {
  ['telefone_tutor', 'edit-telefone-tutor'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = formatarMascaraTelefone(input.value);
  });

  ['valor', 'edit-valor'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = formatarMascaraMoeda(input.value);
  });
}

// ============ FORMULÁRIO DE CADASTRO ============

async function enviarFicha(event) {
  event.preventDefault();

  if (enviando) return;

  const nome_cachorro = document.getElementById('nome_cachorro').value.trim();
  const nome_tutor = document.getElementById('nome_tutor').value.trim();
  const telefone_tutor = document.getElementById('telefone_tutor').value.trim();
  const data_atendimento = document.getElementById('data_atendimento').value;
  const horario_atendimento = document.getElementById('horario_atendimento').value;

  if (!nome_tutor) {
    mostrarToast('Por favor, preencha o nome do tutor.', 'error');
    document.getElementById('nome_tutor').focus();
    return;
  }

  if (!nome_cachorro) {
    mostrarToast('Por favor, preencha o nome do cachorro.', 'error');
    document.getElementById('nome_cachorro').focus();
    return;
  }

  if (!data_atendimento) {
    mostrarToast('Por favor, escolha a data do atendimento.', 'error');
    document.getElementById('data_atendimento').focus();
    return;
  }

  if (!horario_atendimento) {
    mostrarToast('Por favor, informe o horário do atendimento.', 'error');
    document.getElementById('horario_atendimento').focus();
    return;
  }

  const servicosSelecionados = [];
  document.querySelectorAll('input[name="servico"]:checked').forEach(cb => {
    servicosSelecionados.push(cb.value);
  });

  if (servicosSelecionados.length === 0) {
    mostrarToast('Por favor, selecione pelo menos um serviço.', 'error');
    return;
  }

  const forma_entrega = document.querySelector('input[name="forma_entrega"]:checked')?.value || 'tutor';
  const endereco_busca = document.getElementById('endereco_busca')?.value.trim() || '';

  if (forma_entrega === 'driver' && !endereco_busca) {
    mostrarToast('Por favor, informe o endereço para busca do pet.', 'error');
    document.getElementById('endereco_busca').focus();
    return;
  }

  const valor = document.getElementById('valor').value.trim();
  const pacote = document.querySelector('input[name="pacote"]:checked')?.value || 'Não';
  const perfume = document.querySelector('input[name="perfume"]:checked')?.value || 'Não';
  const observacoes = document.getElementById('observacoes').value.trim();

  const dados = {
    nome_cachorro,
    nome_tutor,
    telefone_tutor,
    data_atendimento,
    horario_atendimento,
    pacote,
    servicos: servicosSelecionados.join(', '),
    perfume,
    observacoes,
    forma_entrega,
    endereco_busca,
    valor
  };

  enviando = true;
  const btnEnviar = document.getElementById('btn-enviar');
  btnEnviar.disabled = true;
  btnEnviar.innerHTML = '⏳ Enviando...';

  try {
    const response = await fetch('/api/fichas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });

    const resultado = await response.json();

    if (response.ok) {
      const infoDia = obterDescricaoDia(data_atendimento);
      mostrarToast(`Ficha de ${nome_cachorro} agendada para ${infoDia.rotulo} às ${horario_atendimento}! 🐶`, 'success');
      limparFormulario();
      await carregarFichasAtivas();
      notificarAtualizacao();
    } else {
      mostrarToast(resultado.erro || 'Erro ao enviar a ficha.', 'error');
    }
  } catch (error) {
    console.error('Erro:', error);
    mostrarToast('Erro de conexão com o sistema.', 'error');
  } finally {
    enviando = false;
    btnEnviar.disabled = false;
    btnEnviar.innerHTML = '🐾 ENVIAR PARA BANHO E TOSA';
  }
}

function limparFormulario() {
  document.getElementById('form-ficha').reset();
  const hoje = obterDataHojeISO();
  document.getElementById('data_atendimento').value = hoje;
  document.getElementById('horario_atendimento').value = '09:00';
  document.getElementById('pacote_nao').checked = true;
  document.getElementById('perfume_nao').checked = true;
  document.getElementById('entrega_tutor').checked = true;
  document.getElementById('endereco_busca').value = '';
  document.getElementById('telefone_tutor').value = '';
  document.getElementById('valor').value = '';
  alternarCampoEndereco();

  document.querySelectorAll('.btn-quick-date').forEach(b => b.classList.remove('active'));
  const btnHoje = document.querySelectorAll('.btn-quick-date')[0];
  if (btnHoje) btnHoje.classList.add('active');

  document.querySelectorAll('.btn-quick-time').forEach(b => b.classList.remove('active'));
  const btn09 = Array.from(document.querySelectorAll('.btn-quick-time')).find(b => b.textContent === '09:00');
  if (btn09) btn09.classList.add('active');
}

// ============ FICHAS / AGENDAMENTOS ============

async function carregarFichasAtivas() {
  try {
    const response = await fetch('/api/fichas/ativas');
    if (!response.ok) return;
    const fichas = await response.json();
    todasFichasAtivas = ordenarFichas(fichas);
    atualizarContadoresFiltros();
    renderizarListaFichas();
  } catch (error) {
    console.error('Erro ao carregar fichas:', error);
  }
}

function atualizarContadoresFiltros() {
  const hoje = obterDataHojeISO();
  const amanha = adicionarDias(hoje, 1);

  const qtdHoje = todasFichasAtivas.filter(f => f.data_atendimento === hoje).length;
  const qtdAmanha = todasFichasAtivas.filter(f => f.data_atendimento === amanha).length;
  const qtdTotal = todasFichasAtivas.length;

  const bHoje = document.getElementById('badge-count-hoje');
  const bAmanha = document.getElementById('badge-count-amanha');
  const bTodos = document.getElementById('badge-count-todos');

  if (bHoje) bHoje.textContent = `(${qtdHoje})`;
  if (bAmanha) bAmanha.textContent = `(${qtdAmanha})`;
  if (bTodos) bTodos.textContent = `(${qtdTotal})`;

  const contadorAba = document.getElementById('contador-fichas');
  if (contadorAba) {
    if (qtdHoje > 0) {
      contadorAba.textContent = `(${qtdHoje} hoje)`;
    } else if (qtdTotal > 0) {
      contadorAba.textContent = `(${qtdTotal})`;
    } else {
      contadorAba.textContent = '';
    }
  }
}

function aplicarFiltroData(tipo) {
  filtroAtual = tipo;

  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));

  if (tipo === 'hoje') {
    document.getElementById('filtro-btn-hoje').classList.add('active');
    document.getElementById('filtro-data-especifica').value = '';
  } else if (tipo === 'amanha') {
    document.getElementById('filtro-btn-amanha').classList.add('active');
    document.getElementById('filtro-data-especifica').value = '';
  } else if (tipo === 'todos') {
    document.getElementById('filtro-btn-todos').classList.add('active');
    document.getElementById('filtro-data-especifica').value = '';
  } else if (tipo === 'especifica') {
    // Escolher pelo calendário
  }

  renderizarListaFichas();
}

function renderizarListaFichas() {
  const container = document.getElementById('lista-fichas');
  if (!container) return;

  const hoje = obterDataHojeISO();
  const amanha = adicionarDias(hoje, 1);

  let fichasFiltradas = [];

  if (filtroAtual === 'hoje') {
    fichasFiltradas = todasFichasAtivas.filter(f => f.data_atendimento === hoje);
  } else if (filtroAtual === 'amanha') {
    fichasFiltradas = todasFichasAtivas.filter(f => f.data_atendimento === amanha);
  } else if (filtroAtual === 'todos') {
    fichasFiltradas = [...todasFichasAtivas];
  } else if (filtroAtual === 'especifica') {
    const dataEsp = document.getElementById('filtro-data-especifica').value;
    if (dataEsp) {
      fichasFiltradas = todasFichasAtivas.filter(f => f.data_atendimento === dataEsp);
    } else {
      fichasFiltradas = [...todasFichasAtivas];
    }
  }

  fichasFiltradas = ordenarFichas(fichasFiltradas);

  if (fichasFiltradas.length === 0) {
    let msgVazio = 'Nenhum agendamento para este filtro.';
    if (filtroAtual === 'hoje') msgVazio = 'Nenhum cachorro agendado para hoje.';
    else if (filtroAtual === 'amanha') msgVazio = 'Nenhum agendamento para amanhã.';

    container.innerHTML = `
      <div class="empty-state">
        <span class="emoji">🐕</span>
        <p>${msgVazio}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = fichasFiltradas.map(ficha => criarCardFicha(ficha)).join('');
}

function criarCardFicha(ficha) {
  const servicosBadges = ficha.servicos.split(', ').map(s =>
    `<span class="servico-badge">${escapeHtml(s)}</span>`
  ).join('');

  const obsHtml = ficha.observacoes
    ? `<div class="ficha-obs">📝 ${escapeHtml(ficha.observacoes)}</div>`
    : '';

  const diaInfo = obterDescricaoDia(ficha.data_atendimento);
  const horario = ficha.horario_atendimento || '08:00';
  const entrega = ficha.forma_entrega === 'driver'
    ? '<span class="ficha-entrega-badge driver">🟠 Motorista busca</span>'
    : '<span class="ficha-entrega-badge tutor">🟢 Tutor entrega</span>';
  const endereco = ficha.forma_entrega === 'driver' && ficha.endereco_busca
    ? `<div class="ficha-detalhe"><strong>Endereço para busca:</strong> ${escapeHtml(ficha.endereco_busca)}</div>`
    : '';
  const telefone = ficha.telefone_tutor
    ? `<div class="ficha-detalhe"><strong>Telefone:</strong> ${escapeHtml(ficha.telefone_tutor)}</div>`
    : '';

  return `
    <div class="ficha-card" id="ficha-${ficha.id}">
      <div class="ficha-info">
        <div class="ficha-header-top">
          <span class="ficha-horario-badge">🕐 ${escapeHtml(horario)}</span>
          <span class="ficha-nome">🐶 ${escapeHtml(ficha.nome_cachorro)}</span>
          <span class="ficha-data-badge ${diaInfo.classe}">📅 ${diaInfo.rotulo}</span>
        </div>
        <div class="ficha-detalhe"><strong>Tutor:</strong> ${escapeHtml(ficha.nome_tutor)}</div>
        ${telefone}
        <div class="ficha-detalhe"><strong>📦 Pacote:</strong> ${escapeHtml(ficha.pacote)}</div>
        <div class="ficha-detalhe"><strong>🛁 Serviços:</strong> ${servicosBadges}</div>
        <div class="ficha-detalhe"><strong>🌸 Perfume:</strong> ${escapeHtml(ficha.perfume)}</div>
        <div class="ficha-detalhe"><strong>💰 Valor:</strong> ${escapeHtml(formatarMoedaExibicao(ficha.valor))}</div>
        <div class="ficha-detalhe">${entrega}</div>
        ${endereco}
        ${obsHtml}
      </div>
      <div class="ficha-actions">
        <button class="btn-concluir" onclick="confirmarConclusao(${ficha.id}, '${escapeHtml(ficha.nome_cachorro)}')">
          ✅ CONCLUÍDO
        </button>
        <button class="btn-editar" onclick="abrirModalEdicao(${ficha.id})">
          ✏️ Editar
        </button>
        <button class="btn-cancelar" onclick="confirmarCancelamento(${ficha.id}, '${escapeHtml(ficha.nome_cachorro)}')">
          ❌ Cancelar
        </button>
      </div>
    </div>
  `;
}

// ============ EDIÇÃO DE AGENDAMENTO ============

function abrirModalEdicao(id) {
  const ficha = todasFichasAtivas.find(f => f.id === id);
  if (!ficha) return;

  document.getElementById('edit-id').value = ficha.id;
  document.getElementById('edit-nome-cachorro').value = ficha.nome_cachorro;
  document.getElementById('edit-nome-tutor').value = ficha.nome_tutor;
  document.getElementById('edit-telefone-tutor').value = ficha.telefone_tutor || '';
  document.getElementById('edit-data-atendimento').value = ficha.data_atendimento;
  document.getElementById('edit-horario-atendimento').value = ficha.horario_atendimento || '08:00';
  document.getElementById('edit-valor').value = ficha.valor ? formatarMoedaExibicao(ficha.valor) : '';

  const formaEntrega = ficha.forma_entrega || 'tutor';
  document.getElementById('edit-entrega-driver').checked = formaEntrega === 'driver';
  document.getElementById('edit-entrega-tutor').checked = formaEntrega !== 'driver';
  document.getElementById('edit-endereco-busca').value = ficha.endereco_busca || '';
  alternarCampoEnderecoEdicao();

  if (ficha.pacote === 'Sim') {
    document.getElementById('edit-pacote-sim').checked = true;
  } else {
    document.getElementById('edit-pacote-nao').checked = true;
  }

  if (ficha.perfume === 'Sim') {
    document.getElementById('edit-perfume-sim').checked = true;
  } else {
    document.getElementById('edit-perfume-nao').checked = true;
  }

  const servicos = ficha.servicos.split(', ');
  document.querySelectorAll('input[name="edit_servico"]').forEach(cb => {
    cb.checked = servicos.includes(cb.value);
  });

  document.getElementById('edit-observacoes').value = ficha.observacoes || '';

  document.getElementById('modal-editar').classList.add('show');
}

function fecharModalEdicao() {
  document.getElementById('modal-editar').classList.remove('show');
}

async function salvarEdicao(event) {
  event.preventDefault();

  const id = document.getElementById('edit-id').value;
  const nome_cachorro = document.getElementById('edit-nome-cachorro').value.trim();
  const nome_tutor = document.getElementById('edit-nome-tutor').value.trim();
  const telefone_tutor = document.getElementById('edit-telefone-tutor').value.trim();
  const data_atendimento = document.getElementById('edit-data-atendimento').value;
  const horario_atendimento = document.getElementById('edit-horario-atendimento').value;
  const forma_entrega = document.querySelector('input[name="edit_forma_entrega"]:checked')?.value || 'tutor';
  const endereco_busca = document.getElementById('edit-endereco-busca').value.trim();

  if (!nome_cachorro || !nome_tutor || !data_atendimento || !horario_atendimento) {
    mostrarToast('Preencha os campos obrigatórios (incluindo horário).', 'error');
    return;
  }

  if (forma_entrega === 'driver' && !endereco_busca) {
    mostrarToast('Por favor, informe o endereço para busca do pet.', 'error');
    document.getElementById('edit-endereco-busca').focus();
    return;
  }

  const servicosSelecionados = [];
  document.querySelectorAll('input[name="edit_servico"]:checked').forEach(cb => {
    servicosSelecionados.push(cb.value);
  });

  if (servicosSelecionados.length === 0) {
    mostrarToast('Selecione pelo menos um serviço.', 'error');
    return;
  }

  const pacote = document.querySelector('input[name="edit_pacote"]:checked')?.value || 'Não';
  const perfume = document.querySelector('input[name="edit_perfume"]:checked')?.value || 'Não';
  const observacoes = document.getElementById('edit-observacoes').value.trim();

  const dados = {
    nome_cachorro,
    nome_tutor,
    telefone_tutor,
    data_atendimento,
    horario_atendimento,
    pacote,
    servicos: servicosSelecionados.join(', '),
    perfume,
    observacoes,
    forma_entrega,
    endereco_busca,
    valor: document.getElementById('edit-valor').value.trim()
  };

  const btnSalvar = document.getElementById('btn-salvar-edicao');
  btnSalvar.disabled = true;
  btnSalvar.innerHTML = 'Salvando...';

  try {
    const response = await fetch(`/api/fichas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });

    const resultado = await response.json();

    if (response.ok) {
      fecharModalEdicao();
      mostrarToast(resultado.mensagem, 'success');
      await carregarFichasAtivas();
      notificarAtualizacao();
    } else {
      mostrarToast(resultado.erro || 'Erro ao atualizar.', 'error');
    }
  } catch (error) {
    console.error('Erro:', error);
    mostrarToast('Erro de conexão ao salvar alterações.', 'error');
  } finally {
    btnSalvar.disabled = false;
    btnSalvar.innerHTML = 'Salvar Alterações';
  }
}

// ============ CONCLUSÃO DE FICHA ============

function confirmarConclusao(id, nome) {
  fichaParaConcluir = id;
  document.getElementById('modal-mensagem').textContent =
    `Tem certeza que deseja concluir o atendimento de ${nome}?`;
  document.getElementById('modal-confirmar').classList.add('show');

  document.getElementById('btn-confirmar-concluir').onclick = () => concluirFicha();
}

function fecharModalConcluir() {
  fichaParaConcluir = null;
  document.getElementById('modal-confirmar').classList.remove('show');
}

async function concluirFicha() {
  if (!fichaParaConcluir) return;

  const id = fichaParaConcluir;
  fecharModalConcluir();

  try {
    const response = await fetch(`/api/fichas/${id}/concluir`, { method: 'PUT' });
    const resultado = await response.json();

    if (response.ok) {
      mostrarToast(resultado.mensagem, 'success');
      removerFichaDaInterface(id);
      notificarAtualizacao();
    } else {
      mostrarToast(resultado.erro || 'Erro ao concluir.', 'error');
    }
  } catch (error) {
    console.error('Erro:', error);
    mostrarToast('Erro de conexão.', 'error');
  }
}

// ============ CANCELAR AGENDAMENTO ============

function confirmarCancelamento(id, nome) {
  fichaParaCancelar = id;
  document.getElementById('modal-cancelar-mensagem').textContent =
    `Tem certeza que deseja cancelar o agendamento de ${nome}?`;
  document.getElementById('modal-cancelar').classList.add('show');

  document.getElementById('btn-confirmar-cancelar').onclick = () => cancelarFicha();
}

function fecharModalCancelar() {
  fichaParaCancelar = null;
  document.getElementById('modal-cancelar').classList.remove('show');
}

async function cancelarFicha() {
  if (!fichaParaCancelar) return;

  const id = fichaParaCancelar;
  fecharModalCancelar();

  try {
    const response = await fetch(`/api/fichas/${id}/cancelar`, { method: 'PUT' });
    const resultado = await response.json();

    if (response.ok) {
      mostrarToast(resultado.mensagem, 'success');
      removerFichaDaInterface(id);
      notificarAtualizacao();
    } else {
      mostrarToast(resultado.erro || 'Erro ao cancelar.', 'error');
    }
  } catch (error) {
    console.error('Erro:', error);
    mostrarToast('Erro de conexão.', 'error');
  }
}

function removerFichaDaInterface(id) {
  todasFichasAtivas = todasFichasAtivas.filter(f => f.id !== id);
  atualizarContadoresFiltros();

  const card = document.getElementById(`ficha-${id}`);
  if (card) {
    card.style.transition = 'all 0.3s ease-out';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
    setTimeout(() => {
      card.remove();
      renderizarListaFichas();
    }, 300);
  } else {
    renderizarListaFichas();
  }
}

// ============ HISTÓRICO ============

let paginaAtual = 1;

async function carregarHistorico(pagina) {
  paginaAtual = pagina;

  try {
    const response = await fetch(`/api/fichas/historico?pagina=${pagina}&limite=20`);
    const dados = await response.json();

    const container = document.getElementById('historico-container');

    if (dados.fichas.length === 0 && pagina === 1) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="emoji">📋</span>
          <p>Nenhuma ficha no histórico ainda.</p>
        </div>
      `;
      return;
    }

    let html = `
      <div class="historico-table-wrapper">
      <table class="historico-table">
        <thead>
          <tr>
            <th>Horário</th>
            <th>Data Atend.</th>
            <th>Cachorro</th>
            <th>Tutor</th>
            <th>Telefone</th>
            <th>Serviços</th>
            <th>Pacote</th>
            <th>Perfume</th>
            <th>Valor</th>
            <th>Forma de entrega</th>
            <th>Endereço para busca</th>
            <th>Observações</th>
            <th>Finalização</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    dados.fichas.forEach(ficha => {
      const dataAtendFormatada = formatarDataBr(ficha.data_atendimento);
      const horario = ficha.horario_atendimento || '—';
      const dataFinal = ficha.data_conclusao
        ? formatarDataHora(ficha.data_conclusao)
        : formatarDataHora(ficha.data_criacao);

      const obs = ficha.observacoes
        ? (ficha.observacoes.length > 35
          ? escapeHtml(ficha.observacoes.substring(0, 35)) + '...'
          : escapeHtml(ficha.observacoes))
        : '—';

      const statusBadge = ficha.status === 'cancelado'
        ? '<span class="status-badge cancelado">Cancelado</span>'
        : '<span class="status-badge concluido">Concluído</span>';

      html += `
        <tr>
          <td><strong>🕐 ${escapeHtml(horario)}</strong></td>
          <td>${dataAtendFormatada}</td>
          <td><strong>${escapeHtml(ficha.nome_cachorro)}</strong></td>
          <td>${escapeHtml(ficha.nome_tutor)}</td>
          <td>${escapeHtml(ficha.telefone_tutor || '—')}</td>
          <td>${escapeHtml(ficha.servicos)}</td>
          <td>${escapeHtml(ficha.pacote)}</td>
          <td>${escapeHtml(ficha.perfume)}</td>
          <td>${escapeHtml(formatarMoedaExibicao(ficha.valor) || '—')}</td>
          <td>${ficha.forma_entrega === 'driver' ? 'Motorista busca' : 'Tutor entrega'}</td>
          <td>${escapeHtml(ficha.forma_entrega === 'driver' ? (ficha.endereco_busca || '—') : '—')}</td>
          <td>${obs}</td>
          <td>${dataFinal}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';

    if (dados.totalPaginas > 1) {
      html += `
        <div class="paginacao">
          <button class="btn-pagina" onclick="carregarHistorico(${pagina - 1})" ${pagina <= 1 ? 'disabled' : ''}>
            ← Anterior
          </button>
          <span class="pagina-info">Página ${pagina} de ${dados.totalPaginas}</span>
          <button class="btn-pagina" onclick="carregarHistorico(${pagina + 1})" ${pagina >= dados.totalPaginas ? 'disabled' : ''}>
            Próxima →
          </button>
        </div>
      `;
    }

    container.innerHTML = html;
  } catch (error) {
    console.error('Erro ao carregar histórico:', error);
  }
}

// ============ TOAST (NOTIFICAÇÕES) ============

function mostrarToast(mensagem, tipo) {
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensagem;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============ UTILITÁRIOS ============

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatarDataHora(dataStr) {
  if (!dataStr) return '—';
  try {
    const data = new Date(dataStr.replace(' ', 'T'));
    return data.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dataStr;
  }
}

// ============ TEMPO REAL (SOCKET.IO + BROADCASTCHANNEL + POLLING) ============

if (socket) {
  socket.on('connect', () => {
    socket.emit('registrar-caixa');
  });

  socket.on('nova-ficha', (ficha) => {
    todasFichasAtivas.push(ficha);
    todasFichasAtivas = ordenarFichas(todasFichasAtivas);
    atualizarContadoresFiltros();
    renderizarListaFichas();
  });

  socket.on('ficha-atualizada', (ficha) => {
    const index = todasFichasAtivas.findIndex(f => f.id === ficha.id);
    if (index !== -1) {
      todasFichasAtivas[index] = ficha;
    }
    todasFichasAtivas = ordenarFichas(todasFichasAtivas);
    atualizarContadoresFiltros();
    renderizarListaFichas();
  });

  socket.on('ficha-concluida', ({ id }) => {
    removerFichaDaInterface(id);
  });

  socket.on('ficha-cancelada', ({ id }) => {
    removerFichaDaInterface(id);
  });
}

// Escuta canal local entre abas
if (petshopCanal) {
  petshopCanal.onmessage = (event) => {
    carregarFichasAtivas();
  };
}

// Atualiza a lista completa, sem depender de estado em memória do processo servidor.
setInterval(async () => {
  try {
    await carregarFichasAtivas();
  } catch (error) {
    console.error('Erro ao sincronizar agendamentos:', error);
  }
}, 4000);

// ============ INICIALIZAÇÃO ============

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('telefone_tutor').addEventListener('input', atualizarMascarasCampos);
  document.getElementById('edit-telefone-tutor').addEventListener('input', atualizarMascarasCampos);
  document.getElementById('valor').addEventListener('input', atualizarMascarasCampos);
  document.getElementById('edit-valor').addEventListener('input', atualizarMascarasCampos);

  const hoje = obterDataHojeISO();
  document.getElementById('data_atendimento').value = hoje;
  document.getElementById('horario_atendimento').value = '09:00';

  carregarFichasAtivas();

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('show');
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('show'));
    }
  });
});
