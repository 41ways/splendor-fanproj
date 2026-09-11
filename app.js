/* 스플렌더 — 화면과 진행
   방장(또는 혼자 하기)의 브라우저가 심판이다. 참가자는 자기 시야만 받아서 그린다. */
(function () {
  'use strict';
  var R = window.Rules, AI = window.AI;
  var $ = function (id) { return document.getElementById(id); };
  var COLORS = R.COLORS, GOLD = R.GOLD, NAME = R.GEM_NAME;
  var SHORT = { w: '다이아', u: '사파이어', g: '에메랄드', r: '루비', k: '오닉스', y: '황금' };

  var App = {
    mode: 'solo', me: 'me', net: null, seats: [], state: null, view: null,
    started: false, skill: 1, botTimer: null, sig: '',
    selCard: null, selDeck: null, gems: [], drop: [],
    coach: true, tip: null, tourStep: 0,
    moveKey: '', moveTimer: null, holdUntil: 0
  };

  function show(which) {
    ['home', 'setup', 'lobby', 'game'].forEach(function (id) {
      $(id).classList.toggle('hidden', id !== which);
    });
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2000);
  }
  function myName() { return $('name').value.trim() || '이름없음'; }
  function seatOf(id) {
    for (var i = 0; i < App.seats.length; i++) if (App.seats[i].id === id) return App.seats[i];
    return null;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function icon(id, cls) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', cls || '');
    var use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }
  /* 남이 정한 값(이름 등)을 innerHTML 에 넣을 때는 반드시 이걸 거친다 */
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ---------------- 진행 ---------------- */
  function startEngine() {
    if (App.seats.length < 2) { toast('2명 이상이어야 시작할 수 있습니다.'); return; }
    App.started = true;
    App.state = R.newGame(App.seats.map(function (s) {
      return { id: s.id, name: s.name, bot: s.bot };
    }), Math.floor(Math.random() * 1e9));
    clearSel();
    show('game');
    pushViews();
  }

  function clearSel() { App.selCard = null; App.selDeck = null; App.gems = []; App.drop = []; }

  function pushViews() {
    var s = App.state;
    if (App.mode === 'host' && App.net) {
      App.net.broadcast(function (pid) { return { t: 'view', view: R.viewFor(s, pid) }; });
    }
    applyView(R.viewFor(s, App.me));
  }

  function sigOf(v) {
    var p = meOf(v);
    return v.turn + '/' + v.phase + '/' + v.round + '/' +
      (p ? p.cards.length + ':' + R.tokenCount(p) + ':' + p.reserved.length : '');
  }

  /* ── 방금 무슨 일이 있었는가 ──
     봇이 700ms 마다 조용히 움직이면 처음 하는 사람은 판이 왜 바뀌었는지 따라갈 수 없다.
     남이 둔 수를 한 줄로 띄우고, 그 줄을 읽을 만큼 다음 수를 미룬다.
     한글 짧은 문구는 눈에 들어오는 데 0.8초 + 글자당 0.07초쯤 걸린다. */
  function readMs(text, floor) {
    var n = String(text || '').replace(/\s/g, '').length;
    return Math.max(floor, 800 + n * 70);
  }

  function showMove(v) {
    var last = v.log && v.log.length ? v.log[v.log.length - 1] : null;
    if (!last) return;
    var key = v.round + '|' + v.turn + '|' + last.name + '|' + last.text;
    if (key === App.moveKey) return;
    App.moveKey = key;

    var box = $('move');
    // 내가 둔 수는 내가 방금 눌렀으니 굳이 붙잡아 두지 않는다
    var mine = last.pid === v.me;
    box.querySelector('.mv-who').textContent = last.name || '';
    box.querySelector('.mv-what').textContent = last.text || '';
    box.classList.add('on');

    var hold = mine ? 600 : readMs((last.name || '') + (last.text || ''), 1400);
    App.holdUntil = Date.now() + hold;
    clearTimeout(App.moveTimer);
    App.moveTimer = setTimeout(function () { box.classList.remove('on'); }, hold);
  }

  function applyView(v) {
    var prev = App.view;
    var sig = sigOf(v);
    if (sig !== App.sig) { clearSel(); App.sig = sig; }
    App.view = v;
    App.tip = tipFor(v);
    render();
    showMove(v);

    // 버리기 단계에서는 눌러야 할 내 칩이 아래 조작 판에 가린다. 판 위로 끌어올린다.
    if (v.phase === 'discard' && isMyTurn(v) && (!prev || prev.phase !== 'discard')) showMine();
    if (v.phase === 'over') showOver(v);
    scheduleBot();
  }

  // 내 칩 줄이 아래 조작 판에 가리지 않는 자리까지 스크롤한다
  function showMine() {
    var box = $('mine'), panel = document.querySelector('.panel');
    if (!box) return;
    var lift = (panel ? panel.offsetHeight : 0) + 14;
    var y = window.scrollY + box.getBoundingClientRect().bottom - window.innerHeight + lift;
    if (y <= window.scrollY) return;                 // 이미 잘 보이면 그대로 둔다
    try { window.scrollTo({ top: y, behavior: 'smooth' }); }
    catch (e) { window.scrollTo(0, y); }
    // 부드러운 스크롤은 탭이 뒤에 있으면 무시되기도 한다. 안 갔으면 그냥 옮긴다.
    setTimeout(function () {
      if (Math.abs(window.scrollY - y) > 4) window.scrollTo(0, y);
    }, 320);
  }

  function scheduleBot() {
    if (App.mode === 'client') return;
    var s = App.state;
    if (!s || s.phase === 'over') return;
    var p = R.current(s);
    if (!p.bot) return;
    clearTimeout(App.botTimer);
    // 방금 둔 수를 읽을 시간을 먼저 준다. 그래야 판이 왜 바뀌었는지 따라갈 수 있다.
    var hold = Math.max(0, (App.holdUntil || 0) - Date.now());
    App.botTimer = setTimeout(botStep, hold + (s.phase === 'play' ? 550 : 380));
  }

  function botStep() {
    var s = App.state;
    if (!s || s.phase === 'over') return;
    var p = R.current(s);
    if (!p.bot) return;
    var v = R.viewFor(s, p.id), r = null;

    if (s.phase === 'discard') r = R.discard(s, p.id, AI.chooseDiscard(v));
    else if (s.phase === 'noble') r = R.pickNoble(s, p.id, AI.chooseNoble(v));
    else {
      var a = AI.act(v, App.skill);
      if (a) r = R[a.action].apply(null, [s, p.id].concat(a.args));
    }
    if (!r || !r.ok) r = botFallback(s, p, v);
    if (!r || !r.ok) { toast('봇이 막혔습니다.'); return; }
    pushViews();
  }

  // 봇 판단이 규칙에 걸렸을 때를 대비한 안전망 — 아무 합법 수나 둔다
  function botFallback(s, p, v) {
    var r;
    if (s.phase === 'discard') {
      var list = [], over = R.tokenCount(p) - R.MAX_TOKENS;
      R.ALL.forEach(function (c) { for (var i = 0; i < p.gems[c] && list.length < over; i++) list.push(c); });
      return R.discard(s, p.id, list);
    }
    if (s.phase === 'noble') return R.pickNoble(s, p.id, v.nobleChoices[0]);

    for (var t = 1; t <= 3; t++) {
      for (var i = 0; i < s.board[t].length; i++) {
        var card = s.board[t][i];
        if (card && R.payFor(p, card)) { r = R.buy(s, p.id, card.id); if (r.ok) return r; }
      }
    }
    var avail = COLORS.filter(function (c) { return s.bank[c] > 0; });
    if (avail.length) { r = R.takeGems(s, p.id, avail.slice(0, 3)); if (r.ok) return r; }
    for (var t2 = 1; t2 <= 3; t2++) {
      for (var j = 0; j < s.board[t2].length; j++) {
        if (s.board[t2][j]) { r = R.reserve(s, p.id, s.board[t2][j].id); if (r.ok) return r; }
      }
    }
    return R.pass(s, p.id);
  }

  function act(action, args) {
    if (App.mode === 'client') { App.net.toHost({ t: 'act', action: action, args: args }); return; }
    doAction(App.me, action, args);
  }

  function doAction(pid, action, args) {
    var s = App.state, allowed = ['takeGems', 'buy', 'reserve', 'reserveTop', 'discard', 'pickNoble', 'pass'];
    if (!s || allowed.indexOf(action) < 0) return;
    var r = R[action].apply(null, [s, pid].concat(args || []));
    if (!r.ok) {
      if (pid === App.me) toast(r.error);
      else if (App.net) App.net.toPlayer(pid, { t: 'err', msg: r.error });
      return;
    }
    clearSel();
    pushViews();
  }

  /* ---------------- 조각 ---------------- */
  function meOf(v) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === v.me) return v.players[i];
    return null;
  }
  function isMyTurn(v) {
    return v.phase !== 'over' && v.players[v.turn] && v.players[v.turn].id === v.me;
  }
  // 이미 감당되는 비용은 흐리게 — 남은 것만 눈에 걸리게 한다
  function chip(color, count, paid) {
    var c = el('span', 'chip gem-' + color, String(count));
    if (paid) c.classList.add('paid');
    return c;
  }
  function shortOf(p, card) {
    var out = {};
    COLORS.forEach(function (c) {
      out[c] = Math.max(0, (card.cost[c] || 0) - (p.bonus[c] || 0) - (p.gems[c] || 0));
    });
    return out;
  }

  function cardEl(card, opts) {
    opts = opts || {};
    var v = App.view, p = meOf(v);
    var d = el('div', 'card gem-' + card.gem + ' t' + card.tier + (opts.mini ? ' mini' : ''));

    d.appendChild(icon('i-art' + card.tier, 'art'));

    var band = el('div', 'band');
    band.appendChild(el('span', 'pts', card.pts ? String(card.pts) : ''));
    band.appendChild(icon('i-gem', 'gemicon g-' + card.gem));
    d.appendChild(band);

    var costs = el('div', 'costs'), miss = shortOf(p, card);
    COLORS.forEach(function (c) {
      if (card.cost[c]) costs.appendChild(chip(c, card.cost[c], miss[c] === 0));
    });
    d.appendChild(costs);

    if (p && R.payFor(p, card)) d.classList.add('buyable');
    if (tipActive() && App.tip.card === card.id) d.classList.add('tip');
    if (App.selCard === card.id) d.classList.add('sel');
    d.onclick = function () {
      if (!isMyTurn(v) || v.phase !== 'play') return;
      App.selCard = (App.selCard === card.id) ? null : card.id;
      App.selDeck = null; App.gems = [];
      render();
    };
    return d;
  }


  /* ---------------- 도우미 ----------------
     봇이 쓰는 판단을 그대로 돌려서, 지금 무엇을 누르면 되는지 한 줄로 옮긴다.
     초보자가 화면에서 길을 잃지 않게 하는 것이 목적이라 이유도 한마디 붙인다. */
  function gemNames(list) {
    return list.map(function (c) { return NAME[c]; }).join(' · ');
  }
  // 같은 색이 겹치면 '사파이어 · 사파이어' 대신 '사파이어 2개' 로 묶는다
  function gemTally(list) {
    var seen = [], count = {};
    list.forEach(function (c) {
      if (!count[c]) { count[c] = 0; seen.push(c); }
      count[c]++;
    });
    return seen.map(function (c) { return NAME[c] + (count[c] > 1 ? ' ' + count[c] + '개' : ''); }).join(' · ');
  }
  // 받침에 따라 조사를 고른다 ('에메랄드을' 이 되지 않게)
  function josa(word, withBatchim, without) {
    var last = word.charCodeAt(word.length - 1) - 0xAC00;
    var has = last >= 0 && last <= 11171 && (last % 28) !== 0;
    return has ? withBatchim : without;
  }

  function tipFor(v) {
    if (!App.coach || !v || v.phase === 'over' || !isMyTurn(v)) return null;
    var p = meOf(v);
    if (!p) return null;

    if (v.phase === 'discard') {
      var rec = [];
      try { rec = AI.chooseDiscard(v) || []; } catch (e) {}
      if (!rec.length) return null;
      return {
        text: '<b>' + gemTally(rec) + '</b>' + josa(gemTally(rec), '을', '를') +
              ' 버리는 게 좋아 보입니다. 지금 노리는 카드에 안 쓰는 색입니다.',
        drop: rec
      };
    }
    if (v.phase === 'noble') return { noble: true };

    var a = null;
    try { a = AI.act(v, 1); } catch (e) { return null; }
    if (!a) return null;

    var w = AI.colorWeights(v, p);
    var goal = AI.bestTarget(v, p, w);
    var goalName = goal ? R.cardLabel(goal.card) : null;

    if (a.action === 'buy') {
      var f = findCard(v, a.args[0]);
      if (!f) return null;
      var why = f.card.pts
        ? '<b>' + f.card.pts + '점</b>이 바로 들어옵니다.'
        : NAME[f.card.gem] + ' 카드가 늘면 앞으로 사는 카드가 계속 싸집니다.';
      return {
        text: '<b>' + R.cardLabel(f.card) + '</b> 카드를 지금 살 수 있습니다. 카드를 누르고 <b>[사기]</b>. ' + why,
        card: f.card.id
      };
    }
    if (a.action === 'takeGems') {
      var list = a.args[0], t;
      if (list.length === 2 && list[0] === list[1]) {
        t = '<b>' + NAME[list[0]] + '</b> 더미를 <b>두 번</b> 눌러 2개 가져오세요. ' +
            '같은 색 2개는 그 보석이 4개 이상 남아 있을 때만 됩니다.';
      } else {
        t = '<b>' + gemNames(list) + '</b>' + josa(NAME[list[list.length - 1]], '을', '를') +
            ' 집어 두면 좋습니다. 아래에서 그 보석을 누르고 <b>[가져오기]</b>.';
      }
      if (goalName && goal.dist > 0) t += ' <b>' + goalName + '</b> 카드에 가까워집니다.';
      return { text: t, gems: list.slice() };
    }
    if (a.action === 'reserve') {
      var f2 = findCard(v, a.args[0]);
      return {
        text: '지금은 <b>킵</b>이 낫습니다. 점선 카드를 누르고 <b>[킵하기]</b> — 아무 색으로나 쓰는 <b>황금 1개</b>를 같이 받습니다.',
        card: f2 ? f2.card.id : null
      };
    }
    if (a.action === 'reserveTop') {
      return {
        text: '집을 보석이 없습니다. 왼쪽 <b>' + a.args[0] + '단계 더미</b>를 눌러 안 보고 한 장 킵하면 황금 1개를 받습니다.',
        deck: a.args[0]
      };
    }
    if (a.action === 'pass') return { text: '할 수 있는 행동이 없습니다. <b>[넘기기]</b>를 누르세요.' };
    return null;
  }

  // 뭔가 고른 상태에서는 점선을 지운다 — 지금 하려는 일에 집중하게
  function tipActive() {
    return !!App.tip && !App.selCard && !App.selDeck && !App.gems.length && !App.drop.length;
  }

  /* ---------------- 판 그리기 ---------------- */
  function renderNobles(v) {
    var box = $('nobles'); box.innerHTML = '';
    v.nobles.forEach(function (nb) {
      var d = el('div', 'noble');
      d.appendChild(icon('i-bust', 'bust'));
      d.appendChild(el('div', 'np', nb.pts + '점'));
      d.appendChild(el('div', 'medal', nb.icon));
      d.appendChild(el('div', 'nm', nb.name));
      var need = el('div', 'need');
      COLORS.forEach(function (c) { if (nb.need[c]) need.appendChild(chip(c, nb.need[c])); });
      d.appendChild(need);
      if (v.phase === 'noble' && isMyTurn(v) && v.nobleChoices.indexOf(nb.id) >= 0) {
        d.classList.add('pick');
        if (App.tip && App.tip.noble) d.classList.add('tip');
        d.onclick = function () { act('pickNoble', [nb.id]); };
      }
      box.appendChild(d);
    });
  }

  function renderRows(v) {
    var box = $('rows'); box.innerHTML = '';
    var p = meOf(v);
    [3, 2, 1].forEach(function (t) {
      var row = el('div', 'tier');
      var deck = el('div', 'deck t' + t);
      deck.appendChild(icon('i-back', 'deckart'));
      deck.appendChild(el('div', 'lv', t + '단계'));
      deck.appendChild(el('div', 'dcount', v.deckCount[t] + '장'));
      var canDeck = isMyTurn(v) && v.phase === 'play' && v.deckCount[t] > 0 &&
                    p.reserved.length < R.MAX_RESERVED;
      if (!canDeck) deck.classList.add('dead');
      if (tipActive() && App.tip.deck === t) deck.classList.add('tip');
      if (App.selDeck === t) deck.classList.add('sel');
      deck.onclick = function () {
        if (!canDeck) {
          // 눌렀는데 아무 일도 안 일어나면 고장으로 보인다
          if (!isMyTurn(v) || v.phase !== 'play') return;
          if (!v.deckCount[t]) toast(t + '단계 더미가 비었습니다.');
          else if (p.reserved.length >= R.MAX_RESERVED) toast('킵은 3장까지입니다 — 먼저 킵한 카드를 사야 자리가 납니다.');
          return;
        }
        App.selDeck = (App.selDeck === t) ? null : t;
        App.selCard = null; App.gems = [];
        render();
      };
      row.appendChild(deck);

      v.board[t].forEach(function (card) {
        row.appendChild(card ? cardEl(card) : el('div', 'card empty'));
      });
      box.appendChild(row);
    });
  }

  function renderBank(v) {
    var box = $('bank'); box.innerHTML = '';
    R.ALL.forEach(function (c) {
      var pile = el('div', 'pile');
      var picked = App.gems.filter(function (x) { return x === c; }).length;
      var tok = el('div', 'tok gem-' + c);
      tok.appendChild(icon('i-gem', 'gemicon g-' + c));
      tok.appendChild(el('span', 'num', String(v.bank[c])));
      pile.appendChild(tok);
      pile.appendChild(el('div', 'cnt', picked ? '+' + picked : SHORT[c]));
      if (picked) pile.classList.add('on');
      if (tipActive() && App.tip.gems && App.tip.gems.indexOf(c) >= 0) pile.classList.add('tip');
      var usable = isMyTurn(v) && v.phase === 'play' && c !== GOLD && v.bank[c] > 0;
      if (!v.bank[c]) pile.classList.add('dead');          // 바닥난 것만 흐리게
      if (usable) pile.classList.add('live');
      // 눌렀는데 아무 일도 안 일어나면 고장으로 보인다. 왜 안 되는지 말해 준다.
      pile.onclick = function () {
        if (usable) { toggleGem(c, v); return; }
        if (!isMyTurn(v) || v.phase !== 'play') return;
        if (c === GOLD) toast('황금은 직접 가져올 수 없습니다 — 카드를 킵하면 1개 따라옵니다.');
        else if (!v.bank[c]) toast('그 보석은 다 떨어졌습니다.');
      };
      box.appendChild(pile);
    });
  }

  // 서로 다른 3개 / 같은 색 2개를 손으로 고르는 규칙을 그대로 따라간다
  function toggleGem(c, v) {
    var sel = App.gems.slice();
    var same = sel.length === 2 && sel[0] === sel[1];
    var have = sel.filter(function (x) { return x === c; }).length;

    if (same) sel = (sel[0] === c) ? [] : [c];
    else if (have) {
      if (sel.length === 1 && v.bank[c] >= 4) sel = [c, c];       // 한 색만 골라둔 상태에서 다시 누르면 2개
      else {
        // 두 개를 노리고 다시 누른 것인데 조건이 안 되는 경우 — 말없이 풀리면 고장으로 보인다
        if (sel.length === 1) toast('같은 색 2개는 그 보석이 4개 이상 남아 있을 때만 됩니다 (지금 ' + v.bank[c] + '개).');
        sel = sel.filter(function (x) { return x !== c; });
      }
    } else if (sel.length < 3) sel.push(c);
    else toast('한 번에 3개까지입니다.');

    App.gems = sel; App.selCard = null; App.selDeck = null;
    render();
  }

  function stacksFor(v, p, pickable) {
    var box = el('div', 'stacks');
    var need = pickable ? R.tokenCount(p) - R.MAX_TOKENS : 0;

    R.ALL.forEach(function (c) {
      var st = el('div', 'stack');
      var picked = App.drop.filter(function (x) { return x === c; }).length;

      st.appendChild(el('div', 'bn gem-' + c, c === GOLD ? '·' : String(p.bonus[c] || 0)));
      st.appendChild(el('div', 'gm' + (p.gems[c] ? '' : ' zero') + (picked ? ' on' : ''),
                        '칩 ' + (p.gems[c] - (pickable ? picked : 0))));
      if (picked) {
        st.classList.add('picked');
        st.appendChild(el('div', 'minus', '−' + picked));
      }

      if (pickable) {
        st.classList.add('pickable');
        if (tipActive() && App.tip.drop && App.tip.drop.indexOf(c) >= 0) st.classList.add('tip');
        // 누를 때마다 하나씩 더 고른다. 다 골랐는데 또 누르면 그 색을 하나 되돌린다.
        st.onclick = function () {
          var cur = App.drop.filter(function (x) { return x === c; }).length;
          if (App.drop.length < need && cur < p.gems[c]) App.drop.push(c);
          else if (cur > 0) App.drop.splice(App.drop.indexOf(c), 1);
          render();
        };
      }
      box.appendChild(st);
    });
    return box;
  }

  function renderMine(v) {
    var box = $('mine'); box.innerHTML = '';
    var p = meOf(v);
    if (!p) return;
    var card = el('div', 'me-card' + (isMyTurn(v) ? ' turn' : ''));

    var line = el('div', 'who-line');
    line.appendChild(el('span', null, p.name));
    line.appendChild(el('span', 'sub', '나'));
    if (p.nobles.length) line.appendChild(el('span', 'sub', p.nobles.map(function (n) { return n.icon; }).join('')));
    line.appendChild(el('span', 'pt', p.pts + '점'));
    card.appendChild(line);

    card.appendChild(stacksFor(v, p, v.phase === 'discard' && isMyTurn(v)));

    var kept = el('div', 'kept');
    kept.appendChild(el('span', 'lbl', '킵 ' + p.reserved.length + '/3'));
    p.reserved.forEach(function (r) {
      kept.appendChild(cardEl(r.card, { mini: true }));
    });
    card.appendChild(kept);
    box.appendChild(card);
  }

  function renderOthers(v) {
    var box = $('others'); box.innerHTML = '';
    var n = v.players.length;
    for (var k = 1; k < n; k++) {
      var idx = (v.players.map(function (x) { return x.id; }).indexOf(v.me) + k) % n;
      var p = v.players[idx];
      var d = el('div', 'opp' + (v.turn === idx ? ' turn' : ''));
      var l1 = el('div', 'line1');
      l1.appendChild(el('span', null, p.name + (p.bot ? ' ·봇' : '') + (p.out ? ' (나감)' : '')));
      if (p.nobles.length) l1.appendChild(el('span', 'kp', p.nobles.map(function (x) { return x.icon; }).join('')));
      l1.appendChild(el('span', 'pt', p.pts + '점'));
      d.appendChild(l1);

      var l2 = el('div', 'line2');
      var shown = R.ALL.filter(function (c) {
        return c === GOLD ? p.gems[c] > 0 : (p.bonus[c] || p.gems[c]);
      });
      if (shown.length) l2.appendChild(el('span', 'kp', '카드·칩'));
      shown.forEach(function (c) {
        var pair = el('div', 'pair');
        var sq = el('span', 'sq gem-' + c);
        pair.appendChild(sq);
        pair.appendChild(el('span', null, (c === GOLD ? '' : (p.bonus[c] || 0) + '·') + p.gems[c]));
        l2.appendChild(pair);
      });
      l2.appendChild(el('span', 'kp', '킵 ' + p.reserved.length));
      d.appendChild(l2);
      box.appendChild(d);
    }
  }

  function findCard(v, id) {
    for (var t = 1; t <= 3; t++) {
      for (var i = 0; i < v.board[t].length; i++) {
        if (v.board[t][i] && v.board[t][i].id === id) return { card: v.board[t][i], where: 'board' };
      }
    }
    var p = meOf(v);
    for (var j = 0; j < p.reserved.length; j++) {
      if (p.reserved[j].card && p.reserved[j].card.id === id) return { card: p.reserved[j].card, where: 'kept' };
    }
    return null;
  }

  function renderPanel(v) {
    var box = $('panel'); box.innerHTML = '';
    var inner = el('div', 'inner');
    box.appendChild(inner);
    var p = meOf(v);

    if (App.tip && App.tip.text) {
      var co = el('div', 'coach');
      co.appendChild(el('span', 'mark', '💡'));
      var ct = el('span'); ct.innerHTML = App.tip.text;
      co.appendChild(ct);
      inner.appendChild(co);
    }

    function msg(html) {
      var m = el('div', 'msg'); m.innerHTML = html; inner.appendChild(m);
    }
    function btn(label, fn, primary, off) {
      var b = el('button', primary ? 'primary' : null, label);
      b.style.width = 'auto';
      b.disabled = !!off;
      b.onclick = fn;
      inner.appendChild(b);
      return b;
    }

    if (v.phase === 'over') { msg('판이 끝났습니다.'); return; }

    if (!isMyTurn(v)) {
      var cur = v.players[v.turn];
      msg('<b>' + esc(cur.name) + '</b>의 차례입니다.');
      return;
    }

    if (v.phase === 'discard') {
      var over = R.tokenCount(p) - R.MAX_TOKENS;
      msg('칩은 <b>10개까지</b>입니다. 지금 ' + R.tokenCount(p) + '개라, 아래 <b>내 칩</b>에서 <b>' +
          over + '개</b>를 눌러 버려야 합니다. 같은 색을 두 번 눌러도 됩니다.');
      var picks = el('div', 'picks');
      App.drop.forEach(function (c) { picks.appendChild(chip(c, 1)); });
      inner.appendChild(picks);
      btn('버리기 (' + App.drop.length + '/' + over + ')', function () {
        act('discard', [App.drop.slice()]);
      }, true, App.drop.length !== over);
      if (App.drop.length) btn('다시 고르기', function () { App.drop = []; render(); });
      else if (App.tip && App.tip.drop && App.tip.drop.length === over) {
        btn('추천대로 버리기', function () { act('discard', [App.tip.drop.slice()]); });
      }
      return;
    }

    if (v.phase === 'noble') {
      msg('조건을 채운 귀족이 둘 이상입니다. <b>위에서 한 명</b>을 고르세요.');
      return;
    }

    if (App.gems.length) {
      var picks2 = el('div', 'picks');
      App.gems.forEach(function (c) { picks2.appendChild(chip(c, 1)); });
      inner.appendChild(picks2);
      var same = App.gems.length === 2 && App.gems[0] === App.gems[1];
      var avail = COLORS.filter(function (c) { return v.bank[c] > 0; }).length;
      var okTake = same || App.gems.length === 3 || App.gems.length >= avail;
      // 버튼만 꺼 두면 왜 안 눌리는지 알 수 없다. 무엇이 모자란지 함께 말해 준다.
      msg(same ? '같은 색 2개'
               : '서로 다른 ' + App.gems.length + '가지' +
                 (okTake ? '' : ' — <b>3가지</b>를 채우거나, 한 색을 두 번 눌러 <b>같은 색 2개</b>로 가져오세요'));
      btn('가져오기', function () { act('takeGems', [App.gems.slice()]); }, true, !okTake);
      btn('취소', function () { App.gems = []; render(); });
      return;
    }

    if (App.selDeck) {
      msg('<b>' + App.selDeck + '단계</b> 더미에서 안 보고 한 장 킵합니다. 황금이 남아 있으면 1개 같이 받습니다.');
      btn('뒷면으로 킵', function () { act('reserveTop', [App.selDeck]); }, true);
      btn('취소', function () { App.selDeck = null; render(); });
      return;
    }

    if (App.selCard) {
      var f = findCard(v, App.selCard);
      if (f) {
        var bill = R.payFor(p, f.card);
        var miss = shortOf(p, f.card), missTotal = 0;
        COLORS.forEach(function (c) { missTotal += miss[c]; });
        msg(R.cardLabel(f.card) + (bill ? (bill.gold ? ' · 황금 ' + bill.gold + '개 사용' : ' · 바로 살 수 있음')
                                        : ' · 보석 ' + Math.max(0, missTotal - p.gems[GOLD]) + '개 모자람'));
        btn('사기', function () { act('buy', [f.card.id]); }, true, !bill);
        if (f.where === 'board') {
          var full = p.reserved.length >= R.MAX_RESERVED;
          // 버튼만 꺼 두면 왜 안 눌리는지 알 수 없다
          if (full) msg('킵은 <b>3장까지</b>입니다 — 먼저 킵한 카드를 사야 자리가 납니다.');
          btn('킵하기', function () { act('reserve', [f.card.id]); }, false, full);
        }
        btn('닫기', function () { App.selCard = null; render(); });
        return;
      }
    }

    if (v.canPass) {
      msg('할 수 있는 행동이 없습니다.');
      btn('넘기기', function () { act('pass', []); }, true);
      return;
    }
    if (!App.tip || !App.tip.text) msg('보석을 고르거나 카드를 누르세요.');
  }

  function renderLog(v) {
    var box = $('log'); box.innerHTML = '';
    v.log.slice(-8).reverse().forEach(function (l) {
      var d = el('div');
      if (l.name) d.appendChild(el('b', null, l.name + ' '));
      d.appendChild(document.createTextNode(l.text));
      box.appendChild(d);
    });
  }

  function render() {
    var v = App.view;
    if (!v) return;
    var cur = v.players[v.turn];
    $('turnInfo').textContent = v.phase === 'over' ? '판 종료'
      : (isMyTurn(v) ? '내 차례' : cur.name + '의 차례');
    var info = $('roundInfo');
    info.textContent = v.endRound ? '마지막 라운드' : (v.round + '라운드');
    info.classList.toggle('last', !!v.endRound);

    renderNobles(v);
    renderRows(v);
    renderBank(v);
    renderPanel(v);
    renderMine(v);
    renderOthers(v);
    renderLog(v);
  }

  /* ---------------- 결과 ---------------- */
  function rankView(v) {
    var order = v.players.map(function (p, i) { return { p: p, seat: i }; })
      .filter(function (x) { return !x.p.out; });
    if (!order.length) order = v.players.map(function (p, i) { return { p: p, seat: i }; });
    order.sort(function (a, b) {
      if (b.p.pts !== a.p.pts) return b.p.pts - a.p.pts;
      if (a.p.cards.length !== b.p.cards.length) return a.p.cards.length - b.p.cards.length;
      if (b.p.nobles.length !== a.p.nobles.length) return b.p.nobles.length - a.p.nobles.length;
      var ta = R.tokenCount(a.p), tb = R.tokenCount(b.p);
      if (tb !== ta) return tb - ta;
      return b.seat - a.seat;
    });
    return order.map(function (x) { return x.p; });
  }

  function showOver(v) {
    var list = rankView(v);
    var win = list[0];
    $('overTitle').textContent = win.id === v.me ? '이겼습니다' : win.name + ' 승리';
    var box = $('overTable'); box.innerHTML = '';
    list.forEach(function (p, i) {
      var row = el('div', 'rowr' + (i === 0 ? ' win' : ''));
      row.appendChild(el('span', null, (i + 1) + '. ' + p.name));
      row.appendChild(el('span', 'det', '카드 ' + p.cards.length + ' · 귀족 ' + p.nobles.length));
      row.appendChild(el('span', 'pt', p.pts + '점'));
      box.appendChild(row);
    });
    $('over').classList.remove('hidden');
  }

  /* ---------------- 대기실 ---------------- */
  function renderSeats(list, hostView) {
    syncChatVisible(list);          // 대기실에서도 채팅이 되어야 한다
    var box = $('seats'); box.innerHTML = '';
    list.forEach(function (s, i) {
      var row = el('div', 'seat');
      row.appendChild(el('span', 'who', s.name));
      if (i === 0) row.appendChild(el('span', 'mark', '방장'));
      if (s.bot) row.appendChild(el('span', 'mark', '봇'));
      box.appendChild(row);
    });
    for (var k = list.length; k < 4; k++) {
      var e2 = el('div', 'seat'); e2.style.opacity = '.4';
      e2.appendChild(el('span', 'who', '빈 자리'));
      box.appendChild(e2);
    }
    $('hostControls').classList.toggle('hidden', !hostView);
    $('btnStart').disabled = list.length < 2;
    $('btnAddBot').disabled = list.length >= 4;
  }

  function broadcastLobby() {
    if (!App.net) return;
    var list = App.seats.map(function (s) { return { name: s.name, bot: s.bot }; });
    App.net.broadcast(function () { return { t: 'lobby', seats: list }; });
  }

  /* ---------------- 방장 / 참가자 ---------------- */
  function beHost() {
    App.mode = 'host'; App.me = 'host';
    App.seats = [{ id: 'host', name: myName(), bot: false }];
    App.net = new Net();
    App.net.on.status = toast;
    App.net.on.error = toast;
    App.net.on.open = function (code) {
      $('roomCode').textContent = code;
      $('lobbyHint').textContent = '친구에게 이 코드를 알려주세요.';
      show('lobby'); renderSeats(App.seats, true);
    };
    App.net.on.join = function (pid, name) {
      if (App.started || App.seats.length >= 4) {
        App.net.toPlayer(pid, { t: 'err', msg: App.started ? '이미 시작된 방입니다.' : '자리가 찼습니다.' });
        return;
      }
      var base = name, n = 2;
      while (App.seats.some(function (s) { return s.name === name; })) name = base + n++;
      App.seats.push({ id: pid, name: name, bot: false });
      renderSeats(App.seats, true); broadcastLobby(); toast(name + ' 참가');
    };
    App.net.on.leave = function (pid) {
      var seat = seatOf(pid); if (!seat) return;
      App.seats = App.seats.filter(function (s) { return s.id !== pid; });
      if (App.started && App.state) { R.dropPlayer(App.state, pid); pushViews(); }
      else { renderSeats(App.seats, true); broadcastLobby(); }
      toast(seat.name + ' 나감');
    };
    App.net.on.data = function (pid, msg) {
      if (msg.t === 'act' && App.started) doAction(pid, msg.action, msg.args || []);
      else if (msg.t === 'chat') relayChat(pid, msg.text);
    };
    App.net.host();
  }

  function beClient(code) {
    App.mode = 'client';
    App.net = new Net();
    App.net.on.status = toast;
    App.net.on.error = function (m) { toast(m); show('home'); App.net.close(); };
    App.net.on.open = function (c) {
      // 방장은 나를 내 연결 id 로 부른다. 판이 시작되기 전에도 알고 있어야
      // 대기실에서 내가 친 채팅을 내 것으로 알아본다(안 그러면 남의 말처럼 보이고 알림까지 센다).
      if (App.net.peer && App.net.peer.id) App.me = App.net.peer.id;
      $('roomCode').textContent = c;
      $('lobbyHint').textContent = '방장이 시작하기를 기다리는 중…';
      show('lobby'); renderSeats([], false);
    };
    App.net.on.data = function (_, msg) {
      if (msg.t === 'lobby') {
        // 참가자는 자리 목록을 여기서만 받는다. 기억해 두지 않으면
        // 판이 시작된 뒤 사람 수를 셀 수 없어 채팅이 사라져 버린다.
        App.seats = msg.seats || [];
        renderSeats(App.seats, false);
      }
      else if (msg.t === 'view') {
        App.me = msg.view.me;
        if ($('game').classList.contains('hidden')) show('game');
        applyView(msg.view);
      } else if (msg.t === 'chat') addChat(msg.name, msg.text, msg.from === App.me);
      else if (msg.t === 'err') toast(msg.msg);
    };
    App.net.join(code, myName());
  }


  /* ---------------- 첫 안내 ---------------- */
  var TOUR_LAST = 5;
  function tourShow(step) {
    App.tourStep = Math.max(0, Math.min(TOUR_LAST, step));
    var steps = document.querySelectorAll('#tour .tstep');
    for (var i = 0; i < steps.length; i++) {
      steps[i].classList.toggle('hidden', i !== App.tourStep);
    }
    var dots = $('tourDots'); dots.innerHTML = '';
    for (var j = 0; j <= TOUR_LAST; j++) {
      dots.appendChild(el('i', j === App.tourStep ? 'on' : null));
    }
    $('btnTourPrev').disabled = App.tourStep === 0;
    $('btnTourNext').textContent = App.tourStep === TOUR_LAST ? '시작하기' : '다음';
    $('tour').classList.remove('hidden');
  }
  function tourClose() {
    var onTitle = !$('home').classList.contains('hidden');
    $('tour').classList.add('hidden');
    try { localStorage.setItem('splendor.seen', '1'); } catch (e) {}
    // 마지막 장의 버튼이 '시작하기'다. 타이틀에서 봤다면 그대로 고르는 화면으로 넘긴다.
    if (onTitle && App.tourStep === TOUR_LAST) show('setup');
  }

  /* ---------------- 테마 ---------------- */
  function setTheme(t, remember) {
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f2ecdf' : '#151318');
    var boxes = document.querySelectorAll('.theme-in');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = (t === 'light');
      var lbl = boxes[i].parentNode.querySelector('.lbl');
      if (lbl) lbl.textContent = (t === 'light') ? '☀' : '☾';
    }
    if (remember) { try { localStorage.setItem('splendor.theme', t); } catch (e) {} }
  }

  /* ---------------- 버튼 ---------------- */
  $('btnSolo').onclick = function () {
    var count = parseInt($('soloCount').value, 10);
    App.skill = parseFloat($('soloSkill').value);
    App.mode = 'solo'; App.me = 'me';
    App.seats = [{ id: 'me', name: myName(), bot: false }];
    var names = ['봇 하나', '봇 둘', '봇 셋'];
    for (var i = 0; i < count - 1; i++) App.seats.push({ id: 'bot' + i, name: names[i], bot: true });
    startEngine();
  };
  $('btnHost').onclick = function () {
    if (!window.Peer) { toast('통신 모듈을 불러오지 못했습니다.'); return; }
    beHost();
  };
  $('btnJoin').onclick = function () {
    var code = $('joinCode').value.trim().toUpperCase();
    if (code.length !== 4) { toast('방 코드 4자리를 입력해 주세요.'); return; }
    if (!window.Peer) { toast('통신 모듈을 불러오지 못했습니다.'); return; }
    beClient(code);
  };
  $('joinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnJoin').click(); });
  $('btnAddBot').onclick = function () {
    if (App.seats.length >= 4) return;
    var names = ['봇 하나', '봇 둘', '봇 셋'];
    var used = App.seats.filter(function (s) { return s.bot; }).length;
    App.seats.push({ id: 'bot' + used + '-' + Date.now(), name: names[used] || ('봇 ' + (used + 1)), bot: true });
    renderSeats(App.seats, true); broadcastLobby();
  };
  $('btnStart').onclick = function () { startEngine(); };
  $('btnLeave').onclick = function () { if (App.net) App.net.close(); location.reload(); };
  $('btnAgain').onclick = function () { if (App.net) App.net.close(); location.reload(); };
  $('btnBegin').onclick = function () { show('setup'); };   // 자동 포커스는 안 준다 — 모바일에서 자판이 튀어나온다
  $('btnBack').onclick = function () { show('home'); };
  $('btnRules').onclick = function () { tourShow(0); };
  $('btnHelp').onclick = function () { $('rules').classList.remove('hidden'); };
  $('btnCloseRules').onclick = function () { $('rules').classList.add('hidden'); };
  $('btnTourAgain').onclick = function () { $('rules').classList.add('hidden'); tourShow(0); };
  $('btnTourNext').onclick = function () {
    if (App.tourStep === TOUR_LAST) tourClose(); else tourShow(App.tourStep + 1);
  };
  $('btnTourPrev').onclick = function () { tourShow(App.tourStep - 1); };
  $('btnTourSkip').onclick = tourClose;

  // 테마 — <head> 에서 이미 정해 놓은 값을 화면 스위치에 맞춰 둔다
  (function () {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark', false);
    var boxes = document.querySelectorAll('.theme-in');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].onchange = function () { setTheme(this.checked ? 'light' : 'dark', true); };
    }
  })();

  // 도우미 — 처음 온 사람에게는 켜진 채로 시작하고, 한 번 끄면 그 선택을 기억한다
  (function () {
    var saved = null;
    try { saved = localStorage.getItem('splendor.coach'); } catch (e) {}
    App.coach = (saved === null) ? true : saved === '1';
    $('coach').checked = App.coach;
  })();
  $('coach').onchange = function () {
    App.coach = $('coach').checked;
    try { localStorage.setItem('splendor.coach', App.coach ? '1' : '0'); } catch (e) {}
    if (App.view) { App.tip = tipFor(App.view); render(); }
  };

  // 처음 온 사람에게는 안내를 먼저 보여준다
  (function () {
    var seen = null;
    try { seen = localStorage.getItem('splendor.seen'); } catch (e) {}
    if (!seen) tourShow(0);
  })();
  $('name').value = localStorage.getItem('splendor.name') || '';
  $('name').addEventListener('change', function () { localStorage.setItem('splendor.name', myName()); });

  /* ---------------- 채팅 ----------------
     같은 방 사람끼리만 오간다. 판정과는 무관하고 어디에도 저장되지 않는다.
     방장이 받아서 모두에게 그대로 넘겨 준다. 봇만 있는 방에서는 아예 뜨지 않는다. */

  var chatUnread = 0, chatLast = {};      // 도배 방지는 사람마다 따로 센다
  function chatSeatName(pid) {
    for (var i = 0; i < App.seats.length; i++) if (App.seats[i].id === pid) return App.seats[i].name;
    return '?';
  }
  function relayChat(pid, text) {
    text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return;
    var now = Date.now();
    // 한 사람이 몰아치는 것만 막는다. 전체를 하나로 세면
    // 두 사람이 동시에 말할 때 한쪽 말이 소리 없이 사라진다.
    if (now - (chatLast[pid] || 0) < 350) return;
    chatLast[pid] = now;
    var out = { t: 'chat', from: pid, name: chatSeatName(pid), text: text };
    App.net.broadcast(function () { return out; });
    addChat(out.name, text, pid === App.me);
  }
  function chatSend(text) {
    if (App.mode === 'client') App.net.toHost({ t: 'chat', text: text });
    else relayChat(App.me, text);
  }
  function chatOpen(on) {
    $('chat').hidden = !on;
    if (!on) return;
    chatUnread = 0; $('chatN').hidden = true;
    $('chatText').focus();
    var log = $('chatLog'); log.scrollTop = log.scrollHeight;
  }
  function addChat(name, text, mine) {
    var log = $('chatLog');
    var d = el('p', 'chat-msg' + (mine ? ' mine' : ''));
    d.innerHTML = '<b>' + esc(name) + '</b> ' + esc(text);
    log.appendChild(d);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    if ($('chat').hidden && !mine) {
      chatUnread++;
      var n = $('chatN');
      n.textContent = chatUnread > 9 ? '9+' : String(chatUnread);
      n.hidden = false;
    }
  }
  /** 사람이 나 말고 또 있을 때만 채팅을 내놓는다 */
  function syncChatVisible(list) {
    var seats = list || App.seats || [];
    var humans = 0;
    seats.forEach(function (st) { if (!st.bot) humans++; });
    var on = App.mode !== 'solo' && humans > 1;
    $('chatBtn').hidden = !on;
    if (!on) $('chat').hidden = true;
    else $('chatWho').textContent = humans + '명';
  }
  $('chatBtn').onclick = function () { chatOpen($('chat').hidden); };
  $('chatX').onclick = function () { chatOpen(false); };
  $('chatForm').onsubmit = function (e) {
    e.preventDefault();
    var box = $('chatText'), text = box.value.trim();
    box.value = '';
    if (text) chatSend(text);
  };
  $('chatText').onkeydown = function (e) { if (e.key === 'Escape') chatOpen(false); };

  App.act = act; App.doAction = doAction; App.pushViews = pushViews; App.render = render;
  window.__sp = App;
})();
