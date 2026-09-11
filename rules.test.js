/* 규칙 엔진 테스트 — node rules.test.js */
var R = require('./rules.js');
var AI = require('./ai.js');

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
function seats(n) {
  var a = []; for (var i = 0; i < n; i++) a.push({ id: 'p' + i, name: 'P' + i });
  return a;
}
function game(n, seed) { return R.newGame(seats(n), seed || 1); }
function gems(o) {
  var g = {}; R.ALL.forEach(function (c) { g[c] = o[c] || 0; }); return g;
}

section('카드 구성');
(function () {
  var t1 = R.buildTier(1), t2 = R.buildTier(2), t3 = R.buildTier(3);
  ok('1단계 40장', t1.length === 40, t1.length);
  ok('2단계 30장', t2.length === 30, t2.length);
  ok('3단계 20장', t3.length === 20, t3.length);

  var all = t1.concat(t2, t3);
  ok('전부 90장', all.length === 90);
  ok('아이디가 겹치지 않음', new Set(all.map(function (c) { return c.id; })).size === 90);

  var selfCost = all.filter(function (c) { return c.cost[c.gem]; });
  ok('자기 색을 요구하는 카드 없음', selfCost.length === 0, selfCost.length);

  R.COLORS.forEach(function (col) {
    ok(col + ' 색 카드 8/6/4장',
      t1.filter(function (c) { return c.gem === col; }).length === 8 &&
      t2.filter(function (c) { return c.gem === col; }).length === 6 &&
      t3.filter(function (c) { return c.gem === col; }).length === 4);
  });

  function pts(list) { return list.map(function (c) { return c.pts; }).sort().join(''); }
  var one = t1.filter(function (c) { return c.gem === 'w'; });
  ok('1단계는 0점 일곱 + 1점 하나', pts(one) === '00000001', pts(one));
  ok('2단계 점수는 1·1·2·2·2·3', pts(t2.filter(function (c) { return c.gem === 'w'; })) === '112223');
  ok('3단계 점수는 3·4·4·5', pts(t3.filter(function (c) { return c.gem === 'w'; })) === '3445');

  // 다섯 색이 대칭 — 색을 한 칸 돌리면 같은 비용표가 나온다
  function shape(card) {
    var base = R.COLORS.indexOf(card.gem), out = [];
    for (var o = 1; o <= 4; o++) out.push(card.cost[R.COLORS[(base + o) % 5]] || 0);
    return out.join(',');
  }
  var byShape = {};
  all.forEach(function (c) { byShape[c.tier + '|' + shape(c)] = (byShape[c.tier + '|' + shape(c)] || 0) + 1; });
  var uneven = Object.keys(byShape).filter(function (k) { return byShape[k] !== 5; });
  ok('모든 비용 모양이 다섯 색에 하나씩', uneven.length === 0, uneven.join(' '));
})();

section('판 벌리기');
(function () {
  [2, 3, 4].forEach(function (n) {
    var s = game(n, 5);
    ok(n + '인 보석 ' + R.bankStart(n) + '개씩',
      R.COLORS.every(function (c) { return s.bank[c] === R.bankStart(n); }));
    ok(n + '인 황금은 5개 고정', s.bank.y === 5);
    ok(n + '인 귀족 ' + (n + 1) + '명', s.nobles.length === n + 1);
    ok(n + '인 단계별 4장씩 공개', [1, 2, 3].every(function (t) {
      return s.board[t].filter(Boolean).length === 4;
    }));
    ok(n + '인 더미 장수', s.decks[1].length === 36 && s.decks[2].length === 26 && s.decks[3].length === 16);
  });
  var s2 = game(4, 9);
  var ids = {};
  [1, 2, 3].forEach(function (t) {
    s2.decks[t].concat(s2.board[t].filter(Boolean)).forEach(function (c) { ids[c.id] = 1; });
  });
  ok('90장이 빠짐없이 들어 있음', Object.keys(ids).length === 90, Object.keys(ids).length);
})();

