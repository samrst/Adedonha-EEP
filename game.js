/* ============================================================
   ADEDONHA SENAI — game.js  v2.0
   Backend: Firebase Realtime Database (REST API, plano Spark)
   Multiplayer real entre navegadores diferentes.
   ============================================================ */

'use strict';

// ══════════════════════════════════════════════════════════════
//  FIREBASE CONFIG
//  Substitua FIREBASE_URL pela URL do seu projeto Firebase.
//  Formato: https://adedonha-eep-default-rtdb.firebaseio.com/
//
//  Como obter gratuitamente:
//  1. Acesse https://console.firebase.google.com
//  2. Crie um projeto → Realtime Database → Criar banco de dados
//  3. Escolha "Iniciar no modo de teste" (regras abertas por 30d)
//  4. Copie a URL e cole aqui embaixo
// ══════════════════════════════════════════════════════════════
const FIREBASE_URL = 'https://adedonha-eep-default-rtdb.firebaseio.com/';

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

async function fbUpdate(path, data) {
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
const POLL_MS  = 2000;

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

  answers:       {},
  scoring:       {},
  roundScores:   {},
  metrics:       {},

  timer:         null,
  timeLeft:      90,
  paused:        false,
  stoppedBy:     null,

  phase:         'lobby',
  pollId:        null,
};

let _lastPhase       = '';
let _lastRound       = -1;
let _lastPlayerCount = 0;
let _lastStoppedBy   = null;

// ── Caminhos Firebase ──
const roomPath    = () => `rooms/${S.roomCode}`;
const answersPath = () => `rooms/${S.roomCode}/answers_r${S.currentRound}`;
const scoringPath = () => `rooms/${S.roomCode}/scoring_r${S.currentRound}`;

