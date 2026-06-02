/* ============================================================
   ADEDONHA SENAI — game.js  v4.0
   Backend: Firebase Realtime Database (REST API, plano Spark)
   ============================================================ */

'use strict';

// ══════════════════════════════════════════════════════════════
//  FIREBASE CONFIG
//  Substitua pela URL do seu projeto Firebase.
//  Formato: https://SEU-PROJETO-default-rtdb.firebaseio.com
// ══════════════════════════════════════════════════════════════
const FIREBASE_URL = 'https://adedonha-senai-default-rtdb.firebaseio.com';

// ── REST helpers ──────────────────────────────────────────────
async function fbGet(path) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fbSet(path, data) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return r.ok;
  } catch { return false; }
}

async function fbPatch(path, data) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return r.ok;
  } catch { return false; }
}

// ══════════════════════════════════════════════════════════════
//  CONSTANTES
// ══════════════════════════════════════════════════════════════
const ALPHABET = 'ABCDEFGHIJLMNOPRSTUVZ'.split('');
const DEF_CATS = ['Nome', 'Animal', 'Cidade', 'Fruta', 'Cor', 'Profissão', 'Objeto'];
const POLL_MS  = 1500;

// ══════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════
let S = {
  myName:       '',
  myId:         '',
  roomCode:     '',
  isHost:       false,
  isSpectator:  false,

  players:      {},
  config:       { time: 90, rounds: 5, cats: [...DEF_CATS] },

  currentRound:  0,
  currentLetter: '',
  usedLetters:   [],

  myAnswers:    {},   // só as respostas do próprio jogador (local)
  allAnswers:   {},   // todas as respostas (só populado na fase scoring)
  scoring:      {},
  roundScores:  {},
  metrics:      {},

  timer:        null,
  timeLeft:     90,
  paused:       false,
  startedAt:    null,
  stoppedBy:    null,
  phase:        'lobby',
  pollId:       null,
  _collecting:  false,
};

// sentinelas de poll
let _lastPhase       = '';
let _lastRound       = -1;
let _lastPlayerCount = 0;
let _lastStoppedBy   = null;
let _answerDebounce  = null;

// ── Caminhos Firebase (separados da sala principal) ──
const roomPath     = () => `rooms/${S.roomCode}/meta`;
const playersPath  = () => `rooms/${S.roomCode}/meta/players`;
const myAnsPath    = () => `rooms/${S.roomCode}/answers/${S.currentRound}/${S.myId}`;
const allAnsPath   = () => `rooms/${S.roomCode}/answers/${S.currentRound}`;
// contagem de "respondidos" — só boolean, sem revelar texto
const readyPath    = () => `rooms/${S.roomCode}/ready/${S.currentRound}`;

// ── DOM helpers ──
const el           = id  => document.getElementById(id);
function showErr(id, msg) { const e = el(id); e.style.display = 'block'; e.textContent = msg; }
function hideErr(id)      { const e = el(id); if (e) e.style.display = 'none'; }
function uid()            { return Math.random().toString(36).slice(2, 10); }

// ══════════════════════════════════════════════════════════════
//  NAVEGAÇÃO
// ══════════════════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  el(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ══════════════════════════════════════════════════════════════
//  HOME — criar / entrar em sala
// ══════════════════════════════════════════════════════════════
async function createRoom() {
  const name = el('h-name').value.trim();
  if (!name) { showErr('h-err', 'Digite seu nome.'); return; }
  hideErr('h-err');

  const btn = el('h-name').closest('.card-body').querySelector('button');
  btn.disabled = true; btn.textContent = 'Criando sala...';

  S.myName      = name;
  S.myId        = uid();
  S.isHost      = true;
  S.isSpectator = false;
  S.roomCode    = genCode();
  S.config      = { time: 90, rounds: 5, cats: [...DEF_CATS] };
  S.players     = { [S.myId]: { id: S.myId, name, host: true, spectator: false } };
  S.usedLetters = [];
  S.roundScores = {};
  S.metrics     = {};
  S.currentRound  = 0;
  S.currentLetter = '';
  S.phase       = 'lobby';
  S.stoppedBy   = null;
  S.startedAt   = null;
  S._collecting = false;

  const ok = await pushRoom();
  btn.disabled = false; btn.textContent = 'Criar Sala';

  if (!ok) {
    showErr('h-err', '❌ Erro ao conectar. Verifique a URL do Firebase em game.js.');
    return;
  }
  resetSentinels();
  startPoll();
  showLobby();
}