section('보석 집기');
(function () {
  var s = game(2, 3);
  ok('서로 다른 3개', R.takeGems(s, 'p0', ['w', 'u', 'g']).ok);
  ok('가져온 만큼 줄어듦', s.bank.w === 3 && s.players[0].gems.w === 1);
  ok('내 차례가 아니면 거부', !R.takeGems(s, 'p0', ['w', 'u', 'g']).ok);
  ok('같은 색 2개 — 4개 이상 남았을 때', R.takeGems(s, 'p1', ['r', 'r']).ok);
  ok('같은 색 2개 — 3개만 남으면 거부', !R.takeGems(s, 'p0', ['r', 'r']).ok);
  ok('같은 색 3개는 거부', !R.takeGems(s, 'p0', ['u', 'u', 'u']).ok);
  ok('황금은 직접 못 집음', !R.takeGems(s, 'p0', ['y', 'w', 'u']).ok);
  ok('넉넉한데 2개만 집는 건 거부', !R.takeGems(s, 'p0', ['w', 'u']).ok);

  // 색이 두 가지밖에 안 남으면 그만큼만 집는다
  var s2 = game(2, 4);
  ['g', 'r', 'k'].forEach(function (c) { s2.bank[c] = 0; });
  ok('남은 색이 둘뿐이면 2개도 허용', R.takeGems(s2, 'p0', ['w', 'u']).ok);
})();

section('칩 10개 제한');
(function () {
  var s = game(2, 6);
  s.players[0].gems = gems({ w: 4, u: 4 });
  R.takeGems(s, 'p0', ['g', 'r', 'k']);
  ok('11개가 되면 버리기 단계', s.phase === 'discard' && s.turn === 0);
  ok('개수가 안 맞으면 거부', !R.discard(s, 'p0', ['w', 'u']).ok);
  ok('없는 보석은 거부', !R.discard(s, 'p0', ['y']).ok);
  ok('한 개 버리면 차례가 넘어감', R.discard(s, 'p0', ['w']).ok && s.phase === 'play' && s.turn === 1);
  ok('버린 칩은 은행으로', s.players[0].gems.w === 3);
  ok('10개가 됨', R.tokenCount(s.players[0]) === 10);

  // 같은 색을 여러 개 버리는 경우 (화면에서 같은 칸을 두 번 누르는 상황)
  var s2 = game(2, 7);
  s2.players[0].gems = gems({ w: 5, u: 4 });
  R.takeGems(s2, 'p0', ['g', 'r', 'k']);
  ok('12개면 2개를 버려야 한다', s2.phase === 'discard' &&
     R.tokenCount(s2.players[0]) - R.MAX_TOKENS === 2);
  ok('한 개만 내면 거부', !R.discard(s2, 'p0', ['w']).ok);
  ok('가진 것보다 많이 내면 거부', !R.discard(s2, 'p0', ['g', 'g']).ok);
  var bankW = s2.bank.w;
  ok('같은 색 2개 버리기', R.discard(s2, 'p0', ['w', 'w']).ok);
  ok('그 색이 2개 줄고 은행이 2개 늘었다',
     s2.players[0].gems.w === 3 && s2.bank.w === bankW + 2, s2.players[0].gems.w + '/' + s2.bank.w);
  ok('10개가 됨', R.tokenCount(s2.players[0]) === 10);

  // 세 개를 넘겨야 하는 경우도 (황금까지 섞어서)
  var s3 = game(2, 8);
  s3.players[0].gems = gems({ w: 4, u: 4, y: 2 });
  R.takeGems(s3, 'p0', ['g', 'r', 'k']);
  ok('13개면 3개', R.tokenCount(s3.players[0]) - R.MAX_TOKENS === 3);
  var bankY = s3.bank.y;
  ok('황금도 버릴 수 있다', R.discard(s3, 'p0', ['y', 'w', 'w']).ok &&
     s3.players[0].gems.y === 1 && s3.bank.y === bankY + 1);
})();

