'use strict';
/**
 * 스플렌더 — 방 관리와 판 진행.
 *  - 판(보석·카드·귀족·차례)과 봇은 전부 서버가 쥔다(권위 서버). 규칙 판정은 rules.js 가 한다.
 *    화면은 "이 행동 할래" 만 보내고, 서버는 사람마다 볼 수 있는 만큼(R.viewFor)만 잘라서 보낸다.
 *  - 통신 방식은 모른다. 소켓은 send(문자열) · close() · readyState 만 있으면 된다.
 *    Node 서버(server.js)와 Cloudflare(worker.js)가 이 파일을 똑같이 쓴다.
 *  - 혼자 하기(봇과)는 여기를 거치지 않는다. 브라우저가 같은 rules.js · ai.js 로 직접 돌린다.
 */
const R = require('./rules');
const AI = require('./ai');

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const SKILLS = [0.5, 0.8, 1];                  // 쉬움 · 보통 · 어려움 — 화면의 고르기 칸과 같은 값
// 테스트는 판을 빨리 돌려야 해서 SPLENDOR_FAST=1 로 뜸을 들이지 않게 한다
const FAST = typeof process !== 'undefined' && !!process.env && process.env.SPLENDOR_FAST === '1';
const LOBBY_GRACE = FAST ? 300 : 20_000;       // 끊긴 방장을 넘기기까지 · 대기실에서 끊긴 자리를 비우기까지
const DC_GRACE = FAST ? 300 : 20_000;          // 판 중에 끊긴 사람 차례가 오면 이만큼 기다렸다가 판에서 뺀다
const BOT_NAMES = ['봇 하나', '봇 둘', '봇 셋'];

/* 방금 무슨 일이 있었는가 — 화면은 남이 둔 수를 한 줄로 띄운다.
   봇이 곧바로 다음 수를 두면 그 줄을 읽기 전에 판이 바뀐다. 읽을 만큼 다음 봇 수를 미룬다.
   한글 짧은 문구는 눈에 들어오는 데 0.8초 + 글자당 0.07초쯤 걸린다. (예전 방장 화면의 readMs 그대로) */
function readMs(text, floor) {
  if (FAST) return 0;
  const n = String(text || '').replace(/\s/g, '').length;
  return Math.max(floor, 800 + n * 70);
}
const OWN_MOVE_HOLD = FAST ? 0 : 600;          // 내가 둔 수는 방금 눌렀으니 굳이 붙잡아 두지 않는다
const BOT_PLAY = FAST ? 5 : 550;               // 봇이 보통 차례를 두기까지 더 쉬는 시간
const BOT_SUB = FAST ? 5 : 380;                // 버리기 · 귀족 고르기처럼 차례 안의 작은 결정

/* ─────────────────────────── 유틸 ─────────────────────────── */

const pick = a => a[Math.floor(Math.random() * a.length)];
const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const token = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)),
  b => b.toString(16).padStart(2, '0')).join('');

/* ─────────────────────────── 방 ─────────────────────────── */