async function joinRoom() {
  const name = el('j-name').value.trim();
  const code = el('j-code').value.trim().toUpperCase();
  if (!name) { showErr('j-err', 'Digite seu nome.'); return; }
  if (!code || code.length < 4) { showErr('j-err', 'Código inválido.'); return; }
  hideErr('j-err');

  const btn = el('j-name').closest('.card-body').querySelector('button');
  btn.disabled = true; btn.textContent = 'Entrando...';

  const meta = await fbGet(`rooms/${code}/meta`);
  btn.disabled = false; btn.textContent = 'Entrar na Sala';

  if (!meta) { showErr('j-err', '❌ Sala não encontrada. Verifique o código.'); return; }
  if (meta.phase === 'results') { showErr('j-err', 'Esta partida já terminou.'); return; }

  S.myName        = name;
  S.myId          = uid();
  S.isHost        = false;
  S.isSpectator   = false;
  S.roomCode      = code;
  S.players       = meta.players       || {};
  S.config        = meta.config        || { time: 90, rounds: 5, cats: [...DEF_CATS] };
  S.usedLetters   = meta.usedLetters   || [];
  S.roundScores   = meta.roundScores   || {};
  S.metrics       = meta.metrics       || {};
  S.currentRound  = meta.currentRound  || 0;
  S.currentLetter = meta.currentLetter || '';
  S.phase         = meta.phase         || 'lobby';
  S.stoppedBy     = meta.stoppedBy     || null;
  S.startedAt     = meta.startedAt     || null;
  S._collecting   = false;

  S.players[S.myId] = { id: S.myId, name, host: false, spectator: false };
  await fbPatch(playersPath(), { [S.myId]: S.players[S.myId] });

  // Sentinelas sincronizadas com o estado atual (evita reprocessar fase já ativa)
  resetSentinels();
  startPoll();

  if      (S.phase === 'game')    { showGamePage(); startTimerFromServer(); }
  else if (S.phase === 'scoring') { await loadAllAnswers(); showScoringPage(); }
  else if (S.phase === 'metrics') { showMetricsPage(); }
  else                            { showLobby(); }
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function resetSentinels() {
  _lastPhase       = S.phase;
  _lastRound       = S.currentRound;
  _lastStoppedBy   = S.stoppedBy;
  _lastPlayerCount = Object.keys(S.players).length;
}

// ══════════════════════════════════════════════════════════════
//  PUSH — metadados da sala (sem respostas, sem allAnswers)
// ══════════════════════════════════════════════════════════════
async function pushRoom() {
  return fbSet(roomPath(), {
    roomCode:      S.roomCode,
    players:       S.players,
    config:        S.config,
    usedLetters:   S.usedLetters,
    roundScores:   S.roundScores,
    metrics:       S.metrics,
    currentRound:  S.currentRound,
    currentLetter: S.currentLetter,
    phase:         S.phase,
    stoppedBy:     S.stoppedBy,
    startedAt:     S.startedAt,
  });
}

// ══════════════════════════════════════════════════════════════
//  RESPOSTAS — cada jogador só escreve as próprias
//  As respostas dos outros NÃO são lidas durante o jogo,
//  apenas na fase de pontuação.
// ══════════════════════════════════════════════════════════════
function scheduleAnswerPush() {
  if (_answerDebounce) clearTimeout(_answerDebounce);
  _answerDebounce = setTimeout(pushMyAnswers, 500);
}

async function pushMyAnswers() {
  if (S.isSpectator || S.phase !== 'game') return;
  await fbSet(myAnsPath(), S.myAnswers);

  // Publica apenas se o jogador tem alguma resposta (para o contador de "prontos")
  const filled = S.config.cats.some(c => (S.myAnswers[c] || '').trim() !== '');
  await fbPatch(readyPath(), { [S.myId]: filled ? 'typing' : 'empty' });
}

async function loadAllAnswers() {
  const all = await fbGet(allAnsPath());
  S.allAnswers = all || {};
  initScoring();
}

// ── Contador de jogadores digitando (sem revelar texto) ──
async function fetchReadyCount() {
  const ready = await fbGet(readyPath());
  if (!ready) return 0;
  return Object.values(ready).filter(v => v === 'typing').length;
}

// ══════════════════════════════════════════════════════════════
//  POLL
// ══════════════════════════════════════════════════════════════
function startPoll() {
  if (S.pollId) clearInterval(S.pollId);
  S.pollId = setInterval(pollRoom, POLL_MS);
}

async function pollRoom() {
  const meta = await fbGet(roomPath());
  if (!meta) return;

  // Sincroniza jogadores
  S.players = meta.players || {};
  const pCount = Object.keys(S.players).length;

  // Convidados seguem config do host
  if (!S.isHost) {
    S.config      = meta.config      || S.config;
    S.usedLetters = meta.usedLetters || S.usedLetters;
    S.roundScores = meta.roundScores || S.roundScores;
    S.metrics     = meta.metrics     || S.metrics;
  }

  const remPhase   = meta.phase;
  const remRound   = meta.currentRound;
  const remStopped = meta.stoppedBy || null;

  // ── Atualiza contador de "digitando" na tela de jogo ──
  if (S.phase === 'game') {
    const count = await fetchReadyCount();
    const total = Object.values(S.players).filter(p => !p.spectator).length;
    const statusEl = el('g-stop-status');
    if (statusEl && !S.stoppedBy) {
      statusEl.textContent = count > 0
        ? `✏️ ${count} de ${total} digitando...`
        : '';
    }
  }

  // ── Transição de fase (conduzida pelo host, seguida pelos convidados) ──
  if (remPhase !== _lastPhase || remRound !== _lastRound) {
    _lastPhase = remPhase;
    _lastRound = remRound;

    if (!S.isHost) {
      S.phase         = remPhase;
      S.currentRound  = remRound;
      S.currentLetter = meta.currentLetter || '';
      S.stoppedBy     = remStopped;
      _lastStoppedBy  = remStopped;
      S.startedAt     = meta.startedAt || null;

      stopTimerLocal();

      if      (remPhase === 'game') {
        showGamePage();
        startTimerFromServer();
      }
      else if (remPhase === 'scoring') {
        revealStopState();
        await loadAllAnswers();
        showScoringPage();
      }
      else if (remPhase === 'metrics') {
        S.metrics = meta.metrics || {};
        showMetricsPage();
      }
      else if (remPhase === 'results') {
        S.metrics     = meta.metrics     || {};
        S.roundScores = meta.roundScores || {};
        showResultsPage();
      }
      else if (remPhase === 'lobby') {
        resetLocalRoundState();
        showLobby();
      }
    }
  }

  // ── STOP disparado por alguém ──
  if (S.phase === 'game' && remStopped && remStopped !== _lastStoppedBy) {
    _lastStoppedBy = remStopped;
    S.stoppedBy    = remStopped;
    stopTimerLocal();

    if (!S.isHost) {
      revealStopState();
    }

    if (S.isHost && !S._collecting) {
      await collectAndShowScoring();
    }
  }

  // ── Atualiza lista no lobby ──
  if (pCount !== _lastPlayerCount) {
    _lastPlayerCount = pCount;
    const ap = document.querySelector('.page.active');
    if (ap && ap.id === 'pg-lobby') renderLobbyPlayers();
  }
  const ap = document.querySelector('.page.active');
  if (ap && ap.id === 'pg-lobby') renderLobbyPlayers();
}

// Mostra estado visual de "parado" para convidados sem trocar de página
function revealStopState() {
  const stopBtn = el('g-stop-btn');
  if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = '🛑 Parado'; }
  const statusEl = el('g-stop-status');
  if (statusEl) statusEl.textContent = '⏳ Aguardando o host processar as respostas...';
}