section('카드 사기');
(function () {
  var s = game(2, 8);
  var card = s.board[1][0];
  var p = s.players[0];
  R.COLORS.forEach(function (c) { p.gems[c] = card.cost[c] || 0; });
  var beforeBank = R.COLORS.reduce(function (a, c) { return a + s.bank[c]; }, 0);
  ok('낼 수 있으면 산다', R.buy(s, 'p0', card.id).ok);
  ok('보너스가 하나 늘어남', p.bonus[card.gem] === 1);
  ok('점수가 붙음', p.pts === card.pts);
  ok('낸 보석은 은행으로 돌아감',
    R.COLORS.reduce(function (a, c) { return a + s.bank[c]; }, 0) > beforeBank);
  ok('빈 자리는 더미에서 채워짐', !!s.board[1][0] && s.board[1][0].id !== card.id);
  ok('보석이 모자라면 거부', !R.buy(s, 'p1', s.board[3][0].id).ok);

  // 보너스 할인과 황금
  var s2 = game(2, 11);
  var c2 = s2.board[2][0], p2 = s2.players[0];
  var first = Object.keys(c2.cost)[0];
  p2.bonus[first] = c2.cost[first];                        // 그 색은 카드로 전부 대신한다
  R.COLORS.forEach(function (c) { if (c !== first) p2.gems[c] = c2.cost[c] || 0; });
  p2.gems[first] = 0;
  ok('보너스로 깎아서 산다', R.buy(s2, 'p0', c2.id).ok);

  var s3 = game(2, 12);
  var c3 = s3.board[1][0], p3 = s3.players[0];
  var k3 = Object.keys(c3.cost)[0];
  R.COLORS.forEach(function (c) { p3.gems[c] = c3.cost[c] || 0; });
  p3.gems[k3] -= 1; p3.gems.y = 1;
  var r3 = R.buy(s3, 'p0', c3.id);
  ok('모자란 하나는 황금으로', r3.ok && p3.gems.y === 0 && s3.bank.y === 6);
})();

section('킵');
(function () {
  var s = game(2, 15);
  var card = s.board[3][0];
  ok('공개 카드 킵', R.reserve(s, 'p0', card.id).ok);
  ok('킵하면 황금 1개', s.players[0].gems.y === 1 && s.bank.y === 4);
  ok('자리는 더미에서 채워짐', s.board[3][0] && s.board[3][0].id !== card.id);
  ok('킵한 카드는 남이 못 가져감', !R.findOnBoard(s, card.id));

  R.takeGems(s, 'p1', ['w', 'u', 'g']);
  R.reserve(s, 'p0', s.board[2][0].id);
  R.takeGems(s, 'p1', ['w', 'u', 'g']);
  R.reserveTop(s, 'p0', 1);
  ok('킵 3장', s.players[0].reserved.length === 3);
  R.takeGems(s, 'p1', ['w', 'u', 'g']);
  ok('4장째는 거부', !R.reserve(s, 'p0', s.board[1][0].id).ok);

  ok('더미에서 킵한 것은 뒷면', s.players[0].reserved[2].hidden === true);
  var vOther = R.viewFor(s, 'p1');
  ok('남에게는 안 보임', vOther.players[0].reserved[2].card === null);
  ok('나에게는 보임', R.viewFor(s, 'p0').players[0].reserved[2].card !== null);
  ok('더미는 장수만 보임', vOther.deckCount[1] === s.decks[1].length && !vOther.decks);

  // 킵한 카드를 산다
  var s2 = game(2, 16);
  R.reserve(s2, 'p0', s2.board[1][0].id);
  var kept = s2.players[0].reserved[0].card;
  R.takeGems(s2, 'p1', ['w', 'u', 'g']);
  R.COLORS.forEach(function (c) { s2.players[0].gems[c] = kept.cost[c] || 0; });
  ok('킵에서 구매', R.buy(s2, 'p0', kept.id).ok && s2.players[0].reserved.length === 0);

  // 황금이 없으면 킵만 하고 못 받는다
  var s3 = game(2, 17);
  s3.bank.y = 0;
  R.reserve(s3, 'p0', s3.board[1][0].id);
  ok('황금이 없으면 카드만', s3.players[0].gems.y === 0);
})();