const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 글자 제외
  let code;
  do {
    code = Array.from({ length: 4 }, () => pick(alphabet.split(''))).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: makeCode(),
    phase: 'lobby',            // lobby | playing | over
    hostId: null,
    players: [],               // 자리 — 사람과 봇. 판이 시작되면 이 순서가 차례 순서다
    nextId: 1,
    cfg: { skill: 0.8, priv: false },
    state: null,               // rules.js 의 판 상태. 대기실에서는 null
    moveKey: '',               // 마지막으로 읽을 시간을 준 기록 줄
    holdUntil: 0,              // 이 시각까지는 봇이 다음 수를 두지 않는다
    timers: { bot: null, dc: null, host: null },
    madeAt: Date.now(),
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

/** 같은 이름이 둘이면 화면에서 누가 누군지 모른다 — 뒤에 숫자를 붙인다 */
function uniqueName(room, name) {
  const base = name;
  let n = 2;
  while (room.players.some(p => p.name === name)) name = base + n++;
  return name;
}

function addPlayer(room, { name, bot }) {
  const p = {
    id: room.nextId++,
    token: bot ? null : token(),
    name: uniqueName(room, name || `플레이어 ${room.nextId - 1}`),
    bot: !!bot,
    ws: null,
    connected: !!bot,
  };
  room.players.push(p);
  if (!p.bot && room.hostId == null) room.hostId = p.id;
  return p;
}

const playerOf = (room, id) => room.players.find(p => p.id === id) || null;

/** 자리를 뺀다. 판 중이면 판에서도 빠지게 한다(쥔 보석은 은행으로 — R.dropPlayer). */
function removePlayer(room, id) {
  const i = room.players.findIndex(p => p.id === id);
  if (i < 0) return;
  const [gone] = room.players.splice(i, 1);
  clearTimeout(gone.leaveT);

  if (room.hostId === gone.id) {
    const next = room.players.find(p => !p.bot && p.connected) || room.players.find(p => !p.bot);
    room.hostId = next ? next.id : null;
  }
  if (room.phase === 'playing' && room.state) {
    const r = R.dropPlayer(room.state, gone.id);
    if (r.ok) afterMove(room);
  }
}

/* ─────────────────────────── 판 진행 ─────────────────────────── */

function startGame(room) {
  clearAll(room);
  room.phase = 'playing';
  room.moveKey = '';
  room.holdUntil = 0;
  room.state = R.newGame(room.players.map(p => ({ id: p.id, name: p.name, bot: p.bot })),
    Math.floor(Math.random() * 1e9));
  pushState(room);
  scheduleBot(room);
  watchAbsent(room);
}

/** 행동 하나가 판에 반영된 뒤 — 읽을 시간 잡기 · 판 끝 확인 · 모두에게 알리기 · 다음 봇 예약 */
function afterMove(room) {
  const s = room.state;
  holdForLog(room);
  if (s.phase === 'over') {
    finish(room);
    return;
  }
  pushState(room);
  scheduleBot(room);
  watchAbsent(room);
}

/** 기록의 마지막 줄을 사람들이 읽을 시간만큼 다음 봇 수를 미룬다.
 *  그 수를 둔 사람 말고는 볼 사람이 없으면(봇들과 온라인 방) 짧게만 쉰다. */
function holdForLog(room) {
  const s = room.state;
  const last = s.log.length ? s.log[s.log.length - 1] : null;
  if (!last) return;
  const key = s.round + '|' + s.turn + '|' + last.name + '|' + last.text + '|' + s.log.length;
  if (key === room.moveKey) return;
  room.moveKey = key;
  const watchers = room.players.filter(p => !p.bot && p.connected && p.id !== last.pid);
  const hold = watchers.length ? readMs((last.name || '') + (last.text || ''), 1400) : OWN_MOVE_HOLD;
  room.holdUntil = Date.now() + hold;
}

function finish(room) {
  clearAll(room);
  room.phase = 'over';
  pushState(room);
}

function scheduleBot(room) {
  clearTimeout(room.timers.bot); room.timers.bot = null;
  const s = room.state;
  if (room.phase !== 'playing' || !s || s.phase === 'over') return;
  const p = R.current(s);
  if (!p || !p.bot) return;
  // 방금 둔 수를 읽을 시간을 먼저 준다. 그래야 판이 왜 바뀌었는지 따라갈 수 있다.
  const hold = Math.max(0, room.holdUntil - Date.now());
  room.timers.bot = setTimeout(() => botStep(room), hold + (s.phase === 'play' ? BOT_PLAY : BOT_SUB));
}

function botStep(room) {
  room.timers.bot = null;
  const s = room.state;
  if (room.phase !== 'playing' || !s || s.phase === 'over' || rooms.get(room.code) !== room) return;
  const p = R.current(s);
  if (!p.bot) return;
  const v = R.viewFor(s, p.id);
  let r = null;

  if (s.phase === 'discard') r = R.discard(s, p.id, AI.chooseDiscard(v));
  else if (s.phase === 'noble') r = R.pickNoble(s, p.id, AI.chooseNoble(v));
  else {
    const a = AI.act(v, room.cfg.skill);
    if (a) r = R[a.action].apply(null, [s, p.id].concat(a.args));
  }
  if (!r || !r.ok) r = botFallback(s, p, v);
  if (!r || !r.ok) {
    // 여기까지 오면 규칙 엔진과 봇이 어긋난 것이다. 판이 영영 멈추지 않게 그 봇을 판에서 뺀다.
    console.error('봇이 막힘', room.code, p.name, r && r.error);
    R.dropPlayer(s, p.id);
  }
  afterMove(room);
}

/** 봇 판단이 규칙에 걸렸을 때를 대비한 안전망 — 아무 합법 수나 둔다 */
function botFallback(s, p, v) {
  let r;
  if (s.phase === 'discard') {
    const list = [], over = R.tokenCount(p) - R.MAX_TOKENS;
    R.ALL.forEach(c => { for (let i = 0; i < p.gems[c] && list.length < over; i++) list.push(c); });
    return R.discard(s, p.id, list);
  }
  if (s.phase === 'noble') return R.pickNoble(s, p.id, v.nobleChoices[0]);

  for (let t = 1; t <= 3; t++) {
    for (const card of s.board[t]) {
      if (card && R.payFor(p, card)) { r = R.buy(s, p.id, card.id); if (r.ok) return r; }
    }
  }
  // 킵해 둔 카드도 살 수 있다. 여길 빼먹으면 은행이 비고 킵이 3장 찼을 때 할 수 있는 게
  // 킵한 카드 사기뿐인데, 넘기기는 "아직 할 수 있는 행동이 있다" 로 거절되어 판이 멈췄다.
  for (const k of p.reserved) {
    if (R.payFor(p, k.card)) { r = R.buy(s, p.id, k.card.id); if (r.ok) return r; }
  }
  const avail = R.COLORS.filter(c => s.bank[c] > 0);
  if (avail.length) { r = R.takeGems(s, p.id, avail.slice(0, 3)); if (r.ok) return r; }
  for (let t = 1; t <= 3; t++) {
    for (const card of s.board[t]) {
      if (card) { r = R.reserve(s, p.id, card.id); if (r.ok) return r; }
    }
  }
  return R.pass(s, p.id);
}

/** 판 중에 끊긴 사람 차례가 오면 잠깐 기다렸다가(새로고침은 그 안에 돌아온다) 판에서 뺀다.
 *  빼지 않으면 남은 사람들이 그 사람 차례에서 영영 멈춘다. */
function watchAbsent(room) {
  const s = room.state;
  if (room.phase !== 'playing' || !s || s.phase === 'over') { clearTimeout(room.timers.dc); room.timers.dc = null; return; }
  const cur = R.current(s);
  const seat = playerOf(room, cur.id);
  if (cur.bot || (seat && seat.connected)) { clearTimeout(room.timers.dc); room.timers.dc = null; return; }
  if (room.timers.dc) return;
  const turnAt = s.turn, roundAt = s.round;
  room.timers.dc = setTimeout(() => {
    room.timers.dc = null;
    if (room.phase !== 'playing' || room.state !== s || s.turn !== turnAt || s.round !== roundAt) return;
    const now = playerOf(room, cur.id);
    if (now && now.connected) return;
    const r = R.dropPlayer(s, cur.id);
    if (r.ok) {
      ev(room, { kind: 'dropped', name: cur.name });
      afterMove(room);
    }
  }, DC_GRACE);
}

/* ─────────────────────────── 통신 ─────────────────────────── */

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
  }
}

