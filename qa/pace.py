# -*- coding: utf-8 -*-
"""화면에 뜬 안내가 사람이 읽을 만큼 떠 있었는지 따져 본다.

읽는 속도 — 한글 짧은 문구는 눈에 들어오는 데 0.8초 + 글자당 0.07초로 잡는다.
(초당 14자 남짓. 게임 화면의 짧은 문장을 훑는 속도.)
처음 하는 사람은 이보다 느리므로, 이 기준을 넘겼다고 넉넉한 건 아니다.
"""
import json, re, sys

def need(text, floor):
    n = len(re.sub(r'\s', '', text or ''))
    return max(floor, 0.8 + n * 0.07)

FLOOR = {'move': 1.4}

# 내 차례 안내는 내가 누를 때까지 떠 있으므로 길이를 잴 의미가 없다.
# 봇이 내 자리를 대신 두는 계측판에서만 짧게 스쳐 지나간다.
WAITS_FOR_HUMAN = ()

def spans(ev, kind):
    out, open_ = [], None
    for e in ev:
        if e['k'] != kind:
            continue
        if e['on'] and open_ is None:
            open_ = e
        elif not e['on'] and open_ is not None:
            out.append((open_['t'], e['t'], open_['w'], open_.get('mine', 0)))
            open_ = None
    if open_:
        out.append((open_['t'], None, open_['w'], open_.get('mine', 0)))
    return out

def run(path):
    o = json.load(open(path, encoding='utf-8'))
    ev = o['ev']
    if not ev:
        print('기록이 비어 있음 — 판이 시작되지 않았다'); return 1
    total = ev[-1]['t'] / 1000.0
    print('=== %s %s인 — %.0f초짜리 한 판, 기록 %d개 (%s) ===' %
          (o['game'], o['n'], total, len(ev), o.get('why', '?')))
    for e in o['errs'][:6]:
        print('  ! 자바스크립트 오류:', e)

    problems = []
    for kind in ('move',):
        sp = [x for x in spans(ev, kind) if x[1]]
        if not sp:
            continue
        durs = [(b - a) / 1000.0 for a, b, w, mine in sp]
        durs_s = sorted(durs)
        print('%-9s %3d회 · 중앙값 %.1f초 · 가장 짧은 셋 %s'
              % (kind, len(sp), durs_s[len(durs_s) // 2],
                 ' '.join('%.1f' % d for d in durs_s[:3])))
        for a, b, w, mine in sp:
            d = (b - a) / 1000.0
            # 내가 고른 값은 내가 이미 아니까 읽을 시간이 필요 없다.
            # 다만 눈에 걸리기는 해야 하므로 최소 0.4초는 준다.
            if mine and kind in WAITS_FOR_HUMAN:
                continue                       # 사람을 기다리는 줄 — 계측 대상이 아니다
            req = 0.4 if mine else need(w, FLOOR[kind])
            if d + 0.05 < req:
                problems.append('%6.1f초 · %s "%s" — %.1f초만 떴음 (%.1f초 필요)'
                                % (a / 1000.0, kind, (w or '')[:34], d, req))

    # 차례가 넘어가는 간격
    turns = [e['t'] for e in ev if e['k'] == 'turn']
    gaps = sorted((turns[i + 1] - turns[i]) / 1000.0 for i in range(len(turns) - 1))
    if gaps:
        print('단계 전환 %3d번 · 중앙값 %.1f초 · 가장 짧은 셋 %s'
              % (len(turns), gaps[len(gaps) // 2], ' '.join('%.1f' % g for g in gaps[:3])))

    print()
    if not problems:
        print('  ✓ 사람이 못 읽고 지나갈 만한 안내는 없음')
    else:
        print('  ! 너무 빨리 지나간 것 %d개' % len(problems))
        for p in problems[:24]:
            print('   ·', p)
    print()
    return 1 if problems or o['errs'] else 0

if __name__ == '__main__':
    sys.exit(run(sys.argv[1]))
