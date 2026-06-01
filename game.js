/* ============================================================
   ADEDONHA SENAI — game.js  v3.0
   Backend: Firebase Realtime Database (REST API, plano Spark)
   ============================================================ */

'use strict';

// ══════════════════════════════════════════════════════════════
//  FIREBASE CONFIG — substitua pela URL do seu projeto
// ══════════════════════════════════════════════════════════════
const FIREBASE_URL = 'https://adedonha-eep-default-rtdb.firebaseio.com/';

// ── REST helpers ──────────────────────────────────────────────
async function fbGet(path) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`);
    if (!r.ok) return null;
    return await r.json();          // retorna null se o nó não existe
  } catch { return null; }
}

async function fbSet(path, data) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    return r.ok;
  } catch { return false; }
}

async function fbPatch(path, data) {
  try {
    const r = await fetch(`${FIREBASE_URL}/${path}.json`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    return r.ok;
  } catch { return false; }
}

// ══════════════════════════════════════════════════════════════
//  CONSTANTES
// ══════════════════════════════════════════════════════════════
const ALPHABET = 'ABCDEFGHIJLMNOPRSTUVZ'.split('');
const DEF_CATS = ['Nome', 'Animal', 'Cidade', 'Fruta', 'Cor', 'Profissão', 'Objeto'];
const POLL_MS  = 1500;   // poll mais rápido para responsividade

// ══════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════
let S = {
  myName:        '',
  myId:          '',
  roomCode:      '',
  isHost:        false,
  isSpectator:   false,

  players:       {},
  config:        { time: 90, rounds: 5, cats: [...DEF_CATS] },

  currentRound:  0,
  currentLetter: '',
  usedLetters:   [],

  answers:       {},   // respostas locais do meu jogador (publicadas a cada digitação)
  scoring:       {},
  roundScores:   {},
  metrics:       {},

  timer:         null,
  timeLeft:      90,
  paused:        false,
  stoppedBy:     null,

  phase:         'lobby',
  pollId:        null,

  // anti-duplo-disparo
  _collecting:   false,
};

// ── Sentinelas de poll ──
let _lastPhase       = '';
let _lastRound       = -1;
let _lastPlayerCount = 0;
let _lastStoppedBy   = null;
let _answerPushTimer = null;  // debounce para publicar respostas enquanto digita

// ── Caminhos Firebase ──
const roomPath      = () => `rooms/${S.roomCode}`;
const myAnswerPath  = () => `rooms/${S.roomCode}/live_answers/${S.currentRound}/${S.myId}`;
const allAnswerPath = () => `rooms/${S.roomCode}/live_answers/${S.currentRound}`;
const scoringPath   = () => `rooms/${S.roomCode}/scoring_r${S.currentRound}`;

// ── DOM helpers ──
function uid()            { return Math.random().toString(36).slice(2, 10); }
function el(id)           { return document.getElementById(id); }
function showErr(id, msg) { const e = el(id); e.style.display = 'block'; e.textContent = msg; }
function hideErr(id)      { const e = el(id); if (e) e.style.display = 'none'; }

// ══════════════════════════════════════════════════════════════
//  NAVEGAÇÃO
// ══════════════════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  el(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ══════════════════════════════════════════════════════════════
//  HOME
// ══════════════════════════════════════════════════════════════
async function createRoom() {
  const name = el('h-name').value.trim();
  if (!name) { showErr('h-err', 'Digite seu nome.'); return; }
  hideErr('h-err');

  const btn = el('h-name').closest('.card-body').querySelector('button');
  btn.disabled = true; btn.textContent = 'Criando sala...';

  S.myName       = name;
  S.myId         = uid();
  S.isHost       = true;
  S.isSpectator  = false;
  S.roomCode     = genCode();
  S.config       = { time: 90, rounds: 5, cats: [...DEF_CATS] };
  S.players      = { [S.myId]: { id: S.myId, name, host: true, spectator: false } };
  S.usedLetters  = [];
  S.roundScores  = {};
  S.metrics      = {};
  S.currentRound = 0;
  S.phase        = 'lobby';
  S.stoppedBy    = null;

  const ok = await pushRoom();
  btn.disabled = false; btn.textContent = 'Criar Sala';

  if (!ok) {
    showErr('h-err', '❌ Erro ao conectar. Verifique a URL do Firebase em game.js.');
    return;
  }
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

  const room = await fbGet(`rooms/${code}`);
  btn.disabled = false; btn.textContent = 'Entrar na Sala';

  if (!room)                   { showErr('j-err', '❌ Sala não encontrada. Verifique o código.'); return; }
  if (room.phase === 'results'){ showErr('j-err', 'Esta partida já terminou.'); return; }

  S.myName        = name;
  S.myId          = uid();
  S.isHost        = false;
  S.isSpectator   = false;
  S.roomCode      = code;
  S.players       = room.players       || {};
  S.config        = room.config        || { time: 90, rounds: 5, cats: [...DEF_CATS] };
  S.usedLetters   = room.usedLetters   || [];
  S.roundScores   = room.roundScores   || {};
  S.metrics       = room.metrics       || {};
  S.currentRound  = room.currentRound  || 0;
  S.currentLetter = room.currentLetter || '';
  S.phase         = room.phase         || 'lobby';
  S.stoppedBy     = room.stoppedBy     || null;
  S.players[S.myId] = { id: S.myId, name, host: false, spectator: false };

  // Registra apenas o próprio jogador (sem sobrescrever o resto)
  await fbPatch(`rooms/${code}/players`, { [S.myId]: S.players[S.myId] });

  // Sincroniza sentinelas para não reagir à fase atual como "nova"
  _lastPhase = S.phase;
  _lastRound = S.currentRound;
  _lastStoppedBy = S.stoppedBy;

  startPoll();

  if      (S.phase === 'game')    { showGamePage(); startTimer(); }
  else if (S.phase === 'scoring') { await loadRemoteAnswers(); showScoringPage(); }
  else if (S.phase === 'metrics') { showMetricsPage(); }
  else                            { showLobby(); }
}

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

// ══════════════════════════════════════════════════════════════
//  PUSH — escreve apenas metadados da sala (não as respostas)
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
    startedAt:     S.startedAt || null,
  });
}

// ══════════════════════════════════════════════════════════════
//  RESPOSTAS — cada jogador publica apenas as próprias
// ══════════════════════════════════════════════════════════════
function scheduleAnswerPush() {
  // debounce: publica 600ms depois de parar de digitar
  if (_answerPushTimer) clearTimeout(_answerPushTimer);
  _answerPushTimer = setTimeout(pushMyAnswers, 600);
}

async function pushMyAnswers() {
  if (S.isSpectator || S.phase !== 'game') return;
  const myAnswers = (S.answers[S.myId]) || {};
  await fbSet(myAnswerPath(), myAnswers);
}

async function loadAllAnswers() {
  const all = await fbGet(allAnswerPath());
  if (all) {
    // Mescla: mantém dados locais do próprio jogador, pega o resto do Firebase
    Object.keys(all).forEach(pid => {
      if (pid !== S.myId) S.answers[pid] = all[pid];
    });
  }
}

async function loadRemoteAnswers() {
  const all = await fbGet(allAnswerPath());
  if (all) S.answers = all;
  initScoring();
}

// ══════════════════════════════════════════════════════════════
//  POLL — 1.5s, leve e sem sobrescrever estado local
// ══════════════════════════════════════════════════════════════
function startPoll() {
  if (S.pollId) clearInterval(S.pollId);
  S.pollId = setInterval(pollRoom, POLL_MS);
}

async function pollRoom() {
  const room = await fbGet(roomPath());
  if (!room) return;

  // Sempre sincroniza jogadores
  S.players = room.players || {};

  // Convidados seguem config do host
  if (!S.isHost) {
    S.config      = room.config      || S.config;
    S.usedLetters = room.usedLetters || S.usedLetters;
    S.roundScores = room.roundScores || S.roundScores;
    S.metrics     = room.metrics     || S.metrics;
  }

  const rp     = room.phase;
  const rr     = room.currentRound;
  const pCount = Object.keys(S.players).length;

  // ── Atualiza respostas na tela de jogo (todos os jogadores) ──
  if (S.phase === 'game') {
    await loadAllAnswers();
    updateOtherAnswersUI();
  }

  // ── Detecta mudança de fase / rodada ──
  if (rp !== _lastPhase || rr !== _lastRound) {
    _lastPhase = rp;
    _lastRound = rr;

    if (!S.isHost) {
      S.phase         = rp;
      S.currentRound  = rr;
      S.currentLetter = room.currentLetter || '';
      S.stoppedBy     = room.stoppedBy || null;
      _lastStoppedBy  = S.stoppedBy;

      if      (rp === 'game')    { showGamePage(); if (!S.timer) startTimerFromServer(room); }
      else if (rp === 'scoring') { stopTimerLocal(); await loadRemoteAnswers(); showScoringPage(); }
      else if (rp === 'metrics') { S.metrics = room.metrics || {}; showMetricsPage(); }
      else if (rp === 'results') { S.metrics = room.metrics || {}; S.roundScores = room.roundScores || {}; showResultsPage(); }
      else if (rp === 'lobby')   { resetLocalRoundState(); showLobby(); }
    }
  }

  // ── Lobby: atualiza lista de jogadores ──
  if (pCount !== _lastPlayerCount) {
    _lastPlayerCount = pCount;
    const ap = document.querySelector('.page.active');
    if (ap && ap.id === 'pg-lobby') renderLobbyPlayers();
  }
  const ap = document.querySelector('.page.active');
  if (ap && ap.id === 'pg-lobby') renderLobbyPlayers();

  // ── STOP disparado por outro jogador ──
  const remStopped = room.stoppedBy;
  if (S.phase === 'game' && remStopped && remStopped !== _lastStoppedBy) {
    _lastStoppedBy = remStopped;
    S.stoppedBy    = remStopped;
    stopTimerLocal();

    // Convidado: desabilita o STOP e mostra aviso
    if (!S.isHost) {
      const stopBtn = el('g-stop-btn');
      if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = '⏳ Aguardando...'; }
      el('g-stop-status').textContent = '🛑 Rodada parada! Aguardando pontuação...';
    }

    // Host processa (com guard anti-duplo)
    if (S.isHost && !S._collecting) await collectAndShowScoring();
  }
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

function copyCode() {
  navigator.clipboard.writeText(S.roomCode).catch(() => {});
  const btn = event.currentTarget;
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
  _lastStoppedBy  = null;
  S.answers       = {};
  S.scoring       = {};

  actives.forEach(p => {
    S.answers[p.id] = {};
    S.scoring[p.id] = {};
    S.config.cats.forEach(c => { S.answers[p.id][c] = ''; S.scoring[p.id][c] = false; });
  });

  await pushRoom();
  showGamePage();
  startTimer();
}

function pickLetter() {
  const avail = ALPHABET.filter(l => !S.usedLetters.includes(l));
  if (!avail.length) return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return avail[Math.floor(Math.random() * avail.length)];
}

function resetLocalRoundState() {
  S.answers     = {};
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

  const amSpec = S.isHost && S.isSpectator;
  el('spectator-banner').style.display = amSpec ? 'block' : 'none';
  el('g-pause-btn').style.display      = 'inline-flex';

  const stopBtn = el('g-stop-btn');
  stopBtn.style.display = amSpec ? 'none' : 'inline-flex';
  stopBtn.disabled      = false;
  stopBtn.textContent   = '🛑 STOP!';

  el('g-stop-status').textContent = '';

  S._collecting = false;
  buildGameTable();
}

function buildGameTable() {
  const thead   = el('g-thead');
  const tbody   = el('g-tbody');
  const myId    = S.myId;
  const amSpec  = S.isHost && S.isSpectator;
  const players = Object.values(S.players).filter(p => !p.spectator);
  const cats    = S.config.cats;

  let hrow = '<tr><th>Jogador</th>';
  cats.forEach(c => { hrow += `<th class="cat">${c}</th>`; });
  hrow += '</tr>';
  thead.innerHTML = hrow;
  tbody.innerHTML = '';

  players.forEach(p => {
    const isMe = (p.id === myId) && !amSpec;
    const tr   = document.createElement('tr');
    tr.dataset.pid = p.id;

    let cells = `<td class="pname">${p.name}${isMe ? ' <span class="status-pill pill-blue" style="font-size:9px">você</span>' : ''}</td>`;

    cats.forEach(c => {
      if (isMe) {
        const val = (S.answers[myId] && S.answers[myId][c]) || '';
        cells += `<td><input class="ans-input" data-pid="${myId}" data-cat="${c}"
                    placeholder="${S.currentLetter}..." maxlength="30" value="${val}" /></td>`;
      } else {
        // Célula para outros — será preenchida pelo updateOtherAnswersUI
        const val = (S.answers[p.id] && S.answers[p.id][c]) || '';
        cells += `<td><div class="other-cell" data-pid="${p.id}" data-cat="${c}">${
          val
            ? `<span class="other-ans-filled">${val}</span>`
            : '<span class="other-ans">✏️ digitando...</span>'
        }</div></td>`;
      }
    });

    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  // Listeners de input — publica respostas com debounce
  document.querySelectorAll('.ans-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const pid = e.target.dataset.pid, cat = e.target.dataset.cat;
      if (!S.answers[pid]) S.answers[pid] = {};
      S.answers[pid][cat] = e.target.value;
      scheduleAnswerPush();
    });
  });
}

// Atualiza apenas as células dos outros jogadores (sem recriar a tabela)
function updateOtherAnswersUI() {
  const ap = document.querySelector('.page.active');
  if (!ap || ap.id !== 'pg-game') return;

  document.querySelectorAll('.other-cell').forEach(cell => {
    const pid = cell.dataset.pid;
    const cat = cell.dataset.cat;
    if (pid === S.myId) return;

    const val = (S.answers[pid] && S.answers[pid][cat]) || '';
    const cur = cell.querySelector('.other-ans-filled');
    const curVal = cur ? cur.textContent : '';

    if (val && val !== curVal) {
      cell.innerHTML = `<span class="other-ans-filled">${val}</span>`;
    } else if (!val && cur) {
      cell.innerHTML = '<span class="other-ans">✏️ digitando...</span>';
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  TIMER — sincronizado com o servidor
// ══════════════════════════════════════════════════════════════
function startTimer() {
  S.timeLeft = S.config.time;
  S.paused   = false;
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

// Convidado sincroniza o timer com base em quando o host iniciou
function startTimerFromServer(room) {
  if (!room.startedAt) { startTimer(); return; }
  const elapsed = Math.floor((Date.now() - room.startedAt) / 1000);
  S.timeLeft  = Math.max(0, (S.config.time || 90) - elapsed);
  S.paused    = false;
  S._collecting = false;
  updateTimerUI();
  if (S.timer) clearInterval(S.timer);
  S.timer = setInterval(async () => {
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
  stopBtn.textContent = '⏳ Parando...';
  el('g-stop-status').textContent = '⏳ Rodada parada! Aguardando host processar...';
  stopTimerLocal();

  // Publica as respostas imediatamente (sem debounce)
  if (_answerPushTimer) { clearTimeout(_answerPushTimer); _answerPushTimer = null; }
  await pushMyAnswers();

  // Sinaliza STOP para todos
  S.stoppedBy    = S.myId;
  _lastStoppedBy = S.myId;
  await fbPatch(roomPath(), { stoppedBy: S.myId });

  // Host processa direto
  if (S.isHost && !S._collecting) await collectAndShowScoring();
}

// ══════════════════════════════════════════════════════════════
//  COLETA E PONTUAÇÃO
// ══════════════════════════════════════════════════════════════
async function collectAndShowScoring() {
  if (S._collecting) return;   // guard anti-duplo
  S._collecting = true;
  stopTimerLocal();

  // Publica últimas respostas do host antes de fechar
  if (!S.isSpectator) {
    document.querySelectorAll('.ans-input').forEach(inp => {
      const pid = inp.dataset.pid, cat = inp.dataset.cat;
      if (!S.answers[pid]) S.answers[pid] = {};
      S.answers[pid][cat] = inp.value.trim();
    });
    await pushMyAnswers();
  }

  // Carrega todas as respostas do Firebase
  await loadRemoteAnswers();   // preenche S.answers e chama initScoring

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
      const ans = (S.answers[p.id] && S.answers[p.id][c]) || '';
      S.scoring[p.id][c] = ans.length > 0 && ans[0].toUpperCase() === letter;
    });
  });
}

// ── Pontuação ──────────────────────────────────────────────────
function showScoringPage() {
  showPage('pg-scoring');
  el('sc-title').textContent     = `Pontuação — Letra ${S.currentLetter}`;
  el('sc-host-badge').innerHTML  = S.isHost
    ? '<span class="status-pill pill-green">Host · você valida</span>' : '';
  el('sc-confirm-btn').style.display = S.isHost ? 'inline-flex' : 'none';
  el('sc-wait-msg').style.display    = S.isHost ? 'none' : 'block';
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
      const ans   = (S.answers[pid] && S.answers[pid][c]) || '';
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
      const ans   = (S.answers[pid] && S.answers[pid][c]) || '';
      const valid = S.scoring[pid] && S.scoring[pid][c];
      const btnId = `sv_${pid}_${c}`.replace(/[^a-z0-9_]/gi, '_');
      const ptsEl = el('pts_' + btnId);
      if (ans && valid) {
        const same = players.filter(op =>
          op.id !== pid &&
          S.answers[op.id] && S.answers[op.id][c] &&
          S.answers[op.id][c].trim().toLowerCase() === ans.trim().toLowerCase() &&
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
      const ans   = (S.answers[pid] && S.answers[pid][c]) || '';
      const valid = S.scoring[pid] && S.scoring[pid][c];
      if (ans && valid) {
        const same = players.filter(op =>
          op.id !== pid &&
          S.answers[op.id] && S.answers[op.id][c] &&
          S.answers[op.id][c].trim().toLowerCase() === ans.trim().toLowerCase() &&
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
  await fbSet(scoringPath(), S.scoring);
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
    if (!S.metrics[pid]) S.metrics[pid] = { name: p.name, eficacia: [], eficiencia: [], produtividade: [] };

    const validCount = cats.filter(c => {
      const ans = (S.answers[pid] && S.answers[pid][c]) || '';
      return ans && S.scoring[pid] && S.scoring[pid][c];
    }).length;

    const uniqueCount = cats.filter(c => {
      const ans = (S.answers[pid] && S.answers[pid][c]) || '';
      if (!ans || !S.scoring[pid] || !S.scoring[pid][c]) return false;
      return !players.some(op =>
        op.id !== pid &&
        S.answers[op.id] && S.answers[op.id][c] &&
        S.answers[op.id][c].trim().toLowerCase() === ans.trim().toLowerCase() &&
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

  const amSpec    = S.isHost && S.isSpectator;
  const actives   = Object.values(S.players).filter(p => !p.spectator);

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

  const lastRound = S.currentRound >= S.config.rounds;
  el('mt-next-btn').textContent = lastRound ? '🏆 Ver Resultado Final' : '▶ Próxima Rodada';
  el('mt-next-lbl').textContent = lastRound
    ? `Rodada ${S.currentRound} de ${S.config.rounds} — fim da partida!`
    : `Rodada ${S.currentRound} de ${S.config.rounds}`;
  el('mt-next-btn').disabled = !S.isHost;
  if (!S.isHost) el('mt-next-btn').textContent = '⏳ Aguardando host...';
}

function renderMetricsForPlayer(pid) {
  const m          = S.metrics[pid];
  const playerName = S.players[pid] ? S.players[pid].name : 'Jogador';
  el('mt-sub').textContent = `${playerName} — Letra ${S.currentLetter}`;

  if (!m || m.eficacia.length === 0) {
    setMetric('eficacia', '0%', 0);
    setMetric('eficiencia', '0%', 0);
    setMetric('produtividade', '0', 0);
    el('mt-details').innerHTML = '<p class="muted" style="text-align:center;padding:16px">Sem dados para esta rodada.</p>';
    return;
  }

  const idx   = m.eficacia.length - 1;
  const ef    = m.eficacia[idx]      || 0;
  const ei    = m.eficiencia[idx]    || 0;
  const pr    = m.produtividade[idx] || 0;
  const maxPr = S.config.cats.length * 10;

  setMetric('eficacia',      ef  + '%',   ef);
  setMetric('eficiencia',    ei  + '%',   ei);
  setMetric('produtividade', pr  + 'pts', Math.round((pr / maxPr) * 100));

  const players = Object.values(S.players).filter(p => !p.spectator);
  let rows = '';
  S.config.cats.forEach(c => {
    const ans   = (S.answers[pid] && S.answers[pid][c]) || '';
    const valid = S.scoring[pid] && S.scoring[pid][c];
    let pts = 0;
    if (ans && valid) {
      const same = players.filter(op =>
        op.id !== pid &&
        S.answers[op.id] && S.answers[op.id][c] &&
        S.answers[op.id][c].trim().toLowerCase() === ans.trim().toLowerCase() &&
        S.scoring[op.id] && S.scoring[op.id][c]
      );
      pts = same.length > 0 ? 5 : 10;
    }
    const pill = ans && valid
      ? '<span class="status-pill pill-green">✓ Válida</span>'
      : ans ? '<span class="status-pill pill-red">✗ Inválida</span>'
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
        <th>Categoria</th><th>Resposta</th><th>Status</th><th style="text-align:right">Pts</th>
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
  S.answers     = {};
  S.scoring     = {};

  Object.values(S.players).filter(p => !p.spectator).forEach(p => {
    S.answers[p.id] = {};
    S.scoring[p.id] = {};
    S.config.cats.forEach(c => { S.answers[p.id][c] = ''; S.scoring[p.id][c] = false; });
  });

  await pushRoom();
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
  const heights= [110, 150, 85];
  const colors = ['#003087', '#C8102E', '#E8A020'];
  const medals = ['🥈', '🥇', '🥉'];

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
            <div class="triple-pos">${['🥇','🥈','🥉'][i] || (i+1)+'°'}</div>
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
  S.currentRound = 0; S.usedLetters  = []; S.roundScores  = {}; S.metrics = {};
  S.phase = 'lobby';  S.answers = {};      S.scoring = {};
  S.stoppedBy = null; S.startedAt = null;  S._collecting = false;
  _lastStoppedBy = null; _lastPhase = ''; _lastRound = -1;
  await pushRoom();
  showLobby();
  startPoll();
}

function goHome() {
  clearInterval(S.pollId); S.pollId = null;
  location.reload();
}

// ══════════════════════════════════════════════════════════════
//  CSS extra — estilo para respostas dos outros aparecendo
// ══════════════════════════════════════════════════════════════
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .other-ans-filled {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--dark, #1C1F2E);
      padding: 5px 7px;
      background: #eef5ff;
      border-radius: 4px;
      border-left: 3px solid #003087;
      animation: fadeIn .3s ease;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
  `;
  document.head.appendChild(style);
})();

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
