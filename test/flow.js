'use strict';
/**
 * 서버를 실제로 띄우고 방·판 흐름을 끝까지 돌려 본다 — node test/flow.js
 *  - 서버는 SPLENDOR_FAST=1 로 띄운다. 봇 뜸 · 읽는 시간 · 20초 유예가 전부 짧아진다(유예 300ms).
 *    20초라는 실제 값은 맨 끝에서 game.js 를 FAST 없이 불러 따로 확인한다.
 *  - PORT 를 주면 이미 떠 있는 서버(SPLENDOR_FAST=1 로 띄운 것)에 붙는다 — wrangler dev 시험용.
 */
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const R = require('../rules');
const AI = require('../ai');

const USE_EXISTING = !!process.env.PORT;
const PORT = process.env.PORT || 8874;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const GRACE = 300;                      // game.js 의 FAST 유예
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ─────────────── 손님 하나 ─────────────── */

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.inbox = [];
    ws.closed = null;
    ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
    ws.on('close', code => { ws.closed = code; });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
const tx = (ws, obj) => ws.send(JSON.stringify(obj));
/** 조건에 맞는 메시지를 기다린다. from 이후에 온 것만 본다(예전 메시지에 속지 않게). */
async function waitFor(ws, pred, { ms = 6000, from = 0, what = '' } = {}) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (let i = ws.inbox.length - 1; i >= from; i--) if (pred(ws.inbox[i])) return ws.inbox[i];
    await sleep(10);
  }
  throw new Error('기다리던 메시지가 오지 않음 ' + what + ': ' + JSON.stringify(ws.inbox.slice(-2)).slice(0, 400));
}
const lastState = ws => ws.inbox.filter(m => m.t === 'state').pop();
const mark = ws => ws.inbox.length;

async function create(name, extra = {}) {
  const ws = await open();
  tx(ws, Object.assign({ t: 'create', name }, extra));
  const w = await waitFor(ws, m => m.t === 'welcome', { what: '(만들기)' });
  ws.me = w; return ws;
}
async function join(code, name) {
  const ws = await open();
  tx(ws, { t: 'join', code, name });
  const w = await waitFor(ws, m => m.t === 'welcome' || m.t === 'err', { what: '(참가)' });
  if (w.t === 'err') throw new Error('참가 거절: ' + w.msg);
  ws.me = w; return ws;
}
async function listRooms() {
  const ws = await open();
  tx(ws, { t: 'rooms' });
  const m = await waitFor(ws, x => x.t === 'rooms');
  ws.close();
  return m.list;
}

/** 보이는 시야로 한 수를 고른다 — 봇 판단을 그대로 빌려 쓴다 */
function pickMove(v) {
  if (v.phase === 'discard') return { action: 'discard', args: [AI.chooseDiscard(v)] };
  if (v.phase === 'noble') return { action: 'pickNoble', args: [AI.chooseNoble(v)] };
  if (v.canPass) return { action: 'pass', args: [] };
  const a = AI.act(v, 1);
  return a;
}
const myTurn = v => v && v.phase !== 'over' && v.players[v.turn] && v.players[v.turn].id === v.me;

/* 매 시야마다 확인하는 것들 */
const TOTAL = { 2: 4 * 5 + 5, 3: 5 * 5 + 5, 4: 7 * 5 + 5 };
function checkView(v, n) {
  let sum = 0;
  R.ALL.forEach(c => { sum += v.bank[c]; v.players.forEach(p => { sum += p.gems[c]; }); });
  assert.strictEqual(sum, TOTAL[n], `칩 총량이 ${sum} (${TOTAL[n]} 이어야 함)`);
  assert.ok(!('decks' in v), '더미 순서가 새어 나감');
  for (const p of v.players) {
    if (v.phase !== 'discard' || v.players[v.turn].id !== p.id) {
      assert.ok(R.tokenCount(p) <= R.MAX_TOKENS, `${p.name} 칩이 ${R.tokenCount(p)}개`);
    }
    for (const r of p.reserved) {
      if (p.id !== v.me && r.hidden) assert.strictEqual(r.card, null, '남의 뒷면 킵이 보임');
    }
  }
}

/* ─────────────── 시나리오 ─────────────── */

let pass = 0;
async function step(name, fn) {
  const t0 = Date.now();
  await fn();
  pass++;
  console.log(`  ✓ ${name}  (${Date.now() - t0}ms)`);
}