function stateFor(room, me) {
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    cfg: room.cfg,
    max: MAX_PLAYERS,          // 인원 상한은 서버 값 하나만 쓴다 (화면 표기가 어긋나지 않게)
    min: MIN_PLAYERS,
    now: Date.now(),
    you: me ? me.id : null,
    players: room.players.map(p => ({ id: p.id, name: p.name, bot: p.bot, connected: p.connected })),
    // 판 화면은 사람마다 다르다 — 더미 순서와 남의 뒷면 킵은 아예 보내지 않는다
    view: room.state && room.phase !== 'lobby' && me ? R.viewFor(room.state, me.id) : null,
  };
}

function pushState(room) {
  for (const p of room.players) if (!p.bot) send(p.ws, stateFor(room, p));
}
function broadcast(room, obj) {
  for (const p of room.players) if (!p.bot) send(p.ws, obj);
}
const ev = (room, obj) => broadcast(room, Object.assign({ t: 'ev' }, obj));

function clearAll(room) {
  clearTimeout(room.timers.bot); room.timers.bot = null;
  clearTimeout(room.timers.dc); room.timers.dc = null;
}

/* ─────────────────────────── 메시지 처리 ─────────────────────────── */

function attach(room, p, ws) {
  clearTimeout(p.leaveT);
  p.ws = ws; p.connected = true;
  // 방장이 자리를 비운 채면(모두 끊겼다 이 사람이 먼저 돌아온 경우 등) 돌아온 사람이 방장을 맡는다
  const host = playerOf(room, room.hostId);
  if (!host || (!host.connected && host !== p)) room.hostId = p.id;
  ws.roomCode = room.code; ws.playerId = p.id;
  room.lastActive = Date.now();
  send(ws, { t: 'welcome', you: p.id, token: p.token, code: room.code });
  pushState(room);
  watchAbsent(room);             // 내 차례에 끊겼다 돌아왔으면 빼려던 예약을 거둔다
}

