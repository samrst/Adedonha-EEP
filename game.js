/* ============================================================
   ADEDONHA SENAI — game.js
   Multiplayer em tempo real via storage compartilhado.
   Modo espectador: host pode assistir sem jogar.
   ============================================================ */

'use strict';

// ══════════════════════════════════════════════════════════════
//  STORAGE LAYER
//  Usa window.storage (claude.ai) ou fallback local para dev.
// ══════════════════════════════════════════════════════════════
const ST = window.storage || (() => {
  const _d = {};
  return {
    async get(k, s)   { return _d[k] ? { key: k, value: _d[k], shared: s } : null; },
    async set(k, v, s){ _d[k] = v; return { key: k, value: v, shared: s }; },
    async delete(k, s){ delete _d[k]; return { key: k, deleted: true, shared: s }; },
    async list(p, s)  { return { keys: Object.keys(_d).filter(k => !p || k.startsWith(p)), shared: s }; },
  };
})();

async function stGet(k)    { try { return await ST.get(k, true); } catch { return null; } }
async function stSet(k, v) { try { return await ST.set(k, JSON.stringify(v), true); } catch { return null; } }
async function stRead(k)   { const r = await stGet(k); if (!r) return null; try { return JSON.parse(r.value); } catch { return null; } }

// ══════════════════════════════════════════════════════════════
//  CONSTANTES
// ══════════════════════════════════════════════════════════════
const ALPHABET   = 'ABCDEFGHIJLMNOPRSTUVZ'.split('');
const DEF_CATS   = ['Nome', 'Animal', 'Cidade', 'Fruta', 'Cor', 'Profissão', 'Objeto'];
const POLL_MS    = 2000;

// ══════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════
let S = {
  myName:        '',
  myId:          '',
  roomCode:      '',
  isHost:        false,
  isSpectator:   false,   // true = host escolheu "apenas assistir"

  players:       {},      // { [id]: { id, name, host, spectator } }
  config:        { time: 90, rounds: 5, cats: [...DEF_CATS] },

  currentRound:  0,
  currentLetter: '',
  usedLetters:   [],

  answers:       {},      // { [playerId]: { [cat]: string } }
  scoring:       {},      // { [playerId]: { [cat]: bool } }
  roundScores:   {},      // { [roundIdx]: { [playerId]: pts } }
  metrics:       {},      // { [playerId]: { name, eficacia[], eficiencia[], produtividade[] } }

  timer:         null,
  timeLeft:      90,
  paused:        false,
  stoppedBy:     null,

  phase:         'lobby', // lobby | game | scoring | metrics | results
  pollId:        null,
};

// Estado do último poll para detectar mudanças
let _lastPhase       = '';
let _lastRound       = -1;
let _lastPlayerCount = 0;

// ── Chaves de storage ──
const roomKey    = () => `room:${S.roomCode}`;
const answersKey = () => `room:${S.roomCode}:answers:${S.currentRound}`;
const scoringKey = () => `room:${S.roomCode}:scoring:${S.currentRound}`;

// ── Helpers ──
function uid()    { return Math.random().toString(36).slice(2, 10); }
function el(id)   { return document.getElementById(id); }
function showErr(id, msg) { const e = el(id); e.style.display = 'block'; e.textContent = msg; }
function hideErr(id)      { const e = el(id); if (e) e.style.display = 'none'; }

// ══════════════════════════════════════════════════════════════
//  NAVEGAÇÃO DE PÁGINAS
// ══════════════════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  el(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ══════════════════════════════════════════════════════════════
//  TELA INICIAL — criar / entrar em sala
// ══════════════════════════════════════════════════════════════
async function createRoom() {
  const name = el('h-name').value.trim();
  if (!name) { showErr('h-err', 'Digite seu nome.'); return; }
  hideErr('h-err');

  S.myName     = name;
  S.myId       = uid();
  S.isHost     = true;
  S.isSpectator= false;
  S.roomCode   = genCode();
  S.config     = { time: 90, rounds: 5, cats: [...DEF_CATS] };
  S.players    = {};
  S.players[S.myId] = { id: S.myId, name, host: true, spectator: false };
  S.usedLetters= [];
  S.roundScores= {};
  S.metrics    = {};
  S.currentRound = 0;
  S.phase      = 'lobby';

  await pushRoom();
  startPoll();
  showLobby();
}