// ══════════════════════════════════════════════════════════════
//  LOBBY
// ══════════════════════════════════════════════════════════════
function showLobby() {
  showPage('pg-lobby');
  el('lb-code').textContent = S.roomCode;

  if (S.isHost) {
    el('lb-config-card').style.display = 'block';
    el('lb-guest-info').style.display  = 'none';
    el('lb-start-wrap').style.display  = 'block';
    renderCatTags();
    el('lb-time').value   = S.config.time;
    el('lb-rounds').value = S.config.rounds;
    el('lb-time').onchange   = () => { S.config.time   = +el('lb-time').value;   pushRoom(); };
    el('lb-rounds').onchange = () => { S.config.rounds = +el('lb-rounds').value; pushRoom(); };
  } else {
    el('lb-config-card').style.display = 'none';
    el('lb-guest-info').style.display  = 'block';
    el('lb-start-wrap').style.display  = 'none';
  }
  renderLobbyPlayers();
}

function setHostMode(mode) {
  S.isSpectator = (mode === 'spectator');
  if (S.players[S.myId]) S.players[S.myId].spectator = S.isSpectator;
  el('hm-player').classList.toggle('active', mode === 'player');
  el('hm-spectator').classList.toggle('active', mode === 'spectator');
  el('hm-hint').textContent = S.isSpectator
    ? 'Você vai apenas assistir e controlar a partida. Sem preencher respostas.'
    : 'Você vai jogar e também controlar a partida.';
  pushRoom();
  renderLobbyPlayers();
}

function renderLobbyPlayers() {
  const wrap = el('lb-players');
  if (!wrap) return;
  wrap.innerHTML = '';
  Object.values(S.players).forEach((p, i) => {
    const initials    = p.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const avatarClass = p.spectator ? 'avatar spectator' : i === 0 ? 'avatar red' : 'avatar';
    const badge       = p.host
      ? (p.spectator
          ? '<span class="host-badge">Host</span> <span class="spectator-badge">👁️ Espectador</span>'
          : '<span class="host-badge">Host</span>')
      : '<div class="waiting-dot"></div>';
    wrap.innerHTML += `
      <div class="player-slot">
        <div class="${avatarClass}">${initials}</div>
        <div class="player-slot-name">${p.name}</div>
        ${badge}
      </div>`;
  });
  el('lb-status').textContent = `${Object.keys(S.players).length} participante(s) na sala`;
}

function renderCatTags() {
  const wrap = el('lb-cats');
  if (!wrap) return;
  wrap.innerHTML = '';
  S.config.cats.forEach(c => {
    const span = document.createElement('span');
    span.className = 'tag tag-red';
    span.innerHTML = `${c} <button onclick="removeCat('${c}')" aria-label="Remover ${c}">×</button>`;
    wrap.appendChild(span);
  });
}