async function scenarios() {
  let a, b, code;

  await step('두 사람이 방을 만들고 들어온다', async () => {
    a = await create('방장');
    code = a.me.code;
    assert.match(code, /^[A-Z2-9]{4}$/);
    b = await join(code, '민수');
    const s = await waitFor(a, m => m.t === 'state' && m.players.length === 2);
    assert.strictEqual(s.phase, 'lobby');
    assert.strictEqual(s.hostId, a.me.you);
    assert.strictEqual(s.view, null, '대기실인데 판 시야가 옴');
    await waitFor(a, m => m.t === 'ev' && m.kind === 'joined' && m.name === '민수');
  });

  await step('같은 이름으로 들어오면 뒤에 숫자가 붙는다', async () => {
    const c = await join(code, '민수');
    const s = await waitFor(c, m => m.t === 'state' && m.players.length === 3);
    assert.ok(s.players.some(p => p.name === '민수2'), JSON.stringify(s.players.map(p => p.name)));
    const k = mark(a);
    tx(c, { t: 'leave' });
    await waitFor(c, m => m.t === 'left');
    await waitFor(a, m => m.t === 'state' && m.players.length === 2, { from: k });
    c.close();
  });

  await step('채팅이 같은 방 모두에게 간다(보낸 사람 포함)', async () => {
    tx(b, { t: 'chat', text: '  안녕하세요  ' });
    const c1 = await waitFor(a, m => m.t === 'chat');
    assert.strictEqual(c1.text, '안녕하세요');
    assert.strictEqual(c1.name, '민수');
    assert.strictEqual(c1.from, b.me.you);
    await waitFor(b, m => m.t === 'chat');
  });

  await step('방장이 아니면 시작 · 봇 추가 · 설정을 못 한다', async () => {
    const k = mark(a);
    tx(b, { t: 'start' }); tx(b, { t: 'addBot' }); tx(b, { t: 'cfg', priv: true });
    await sleep(200);
    assert.ok(!a.inbox.slice(k).some(m => m.t === 'state'), '방장 아닌 사람의 조작이 먹힘');
  });

  await step('비공개 방은 열린 방 목록에 안 보인다', async () => {
    let list = await listRooms();
    assert.ok(list.some(r => r.code === code), '공개 방이 목록에 없음');
    const k = mark(a);
    tx(a, { t: 'cfg', priv: true });
    await waitFor(a, m => m.t === 'state' && m.cfg.priv === true, { from: k });
    list = await listRooms();
    assert.ok(!list.some(r => r.code === code), '비공개로 바꿨는데 목록에 보임');
    // 처음부터 비공개로 만든 방
    const p = await create('숨은방', { priv: true });
    list = await listRooms();
    assert.ok(!list.some(r => r.code === p.me.code), '비공개로 만든 방이 목록에 보임');
    tx(p, { t: 'leave' }); await waitFor(p, m => m.t === 'left'); p.close();
    tx(a, { t: 'cfg', priv: false });
    await waitFor(a, m => m.t === 'state' && m.cfg.priv === false);
  });

  await step('봇 실력은 방 설정이다', async () => {
    const k = mark(a);
    tx(a, { t: 'cfg', skill: 1 });
    await waitFor(a, m => m.t === 'state' && m.cfg.skill === 1, { from: k });
    tx(a, { t: 'cfg', skill: 7 });         // 없는 값은 무시
    await sleep(100);
    assert.strictEqual(lastState(a).cfg.skill, 1);
  });

  let idA, idB;
  await step('시작하면 사람마다 자기 시야를 받는다', async () => {
    const k = mark(a), kb = mark(b);
    tx(a, { t: 'start' });
    const sa = await waitFor(a, m => m.t === 'state' && m.phase === 'playing', { from: k });
    const sb = await waitFor(b, m => m.t === 'state' && m.phase === 'playing', { from: kb });
    idA = a.me.you; idB = b.me.you;
    assert.strictEqual(sa.view.me, idA);
    assert.strictEqual(sb.view.me, idB);
    assert.strictEqual(sa.view.players.length, 2);
    checkView(sa.view, 2);
  });

  await step('남의 차례에 두면 서버가 규칙으로 거절한다', async () => {
    const v = lastState(a).view;
    const other = myTurn(v) ? b : a;
    const k = mark(other);
    tx(other, { t: 'act', action: 'takeGems', args: [['w', 'u', 'g']] });
    const e = await waitFor(other, m => m.t === 'err', { from: k });
    assert.strictEqual(e.msg, '당신 차례가 아닙니다.');
  });

  await step('규칙에 어긋난 수도 이유와 함께 거절한다', async () => {
    const v = lastState(a).view;
    const who = myTurn(v) ? a : b;
    const k = mark(who);
    tx(who, { t: 'act', action: 'takeGems', args: [['y']] });
    const e = await waitFor(who, m => m.t === 'err', { from: k });
    assert.ok(/황금/.test(e.msg), e.msg);
    tx(who, { t: 'act', action: 'eval', args: [] });   // 없는 행동은 아예 무시
    await sleep(80);
  });

  await step('차례대로 몇 수를 둔다', async () => {
    for (let i = 0; i < 6; i++) {
      const v = lastState(a).view;
      const who = myTurn(v) ? a : b;
      const wv = lastState(who).view;
      const mv = pickMove(wv);
      const k = mark(a);
      tx(who, { t: 'act', action: mv.action, args: mv.args });
      const s = await waitFor(a, m => m.t === 'state' && m.view.log.length !== v.log.length, { from: k, what: `(${i}번째 수)` });
      checkView(s.view, 2);
    }
  });

  await step('새로고침(resume)하면 같은 자리 · 같은 시야로 돌아온다', async () => {
    const before = lastState(b).view;
    const b2 = await open();
    tx(b2, { t: 'resume', code, token: b.me.token });
    const w = await waitFor(b2, m => m.t === 'welcome');
    assert.strictEqual(w.you, idB);
    const s = await waitFor(b2, m => m.t === 'state' && m.phase === 'playing');
    assert.strictEqual(s.view.me, idB);
    assert.strictEqual(s.view.log.length, before.log.length);
    // 옛 탭은 4001 로 닫힌다 — 두 탭이 서로 밀어내지 않게
    await waitFor(b, m => m.t === 'moved');
    const end = Date.now() + 2000;
    while (b.closed == null && Date.now() < end) await sleep(10);
    assert.strictEqual(b.closed, 4001);
    await sleep(100);
    const me = lastState(a).players.find(p => p.id === idB);
    assert.strictEqual(me.connected, true, '새 소켓이 붙어 있는데 끊긴 걸로 표시됨');
    b = b2; b.me = Object.assign({}, w);
  });

  await step('틀린 자리표로는 돌아올 수 없다', async () => {
    const x = await open();
    tx(x, { t: 'resume', code, token: 'nope' });
    const e = await waitFor(x, m => m.t === 'err');
    assert.strictEqual(e.fatal, true);
    tx(x, { t: 'join', code, name: '늦음' });
    const e2 = await waitFor(x, m => m.t === 'err' && !m.fatal);
    assert.strictEqual(e2.msg, '이미 시작된 방입니다.');
    x.close();
  });

  /** who 의 차례가 끝날 때까지 둔다(버리기 · 귀족 고르기까지) */
  async function finishTurn(who) {
    for (let i = 0; i < 4; i++) {
      const v = lastState(who).view;
      if (!myTurn(v)) return;
      const mv = pickMove(v);
      const k = mark(who);
      tx(who, { t: 'act', action: mv.action, args: mv.args });
      await waitFor(who, m => m.t === 'state' && m.view.log.length !== v.log.length, { from: k });
    }
  }

  await step('방장이 끊기면 유예 뒤에 남은 사람에게 넘어가고, 판은 이어진다', async () => {
    await finishTurn(a);                  // b 차례에 끊겨야 판이 곧바로 끝나지 않는다
    const k = mark(b);
    a.close();
    await sleep(GRACE / 3);
    assert.strictEqual(lastState(b).hostId, idA, '유예 전에 방장이 넘어감');
    const s = await waitFor(b, m => m.t === 'state' && m.hostId === idB, { from: k, ms: 3000 });
    assert.strictEqual(s.phase, 'playing');
  });

  await step('끊긴 사람 차례가 오면 유예 뒤 판에서 빠지고, 남은 사람이 이긴다', async () => {
    await finishTurn(b);                  // b 가 두고 나면 끊긴 a 차례다
    const s = await waitFor(b, m => m.t === 'state' && m.phase === 'over', { ms: 4000, what: '(끊긴 사람 빠짐)' });
    assert.ok(s.view.players.find(p => p.id === idA).out, '끊긴 사람이 빠지지 않음');
    assert.strictEqual(s.view.winner, idB);
    await waitFor(b, m => m.t === 'ev' && m.kind === 'dropped');
  });

  await step('끝난 뒤 방장이 한 판 더를 누르면 대기실로 돌아가고, 끊긴 자리는 비워진다', async () => {
    const k = mark(b);
    tx(b, { t: 'again' });
    await waitFor(b, m => m.t === 'state' && m.phase === 'lobby', { from: k });
    const s = await waitFor(b, m => m.t === 'state' && m.phase === 'lobby' && m.players.length === 1, { from: k, ms: 3000 });
    assert.strictEqual(s.view, null);
  });

  await step('대기실 새로고침은 유예 안에 돌아오면 자리가 남는다', async () => {
    const c = await join(code, '지훈');
    const idC = c.me.you;
    c.close();
    await sleep(GRACE / 3);
    const c2 = await open();
    tx(c2, { t: 'resume', code, token: c.me.token });
    const w = await waitFor(c2, m => m.t === 'welcome');
    assert.strictEqual(w.you, idC);
    await sleep(GRACE + 100);
    assert.ok(lastState(b).players.some(p => p.id === idC), '돌아왔는데 자리가 지워짐');
    // 방장은 대기실에서 내보낼 수 있다
    const k = mark(c2);
    tx(b, { t: 'kick', id: idC });
    const e = await waitFor(c2, m => m.t === 'err' && m.fatal, { from: k });
    assert.ok(/내보냈/.test(e.msg));
    await sleep(80);
    assert.ok(!lastState(b).players.some(p => p.id === idC));
    c2.close();
  });

  await step('방장이 새로고침하면 유예 안에 돌아와 방장을 지킨다', async () => {
    const h = await create('새로고침방장');
    const d = await join(h.me.code, '기다림');
    await waitFor(h, m => m.t === 'state' && m.players.length === 2);
    h.close();
    await sleep(GRACE / 3);
    const h2 = await open();
    tx(h2, { t: 'resume', code: h.me.code, token: h.me.token });
    await waitFor(h2, m => m.t === 'welcome');
    await sleep(GRACE + 150);
    assert.strictEqual(lastState(d).hostId, h.me.you, '돌아왔는데 방장을 잃음');
    assert.strictEqual(lastState(d).players.length, 2);
    h2.close(); d.close();
  });

  await step('모두 끊겼으면 먼저 돌아온 사람이 방장을 맡는다', async () => {
    const h = await create('먼저나감');
    const d = await join(h.me.code, '먼저옴');
    tx(h, { t: 'addBot' });
    await waitFor(h, m => m.t === 'state' && m.players.length === 3);
    tx(h, { t: 'start' });
    await waitFor(d, m => m.t === 'state' && m.phase === 'playing');
    h.close(); d.close();
    await sleep(40);
    const d2 = await open();
    tx(d2, { t: 'resume', code: h.me.code, token: d.me.token });
    const s = await waitFor(d2, m => m.t === 'state');
    assert.strictEqual(s.hostId, d.me.you, '돌아온 사람이 방장을 못 맡음');
    d2.close();
  });

  await step('대기실에서 끊긴 자리는 유예 뒤 비워지고 돌아올 수 없다', async () => {
    b.close();
    await sleep(GRACE + 150);
    const x = await open();
    tx(x, { t: 'resume', code, token: b.me.token });
    const r = await waitFor(x, m => m.t === 'err' || m.t === 'welcome');
    assert.strictEqual(r.t, 'err', '대기실에서 끊긴 자리가 유예 뒤에도 남아 있음');
    x.close();
  });

  await step('판 중에 나가기를 누르면 곧바로 판에서 빠지고 쥔 보석은 은행으로 간다', async () => {
    const h = await create('하나');
    const d = await join(h.me.code, '둘');
    const e = await join(h.me.code, '셋');
    await waitFor(h, m => m.t === 'state' && m.players.length === 3);
    tx(h, { t: 'start' });
    let s = await waitFor(e, m => m.t === 'state' && m.phase === 'playing');
    // 누구든 차례인 사람이 보석을 집게 해서 은행에서 빠진 칩이 있게 한다
    for (let i = 0; i < 3; i++) {
      const v = lastState(h).view;
      const who = [h, d, e].find(x => lastState(x).view.me === v.players[v.turn].id);
      const mv = pickMove(lastState(who).view);
      const k = mark(h);
      tx(who, { t: 'act', action: mv.action, args: mv.args });
      await waitFor(h, m => m.t === 'state' && m.view.log.length !== v.log.length, { from: k });
    }
    const k = mark(h);
    tx(d, { t: 'leave' });
    await waitFor(d, m => m.t === 'left');
    s = await waitFor(h, m => m.t === 'state' && m.players.length === 2, { from: k });
    const gone = s.view.players.find(p => p.id === d.me.you);
    assert.ok(gone.out, '나간 사람이 판에 남음');
    assert.strictEqual(R.tokenCount(gone), 0, '나간 사람 보석이 은행으로 안 감');
    checkView(s.view, 3);
    await waitFor(h, m => m.t === 'ev' && m.kind === 'left' && m.name === '둘');
    [h, d, e].forEach(x => x.close());
  });

  await step('사람 하나 + 봇 셋으로 한 판을 끝까지 둔다', async () => {
    const h = await create('혼자온라인');
    for (let i = 0; i < 3; i++) tx(h, { t: 'addBot' });
    await waitFor(h, m => m.t === 'state' && m.players.length === 4);
    tx(h, { t: 'addBot' });                    // 다섯 번째는 거절
    await waitFor(h, m => m.t === 'err' && /자리/.test(m.msg));
    let seen = h.inbox.length, over = null, moves = 0;
    tx(h, { t: 'start' });
    const end = Date.now() + 60000;
    while (Date.now() < end && !over) {
      for (; seen < h.inbox.length; seen++) {
        const m = h.inbox[seen];
        if (m.t === 'err') throw new Error('서버가 거절: ' + m.msg);
        if (m.t !== 'state' || !m.view) continue;
        checkView(m.view, 4);
        if (m.phase === 'over') { over = m; break; }
      }
      const cur = lastState(h);
      if (!over && cur && cur.view && myTurn(cur.view) && cur.view !== h.lastActed) {
        h.lastActed = cur.view;
        const mv = pickMove(cur.view);
        tx(h, { t: 'act', action: mv.action, args: mv.args });
        moves++;
      }
      await sleep(5);
    }
    assert.ok(over, '60초 안에 판이 안 끝남');
    const v = over.view;
    const top = R.rank({ players: v.players })[0];
    assert.strictEqual(v.winner, top.id, '승자 표시가 순위와 다름');
    assert.ok(v.players.some(p => p.pts >= R.WIN_POINTS) || v.players.filter(p => !p.out).length <= 1, '15점 없이 끝남');
    console.log(`      ${v.round}라운드 · 내 수 ${moves}번 · 승자 ${v.players.find(p => p.id === v.winner).name} ` +
      v.players.map(p => `${p.name} ${p.pts}`).join(' / '));
    h.close();
  });

  await step('ping 은 아무 일도 일으키지 않는다 · 빈 메시지는 무시한다', async () => {
    const x = await open();
    tx(x, { t: 'ping' }); x.send('not json'); tx(x, { nope: 1 }); tx(x, { t: 'act' });
    await sleep(200);
    assert.strictEqual(x.inbox.length, 0);
    x.close();
  });
}