async function joinRoom() {
  const name = el('j-name').value.trim();
  const code = el('j-code').value.trim().toUpperCase();
  if (!name) { showErr('j-err', 'Digite seu nome.'); return; }
  if (!code || code.length < 4) { showErr('j-err', 'Código inválido.'); return; }
  hideErr('j-err');

  const room = await stRead(`room:${code}`);
  if (!room) { showErr('j-err', 'Sala não encontrada. Verifique o código.'); return; }
  if (room.phase === 'results') { showErr('j-err', 'Esta partida já terminou.'); return; }

  S.myName      = name;
  S.myId        = uid();
  S.isHost      = false;
  S.isSpectator = false;
  S.roomCode    = code;
  S.players     = room.players || {};
  S.config      = room.config  || { time: 90, rounds: 5, cats: [...DEF_CATS] };
  S.usedLetters = room.usedLetters  || [];
  S.roundScores = room.roundScores  || {};
  S.metrics     = room.metrics      || {};
  S.currentRound= room.currentRound || 0;
  S.currentLetter = room.currentLetter || '';
  S.phase       = room.phase || 'lobby';
  S.players[S.myId] = { id: S.myId, name, host: false, spectator: false };

  await pushRoom();
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
//  PUSH / POLL DE ESTADO DA SALA
// ══════════════════════════════════════════════════════════════
async function pushRoom() {
  await stSet(roomKey(), {
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
  const room = await stRead(roomKey());
  if (!room) return;

  // Sincroniza jogadores sempre
  S.players = room.players || {};

  // Convidados sincronizam configurações do host
  if (!S.isHost) {
    S.config       = room.config       || S.config;
    S.usedLetters  = room.usedLetters  || S.usedLetters;
    S.roundScores  = room.roundScores  || S.roundScores;
    S.metrics      = room.metrics      || S.metrics;
  }

  const rp = room.phase;
  const rr = room.currentRound;
  const pCount = Object.keys(S.players).length;

  // Transições de fase (convidados seguem o host)
  if (rp !== _lastPhase || rr !== _lastRound) {
    _lastPhase = rp;
    _lastRound = rr;
    if (!S.isHost) {
      S.phase         = rp;
      S.currentRound  = rr;
      S.currentLetter = room.currentLetter || '';
      if      (rp === 'game')    { showGamePage(); if (!S.timer) startTimer(); }
      else if (rp === 'scoring') { stopTimerLocal(); await loadRemoteAnswers(); showScoringPage(); }
      else if (rp === 'metrics') { S.metrics = room.metrics || {}; showMetricsPage(); }
      else if (rp === 'results') { S.metrics = room.metrics || {}; S.roundScores = room.roundScores || {}; showResultsPage(); }
    }
  }

  // Atualiza lista de jogadores no lobby
  if (pCount !== _lastPlayerCount) {
    _lastPlayerCount = pCount;
    const activePage = document.querySelector('.page.active');
    if (activePage && activePage.id === 'pg-lobby') renderLobbyPlayers();
  }
  const activePage = document.querySelector('.page.active');
  if (activePage && activePage.id === 'pg-lobby') renderLobbyPlayers();

  // Alguém apertou STOP
  if (S.phase === 'game' && room.stoppedBy && room.stoppedBy !== S.stoppedBy) {
    S.stoppedBy = room.stoppedBy;
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

// ── Modo do host: jogar ou espectador ──
function setHostMode(mode) {
  S.isSpectator = (mode === 'spectator');
  // Atualiza flags no objeto do jogador
  if (S.players[S.myId]) {
    S.players[S.myId].spectator = S.isSpectator;
  }

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
  const players = Object.values(S.players);
  players.forEach((p, i) => {
    const initials = p.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
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
  el('lb-status').textContent = `${players.length} participante(s) na sala`;
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
  alert(`Código copiado: ${S.roomCode}`);
}

// ══════════════════════════════════════════════════════════════
//  INICIAR PARTIDA
// ══════════════════════════════════════════════════════════════
async function startGame() {
  // Garante que jogadores não-espectadores existam
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
  S.answers       = {};
  S.scoring       = {};

  // Inicializa apenas jogadores ativos (não espectadores)
  activePlayers.forEach(p => {
    S.answers[p.id]  = {};
    S.scoring[p.id]  = {};
    S.config.cats.forEach(c => {
      S.answers[p.id][c]  = '';
      S.scoring[p.id][c]  = false;
    });
  });

  await pushRoom();
  showGamePage();

  // Espectador não inicia timer local — apenas assiste
  if (!S.isSpectator) startTimer();
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

  // Banner e controles do espectador
  const amSpectator = S.isHost && S.isSpectator;
  el('spectator-banner').style.display = amSpectator ? 'block' : 'none';
  el('g-pause-btn').style.display      = amSpectator ? 'inline-flex' : '';
  el('g-stop-btn').style.display       = amSpectator ? 'none' : 'inline-flex';

  buildGameTable();
}

function buildGameTable() {
  const thead = el('g-thead');
  const tbody = el('g-tbody');
  const myId  = S.myId;
  // Apenas jogadores ativos na tabela
  const players = Object.values(S.players).filter(p => !p.spectator);
  const cats    = S.config.cats;
  const amSpectator = S.isHost && S.isSpectator;

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
      // Espectador e host sem espectador: ambos disparam coleta ao fim do tempo
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
  el('g-stop-btn').disabled = true;
  el('g-stop-status').textContent = '⏳ Parando a rodada...';
  stopTimerLocal();
  S.stoppedBy = S.myId;
  await pushRoom();
  if (S.isHost) await collectAndShowScoring();
}

async function collectAndShowScoring() {
  stopTimerLocal();

  // Coleta respostas dos inputs (somente jogadores ativos)
  document.querySelectorAll('.ans-input').forEach(inp => {
    const pid = inp.dataset.pid, cat = inp.dataset.cat;
    if (!S.answers[pid]) S.answers[pid] = {};
    S.answers[pid][cat] = inp.value.trim();
  });

  await stSet(answersKey(), S.answers);
  initScoring();
  S.phase = 'scoring';
  await pushRoom();
  showScoringPage();
}

function initScoring() {
  const letter = S.currentLetter;
  S.scoring = {};
  // Apenas jogadores ativos (não espectadores)
  const activePlayers = Object.values(S.players).filter(p => !p.spectator);
  activePlayers.forEach(p => {
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
  const remote = await stRead(answersKey());
  if (remote) S.answers = remote;
  initScoring();
}

function showScoringPage() {
  showPage('pg-scoring');
  el('sc-title').textContent = `Pontuação — Letra ${S.currentLetter}`;
  const isHost = S.isHost;
  el('sc-host-badge').innerHTML = isHost
    ? '<span class="status-pill pill-green">Host · você valida</span>'
    : '';
  el('sc-confirm-btn').style.display = isHost ? 'inline-flex' : 'none';
  el('sc-wait-msg').style.display    = isHost ? 'none' : 'block';
  buildScoringTable();
}

function buildScoringTable() {
  const thead   = el('sc-thead');
  const tbody   = el('sc-tbody');
  const cats    = S.config.cats;
  // Apenas jogadores ativos
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
  await stSet(scoringKey(), S.scoring);
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

    const eficacia     = Math.round((validCount / cats.length) * 100);
    const eficiencia   = validCount > 0 ? Math.round((uniqueCount / validCount) * 100) : 0;
    const produtividade= roundPts[pid] || 0;

    S.metrics[pid].eficacia.push(eficacia);
    S.metrics[pid].eficiencia.push(eficiencia);
    S.metrics[pid].produtividade.push(produtividade);
  });
}

// ── Tela de métricas ──
function showMetricsPage() {
  showPage('pg-metrics');
  const r = S.currentRound;
  el('mt-title').textContent = `Resultado da Rodada ${r}`;

  const amSpectator = S.isHost && S.isSpectator;
  const activePlayers = Object.values(S.players).filter(p => !p.spectator);

  if (amSpectator) {
    // Espectador: pode ver métricas de qualquer jogador
    el('mt-player-selector').style.display = 'block';
    const sel = el('mt-player-select');
    sel.innerHTML = '';
    activePlayers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (activePlayers.length > 0) renderMetricsForPlayer(activePlayers[0].id);
  } else {
    el('mt-player-selector').style.display = 'none';
    renderMetricsForPlayer(S.myId);
  }

  // Botão próxima rodada / fim
  const lastRound = S.currentRound >= S.config.rounds;
  el('mt-next-btn').textContent = lastRound ? '🏆 Ver Resultado Final' : '▶ Próxima Rodada';
  el('mt-next-lbl').textContent = lastRound
    ? `Rodada ${S.currentRound} de ${S.config.rounds} — fim da partida!`
    : `Rodada ${S.currentRound} de ${S.config.rounds}`;

  if (!S.isHost) {
    el('mt-next-btn').textContent = 'Aguardando host...';
    el('mt-next-btn').disabled    = true;
  } else {
    el('mt-next-btn').disabled = false;
  }
}

function renderMetricsForPlayer(pid) {
  const m = S.metrics[pid];
  const playerName = S.players[pid] ? S.players[pid].name : 'Jogador';
  el('mt-sub').textContent = `${playerName} — Letra ${S.currentLetter}`;

  if (!m || m.eficacia.length === 0) {
    setMetric('eficacia',     '0%',  0);
    setMetric('eficiencia',   '0%',  0);
    setMetric('produtividade','0',   0);
    el('mt-details').innerHTML = '<p class="muted" style="text-align:center;padding:16px">Sem dados para esta rodada.</p>';
    return;
  }

  const idx = m.eficacia.length - 1;
  const ef  = m.eficacia[idx]      || 0;
  const ei  = m.eficiencia[idx]    || 0;
  const pr  = m.produtividade[idx] || 0;
  const maxPr = S.config.cats.length * 10;

  setMetric('eficacia',      ef + '%',  ef);
  setMetric('eficiencia',    ei + '%',  ei);
  setMetric('produtividade', pr + 'pts', Math.round((pr / maxPr) * 100));

  // Tabela de detalhes
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
      : ans
        ? '<span class="status-pill pill-red">✗ Inválida</span>'
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
  S.phase     = 'game';
  S.stoppedBy = null;
  S.answers   = {};
  S.scoring   = {};

  const activePlayers = Object.values(S.players).filter(p => !p.spectator);
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
  if (!S.isSpectator) startTimer();
  // Espectador: timer começa ao receber o push (não precisa de timer local)
  else startTimer(); // host precisa do timer local mesmo sendo espectador para controlar o fim
}

// ══════════════════════════════════════════════════════════════
//  RESULTADO FINAL
// ══════════════════════════════════════════════════════════════
function showResultsPage() {
  showPage('pg-results');
  clearInterval(S.pollId);

  el('res-sub').textContent =
    `${S.config.rounds} rodadas · ${Object.values(S.players).filter(p => !p.spectator).length} jogadores`;

  const players = Object.values(S.players).filter(p => !p.spectator);

  // Calcula totais
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
    { key: 'eficacia',      label: 'Eficácia',      unit: '%',  cls: 'efc' },
    { key: 'eficiencia',    label: 'Eficiência',    unit: '%',  cls: 'efi' },
    { key: 'produtividade', label: 'Produtividade', unit: 'pts',cls: 'prd' },
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
      const medals = ['🥇', '🥈', '🥉'];
      rows += `<div class="triple-row">
        <div class="triple-pos">${medals[i] || (i + 1) + '°'}</div>
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
//  INICIALIZAÇÃO — listeners de teclado
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  el('h-name').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
  el('j-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  el('j-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  el('j-code').addEventListener('input',   e => { e.target.value = e.target.value.toUpperCase(); });
  el('lb-cat-in').addEventListener('keydown', e => { if (e.key === 'Enter') addCat(); });
});