function addCat() {
  const v = el('lb-cat-in').value.trim();
  if (!v || S.config.cats.includes(v) || S.config.cats.length >= 10) return;
  S.config.cats.push(v);
  el('lb-cat-in').value = '';
  renderCatTags();
  pushRoom();
}

function removeCat(c) {
  if (S.config.cats.length <= 2) return;
  S.config.cats = S.config.cats.filter(x => x !== c);
  renderCatTags();
  pushRoom();
}

function resetCats() { S.config.cats = [...DEF_CATS]; renderCatTags(); pushRoom(); }

function copyCode(btn) {
  navigator.clipboard.writeText(S.roomCode).catch(() => {});
  const orig = btn.textContent;
  btn.textContent = '✅ Copiado!';
  setTimeout(() => { btn.textContent = orig; }, 1800);
}

// ══════════════════════════════════════════════════════════════
//  INICIAR PARTIDA
// ══════════════════════════════════════════════════════════════
async function startGame() {
  const actives = Object.values(S.players).filter(p => !p.spectator);
  if (actives.length < 1) { alert('É necessário pelo menos 1 jogador para iniciar.'); return; }

  S.currentRound  = 1;
  S.currentLetter = pickLetter();
  S.usedLetters   = [S.currentLetter];
  S.phase         = 'game';
  S.stoppedBy     = null;
  S.startedAt     = Date.now();
  S._collecting   = false;
  S.myAnswers     = {};
  S.allAnswers    = {};
  S.scoring       = {};
  _lastStoppedBy  = null;

  // Inicializa respostas locais do host (se não for espectador)
  if (!S.isSpectator) {
    S.config.cats.forEach(c => { S.myAnswers[c] = ''; });
  }

  await pushRoom();
  resetSentinels();
  showGamePage();
  startTimer();
}

function pickLetter() {
  const avail = ALPHABET.filter(l => !S.usedLetters.includes(l));
  if (!avail.length) return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return avail[Math.floor(Math.random() * avail.length)];
}

function resetLocalRoundState() {
  S.myAnswers   = {};
  S.allAnswers  = {};
  S.scoring     = {};
  S.stoppedBy   = null;
  S._collecting = false;
  _lastStoppedBy = null;
}

// ══════════════════════════════════════════════════════════════
//  TELA DO JOGO
// ══════════════════════════════════════════════════════════════
function showGamePage() {
  showPage('pg-game');
  el('g-letter').textContent = S.currentLetter;
  el('g-round').textContent  = `${S.currentRound}/${S.config.rounds}`;

  const amSpec  = S.isHost && S.isSpectator;
  el('spectator-banner').style.display = amSpec ? 'block' : 'none';
  el('g-pause-btn').style.display      = 'inline-flex';

  const stopBtn = el('g-stop-btn');
  stopBtn.style.display = amSpec ? 'none' : 'inline-flex';
  stopBtn.disabled      = false;
  stopBtn.textContent   = '🛑 STOP!';

  el('g-stop-status').textContent = '';
  buildGameTable();
}