/** 이 소켓이 이미 어느 자리에 앉아 있으면 거기서 떼어 낸다. create/join 을 연달아 받으면 앞 자리가
 *  소켓을 쥔 채 "접속 중" 으로 영영 남아서, 그 자리 차례에서 판이 멈추고 방도 치워지지 않았다. */
function detach(ws) {
  const room = rooms.get(ws.roomCode);
  if (room) {
    const p = playerOf(room, ws.playerId);
    if (p && p.ws === ws) {
      if (room.phase === 'lobby') {
        removePlayer(room, p.id);
        if (!room.players.some(x => !x.bot)) dropRoom(room);   // 빈 방은 곧바로 치운다
        else pushState(room);
      } else disconnect(ws);
    }
  }
  ws.roomCode = null; ws.playerId = null;
}

function dropRoom(room) {
  clearAll(room);
  clearTimeout(room.timers.host);
  for (const p of room.players) clearTimeout(p.leaveT);
  rooms.delete(room.code);
}

/** 열린 방 목록 — 코드를 몰라도 들어갈 수 있게. 시작 전이고 자리가 남았고 비공개가 아닌 방만. */
function roomList() {
  const list = [];
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.phase !== 'lobby' || r.cfg.priv || r.players.length >= MAX_PLAYERS) continue;
    if (!r.players.some(p => !p.bot && p.connected)) continue;
    const host = playerOf(r, r.hostId);
    list.push({
      code: r.code,
      n: r.players.length,
      max: MAX_PLAYERS,
      bots: r.players.filter(p => p.bot).length,
      host: host ? host.name : '',
      age: Math.round((now - r.madeAt) / 1000),
    });
  }
  list.sort((a, b) => a.age - b.age);
  return list.slice(0, 12);
}

const ACTIONS = ['takeGems', 'buy', 'reserve', 'reserveTop', 'discard', 'pickNoble', 'pass'];