section('귀족');
(function () {
  var s = game(2, 21);
  var nb = s.nobles[0], p = s.players[0];
  for (var c in nb.need) p.bonus[c] = nb.need[c];
  R.takeGems(s, 'p0', ['w', 'u', 'g']);
  ok('조건을 채우면 저절로 온다', p.nobles.length === 1 && p.pts === 3);
  ok('귀족 줄에서 빠진다', s.nobles.length === 2);
  ok('차례는 그대로 넘어간다', s.turn === 1 && s.phase === 'play');

  var s2 = game(2, 22);
  var p2 = s2.players[0];
  s2.nobles.slice(0, 2).forEach(function (n) {
    for (var c2 in n.need) p2.bonus[c2] = Math.max(p2.bonus[c2], n.need[c2]);
  });
  R.takeGems(s2, 'p0', ['w', 'u', 'g']);
  var elig = R.eligibleNobles(s2, p2);
  ok('둘이면 고르는 단계', s2.phase === 'noble' && s2.turn === 0 && elig.length >= 2, elig.length);
  var outsider = s2.nobles.filter(function (n) {
    return !elig.some(function (e) { return e.id === n.id; });
  })[0];
  ok('못 고르는 귀족은 거부', !R.pickNoble(s2, 'p0', outsider ? outsider.id : 'zzz').ok);
  ok('하나 고르면 차례 종료', R.pickNoble(s2, 'p0', elig[0].id).ok && s2.turn === 1);
  ok('한 턴에 하나만', p2.nobles.length === 1);
})();

section('종료와 순위');
(function () {
  var s = game(3, 31);
  s.players[0].pts = 15;
  R.takeGems(s, 'p0', ['w', 'u', 'g']);
  ok('15점을 넘겨도 그 자리에서 안 끝남', s.phase !== 'over' && s.endRound === true);
  R.takeGems(s, 'p1', ['w', 'u', 'g']);
  ok('아직 진행 중', s.phase !== 'over');
  R.takeGems(s, 'p2', ['w', 'u', 'g']);
  ok('마지막 사람까지 마치면 종료', s.phase === 'over');
  ok('승자는 최고점', s.winner === 'p0');

  // 동점이면 카드가 적은 쪽
  var s2 = game(2, 32);
  s2.players[0].pts = 15; s2.players[0].cards = new Array(12);
  s2.players[1].pts = 15; s2.players[1].cards = new Array(9);
  R.takeGems(s2, 'p0', ['w', 'u', 'g']);
  R.takeGems(s2, 'p1', ['w', 'u', 'g']);
  ok('동점이면 카드가 적은 쪽', s2.phase === 'over' && s2.winner === 'p1');

  // 카드까지 같으면 귀족이 많은 쪽
  var s3 = game(2, 33);
  s3.players[0].pts = 15; s3.players[0].cards = new Array(9); s3.players[0].nobles = [1];
  s3.players[1].pts = 15; s3.players[1].cards = new Array(9);
  R.takeGems(s3, 'p0', ['w', 'u', 'g']);
  R.takeGems(s3, 'p1', ['w', 'u', 'g']);
  ok('귀족이 많은 쪽', s3.winner === 'p0');
})();

section('나간 사람');
(function () {
  var s = game(3, 41);
  R.dropPlayer(s, 'p1');
  ok('빠진 사람은 표시된다', s.players[1].out === true);
  R.takeGems(s, 'p0', ['w', 'u', 'g']);
  ok('차례를 건너뛴다', s.turn === 2);
  R.dropPlayer(s, 'p2');
  ok('혼자 남으면 끝난다', s.phase === 'over' && s.winner === 'p0');

  var s2 = game(2, 42);
  R.dropPlayer(s2, 'p0');
  ok('차례 주인이 나가도 멈추지 않는다', s2.phase === 'over');
})();

