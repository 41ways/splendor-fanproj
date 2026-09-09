/* 연출 속도 재기 — ?qa=pace 로 들어오면 봇끼리 한 판을 끝까지 두면서
   "방금 둔 수" 알림이 몇 초씩 떠 있었는지 기록한다.
   헤드리스 크롬의 가상 시간으로 돌리므로 실제 기다림 없이 설계된 속도가 그대로 나온다.
   평소에는 index.html 의 한 줄이 이 파일을 아예 부르지 않는다. */
(function () {
  var q = new URLSearchParams(location.search);
  if (q.get('qa') !== 'pace') return;

  var out = { game: '스플렌더', n: q.get('n') || '4', ev: [], errs: [], done: false };
  window.onerror = function (m, s, l) { out.errs.push(m + ' @' + l); };

  var pre = document.createElement('pre');
  pre.id = 'qaout'; pre.style.display = 'none';
  document.body.appendChild(pre);

  var T0 = performance.now();
  function at() { return Math.round(performance.now() - T0); }
  function span(k, w, on, mine) {
    out.ev.push({ t: at(), k: k, w: w, on: on ? 1 : 0, mine: mine ? 1 : 0 });
  }
  function finish(why) {
    if (out.done) return;
    out.done = true; out.why = why;
    pre.textContent = JSON.stringify(out);
    document.title = 'QA DONE';
  }

  function ready(fn) {
    if (window.__sp && window.Rules) fn(); else setTimeout(function () { ready(fn); }, 30);
  }

  ready(function () {
    try { localStorage.setItem('splendor.seen', '1'); } catch (e) {}
    document.getElementById('tour').classList.add('hidden');
    document.getElementById('btnBegin').click();
    document.getElementById('name').value = '민수';
    document.getElementById('soloCount').value = out.n;
    document.getElementById('btnSolo').click();

    var A = window.__sp;
    A.state.players.forEach(function (p) { p.bot = true; });   // 내 자리도 봇이 대신 둔다
    A.pushViews();

    var st = { move: '', turn: '' };
    var poll = setInterval(function () {
      var box = document.getElementById('move');
      var on = box && box.classList.contains('on');
      var txt = on ? (box.querySelector('.mv-who').textContent + ' ' +
                      box.querySelector('.mv-what').textContent).trim() : '';
      if (txt !== st.move) {
        var v0 = A.view;
        var lastPid = v0 && v0.log && v0.log.length ? v0.log[v0.log.length - 1].pid : null;
        var mine = !!(v0 && lastPid === v0.me);
        if (st.move) span('move', st.move, 0, st.moveMine);
        st.move = txt; st.moveMine = mine;
        if (txt) span('move', txt, 1, mine);
      }

      var v = A.view;
      if (!v) return;
      var tk = v.phase + '/' + v.round + '/' + v.turn;
      if (tk !== st.turn) { st.turn = tk; span('turn', tk, 1, 0); }
      if (v.phase === 'over') { clearInterval(poll); finish('판 종료'); }
    }, 20);

    setTimeout(function () { clearInterval(poll); finish('시간 초과'); }, 900000);
  });
})();