function buildGameTable() {
  const thead   = el('g-thead');
  const tbody   = el('g-tbody');
  const amSpec  = S.isHost && S.isSpectator;
  const players = Object.values(S.players).filter(p => !p.spectator);
  const cats    = S.config.cats;

  let hrow = '<tr><th>Jogador</th>';
  cats.forEach(c => { hrow += `<th class="cat">${c}</th>`; });
  hrow += '</tr>';
  thead.innerHTML = hrow;
  tbody.innerHTML = '';

  players.forEach(p => {
    const isMe = (p.id === S.myId) && !amSpec;
    const tr   = document.createElement('tr');

    let cells = `<td class="pname">${p.name}${isMe
      ? ' <span class="status-pill pill-blue" style="font-size:9px">você</span>'
      : ''}</td>`;

    cats.forEach(c => {
      if (isMe) {
        const val = S.myAnswers[c] || '';
        cells += `<td><input class="ans-input" data-cat="${c}"
          placeholder="${S.currentLetter}..." maxlength="30" value="${val}" /></td>`;
      } else {
        // ⚠️ Outros jogadores: mostra apenas indicador de status, NUNCA o texto
        cells += `<td>
          <span class="other-ans" data-pid="${p.id}" data-cat="${c}">✏️ digitando...</span>
        </td>`;
      }
    });

    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  // Listeners: atualiza estado local e agenda push
  document.querySelectorAll('.ans-input').forEach(inp => {
    inp.addEventListener('input', e => {
      S.myAnswers[e.target.dataset.cat] = e.target.value;
      scheduleAnswerPush();
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  TIMER
// ══════════════════════════════════════════════════════════════
function startTimer() {
  S.timeLeft    = S.config.time;
  S.paused      = false;
  S._collecting = false;
  const btn = el('g-pause-btn');
  if (btn) btn.textContent = '⏸ Pausar';
  updateTimerUI();
  if (S.timer) clearInterval(S.timer);
  S.timer = setInterval(async () => {
    if (S.paused) return;
    S.timeLeft--;
    updateTimerUI();
    if (S.timeLeft <= 0) {
      clearInterval(S.timer); S.timer = null;
      if (S.isHost && !S._collecting) await collectAndShowScoring();
      else stopTimerLocal();
    }
  }, 1000);
}

function startTimerFromServer() {
  const elapsed = S.startedAt
    ? Math.floor((Date.now() - S.startedAt) / 1000)
    : 0;
  S.timeLeft    = Math.max(1, (S.config.time || 90) - elapsed);
  S.paused      = false;
  S._collecting = false;
  updateTimerUI();
  if (S.timer) clearInterval(S.timer);
  S.timer = setInterval(() => {
    if (S.paused) return;
    S.timeLeft--;
    updateTimerUI();
    if (S.timeLeft <= 0) {
      clearInterval(S.timer); S.timer = null;
      stopTimerLocal();
    }
  }, 1000);
}

function stopTimerLocal() {
  if (S.timer) { clearInterval(S.timer); S.timer = null; }
}

function updateTimerUI() {
  const e = el('g-timer');
  if (!e) return;
  e.textContent = S.timeLeft;
  e.className   = 'timer-num' + (S.timeLeft <= 10 ? ' urgent' : '');
}

function togglePause() {
  S.paused = !S.paused;
  const btn = el('g-pause-btn');
  if (btn) btn.textContent = S.paused ? '▶ Retomar' : '⏸ Pausar';
}

// ══════════════════════════════════════════════════════════════
//  STOP
// ══════════════════════════════════════════════════════════════
async function playerStop() {
  const stopBtn = el('g-stop-btn');
  stopBtn.disabled    = true;
  stopBtn.textContent = '🛑 Parado';
  stopTimerLocal();

  // Publica respostas imediatamente (sem debounce)
  if (_answerDebounce) { clearTimeout(_answerDebounce); _answerDebounce = null; }
  await pushMyAnswers();

  S.stoppedBy    = S.myId;
  _lastStoppedBy = S.myId;

  await fbPatch(roomPath(), { stoppedBy: S.myId });

  const statusEl = el('g-stop-status');
  if (statusEl) statusEl.textContent = '⏳ Aguardando o host processar as respostas...';

  if (S.isHost && !S._collecting) await collectAndShowScoring();
}

// ══════════════════════════════════════════════════════════════
//  COLETA E PONTUAÇÃO
// ══════════════════════════════════════════════════════════════
async function collectAndShowScoring() {
  if (S._collecting) return;
  S._collecting = true;
  stopTimerLocal();

  // Garante que as próprias respostas foram publicadas
  if (!S.isSpectator) {
    // Coleta valores dos inputs (caso o debounce ainda não tenha disparado)
    document.querySelectorAll('.ans-input').forEach(inp => {
      S.myAnswers[inp.dataset.cat] = inp.value.trim();
    });
    if (_answerDebounce) { clearTimeout(_answerDebounce); _answerDebounce = null; }
    await pushMyAnswers();
  }

  // Pequena pausa para garantir que todos os jogadores publicaram as respostas
  await new Promise(res => setTimeout(res, 800));

  // Carrega todas as respostas do Firebase
  await loadAllAnswers();  // popula S.allAnswers e chama initScoring()

  S.phase = 'scoring';
  await pushRoom();
  showScoringPage();
}

function initScoring() {
  const letter = S.currentLetter;
  S.scoring    = {};
  Object.values(S.players).filter(p => !p.spectator).forEach(p => {
    S.scoring[p.id] = {};
    S.config.cats.forEach(c => {
      const ans = (S.allAnswers[p.id] && S.allAnswers[p.id][c]) || '';
      S.scoring[p.id][c] = ans.length > 0 && ans[0].toUpperCase() === letter;
    });
  });
}

// ── Pontuação ──────────────────────────────────────────────────
function showScoringPage() {
  showPage('pg-scoring');
  el('sc-title').textContent    = `Pontuação — Letra ${S.currentLetter}`;
  el('sc-host-badge').innerHTML = S.isHost
    ? '<span class="status-pill pill-green">Host · você valida</span>' : '';
  el('sc-confirm-btn').style.display = S.isHost ? 'inline-flex' : 'none';
  el('sc-wait-msg').style.display    = S.isHost ? 'none'        : 'block';
  buildScoringTable();
}

function buildScoringTable() {
  const thead   = el('sc-thead');
  const tbody   = el('sc-tbody');
  const cats    = S.config.cats;
  const players = Object.values(S.players).filter(p => !p.spectator);

  let hrow = '<tr><th>Jogador</th>';
  cats.forEach(c => { hrow += `<th class="cat">${c}</th>`; });
  hrow += '<th>Total</th></tr>';
  thead.innerHTML = hrow;
  tbody.innerHTML = '';

  players.forEach(p => {
    const pid = p.id;
    const tr  = document.createElement('tr');
    let cells = `<td class="pname">${p.name}</td>`;

    cats.forEach(c => {
      const ans   = (S.allAnswers[pid] && S.allAnswers[pid][c]) || '';
      const valid = S.scoring[pid] && S.scoring[pid][c];
      const btnId = `sv_${pid}_${c}`.replace(/[^a-z0-9_]/gi, '_');

      if (ans) {
        cells += `<td>
          <div class="score-row">
            <span class="ans-word">${ans}</span>
            ${S.isHost
              ? `<button class="btn-v ${valid ? 'ok' : 'no'}" id="${btnId}"
                   onclick="toggleValid('${pid}','${c}','${btnId}')">
                   ${valid ? '✓' : '✗'}
                 </button>`
              : `<span class="btn-v ${valid ? 'ok' : 'no'}" style="cursor:default">${valid ? '✓' : '✗'}</span>`}
            <span class="pts-val" id="pts_${btnId}">0</span>
          </div>
        </td>`;
      } else {
        cells += `<td><span style="color:var(--gray3);font-size:13px">—</span></td>`;
      }
    });

    cells += `<td class="scoring-total" id="tot_${pid}">0</td>`;
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });
  recalcScoring();
}

function toggleValid(pid, cat, btnId) {
  S.scoring[pid][cat] = !S.scoring[pid][cat];
  const btn = el(btnId);
  if (S.scoring[pid][cat]) { btn.className = 'btn-v ok'; btn.textContent = '✓'; }
  else                      { btn.className = 'btn-v no'; btn.textContent = '✗'; }
  recalcScoring();
}

function recalcScoring() {
  const cats    = S.config.cats;
  const players = Object.values(S.players).filter(p => !p.spectator);

  players.forEach(p => {
    const pid = p.id;
    let tot   = 0;
    cats.forEach(c => {
      const ans   = (S.allAnswers[pid] && S.allAnswers[pid][c]) || '';
      const valid = S.scoring[pid] && S.scoring[pid][c];
      const btnId = `sv_${pid}_${c}`.replace(/[^a-z0-9_]/gi, '_');
      const ptsEl = el('pts_' + btnId);
      if (ans && valid) {
        const same = players.filter(op =>
          op.id !== pid &&
          S.allAnswers[op.id] && S.allAnswers[op.id][c] &&
          S.allAnswers[op.id][c].trim().toLowerCase() === ans.trim().toLowerCase() &&
          S.scoring[op.id] && S.scoring[op.id][c]
        );
        const pts = same.length > 0 ? 5 : 10;
        if (ptsEl) ptsEl.textContent = pts + 'pts';
        tot += pts;
      } else {
        if (ptsEl) ptsEl.textContent = '0';
      }
    });
    const totEl = el('tot_' + pid);
    if (totEl) totEl.textContent = tot + 'pts';
  });
}

async function confirmScoring() {
  const cats     = S.config.cats;
  const players  = Object.values(S.players).filter(p => !p.spectator);
  const roundPts = {};

  players.forEach(p => {
    const pid = p.id;
    let tot   = 0;
    cats.forEach(c => {
      const ans   = (S.allAnswers[pid] && S.allAnswers[pid][c]) || '';
      const valid = S.scoring[pid] && S.scoring[pid][c];
      if (ans && valid) {
        const same = players.filter(op =>
          op.id !== pid &&
          S.allAnswers[op.id] && S.allAnswers[op.id][c] &&
          S.allAnswers[op.id][c].trim().toLowerCase() === ans.trim().toLowerCase() &&
          S.scoring[op.id] && S.scoring[op.id][c]
        );
        tot += same.length > 0 ? 5 : 10;
      }
    });
    roundPts[pid] = tot;
  });

  if (!S.roundScores) S.roundScores = {};
  S.roundScores[S.currentRound] = roundPts;

  computeMetrics(roundPts);
  S.phase = 'metrics';
  await pushRoom();
  showMetricsPage();
}

// ══════════════════════════════════════════════════════════════
//  MÉTRICAS
// ══════════════════════════════════════════════════════════════
function computeMetrics(roundPts) {
  const cats    = S.config.cats;
  const players = Object.values(S.players).filter(p => !p.spectator);
  if (!S.metrics) S.metrics = {};

  players.forEach(p => {
    const pid = p.id;
    if (!S.metrics[pid])
      S.metrics[pid] = { name: p.name, eficacia: [], eficiencia: [], produtividade: [] };

    const validCount = cats.filter(c => {
      const ans = (S.allAnswers[pid] && S.allAnswers[pid][c]) || '';
      return ans && S.scoring[pid] && S.scoring[pid][c];
    }).length;

    const uniqueCount = cats.filter(c => {
      const ans = (S.allAnswers[pid] && S.allAnswers[pid][c]) || '';
      if (!ans || !S.scoring[pid] || !S.scoring[pid][c]) return false;
      return !players.some(op =>
        op.id !== pid &&
        S.allAnswers[op.id] && S.allAnswers[op.id][c] &&
        S.allAnswers[op.id][c].trim().toLowerCase() === ans.trim().toLowerCase() &&
        S.scoring[op.id] && S.scoring[op.id][c]
      );
    }).length;

    S.metrics[pid].eficacia.push(Math.round((validCount / cats.length) * 100));
    S.metrics[pid].eficiencia.push(validCount > 0 ? Math.round((uniqueCount / validCount) * 100) : 0);
    S.metrics[pid].produtividade.push(roundPts[pid] || 0);
  });
}

function showMetricsPage() {
  showPage('pg-metrics');
  el('mt-title').textContent = `Resultado da Rodada ${S.currentRound}`;

  const amSpec  = S.isHost && S.isSpectator;
  const actives = Object.values(S.players).filter(p => !p.spectator);

  if (amSpec) {
    el('mt-player-selector').style.display = 'block';
    const sel = el('mt-player-select');
    sel.innerHTML = '';
    actives.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (actives.length > 0) renderMetricsForPlayer(actives[0].id);
  } else {
    el('mt-player-selector').style.display = 'none';
    renderMetricsForPlayer(S.myId);
  }

  const isLast = S.currentRound >= S.config.rounds;
  el('mt-next-btn').textContent = isLast ? '🏆 Ver Resultado Final' : '▶ Próxima Rodada';
  el('mt-next-lbl').textContent = `Rodada ${S.currentRound} de ${S.config.rounds}` +
    (isLast ? ' — fim da partida!' : '');
  el('mt-next-btn').disabled = !S.isHost;
  if (!S.isHost) el('mt-next-btn').textContent = '⏳ Aguardando host...';
}

function renderMetricsForPlayer(pid) {
  const m    = S.metrics[pid];
  const pName = (S.players[pid] && S.players[pid].name) || 'Jogador';
  el('mt-sub').textContent = `${pName} — Letra ${S.currentLetter}`;

  if (!m || m.eficacia.length === 0) {
    setMetric('eficacia',      '0%', 0);
    setMetric('eficiencia',    '0%', 0);
    setMetric('produtividade', '0',  0);
    el('mt-details').innerHTML =
      '<p class="muted" style="text-align:center;padding:16px">Sem dados para esta rodada.</p>';
    return;
  }

  const idx   = m.eficacia.length - 1;
  const ef    = m.eficacia[idx]      || 0;
  const ei    = m.eficiencia[idx]    || 0;
  const pr    = m.produtividade[idx] || 0;
  const maxPr = S.config.cats.length * 10;

  setMetric('eficacia',      ef + '%',   ef);
  setMetric('eficiencia',    ei + '%',   ei);
  setMetric('produtividade', pr + 'pts', Math.round((pr / maxPr) * 100));

  const players = Object.values(S.players).filter(p => !p.spectator);
  let rows = '';
  S.config.cats.forEach(c => {
    const ans   = (S.allAnswers[pid] && S.allAnswers[pid][c]) || '';
    const valid = S.scoring[pid] && S.scoring[pid][c];
    let pts = 0;
    if (ans && valid) {
      const same = players.filter(op =>
        op.id !== pid &&
        S.allAnswers[op.id] && S.allAnswers[op.id][c] &&
        S.allAnswers[op.id][c].trim().toLowerCase() === ans.trim().toLowerCase() &&
        S.scoring[op.id] && S.scoring[op.id][c]
      );
      pts = same.length > 0 ? 5 : 10;
    }
    const pill = ans && valid
      ? '<span class="status-pill pill-green">✓ Válida</span>'
      : ans
        ? '<span class="status-pill pill-red">✗ Inválida</span>'
        : '<span class="status-pill pill-orange">— Vazia</span>';

    rows += `<tr>
      <td style="font-weight:600">${c}</td>
      <td>${ans || '—'}</td>
      <td style="text-align:center">${pill}</td>
      <td style="text-align:right">${pts > 0 ? pts + 'pts' : '—'}</td>
    </tr>`;
  });

  el('mt-details').innerHTML = `
    <table class="detail-table">
      <thead><tr>
        <th>Categoria</th><th>Resposta</th><th>Status</th>
        <th style="text-align:right">Pts</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function setMetric(name, val, pct) {
  el('mt-' + name).textContent = val;
  setTimeout(() => {
    const bar = el('mt-' + name + '-bar');
    if (bar) bar.style.width = Math.min(100, pct) + '%';
  }, 120);
}

async function goNextRound() {
  if (!S.isHost) return;

  if (S.currentRound >= S.config.rounds) {
    S.phase = 'results';
    await pushRoom();
    showResultsPage();
    return;
  }

  S.currentRound++;
  S.currentLetter = pickLetter();
  S.usedLetters.push(S.currentLetter);
  S.phase       = 'game';
  S.stoppedBy   = null;
  S.startedAt   = Date.now();
  S._collecting = false;
  _lastStoppedBy = null;
  S.myAnswers   = {};
  S.allAnswers  = {};
  S.scoring     = {};

  if (!S.isSpectator) {
    S.config.cats.forEach(c => { S.myAnswers[c] = ''; });
  }

  await pushRoom();
  resetSentinels();
  showGamePage();
  startTimer();
}

// ══════════════════════════════════════════════════════════════
//  RESULTADO FINAL
// ══════════════════════════════════════════════════════════════
function showResultsPage() {
  showPage('pg-results');
  clearInterval(S.pollId);

  const players = Object.values(S.players).filter(p => !p.spectator);
  el('res-sub').textContent = `${S.config.rounds} rodadas · ${players.length} jogadores`;

  const totals = {};
  players.forEach(p => {
    let t = 0;
    Object.values(S.roundScores || {}).forEach(rd => { t += (rd[p.id] || 0); });
    totals[p.id] = { name: p.name, pts: t };
  });

  const sorted = players.slice().sort((a, b) => (totals[b.id]?.pts || 0) - (totals[a.id]?.pts || 0));
  buildPodium(sorted, totals);
  buildRankTable(sorted, totals);
  buildTripleRank(players);
}

function buildPodium(sorted, totals) {
  const wrap   = el('res-podium');
  wrap.innerHTML = '';
  const order  = sorted.length >= 3 ? [sorted[1], sorted[0], sorted[2]] : sorted;
  const heights = [110, 150, 85];
  const colors  = ['#003087', '#C8102E', '#E8A020'];
  const medals  = ['🥈', '🥇', '🥉'];

  order.forEach((p, i) => {
    if (!p) return;
    const rank  = sorted.indexOf(p);
    const h     = sorted.length >= 3 ? heights[i] : 140;
    const c     = sorted.length >= 3 ? colors[i]  : colors[1];
    const medal = rank < 3 ? medals[rank] : '';
    wrap.innerHTML += `
      <div class="podium-col" role="listitem">
        <div style="font-size:24px;margin-bottom:4px">${medal}</div>
        <div class="podium-bar" style="background:${c};height:${h}px">${totals[p.id]?.pts || 0}</div>
        <div class="podium-name">${p.name}</div>
        <div class="podium-pts">pts totais</div>
      </div>`;
  });
}

function buildRankTable(sorted, totals) {
  const t = el('res-rank');
  t.innerHTML = '';
  sorted.forEach((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}°`;
    t.innerHTML += `<tr>
      <td style="width:40px;font-size:20px">${medal}</td>
      <td class="rank-name">${p.name}</td>
      <td style="text-align:right">
        <span class="rank-pts">${totals[p.id]?.pts || 0}</span>
        <span class="muted"> pts</span>
      </td>
    </tr>`;
  });
}

function buildTripleRank(players) {
  const wrap = el('res-triple');
  wrap.innerHTML = '';
  [
    { key: 'eficacia',      label: 'Eficácia',      unit: '%',   cls: 'efc' },
    { key: 'eficiencia',    label: 'Eficiência',    unit: '%',   cls: 'efi' },
    { key: 'produtividade', label: 'Produtividade', unit: 'pts', cls: 'prd' },
  ].forEach(m => {
    const ranked = players.map(p => {
      const md   = S.metrics[p.id];
      const vals = md ? md[m.key] : [];
      const avg  = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      return { name: p.name, val: avg };
    }).sort((a, b) => b.val - a.val);

    wrap.innerHTML += `
      <div class="triple-card ${m.cls}">
        <div class="triple-head ${m.cls}">${m.label}</div>
        ${ranked.map((r, i) => `
          <div class="triple-row">
            <div class="triple-pos">${['🥇', '🥈', '🥉'][i] || (i + 1) + '°'}</div>
            <div class="triple-name">${r.name}</div>
            <div class="triple-val">${r.val}${m.unit}</div>
          </div>`).join('')}
      </div>`;
  });
}

// ══════════════════════════════════════════════════════════════
//  REINICIAR / VOLTAR
// ══════════════════════════════════════════════════════════════
async function playAgain() {
  if (!S.isHost) { alert('Apenas o host pode reiniciar.'); return; }
  S.currentRound  = 0;
  S.currentLetter = '';
  S.usedLetters   = [];
  S.roundScores   = {};
  S.metrics       = {};
  S.phase         = 'lobby';
  S.myAnswers     = {};
  S.allAnswers    = {};
  S.scoring       = {};
  S.stoppedBy     = null;
  S.startedAt     = null;
  S._collecting   = false;
  _lastStoppedBy  = null;

  await pushRoom();
  resetSentinels();
  showLobby();
  startPoll();
}

function goHome() {
  clearInterval(S.pollId); S.pollId = null;
  location.reload();
}

// ══════════════════════════════════════════════════════════════
//  INICIALIZAÇÃO
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  el('h-name').addEventListener('keydown',    e => { if (e.key === 'Enter') createRoom(); });
  el('j-name').addEventListener('keydown',    e => { if (e.key === 'Enter') joinRoom(); });
  el('j-code').addEventListener('keydown',    e => { if (e.key === 'Enter') joinRoom(); });
  el('j-code').addEventListener('input',      e => { e.target.value = e.target.value.toUpperCase(); });
  el('lb-cat-in').addEventListener('keydown', e => { if (e.key === 'Enter') addCat(); });
});