(async () => {
  let srv = { kill() {} };
  let stderr = '';
  if (!USE_EXISTING) {
    srv = spawn(process.execPath, [require.resolve('../server.js')], {
      env: Object.assign({}, process.env, { PORT: String(PORT), SPLENDOR_FAST: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    srv.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
    await new Promise((r, j) => {
      srv.stdout.on('data', d => { if (String(d).includes('스플렌더 서버')) r(); });
      srv.on('exit', c => j(new Error('서버가 뜨지 않음 ' + c)));
    });
  }
  console.log('스플렌더 서버 흐름 → ' + URL);
  try {
    await scenarios();
    // 실제 값 — FAST 없이 불러서 유예가 20초인지 본다
    delete process.env.SPLENDOR_FAST;
    const g = require('../game');
    assert.strictEqual(g.FAST, false);
    assert.strictEqual(g.LOBBY_GRACE, 20000, '방장 넘기기 유예가 20초가 아님');
    assert.strictEqual(g.DC_GRACE, 20000);
    assert.ok(g.readMs('봇 하나다이아몬드 · 사파이어 · 에메랄드 가져감', 1400) > 1400);
    pass++; console.log('  ✓ 실제 유예는 20초, 읽는 시간은 글자 수만큼');

    assert.strictEqual(stderr.trim(), '', '서버가 오류를 뱉음');
    console.log(`\n통과 ${pass}\n`);
    srv.kill();
    process.exit(0);
  } catch (e) {
    console.error('\n실패:', e.stack || e.message, '\n');
    srv.kill();
    process.exit(1);
  }
})();