section('막힌 판');
(function () {
  var s = game(2, 51);
  ok('보통은 넘길 수 없다', !R.pass(s, 'p0').ok);
  R.COLORS.forEach(function (c) { s.bank[c] = 0; });
  [1, 2, 3].forEach(function (t) {
    s.decks[t] = [];
    s.board[t] = [null, null, null, null];
  });
  ok('아무것도 못 하면 넘긴다', R.pass(s, 'p0').ok && s.turn === 1);
  ok('시야에도 알려준다', R.viewFor(s, 'p1').canPass === true);
})();

section('봇으로 500판');
(function () {
  var bad = 0, stuck = 0, rounds = [], nobles = 0, games = 0;
  for (var g = 0; g < 500; g++) {
    var n = 2 + (g % 3);
    var s = game(n, g * 7 + 1);
    s.players.forEach(function (p) { p.bot = true; });
    var steps = 0, err = null;
    while (s.phase !== 'over' && steps < 3000) {
      steps++;
      var pid = R.current(s).id, v = R.viewFor(s, pid), r;
      if (s.phase === 'discard') r = R.discard(s, pid, AI.chooseDiscard(v));
      else if (s.phase === 'noble') r = R.pickNoble(s, pid, AI.chooseNoble(v));
      else {
        var a = AI.act(v, 1);
        r = a ? R[a.action].apply(null, [s, pid].concat(a.args)) : { ok: false, error: '수 없음' };
      }
      if (!r.ok) { err = r.error; break; }

      // 칩 총량은 절대 변하지 않는다
      R.ALL.forEach(function (c) {
        var tot = s.bank[c];
        s.players.forEach(function (p) { tot += p.gems[c]; });
        if (tot !== (c === 'y' ? 5 : R.bankStart(n))) err = c + ' 칩 총량 ' + tot;
      });
      s.players.forEach(function (p) {
        if (s.phase !== 'discard' && R.tokenCount(p) > 10) err = '칩 10개 초과';
        if (p.reserved.length > 3) err = '킵 4장';
        var pts = p.cards.reduce(function (a, c) { return a + c.pts; }, 0) + p.nobles.length * 3;
        if (pts !== p.pts) err = '점수 불일치';
      });
      if (err) break;
    }
    if (err) { bad++; if (bad <= 3) console.log('  ✗ 판 ' + g + ': ' + err); }
    else if (s.phase !== 'over') stuck++;
    else {
      games++; rounds.push(s.round);
      s.players.forEach(function (p) { nobles += p.nobles.length; });
    }
  }
  ok('500판 규칙 위반 없음', bad === 0, bad);
  ok('500판 전부 종료', stuck === 0, stuck);
  rounds.sort(function (a, b) { return a - b; });
  console.log('  라운드: 최소 ' + rounds[0] + ' / 중앙 ' + rounds[Math.floor(rounds.length / 2)] +
              ' / 최대 ' + rounds[rounds.length - 1] + '   판당 귀족 ' + (nobles / games).toFixed(2) + '명');
})();

/* ---------------- 나간 사람의 보석 ---------------- */
(function () {
  var s = R.newGame([{ id: 'p0', name: '가' }, { id: 'p1', name: '나' }, { id: 'p2', name: '다' }], 7);
  var cur = R.current(s).id;
  var before = JSON.stringify(s.bank);
  R.takeGems(s, cur, ['w', 'u', 'g']);
  R.dropPlayer(s, cur);
  ok('나간 사람이 쥐던 보석은 은행으로 돌아온다', JSON.stringify(s.bank) === before);
})();

console.log('\n' + (fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass);
process.exit(fail ? 1 : 0);
