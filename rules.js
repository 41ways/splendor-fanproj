/* 스플렌더 — 규칙 엔진
   순수 함수 모음. 네트워크도 UI도 모른다. 노드에서 그대로 테스트된다.

   보석: 다이아몬드(w) 사파이어(u) 에메랄드(g) 루비(r) 오닉스(k) + 황금(y, 조커)
   개발 카드 90장 — 1단계 40 / 2단계 30 / 3단계 20. 각 단계는 4장씩 펼쳐진다.
   차례에 할 수 있는 일은 셋 중 하나: 보석 집기 / 카드 사기 / 카드 킵하기.
   보석 15점을 먼저 넘겨도 그 라운드는 끝까지 돌고, 가장 높은 점수가 이긴다.
*/
(function (root) {
  'use strict';

  var COLORS = ['w', 'u', 'g', 'r', 'k'];
  var GOLD = 'y';
  var ALL = COLORS.concat([GOLD]);
  var GEM_NAME = { w: '다이아몬드', u: '사파이어', g: '에메랄드', r: '루비', k: '오닉스', y: '황금' };
  var WIN_POINTS = 15;
  var MAX_TOKENS = 10;
  var MAX_RESERVED = 3;

  /* ---------- 난수 ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- 카드 ----------
     실제 스플렌더처럼 다섯 색이 정확히 대칭이다.
     비용은 '자기 색 다음 색부터' 시계 방향으로 적는다. 어떤 카드도 자기 색을 요구하지 않는다.
     단계별 점수 구성: 1단계 0점 일곱 + 1점 하나 / 2단계 1·1·2·2·2·3 / 3단계 3·4·4·5 */
  var PAT = {
    1: [[0, [1, 1, 1, 1]], [0, [1, 2, 1, 1]], [0, [2, 2, 0, 1]], [0, [0, 1, 3, 1]],
        [0, [0, 2, 1, 0]], [0, [3, 0, 0, 0]], [0, [0, 0, 2, 1]], [1, [0, 4, 0, 0]]],
    2: [[1, [0, 3, 2, 2]], [1, [2, 3, 0, 3]], [2, [0, 0, 5, 0]],
        [2, [5, 3, 0, 0]], [2, [0, 4, 2, 1]], [3, [6, 0, 0, 0]]],
    3: [[3, [3, 5, 3, 3]], [4, [0, 7, 0, 0]], [4, [3, 6, 3, 0]], [5, [3, 7, 3, 0]]]
  };

  function buildTier(tier) {
    var out = [], pats = PAT[tier];
    for (var ci = 0; ci < COLORS.length; ci++) {
      for (var pi = 0; pi < pats.length; pi++) {
        var cost = {};
        for (var o = 0; o < 4; o++) {
          var amt = pats[pi][1][o];
          if (amt) cost[COLORS[(ci + o + 1) % COLORS.length]] = amt;
        }
        out.push({ id: 'c' + tier + COLORS[ci] + pi, tier: tier, gem: COLORS[ci], pts: pats[pi][0], cost: cost });
      }
    }
    return out;
  }

  /* ---------- 귀족 ----------
     열 명. 다섯은 두 색 4개씩, 다섯은 세 색 3개씩. 전부 3점. */
  var NOBLES = [
    { id: 'n0', name: '유리공방',   icon: '🔨', need: { w: 4, u: 4 } },
    { id: 'n1', name: '항구 선주',     icon: '⚓', need: { u: 4, g: 4 } },
    { id: 'n2', name: '왕실 보석상',     icon: '👑', need: { g: 4, r: 4 } },
    { id: 'n3', name: '사막 대상',     icon: '🐪', need: { r: 4, k: 4 } },
    { id: 'n4', name: '등대지기',        icon: '🗼', need: { k: 4, w: 4 } },
    { id: 'n5', name: '필경사',   icon: '📜', need: { w: 3, u: 3, g: 3 } },
    { id: 'n6', name: '천문대장',        icon: '🔭', need: { u: 3, g: 3, r: 3 } },
    { id: 'n7', name: '극단 후원자',   icon: '🎭', need: { g: 3, r: 3, k: 3 } },
    { id: 'n8', name: '식물학자', icon: '🌿', need: { r: 3, k: 3, w: 3 } },
    { id: 'n9', name: '시계공',          icon: '⏱', need: { k: 3, w: 3, u: 3 } }
  ];
  var NOBLE_POINTS = 3;

  function bankStart(n) { return n <= 2 ? 4 : (n === 3 ? 5 : 7); }

  /* ---------- 준비 ---------- */
  function newGame(seats, seed) {
    var rng = mulberry32(seed || 1);
    var n = seats.length;
    var perColor = bankStart(n);

    var bank = { y: 5 };
    COLORS.forEach(function (c) { bank[c] = perColor; });

    var decks = {}, board = {};
    [1, 2, 3].forEach(function (t) {
      decks[t] = shuffle(buildTier(t), rng);
      board[t] = [];
      for (var i = 0; i < 4; i++) board[t].push(decks[t].pop() || null);
    });

    var nobles = shuffle(NOBLES.slice(), rng).slice(0, n + 1).map(function (x) {
      return { id: x.id, name: x.name, icon: x.icon, need: x.need, pts: NOBLE_POINTS };
    });

    var players = seats.map(function (s) {
      var gems = {}; ALL.forEach(function (c) { gems[c] = 0; });
      var bonus = {}; COLORS.forEach(function (c) { bonus[c] = 0; });
      return {
        id: s.id, name: s.name, bot: !!s.bot,
        gems: gems, bonus: bonus, cards: [], reserved: [], nobles: [], pts: 0
      };
    });

    return {
      seed: seed || 1,
      players: players, decks: decks, board: board, nobles: nobles, bank: bank,
      turn: 0, round: 1, phase: 'play', endRound: false, winner: null,
      log: [], lastEvent: null
    };
  }

  /* ---------- 조회 ---------- */
  function player(s, id) {
    for (var i = 0; i < s.players.length; i++) if (s.players[i].id === id) return s.players[i];
    return null;
  }
  function current(s) { return s.players[s.turn]; }
  function tokenCount(p) {
    var n = 0; ALL.forEach(function (c) { n += p.gems[c] || 0; }); return n;
  }
  function totalPoints(p) { return p.pts; }

  // 카드를 사려면 색깔별로 몇 개가 더 필요한가 (보너스를 빼고, 황금은 아직 안 세고)
  function shortfall(p, card) {
    var out = {}, sum = 0;
    COLORS.forEach(function (c) {
      var need = (card.cost[c] || 0) - (p.bonus[c] || 0) - (p.gems[c] || 0);
      if (need > 0) { out[c] = need; sum += need; }
    });
    out.total = sum;
    return out;
  }

  // 실제 지불 내역. 못 사면 null.
  function payFor(p, card) {
    var pay = {}, gold = 0;
    for (var i = 0; i < COLORS.length; i++) {
      var c = COLORS[i];
      var need = Math.max(0, (card.cost[c] || 0) - (p.bonus[c] || 0));
      var use = Math.min(need, p.gems[c] || 0);
      if (use) pay[c] = use;
      gold += need - use;
    }
    if (gold > (p.gems[GOLD] || 0)) return null;
    if (gold) pay[GOLD] = gold;
    return { pay: pay, gold: gold };
  }
  function canAfford(p, card) { return !!payFor(p, card); }

  function qualifies(p, noble) {
    for (var c in noble.need) {
      if (!Object.prototype.hasOwnProperty.call(noble.need, c)) continue;
      if ((p.bonus[c] || 0) < noble.need[c]) return false;
    }
    return true;
  }
  function eligibleNobles(s, p) {
    return s.nobles.filter(function (nb) { return qualifies(p, nb); });
  }

  function findOnBoard(s, cardId) {
    for (var t = 1; t <= 3; t++) {
      for (var i = 0; i < s.board[t].length; i++) {
        var c = s.board[t][i];
        if (c && c.id === cardId) return { tier: t, index: i, card: c };
      }
    }
    return null;
  }

  /* ---------- 기록 ---------- */
  function note(s, p, text, event) {
    s.log.push({ pid: p ? p.id : null, name: p ? p.name : '', text: text });
    if (s.log.length > 40) s.log.shift();
    s.lastEvent = event || null;
  }
  function gemWord(list) {
    return list.map(function (c) { return GEM_NAME[c]; }).join(' · ');
  }

  /* ---------- 차례 넘기기 ---------- */
  function afterAction(s) {
    var p = current(s);
    if (tokenCount(p) > MAX_TOKENS) { s.phase = 'discard'; return; }
    nobleStep(s);
  }

  function nobleStep(s) {
    var p = current(s);
    var elig = eligibleNobles(s, p);
    if (elig.length === 1) { takeNoble(s, p, elig[0]); }
    else if (elig.length > 1) { s.phase = 'noble'; return; }
    advance(s);
  }

  function takeNoble(s, p, nb) {
    s.nobles = s.nobles.filter(function (x) { return x.id !== nb.id; });
    p.nobles.push(nb);
    p.pts += nb.pts;
    note(s, p, '귀족 ' + nb.name + ' 방문 (+' + nb.pts + '점)', { type: 'noble', pid: p.id, noble: nb.id });
  }

  function alive(s) { return s.players.filter(function (p) { return !p.out; }); }

  function advance(s) {
    for (var i = 0; i < s.players.length; i++) {
      if (!s.players[i].out && s.players[i].pts >= WIN_POINTS) s.endRound = true;
    }
    if (alive(s).length <= 1) { finish(s); return; }

    // 나간 사람은 건너뛴다. 한 바퀴를 돌 때마다 라운드가 하나 올라간다.
    for (var step = 0; step < s.players.length; step++) {
      s.turn = (s.turn + 1) % s.players.length;
      if (s.turn === 0) {
        s.round++;
        if (s.endRound) { finish(s); return; }
      }
      if (!s.players[s.turn].out) break;
    }
    s.phase = 'play';
  }

  // 온라인에서 누가 나갔을 때 — 자리를 비우고 판은 계속 굴린다
  function dropPlayer(s, pid) {
    var p = player(s, pid);
    if (!p || p.out || s.phase === 'over') return { ok: false, error: '이미 빠진 자리입니다.' };
    p.out = true;
    // 쥐고 있던 보석은 은행으로 돌려놓는다. 안 그러면 남은 사람들이 쓸 보석이 그만큼 영영 모자란다.
    ALL.forEach(function (c) { s.bank[c] += p.gems[c] || 0; p.gems[c] = 0; });
    note(s, p, '연결이 끊겨 빠짐', { type: 'drop', pid: pid });
    if (alive(s).length <= 1) { finish(s); return { ok: true }; }
    if (current(s).id === pid) { s.phase = 'play'; advance(s); }
    return { ok: true };
  }

  // 동점 처리 — 점수 > 개발 카드 적은 순 > 귀족 많은 순 > 남은 칩 많은 순 > 후공
  function rank(s) {
    var live = alive(s);
    var pool = live.length ? live : s.players;
    var order = pool.map(function (p) { return { p: p, seat: s.players.indexOf(p) }; });
    order.sort(function (a, b) {
      if (b.p.pts !== a.p.pts) return b.p.pts - a.p.pts;
      if (a.p.cards.length !== b.p.cards.length) return a.p.cards.length - b.p.cards.length;
      if (b.p.nobles.length !== a.p.nobles.length) return b.p.nobles.length - a.p.nobles.length;
      var ta = tokenCount(a.p), tb = tokenCount(b.p);
      if (tb !== ta) return tb - ta;
      return b.seat - a.seat;
    });
    return order.map(function (x) { return x.p; });
  }

  function finish(s) {
    s.phase = 'over';
    s.winner = rank(s)[0].id;
    note(s, null, '게임 종료', { type: 'over' });
  }

  /* ---------- 행동 ---------- */
  function guard(s, pid, phase) {
    if (s.phase === 'over') return '이미 끝난 판입니다.';
    if (s.phase !== phase) return '지금 할 수 있는 행동이 아닙니다.';
    if (current(s).id !== pid) return '당신 차례가 아닙니다.';
    return null;
  }

  // 서로 다른 3개, 또는 같은 색 2개(그 색이 4개 이상 남아 있을 때)
  function takeGems(s, pid, list) {
    var err = guard(s, pid, 'play');
    if (err) return { ok: false, error: err };
    if (!Array.isArray(list) || !list.length) return { ok: false, error: '보석을 고르세요.' };
    for (var i = 0; i < list.length; i++) {
      if (COLORS.indexOf(list[i]) < 0) return { ok: false, error: '황금은 직접 가져올 수 없습니다.' };
    }
    var p = current(s), avail = COLORS.filter(function (c) { return s.bank[c] > 0; });

    if (list.length === 2 && list[0] === list[1]) {
      if (s.bank[list[0]] < 4) return { ok: false, error: '같은 색 2개는 그 보석이 4개 이상 남아 있을 때만 됩니다.' };
    } else {
      var seen = {};
      for (var j = 0; j < list.length; j++) {
        if (seen[list[j]]) return { ok: false, error: '서로 다른 색으로 골라야 합니다.' };
        seen[list[j]] = true;
        if (s.bank[list[j]] <= 0) return { ok: false, error: GEM_NAME[list[j]] + '이(가) 바닥났습니다.' };
      }
      if (list.length > 3) return { ok: false, error: '한 번에 3개까지입니다.' };
      // 3개를 못 채우는 건 바닥에 색이 그만큼 없을 때만 허용한다
      if (list.length < 3 && avail.length > list.length) {
        return { ok: false, error: '서로 다른 3가지를 집을 수 있습니다.' };
      }
    }

    list.forEach(function (c) { s.bank[c]--; p.gems[c]++; });
    note(s, p, gemWord(list) + ' 가져감', { type: 'take', pid: p.id, gems: list.slice() });
    afterAction(s);
    return { ok: true };
  }

  function buy(s, pid, cardId) {
    var err = guard(s, pid, 'play');
    if (err) return { ok: false, error: err };
    var p = current(s);

    var spot = findOnBoard(s, cardId), fromReserve = -1, card = spot ? spot.card : null;
    if (!card) {
      for (var i = 0; i < p.reserved.length; i++) {
        if (p.reserved[i].card.id === cardId) { fromReserve = i; card = p.reserved[i].card; break; }
      }
    }
    if (!card) return { ok: false, error: '그 카드를 살 수 없습니다.' };

    var bill = payFor(p, card);
    if (!bill) return { ok: false, error: '보석이 모자랍니다.' };

    for (var c in bill.pay) {
      if (!Object.prototype.hasOwnProperty.call(bill.pay, c)) continue;
      p.gems[c] -= bill.pay[c];
      s.bank[c] += bill.pay[c];
    }
    p.cards.push(card);
    p.bonus[card.gem]++;
    p.pts += card.pts;

    if (fromReserve >= 0) p.reserved.splice(fromReserve, 1);
    else s.board[spot.tier][spot.index] = s.decks[spot.tier].pop() || null;

    note(s, p, cardLabel(card) + ' 구매' + (card.pts ? ' (+' + card.pts + '점)' : '') +
      (fromReserve >= 0 ? ' · 킵에서' : ''), { type: 'buy', pid: p.id, card: card.id });
    afterAction(s);
    return { ok: true };
  }

  function reserve(s, pid, cardId) {
    var err = guard(s, pid, 'play');
    if (err) return { ok: false, error: err };
    var p = current(s);
    if (p.reserved.length >= MAX_RESERVED) return { ok: false, error: '킵은 3장까지입니다.' };
    var spot = findOnBoard(s, cardId);
    if (!spot) return { ok: false, error: '그 카드를 킵할 수 없습니다.' };

    p.reserved.push({ card: spot.card, hidden: false });
    s.board[spot.tier][spot.index] = s.decks[spot.tier].pop() || null;
    var gold = grabGold(s, p);
    note(s, p, cardLabel(spot.card) + ' 킵' + (gold ? ' · 황금 1개' : ''),
      { type: 'reserve', pid: p.id, card: spot.card.id });
    afterAction(s);
    return { ok: true };
  }

  // 더미에서 보지 않고 한 장 — 다른 사람에게는 뒷면으로 보인다
  function reserveTop(s, pid, tier) {
    var err = guard(s, pid, 'play');
    if (err) return { ok: false, error: err };
    var p = current(s);
    if (p.reserved.length >= MAX_RESERVED) return { ok: false, error: '킵은 3장까지입니다.' };
    if (!s.decks[tier] || !s.decks[tier].length) return { ok: false, error: '그 더미가 비었습니다.' };

    var card = s.decks[tier].pop();
    p.reserved.push({ card: card, hidden: true });
    var gold = grabGold(s, p);
    note(s, p, tier + '단계 더미에서 한 장 킵' + (gold ? ' · 황금 1개' : ''),
      { type: 'reserve', pid: p.id, card: null });
    afterAction(s);
    return { ok: true };
  }

  function grabGold(s, p) {
    if (s.bank[GOLD] > 0) { s.bank[GOLD]--; p.gems[GOLD]++; return true; }
    return false;
  }

  // 10개를 넘겼을 때 넘치는 만큼 버린다
  function discard(s, pid, list) {
    var err = guard(s, pid, 'discard');
    if (err) return { ok: false, error: err };
    var p = current(s), over = tokenCount(p) - MAX_TOKENS;
    if (!Array.isArray(list) || list.length !== over) {
      return { ok: false, error: '정확히 ' + over + '개를 버려야 합니다.' };
    }
    var tally = {};
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (ALL.indexOf(c) < 0) return { ok: false, error: '그런 보석이 없습니다.' };
      tally[c] = (tally[c] || 0) + 1;
      if (tally[c] > p.gems[c]) return { ok: false, error: '가지고 있지 않은 보석입니다.' };
    }
    list.forEach(function (c) { p.gems[c]--; s.bank[c]++; });
    note(s, p, gemWord(list) + ' 버림', { type: 'discard', pid: p.id, gems: list.slice() });
    nobleStep(s);
    return { ok: true };
  }

  // 아무 행동도 못 하는 상황인가 (보석도 못 집고, 못 사고, 킵도 못 하고)
  function hasMove(s, pid) {
    var p = player(s, pid);
    if (!p) return false;
    for (var i = 0; i < COLORS.length; i++) if (s.bank[COLORS[i]] > 0) return true;
    if (p.reserved.length < MAX_RESERVED) {
      for (var t = 1; t <= 3; t++) {
        if (s.decks[t].length) return true;
        for (var j = 0; j < s.board[t].length; j++) if (s.board[t][j]) return true;
      }
    }
    var cards = [];
    for (var t2 = 1; t2 <= 3; t2++) cards = cards.concat(s.board[t2].filter(Boolean));
    cards = cards.concat(p.reserved.map(function (r) { return r.card; }));
    for (var k = 0; k < cards.length; k++) if (canAfford(p, cards[k])) return true;
    return false;
  }

  // 정말 아무것도 못 할 때만 넘긴다 (바닥이 다 마른 판)
  function pass(s, pid) {
    var err = guard(s, pid, 'play');
    if (err) return { ok: false, error: err };
    if (hasMove(s, pid)) return { ok: false, error: '아직 할 수 있는 행동이 있습니다.' };
    note(s, current(s), '할 수 있는 게 없어 넘김', { type: 'pass', pid: pid });
    advance(s);
    return { ok: true };
  }

  // 두 귀족 이상이 동시에 조건을 만족했을 때 하나를 고른다
  function pickNoble(s, pid, nobleId) {
    var err = guard(s, pid, 'noble');
    if (err) return { ok: false, error: err };
    var p = current(s), elig = eligibleNobles(s, p);
    var found = null;
    for (var i = 0; i < elig.length; i++) if (elig[i].id === nobleId) found = elig[i];
    if (!found) return { ok: false, error: '고를 수 없는 귀족입니다.' };
    takeNoble(s, p, found);
    advance(s);
    return { ok: true };
  }

  function cardLabel(card) {
    return card.tier + '단계 ' + GEM_NAME[card.gem] + (card.pts ? ' ' + card.pts + '점' : '');
  }

  /* ---------- 시야 ----------
     더미는 장수만, 남의 뒷면 킵은 단계만 보인다. 그 밖에는 전부 공개다. */
  function viewFor(s, pid) {
    return {
      phase: s.phase, turn: s.turn, round: s.round, endRound: s.endRound, winner: s.winner,
      me: pid,
      bank: JSON.parse(JSON.stringify(s.bank)),
      board: JSON.parse(JSON.stringify(s.board)),
      deckCount: { 1: s.decks[1].length, 2: s.decks[2].length, 3: s.decks[3].length },
      nobles: JSON.parse(JSON.stringify(s.nobles)),
      log: s.log.slice(-12),
      lastEvent: s.lastEvent,
      nobleChoices: s.phase === 'noble' ? eligibleNobles(s, current(s)).map(function (n) { return n.id; }) : [],
      canPass: s.phase === 'play' && !hasMove(s, current(s).id),
      players: s.players.map(function (p) {
        return {
          id: p.id, name: p.name, bot: p.bot, out: !!p.out, pts: p.pts,
          gems: JSON.parse(JSON.stringify(p.gems)),
          bonus: JSON.parse(JSON.stringify(p.bonus)),
          cards: p.cards.map(function (c) { return { id: c.id, tier: c.tier, gem: c.gem, pts: c.pts }; }),
          nobles: JSON.parse(JSON.stringify(p.nobles)),
          reserved: p.reserved.map(function (r) {
            if (r.hidden && p.id !== pid) return { hidden: true, tier: r.card.tier, card: null };
            return { hidden: r.hidden, tier: r.card.tier, card: JSON.parse(JSON.stringify(r.card)) };
          })
        };
      })
    };
  }

  var API = {
    COLORS: COLORS, GOLD: GOLD, ALL: ALL, GEM_NAME: GEM_NAME, NOBLES: NOBLES,
    WIN_POINTS: WIN_POINTS, MAX_TOKENS: MAX_TOKENS, MAX_RESERVED: MAX_RESERVED,
    buildTier: buildTier, bankStart: bankStart,
    newGame: newGame, player: player, current: current, tokenCount: tokenCount, totalPoints: totalPoints,
    shortfall: shortfall, payFor: payFor, canAfford: canAfford,
    qualifies: qualifies, eligibleNobles: eligibleNobles, findOnBoard: findOnBoard,
    cardLabel: cardLabel, rank: rank, alive: alive, dropPlayer: dropPlayer,
    takeGems: takeGems, buy: buy, reserve: reserve, reserveTop: reserveTop,
    discard: discard, pickNoble: pickNoble, pass: pass, hasMove: hasMove,
    viewFor: viewFor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Rules = API;
})(typeof self !== 'undefined' ? self : this);