// ── Helpers DOM ──
function uid()         { return Math.random().toString(36).slice(2, 10); }
function el(id)        { return document.getElementById(id); }
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
//  HOME — criar / entrar em sala
// ══════════════════════════════════════════════════════════════
async function createRoom() {
  const name = el('h-name').value.trim();
  if (!name) { showErr('h-err', 'Digite seu nome.'); return; }
  hideErr('h-err');

  // UI feedback
  const btn = el('h-name').closest('.card-body').querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Criando sala...';

  S.myName      = name;
  S.myId        = uid();
  S.isHost      = true;
  S.isSpectator = false;
  S.roomCode    = genCode();
  S.config      = { time: 90, rounds: 5, cats: [...DEF_CATS] };
  S.players     = {};
  S.players[S.myId] = { id: S.myId, name, host: true, spectator: false };
  S.usedLetters = [];
  S.roundScores = {};
  S.metrics     = {};
  S.currentRound = 0;
  S.phase       = 'lobby';
  S.stoppedBy   = null;

  const ok = await pushRoom();
  btn.disabled = false;
  btn.textContent = 'Criar Sala';

  if (!ok) {
    showErr('h-err', '❌ Erro ao conectar ao servidor. Verifique a URL do Firebase no game.js.');
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
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  const room = await fbGet(`rooms/${code}`);
  btn.disabled = false;
  btn.textContent = 'Entrar na Sala';

  if (!room) {
    showErr('j-err', '❌ Sala não encontrada. Verifique o código.');
    return;
  }
  if (room.phase === 'results') {
    showErr('j-err', 'Esta partida já terminou.');
    return;
  }

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

  await fbUpdate(`rooms/${code}/players`, { [S.myId]: S.players[S.myId] });
  startPoll();

  if      (S.phase === 'game')    { showGamePage(); startTimer(); }
  else if (S.phase === 'scoring') { await loadRemoteAnswers(); showScoringPage(); }
  else                            { showLobby(); }
}

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

// ══════════════════════════════════════════════════════════════
//  PUSH / POLL
// ══════════════════════════════════════════════════════════════
async function pushRoom() {
  return await fbSet(roomPath(), {
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
  });
}

function startPoll() {
  if (S.pollId) clearInterval(S.pollId);
  S.pollId = setInterval(pollRoom, POLL_MS);
}

async function pollRoom() {
  const room = await fbGet(roomPath());
  if (!room) return;

  S.players = room.players || {};

  if (!S.isHost) {
    S.config      = room.config      || S.config;
    S.usedLetters = room.usedLetters || S.usedLetters;
    S.roundScores = room.roundScores || S.roundScores;
    S.metrics     = room.metrics     || S.metrics;
  }

  const rp     = room.phase;
  const rr     = room.currentRound;
  const pCount = Object.keys(S.players).length;

  // Transições de fase
  if (rp !== _lastPhase || rr !== _lastRound) {
    _lastPhase = rp;
    _lastRound = rr;
    if (!S.isHost) {
      S.phase         = rp;
      S.currentRound  = rr;
      S.currentLetter = room.currentLetter || '';
      S.stoppedBy     = room.stoppedBy;
      if      (rp === 'game')    { showGamePage(); if (!S.timer) startTimer(); }
      else if (rp === 'scoring') { stopTimerLocal(); await loadRemoteAnswers(); showScoringPage(); }
      else if (rp === 'metrics') { S.metrics = room.metrics || {}; showMetricsPage(); }
      else if (rp === 'results') { S.metrics = room.metrics || {}; S.roundScores = room.roundScores || {}; showResultsPage(); }
      else if (rp === 'lobby')   { showLobby(); }
    }
  }

  // Atualiza lista de jogadores no lobby
  if (pCount !== _lastPlayerCount) {
    _lastPlayerCount = pCount;
    renderLobbyPlayers();
  }
  const activePg = document.querySelector('.page.active');
  if (activePg && activePg.id === 'pg-lobby') renderLobbyPlayers();

  // Alguém apertou STOP
  const remStopped = room.stoppedBy;
  if (S.phase === 'game' && remStopped && remStopped !== _lastStoppedBy) {
    _lastStoppedBy = remStopped;
    S.stoppedBy    = remStopped;
    stopTimerLocal();
    if (S.isHost) await collectAndShowScoring();
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
    const badge = p.host
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
  const count = Object.keys(S.players).length;
  el('lb-status').textContent = `${count} participante(s) na sala`;
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

function resetCats() {
  S.config.cats = [...DEF_CATS];
  renderCatTags();
  pushRoom();
}

function copyCode() {
  navigator.clipboard.writeText(S.roomCode).catch(() => {});
  const btn = event.target;
  const orig = btn.textContent;
  btn.textContent = '✅ Copiado!';
  setTimeout(() => { btn.textContent = orig; }, 1800);
}

// ══════════════════════════════════════════════════════════════
//  INICIAR PARTIDA
// ══════════════════════════════════════════════════════════════
async function startGame() {
  const activePlayers = Object.values(S.players).filter(p => !p.spectator);
  if (activePlayers.length < 1) {
    alert('É necessário pelo menos 1 jogador (não espectador) para iniciar.');
    return;
  }

  S.currentRound  = 1;
  S.currentLetter = pickLetter();
  S.usedLetters   = [S.currentLetter];
  S.phase         = 'game';
  S.stoppedBy     = null;
  _lastStoppedBy  = null;
  S.answers       = {};
  S.scoring       = {};

  activePlayers.forEach(p => {
    S.answers[p.id] = {};
    S.scoring[p.id] = {};
    S.config.cats.forEach(c => {
      S.answers[p.id][c] = '';
      S.scoring[p.id][c] = false;
    });
  });

  await pushRoom();
  showGamePage();
  startTimer(); // host sempre roda o timer (mesmo espectador, para controlar o fim)
}

function pickLetter() {
  const avail = ALPHABET.filter(l => !S.usedLetters.includes(l));
  if (!avail.length) return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return avail[Math.floor(Math.random() * avail.length)];
}

// ══════════════════════════════════════════════════════════════
//  TELA DO JOGO
// ══════════════════════════════════════════════════════════════
function showGamePage() {
  showPage('pg-game');
  el('g-letter').textContent = S.currentLetter;
  el('g-round').textContent  = `${S.currentRound}/${S.config.rounds}`;

  const amSpectator = S.isHost && S.isSpectator;
  el('spectator-banner').style.display = amSpectator ? 'block' : 'none';
  el('g-pause-btn').style.display      = 'inline-flex';
  el('g-stop-btn').style.display       = amSpectator ? 'none' : 'inline-flex';

  buildGameTable();
}

function buildGameTable() {
  const thead       = el('g-thead');
  const tbody       = el('g-tbody');
  const myId        = S.myId;
  const amSpectator = S.isHost && S.isSpectator;
  const players     = Object.values(S.players).filter(p => !p.spectator);
  const cats        = S.config.cats;

  let hrow = '<tr><th>Jogador</th>';
  cats.forEach(c => { hrow += `<th class="cat">${c}</th>`; });
  hrow += '</tr>';
  thead.innerHTML = hrow;
  tbody.innerHTML = '';

  players.forEach(p => {
    const isMe = (p.id === myId) && !amSpectator;
    const tr   = document.createElement('tr');
    let cells  = `<td class="pname">${p.name}${isMe ? ' <span class="status-pill pill-blue" style="font-size:9px">você</span>' : ''}</td>`;

    cats.forEach(c => {
      if (isMe) {
        const val = (S.answers[myId] && S.answers[myId][c]) || '';
        cells += `<td><input class="ans-input" data-pid="${myId}" data-cat="${c}"
                    placeholder="${S.currentLetter}..." maxlength="30" value="${val}" /></td>`;
      } else {
        cells += '<td><span class="other-ans">✏️ digitando...</span></td>';
      }
    });

    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.ans-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const pid = e.target.dataset.pid, cat = e.target.dataset.cat;
      if (!S.answers[pid]) S.answers[pid] = {};
      S.answers[pid][cat] = e.target.value;
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  TIMER
// ══════════════════════════════════════════════════════════════
function startTimer() {
  S.timeLeft = S.config.time;
  S.paused   = false;
  const btn  = el('g-pause-btn');
  if (btn) btn.textContent = '⏸ Pausar';
  updateTimerUI();
  if (S.timer) clearInterval(S.timer);
  S.timer = setInterval(async () => {
    if (S.paused) return;
    S.timeLeft--;
    updateTimerUI();
    if (S.timeLeft <= 0) {
      clearInterval(S.timer); S.timer = null;
      if (S.isHost) await collectAndShowScoring();
      else          stopTimerLocal();
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
  e.className = 'timer-num' + (S.timeLeft <= 10 ? ' urgent' : '');
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
  const btn = el('g-stop-btn');
  btn.disabled = true;
  el('g-stop-status').textContent = '⏳ Parando a rodada...';
  stopTimerLocal();
  S.stoppedBy    = S.myId;
  _lastStoppedBy = S.myId;
  // Publica apenas o stoppedBy para o host capturar via poll
  await fbUpdate(roomPath(), { stoppedBy: S.myId });
  if (S.isHost) await collectAndShowScoring();
}

async function collectAndShowScoring() {
  stopTimerLocal();
  // Coleta respostas dos inputs (jogador ativo)
  document.querySelectorAll('.ans-input').forEach(inp => {
    const pid = inp.dataset.pid, cat = inp.dataset.cat;
    if (!S.answers[pid]) S.answers[pid] = {};
    S.answers[pid][cat] = inp.value.trim();
  });

  await fbSet(answersPath(), S.answers);
  initScoring();
  S.phase = 'scoring';
  await pushRoom();
  showScoringPage();
}

function initScoring() {
  const letter = S.currentLetter;
  S.scoring = {};
  Object.values(S.players).filter(p => !p.spectator).forEach(p => {
    S.scoring[p.id] = {};
    S.config.cats.forEach(c => {
      const ans = (S.answers[p.id] && S.answers[p.id][c]) || '';
      S.scoring[p.id][c] = ans.length > 0 && ans[0].toUpperCase() === letter;
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  PONTUAÇÃO
// ══════════════════════════════════════════════════════════════
async function loadRemoteAnswers() {
  const remote = await fbGet(answersPath());
  if (remote) S.answers = remote;
  initScoring();
}

function showScoringPage() {
  showPage('pg-scoring');
  el('sc-title').textContent = `Pontuação — Letra ${S.currentLetter}`;
  el('sc-host-badge').innerHTML = S.isHost
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
  const cats    = S.config.cats;
  const players = Object.values(S.players).filter(p => !p.spectator);
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
      const same = players.filter(op =>
        op.id !== pid &&
        S.answers[op.id] && S.answers[op.id][c] &&
        S.answers[op.id][c].trim().toLowerCase() === ans.trim().toLowerCase() &&
        S.scoring[op.id] && S.scoring[op.id][c]
      );
      return same.length === 0;
    }).length;

    S.metrics[pid].eficacia.push(Math.round((validCount / cats.length) * 100));
    S.metrics[pid].eficiencia.push(validCount > 0 ? Math.round((uniqueCount / validCount) * 100) : 0);
    S.metrics[pid].produtividade.push(roundPts[pid] || 0);
  });
}

function showMetricsPage() {
  showPage('pg-metrics');
  el('mt-title').textContent = `Resultado da Rodada ${S.currentRound}`;

  const amSpectator   = S.isHost && S.isSpectator;
  const activePlayers = Object.values(S.players).filter(p => !p.spectator);

  if (amSpectator) {
    el('mt-player-selector').style.display = 'block';
    const sel = el('mt-player-select');
    sel.innerHTML = '';
    activePlayers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (activePlayers.length > 0) renderMetricsForPlayer(activePlayers[0].id);
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
  if (!S.isHost) el('mt-next-btn').textContent = 'Aguardando host...';
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

  setMetric('eficacia',      ef + '%',   ef);
  setMetric('eficiencia',    ei + '%',   ei);
  setMetric('produtividade', pr + 'pts', Math.round((pr / maxPr) * 100));

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
      <td>${pts > 0 ? pts + 'pts' : '—'}</td>
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
  S.phase        = 'game';
  S.stoppedBy    = null;
  _lastStoppedBy = null;
  S.answers      = {};
  S.scoring      = {};

  Object.values(S.players).filter(p => !p.spectator).forEach(p => {
    S.answers[p.id] = {};
    S.scoring[p.id] = {};
    S.config.cats.forEach(c => {
      S.answers[p.id][c] = '';
      S.scoring[p.id][c] = false;
    });
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
        <div class="podium-bar" style="background:${c};height:${h}px">
          ${totals[p.id]?.pts || 0}
        </div>
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
  const metrics = [
    { key: 'eficacia',      label: 'Eficácia',      unit: '%',   cls: 'efc' },
    { key: 'eficiencia',    label: 'Eficiência',    unit: '%',   cls: 'efi' },
    { key: 'produtividade', label: 'Produtividade', unit: 'pts', cls: 'prd' },
  ];

  metrics.forEach(m => {
    const ranked = players.map(p => {
      const md   = S.metrics[p.id];
      const vals = md ? md[m.key] : [];
      const avg  = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      return { name: p.name, val: avg };
    }).sort((a, b) => b.val - a.val);

    let rows = '';
    ranked.forEach((r, i) => {
      rows += `<div class="triple-row">
        <div class="triple-pos">${['🥇','🥈','🥉'][i] || (i+1)+'°'}</div>
        <div class="triple-name">${r.name}</div>
        <div class="triple-val">${r.val}${m.unit}</div>
      </div>`;
    });

    wrap.innerHTML += `
      <div class="triple-card ${m.cls}">
        <div class="triple-head ${m.cls}">${m.label}</div>
        ${rows}
      </div>`;
  });
}

// ══════════════════════════════════════════════════════════════
//  REINICIAR / VOLTAR
// ══════════════════════════════════════════════════════════════
async function playAgain() {
  if (!S.isHost) { alert('Apenas o host pode reiniciar.'); return; }
  S.currentRound = 0;
  S.usedLetters  = [];
  S.roundScores  = {};
  S.metrics      = {};
  S.phase        = 'lobby';
  S.answers      = {};
  S.scoring      = {};
  S.stoppedBy    = null;
  _lastStoppedBy = null;
  _lastPhase     = '';
  _lastRound     = -1;

  await pushRoom();
  showLobby();
  startPoll();
}

function goHome() {
  clearInterval(S.pollId);
  S.pollId = null;
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
