// ============================================
// PET SHOP - TELA DA TV (Frontend)
// Exclusivo para visualização dos cachorros do dia
// Ordenado automaticamente por horário de atendimento
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

let fichasMap = new Map();
let dataHojeISO = '';

// ============ UTILITÁRIOS DE DATA (America/Sao_Paulo) ============

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

function formatarDataCabecalho(dataISO) {
  if (!dataISO) return '';
  try {
    const [ano, mes, dia] = dataISO.split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);

    const diasSemana = [
      'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
      'Quinta-feira', 'Sexta-feira', 'Sábado'
    ];
    const meses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    const diaSemana = diasSemana[data.getDay()];
    const nomeMes = meses[data.getMonth()];

    return `Hoje: ${diaSemana}, ${String(dia).padStart(2, '0')} de ${nomeMes}`;
  } catch {
    return `Data: ${dataISO}`;
  }
}

function atualizarCabecalhoData() {
  const elemento = document.getElementById('tv-data-hoje');
  if (elemento && dataHojeISO) {
    elemento.textContent = formatarDataCabecalho(dataHojeISO);
  }
}

// ============ BUSCA DE DADOS ============

async function buscarFichasDoDia() {
  try {
    const res = await fetch('/api/fichas/hoje');
    if (!res.ok) return;
    const dados = await res.json();

    if (dados.dataHoje) {
      dataHojeISO = dados.dataHoje;
      atualizarCabecalhoData();
    }

    fichasMap.clear();
    if (Array.isArray(dados.fichas)) {
      dados.fichas.forEach(ficha => {
        fichasMap.set(ficha.id, ficha);
      });
    }

    renderizarFichas();
  } catch (e) {
    console.error('Erro ao buscar fichas da TV:', e);
  }
}

// ============ TEMPO REAL (SOCKET.IO) ============

if (socket) {
  socket.on('connect', () => {
    console.log('📺 TV conectada via WebSocket');
    socket.emit('registrar-tv');
    buscarFichasDoDia();
  });

  socket.on('fichas-hoje', ({ dataHoje, fichas }) => {
    dataHojeISO = dataHoje;
    atualizarCabecalhoData();
    fichasMap.clear();
    fichas.forEach(f => fichasMap.set(f.id, f));
    renderizarFichas();
  });

  socket.on('nova-ficha-tv', (ficha) => {
    if (ficha.data_atendimento === dataHojeISO) {
      fichasMap.set(ficha.id, ficha);
      renderizarFichas();
    }
  });

  socket.on('ficha-atualizada-tv', (ficha) => {
    if (ficha.data_atendimento === dataHojeISO) {
      fichasMap.set(ficha.id, ficha);
      renderizarFichas();
    } else {
      if (fichasMap.has(ficha.id)) {
        animarERemoverFicha(ficha.id);
      }
    }
  });

  socket.on('ficha-concluida', ({ id }) => {
    animarERemoverFicha(id);
  });

  socket.on('ficha-cancelada', ({ id }) => {
    animarERemoverFicha(id);
  });
}

// ============ TEMPO REAL LOCAL (BROADCASTCHANNEL) ============

if (petshopCanal) {
  petshopCanal.onmessage = (event) => {
    buscarFichasDoDia();
  };
}

// ============ POLLING (NETLIFY / MULTI-DISPOSITIVO) ============

// Atualiza somente a lista do dia, sem depender de estado em memória do servidor.
setInterval(buscarFichasDoDia, 2500);

function animarERemoverFicha(id) {
  const cardElement = document.getElementById(`tv-ficha-${id}`);
  if (cardElement) {
    cardElement.classList.add('removing');
    setTimeout(() => {
      fichasMap.delete(id);
      renderizarFichas();
    }, 400);
  } else {
    fichasMap.delete(id);
    renderizarFichas();
  }
}

// ============ RENDERIZAR FICHAS NA TV ============

function renderizarFichas() {
  const container = document.getElementById('tv-fichas');
  const vazioElement = document.getElementById('tv-vazio');
  const contadorElement = document.getElementById('tv-contador');

  if (!container || !vazioElement || !contadorElement) return;

  // Ordenação automática estrita por horário: do mais cedo para o mais tarde
  const fichas = Array.from(fichasMap.values()).sort((a, b) => {
    const hA = a.horario_atendimento || '00:00';
    const hB = b.horario_atendimento || '00:00';
    if (hA !== hB) return hA.localeCompare(hB);
    return a.id - b.id;
  });

  if (fichas.length === 0) {
    container.innerHTML = '';
    vazioElement.style.display = 'flex';
    contadorElement.textContent = '0 fichas';
  } else {
    vazioElement.style.display = 'none';
    contadorElement.textContent = `${fichas.length} ficha${fichas.length > 1 ? 's' : ''}`;
    container.innerHTML = fichas.map(ficha => criarCardTV(ficha)).join('');
  }
}

function criarCardTV(ficha) {
  const servicos = ficha.servicos.split(', ').map(s =>
    `<span class="tv-servico-badge">${escapeHtml(s)}</span>`
  ).join('');

  const horario = ficha.horario_atendimento || '08:00';

  return `
    <div class="tv-ficha-card" id="tv-ficha-${ficha.id}">
      <div class="tv-ficha-horario">🕐 ${escapeHtml(horario)}</div>
      <div class="tv-ficha-nome">🐶 ${escapeHtml(ficha.nome_cachorro)}</div>
      <div class="tv-ficha-detalhe">
        <span class="emoji">📦</span>
        <span><strong>Pacote:</strong> ${escapeHtml(ficha.pacote)}</span>
      </div>

      <div class="tv-ficha-detalhe">
        <span class="emoji">🛁</span>
        <span><strong>Serviço:</strong></span>
      </div>
      <div class="tv-ficha-servicos">
        ${servicos}
      </div>

      <div class="tv-delivery-indicator ${ficha.forma_entrega === 'driver' ? 'driver' : 'tutor'}">
        ${ficha.forma_entrega === 'driver' ? '🟠 Motorista busca' : '🟢 Tutor entrega'}
      </div>

      <div class="tv-ficha-detalhe" style="margin-top:12px;">
        <span class="emoji">🌸</span>
        <span><strong>Perfume:</strong> ${escapeHtml(ficha.perfume)}</span>
      </div>

    </div>
  `;
}

// ============ UTILITÁRIOS ============

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  dataHojeISO = obterDataHojeLocal();
  atualizarCabecalhoData();
  buscarFichasDoDia();
});