function handle(ws, msg) {
  if ((msg.t === 'create' || msg.t === 'join' || msg.t === 'resume') && ws.roomCode) detach(ws);
  switch (msg.t) {
    case 'rooms':
      return send(ws, { t: 'rooms', list: roomList() });

    case 'create': {
      const r = createRoom();
      if (msg.priv === true) r.cfg.priv = true;
      if (SKILLS.includes(msg.skill)) r.cfg.skill = msg.skill;
      const p = addPlayer(r, { name: clean(msg.name, 12) || '이름없음' });
      attach(r, p, ws);
      return;
    }
    case 'join': {
      const code = clean(msg.code, 8).toUpperCase();
      const r = rooms.get(code);
      if (!r) return send(ws, { t: 'err', msg: '그런 방이 없습니다. 코드를 확인해 주세요.' });
      if (r.phase !== 'lobby') return send(ws, { t: 'err', msg: '이미 시작된 방입니다.' });
      if (r.players.length >= MAX_PLAYERS) return send(ws, { t: 'err', msg: '자리가 찼습니다.' });
      const p = addPlayer(r, { name: clean(msg.name, 12) || '이름없음' });
      attach(r, p, ws);
      ev(r, { kind: 'joined', by: p.id, name: p.name });
      return;
    }
    case 'resume': {
      const r = rooms.get(clean(msg.code, 8).toUpperCase());
      if (!r) return send(ws, { t: 'err', msg: '방이 사라졌습니다.', fatal: true });
      const p = r.players.find(x => !x.bot && x.token === msg.token);
      if (!p) return send(ws, { t: 'err', msg: '자리를 찾을 수 없습니다.', fatal: true });
      // 먼저 붙어 있던 소켓(복제한 탭 등)은 4001 로 닫는다. 그 탭은 스스로 다시 붙지 않으므로
      // 두 탭이 서로를 밀어내며 끝없이 다시 붙는 일이 없다. 닫는 코드는 중간에 떨어지기도 해서 알림을 먼저 보낸다.
      if (p.ws && p.ws !== ws) {
        const old = p.ws;
        old.roomCode = null; old.playerId = null;      // 옛 소켓이 닫혀도 이 자리를 끊긴 걸로 치지 않게
        send(old, { t: 'moved' });
        try { old.close(4001, 'moved'); } catch (_) {}
      }
      attach(r, p, ws);
      return;
    }
  }

  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const me = playerOf(room, ws.playerId);
  if (!me) return;
  const isHost = room.hostId === me.id;
  room.lastActive = Date.now();

  switch (msg.t) {
    case 'cfg': {
      if (!isHost || room.phase !== 'lobby') return;
      if (SKILLS.includes(msg.skill)) room.cfg.skill = msg.skill;
      if (typeof msg.priv === 'boolean') room.cfg.priv = msg.priv;
      pushState(room);
      break;
    }

    case 'addBot': {
      if (!isHost || room.phase !== 'lobby') return;
      if (room.players.length >= MAX_PLAYERS) return send(ws, { t: 'err', msg: '자리가 찼습니다.' });
      const used = new Set(room.players.map(p => p.name));
      const name = BOT_NAMES.find(n => !used.has(n)) || `봇 ${room.players.length + 1}`;
      addPlayer(room, { name, bot: true });
      pushState(room);
      break;
    }

    case 'kick': {
      if (!isHost || room.phase !== 'lobby') return;
      const target = playerOf(room, msg.id);
      if (!target || target.id === room.hostId) return;
      if (target.ws) {
        send(target.ws, { t: 'err', msg: '방장이 내보냈습니다.', fatal: true });
        target.ws.roomCode = null; target.ws.playerId = null;
      }
      removePlayer(room, target.id);
      pushState(room);
      break;
    }

    case 'start': {
      if (!isHost || room.phase !== 'lobby') return;
      if (room.players.length < MIN_PLAYERS) return send(ws, { t: 'err', msg: '2명 이상이어야 시작할 수 있습니다.' });
      startGame(room);
      break;
    }

    case 'act': {
      if (room.phase !== 'playing' || !room.state) return;
      if (ACTIONS.indexOf(msg.action) < 0) return;
      const args = Array.isArray(msg.args) ? msg.args.slice(0, 3) : [];
      // 신원은 소켓이 정한다 — 메시지에 누구인지 적어 보내도 무시한다. 남의 차례를 가로챌 수 없다.
      const r = R[msg.action].apply(null, [room.state, me.id].concat(args));
      if (!r.ok) return send(ws, { t: 'err', msg: r.error });
      afterMove(room);
      break;
    }

    // 같은 방 사람끼리 하는 잡담. 판정에는 아무 영향이 없고 서버는 저장하지 않는다.
    case 'chat': {
      const text = clean(msg.text, 200);
      if (!text) return;
      const now = Date.now();
      // 한 사람이 몰아치는 것만 막는다. 전체를 하나로 세면 두 사람이 동시에 말할 때 한쪽 말이 사라진다.
      if (now - (me.lastChat || 0) < 350) return;
      me.lastChat = now;
      broadcast(room, { t: 'chat', from: me.id, name: me.name, text });
      break;
    }

    case 'again': {
      if (!isHost || room.phase !== 'over') return;
      clearAll(room);
      room.phase = 'lobby';
      room.state = null;
      // 판 중에 떠난 사람은 대기실 떠나기 예약이 없어 다음 판에 유령 자리로 남는다
      for (const p of room.players) if (!p.bot && !p.connected) armLeave(room, p);
      pushState(room);
      break;
    }

    case 'leave': {
      const name = me.name;
      removePlayer(room, me.id);
      ws.roomCode = null; ws.playerId = null;
      send(ws, { t: 'left' });
      if (!room.players.some(p => !p.bot)) { dropRoom(room); break; }   // 봇만 남은 방은 둘 까닭이 없다
      ev(room, { kind: 'left', name });
      pushState(room);
      break;
    }
  }
}

/** 대기실에서 끊긴 자리를 잠깐 뒤에 비운다 — 그 사이 돌아오면(attach) 취소된다 */
function armLeave(room, p) {
  clearTimeout(p.leaveT);
  p.leaveT = setTimeout(() => {
    if (p.connected || room.phase !== 'lobby' || rooms.get(room.code) !== room) return;
    removePlayer(room, p.id);
    pushState(room);
  }, LOBBY_GRACE);
}

/** 소켓이 닫혔다. 그 사이 같은 자리가 새 소켓으로 다시 붙었으면(새로고침) 건드리지 않는다.
 *  keepSeat — 서버가 스스로 끊은 경우(오래 조작 없음 · 소식 없음). 사람은 나간 게 아니라서
 *  대기실 자리를 지워 버리면 "누르면 다시 붙어요" 가 거짓말이 된다. 자리는 두고 방장만 넘긴다. */
function disconnect(ws, { keepSeat = false } = {}) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const p = playerOf(room, ws.playerId);
  if (!p || p.ws !== ws) return;
  p.connected = false; p.ws = null;
  room.lastActive = Date.now();              // 빈 방 청소는 마지막 사람이 떠난 때부터 센다

  // 방장이 끊기면 잠깐 기다렸다가 붙어 있는 사람에게 넘긴다 — 판 중이든 끝난 뒤든.
  // 곧바로 넘기면 새로고침 한 번에 방장을 잃는다. 안 넘기면 '시작'·'한 판 더'를 누를 사람이 없다.
  if (room.hostId === p.id) {
    clearTimeout(room.timers.host);
    room.timers.host = setTimeout(() => {
      if (rooms.get(room.code) !== room) return;
      const h = playerOf(room, room.hostId);
      if (h && h.connected) return;
      const next = room.players.find(x => !x.bot && x.connected);
      if (next) { room.hostId = next.id; pushState(room); }
    }, LOBBY_GRACE);
  }

  if (room.phase === 'lobby') {
    // 새로고침·앱 전환은 소켓이 먼저 닫히고 곧바로 다시 붙는다. 그 사이에 자리를 지우면
    // 돌아왔을 때 "자리를 찾을 수 없습니다" 로 쫓겨난다. 잠깐 기다렸다가 그래도 없으면 뺀다.
    clearTimeout(p.leaveT);
    if (!keepSeat) armLeave(room, p);
  }
  pushState(room);
  watchAbsent(room);
}

/** 사람이 다 떠난 방을 치운다. 통신 쪽이 30초마다 부른다.
 *  대기실에 자리만 남은 사람이 있으면(서버가 오래 조작 없는 연결을 닫은 경우) 10분까지 기다려 준다. */
function sweepRooms(now = Date.now()) {
  for (const room of [...rooms.values()]) {
    const humans = room.players.filter(p => !p.bot && p.connected).length;
    const seated = room.phase === 'lobby' && room.players.some(p => !p.bot);
    if (humans === 0 && now - room.lastActive > (seated ? 10 * 60_000 : 90_000)) dropRoom(room);
  }
}

/** 카드 구성이 어긋나면 게임 도중이 아니라 켤 때 바로 터지게 한다 */
function selfCheck() {
  const n = [1, 2, 3].map(t => R.buildTier(t).length);
  if (n[0] !== 40 || n[1] !== 30 || n[2] !== 20) throw new Error(`카드가 ${n.join('/')}장입니다 (40/30/20 이어야 함)`);
  if (R.NOBLES.length < MAX_PLAYERS + 1) throw new Error('귀족이 인원 +1명보다 적습니다');
  const s = R.newGame([{ id: 1, name: 'a' }, { id: 2, name: 'b' }], 1);
  if (R.viewFor(s, 1).me !== 1) throw new Error('viewFor 가 자리를 못 찾습니다');
  console.log(`  카드 ${n[0] + n[1] + n[2]}장 · 귀족 ${R.NOBLES.length}명 · 최대 ${MAX_PLAYERS}인`);
}

module.exports = {
  rooms, handle, disconnect, sweepRooms, selfCheck,
  MAX_PLAYERS, LOBBY_GRACE, DC_GRACE, FAST, readMs,
};
