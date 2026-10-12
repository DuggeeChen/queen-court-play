import { BOARD as globalBoard, CHALLENGES, DEFAULTS } from "./data.js?v=3";
export const copy = (x) => structuredClone(x);
// 6行5列采用按列蛇形：1右下、6右上、7相邻列顶部，30左上。
export const BOARD_LAYOUT = Array.from({ length: 6 }, (_, row) =>
  Array.from({ length: 5 }, (_, col) => {
    const fromRight = 4 - col;
    return fromRight * 6 + (fromRight % 2 === 0 ? 6 - row : row + 1);
  }),
);
const clamp = (n, max) => Math.min(max, Math.max(0, n));
export function createGame(
  config = DEFAULTS,
  seed = crypto.getRandomValues(new Uint32Array(1))[0],
) {
  const c = copy(config);
  if (!Array.isArray(c.players) || c.players.length < 1 || c.players.length > 6)
    throw Error("请选择1至6名参与者");
  if (
    c.players.some((p) => !p.name?.trim()) ||
    new Set(c.players.map((p) => p.name.trim())).size !== c.players.length
  )
    throw Error("请填写不同的参与者昵称");
  const game = {
    schemaVersion: 1,
    gameId: crypto.randomUUID(),
    revision: 0,
    config: c,
    seed: seed || 1,
    players: c.players.map((p, id) => ({
      ...p,
      id,
      pos: c.startBonus?.consented && c.startBonus.id === id ? 2 : 0,
      shield: 1,
      favor: 0,
      reroll: 0,
      compensation: false,
      medals: 0,
      title: "",
      temporary: null,
      turns: 0,
      rank: null,
    })),
    order: [],
    round: 1,
    turnIndex: 0,
    completed: [],
    phase: "setup",
    pending: {
      type: "initiative",
      ids: c.players.map((_, id) => id),
      values: {},
    },
    decks: { C: [], R: [], P: [] },
    discards: { C: [], R: [], P: [] },
    favorRemaining: 3,
    triggered: [],
    challengeCount: 0,
    rankCount: 0,
    log: c.startBonus?.consented
      ? [
          {
            text: `全员开局同意：${c.players[c.startBonus.id].name} 使用上局亚军奖励，起点+2`,
            time: new Date().toISOString(),
          },
        ]
      : [],
    history: [],
    redo: null,
    pausedFrom: null,
    rewardChoices: {},
    updatedAt: new Date().toISOString(),
  };
  if (c.orderMode === "seated") {
    game.order = c.players.map((_, id) => id);
    game.phase = "turn_start";
    game.pending = null;
    log(game, "按主持人设置的顺序开始");
  }
  return game;
}
function random(g) {
  let x = g.seed;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  g.seed = x >>> 0;
  return g.seed / 4294967296;
}
function die(g) {
  return 1 + Math.floor(random(g) * 6);
}
function log(g, t) {
  g.log.push({ text: t, time: new Date().toISOString() });
}
const active = (g) => g.players.filter((p) => p.rank === null);
export const current = (g) => g.players[g.order[g.turnIndex]];
function finish(g, ids, after) {
  const ps = ids
    .map((id) => g.players[id])
    .filter((p) => p.pos >= g.config.goal && p.rank === null);
  if (!ps.length) {
    after();
    return;
  }
  const groups = [...new Set(ps.map((p) => p.medals))]
    .sort((a, b) => b - a)
    .map((n) => ps.filter((p) => p.medals === n).map((p) => p.id));
  if (groups.some((x) => x.length > 1)) {
    g.pending = {
      type: "finishTie",
      groups,
      index: 0,
      values: {},
      ordered: [],
      after: copy(g.pending),
    };
    g.phase = "host_judgement";
    return;
  }
  for (const group of groups) rank(g, group[0]);
  after();
}
function rank(g, id) {
  const p = g.players[id];
  p.rank = ++g.rankCount;
  log(g, `${p.name} 加冕，第${p.rank}名`);
}
function move(g, changes) {
  const ids = [];
  for (const [id, delta] of changes) {
    const p = g.players[id];
    if (p.rank !== null) continue;
    p.pos = clamp(p.pos + delta, g.config.goal);
    ids.push(id);
    log(g, `${p.name} ${delta >= 0 ? "+" : ""}${delta}格 → ${p.pos}`);
  }
  return ids;
}
function endEvent(g) {
  g.pending = null;
  if (active(g).length === 0) {
    g.phase = "finished";
    log(g, "全部完赛，角色解除。请确认彼此感受。");
    return;
  }
  if (g.extraChallenge) {
    delete g.extraChallenge;
    g.phase = "turn_start";
    return;
  }
  const p = current(g);
  p.turns++;
  if (p.temporary && p.turns >= p.temporary.expires) p.temporary = null;
  g.completed.push(p.id);
  advance(g);
}
function advance(g) {
  const remain = active(g).filter((p) => !g.completed.includes(p.id));
  if (remain.length) {
    for (let n = 1; n <= g.order.length; n++) {
      const idx = (g.turnIndex + n) % g.order.length;
      if (remain.some((p) => p.id === g.order[idx])) {
        g.turnIndex = idx;
        break;
      }
    }
    g.phase = "turn_start";
    return;
  }
  if (
    [3, 6].includes(g.round) &&
    !g.triggered.includes(g.round) &&
    active(g).length >= 2
  ) {
    g.triggered.push(g.round);
    challenge(g, "round");
    return;
  }
  nextRound(g);
}
function nextRound(g) {
  g.round++;
  g.completed = [];
  g.turnIndex = g.order.findIndex((id) => g.players[id].rank === null);
  g.phase = active(g).length ? "turn_start" : "finished";
  g.pending = null;
}
function settleMove(g, changes) {
  const ids = move(g, changes);
  finish(g, ids, () => endEvent(g));
}
function task(g, title, text, card = null) {
  g.phase = "resolve_event";
  g.pending = {
    type: "task",
    title,
    text,
    card,
    swaps: 0,
    seconds:
      (card && g.config.cards.find((c) => c.id === card)?.seconds) ||
      g.config.seconds,
  };
}
function shield(g, id, amount) {
  g.phase = "resolve_event";
  g.pending = { type: "shield", id, amount };
  if (!g.players[id].shield) settleMove(g, [[id, -amount]]);
}
function draw(g, type, swaps = 0) {
  if (!g.decks[type].length) {
    g.decks[type] = g.config.cards
      .filter((c) => c.enabled && c.id[0] === type)
      .map((c) => c.id);
    for (let i = g.decks[type].length - 1; i > 0; i--) {
      let j = Math.floor(random(g) * (i + 1));
      [g.decks[type][i], g.decks[type][j]] = [
        g.decks[type][j],
        g.decks[type][i],
      ];
    }
    g.discards[type] = [];
  }
  const id = g.decks[type].pop();
  if (!id) {
    task(
      g,
      "空卡池",
      "所有该类卡片已禁用。主持可安排自定义角色任务，或无责跳过。",
    );
    return;
  }
  g.discards[type].push(id);
  const c = g.config.cards.find((c) => c.id === id);
  task(g, c.name, c.text, id);
  g.pending.swaps = swaps;
  log(g, `抽卡 ${id} · ${c.name}`);
}
function pk(g, ids = null) {
  const p = current(g);
  const options = (ids || active(g).map((p) => p.id)).filter(
    (id) => id !== p.id,
  );
  if (!options.length) {
    log(g, "无未完赛对手，PK结束");
    endEvent(g);
    return;
  }
  g.phase = "host_judgement";
  g.pending = {
    type: options.length > 1 ? "pkChoose" : "pk",
    a: p.id,
    b: options[0],
    options,
    values: {},
  };
}
function challenge(g, source) {
  const ps = active(g);
  if (ps.length < 2) {
    if (source === "round") nextRound(g);
    else endEvent(g);
    return;
  }
  const offset = g.challengeCount++ % ps.length;
  const ids = ps.map((p) => p.id);
  g.phase = source === "round" ? "round_challenge" : "host_judgement";
  g.pending = {
    type: "challenge",
    source,
    ids: [...ids.slice(offset), ...ids.slice(0, offset)],
    text: (g.config.challenges || CHALLENGES)[
      (g.challengeCount - 1) % (g.config.challenges || CHALLENGES).length
    ],
  };
  log(g, `${source === "round" ? "定时" : "御前"}争宠，参与顺序轮换`);
}
function afterChallenge(g) {
  if (g.pending?.source === "round") {
    g.pending = null;
    if (!active(g).length) g.phase = "finished";
    else nextRound(g);
  } else endEvent(g);
}
function boardEvent(g) {
  const p = current(g),
    n = p.pos,
    BOARD = g.config.board || globalBoard;
  log(g, `落点 ${n} · ${BOARD[n - 1]?.name || "起点"}`);
  if ([2, 11, 17, 22].includes(n)) draw(g, "R");
  else if ([3, 13, 21].includes(n)) draw(g, "C");
  else if ([4, 9, 14, 19, 24].includes(n)) draw(g, "P");
  else if ([5, 10, 20, 25].includes(n)) pk(g);
  else if ([6, 16, 23].includes(n)) settleMove(g, [[p.id, n === 16 ? 3 : 2]]);
  else if (n === 12) {
    const min = Math.min(...active(g).map((p) => p.pos));
    settleMove(
      g,
      active(g)
        .filter((p) => p.pos === min)
        .map((p) => [p.id, 2]),
    );
  } else if (n === 15) challenge(g, "board");
  else if (n === 26) {
    p.shield = Math.min(2, p.shield + 1);
    log(g, "获得护盾，上限2");
    endEvent(g);
  } else if (n === 27) {
    const min = Math.min(...active(g).map((p) => p.pos));
    settleMove(
      g,
      active(g).map((p) => [p.id, p.pos === min ? 3 : 1]),
    );
  } else if (n === 28) shield(g, p.id, 3);
  else
    task(g, BOARD[n - 1]?.name || "角色任务", BOARD[n - 1]?.text || "主持确认");
}
function applyRoll(g, value) {
  const p = current(g),
    bonus = g.pending.bonus || 0;
  g.lastRoll = {
    first: g.pending.first,
    second: g.pending.second || null,
    chosen: value,
    bonus,
  };
  const ids = move(g, [[p.id, value + bonus]]);
  const cell = (g.config.board || globalBoard)[p.pos - 1];
  g.lastLanding = {
    id: p.id,
    pos: p.pos,
    type: "board",
    name: cell?.name || "起点",
    text: cell?.text || "",
  };
  if (p.pos >= g.config.goal) {
    g.lastLanding.type = "finish";
    g.lastLanding.name = "加冕";
    g.lastLanding.text = "抵达终点，记录名次";
    finish(g, ids, () => endEvent(g));
    return;
  }
  const opponents = active(g)
    .filter((x) => x.id !== p.id && x.pos === p.pos)
    .map((p) => p.id);
  if (opponents.length) {
    g.lastLanding.type = "collision";
    g.lastLanding.name = "同格争宠";
    g.lastLanding.text = "碰撞替代格子事件，接下来骰子PK";
    log(g, "发生碰撞：替代格子事件");
    pk(g, opponents);
  } else boardEvent(g);
}
function resolveTask(g, skip = false, choice = "") {
  const ev = g.pending,
    p = current(g),
    id = ev.card;
  g.pending = { type: "settling" };
  if (id === "R01") settleMove(g, [[p.id, 2]]);
  else if (id === "R02") {
    if (p.reroll) settleMove(g, [[p.id, 1]]);
    else {
      p.reroll = 1;
      endEvent(g);
    }
  } else if (id === "R03") {
    p.shield = Math.min(2, p.shield + 1);
    log(g, "护盾上限2，多出不入账");
    endEvent(g);
  } else if (id === "R07") {
    const v = die(g);
    g.lastExtraRoll = { id: p.id, value: v };
    log(g, `额外机会：${v}点，前进${Math.min(v, 3)}，不增加轮数`);
    settleMove(g, [[p.id, Math.min(v, 3)]]);
  } else if (id === "R09") {
    p.medals++;
    endEvent(g);
  } else if (id === "R10") {
    if (active(g).length < 2) settleMove(g, [[p.id, 1]]);
    else pk(g);
  } else if (id === "P01" || id === "P02")
    shield(g, p.id, id === "P01" ? 2 : 1);
  else {
    if (!skip) {
      if (["C08", "P07"].includes(id) || (!id && p.pos === 8))
        p.temporary = { text: choice || "临时侍从", expires: p.turns + 2 };
      if (id === "R05") p.title = choice || "偏爱侍从";
    }
    log(g, skip ? "角色任务无责跳过" : "主持确认角色任务完成");
    endEvent(g);
  }
}
function body(g, a) {
  if (a.type === "pause") {
    if (g.phase === "paused" || g.phase === "finished")
      throw Error("当前不能暂停");
    g.pausedFrom = g.phase;
    g.phase = "paused";
    log(g, "暂停：隐藏任务，不扣分");
    return;
  }
  if (a.type === "resume") {
    if (g.phase !== "paused") throw Error("未暂停");
    g.phase = g.pausedFrom;
    g.pausedFrom = null;
    log(g, "恢复游戏");
    return;
  }
  if (a.type === "stop") {
    g.phase = "stopped";
    g.pending = null;
    log(g, "安全停止，无责结束，未完赛者不强制排名");
    return;
  }
  if (g.phase === "paused" || g.phase === "stopped")
    throw Error("请先恢复游戏");
  if (a.type === "award") {
    const p = g.players[a.id];
    if (!p || p.rank !== null || g.favorRemaining <= 0)
      throw Error("偏爱令不足或玩家已完赛");
    p.favor++;
    g.favorRemaining--;
    log(g, `公开颁发偏爱令给 ${p.name}，全局余${g.favorRemaining}`);
    return;
  }
  if (a.type === "interaction") {
    const p = g.players[a.id];
    if (!p || !p.favor || p.rank !== null) throw Error("没有可用偏爱令");
    p.favor--;
    log(g, `${p.name} 消耗偏爱令，15秒专属互动（可跳过）`);
    return;
  }
  if (a.type === "adjust") {
    if (g.phase !== "turn_start") throw Error("请在回合开始调整");
    const p = g.players[a.id];
    if (!p || p.rank !== null || !Number.isInteger(a.pos))
      throw Error("调整无效");
    p.pos = clamp(a.pos, g.config.goal);
    log(g, `主持调整 ${p.name} → ${p.pos}，原因：${a.reason || "现场调整"}`);
    if (p.pos >= g.config.goal) {
      rank(g, p.id);
      if (!active(g).length) g.phase = "finished";
      else if (current(g).rank !== null) advance(g);
    }
    return;
  }
  if (a.type === "hostChallenge") {
    if (g.phase !== "turn_start") throw Error("先完成当前事件");
    g.extraChallenge = true;
    challenge(g, "host");
    return;
  }
  if (a.type === "initiative") {
    if (g.phase !== "setup") throw Error("已决定顺序");
    const ev = g.pending;
    for (const id of ev.ids) ev.values[id] = die(g);
    log(
      g,
      "顺序骰：" +
        ev.ids.map((id) => `${g.players[id].name} ${ev.values[id]}`).join("，"),
    );
    g.lastDice = { values: { ...ev.values } };
    const groups = Object.values(ev.values).reduce(
      (o, v) => ({ ...o, [v]: [...(o[v] || []), ...[]] }),
      {},
    );
    for (const id of ev.ids) groups[ev.values[id]].push(id);
    const sorted = Object.keys(groups)
      .map(Number)
      .sort((a, b) => b - a)
      .map((v) => groups[v]);
    if (ev.groups) {
      ev.groups.splice(ev.groupIndex, 1, ...sorted);
    } else ev.groups = sorted;
    const index = ev.groups.findIndex((x) => x.length > 1);
    if (index !== -1) {
      ev.groupIndex = index;
      ev.ids = ev.groups[index];
      ev.values = {};
      log(g, "同分者重掷");
    } else {
      g.order = ev.groups.flat();
      g.turnIndex = 0;
      g.phase = "turn_start";
      g.pending = null;
      log(
        g,
        "固定顺序：" + g.order.map((id) => g.players[id].name).join(" → "),
      );
    }
    return;
  }
  if (a.type === "roll") {
    if (g.phase !== "turn_start") throw Error("等待事件结算");
    const p = current(g);
    let bonus = 0;
    if (a.favor) {
      if (!p.favor) throw Error("没有偏爱令");
      p.favor--;
      bonus = 1;
      log(g, "偏爱令：下一掷+1，不叠加");
    }
    const opponents = active(g).filter((x) => x.id !== p.id);
    const compensation =
      !p.compensation &&
      opponents.length > 0 &&
      Math.max(...opponents.map((p) => p.pos)) - p.pos >= 6;
    g.phase = "roll";
    g.pending = {
      type: "roll",
      first: die(g),
      bonus,
      compensation,
      reward: !!p.reroll,
    };
    log(g, `${p.name} 首掷 ${g.pending.first}${bonus ? " +1" : ""}`);
    return;
  }
  if (a.type === "reroll") {
    const ev = g.pending;
    if (g.phase !== "roll" || ev.second) throw Error("不能重复重掷");
    const p = current(g);
    if (a.source === "compensation" && ev.compensation) p.compensation = true;
    else if (a.source === "reward" && ev.reward) p.reroll = 0;
    else throw Error("无重掷资格");
    ev.second = die(g);
    ev.source = a.source;
    log(g, `重掷 ${ev.second}，仍可选择首掷`);
    return;
  }
  if (a.type === "chooseRoll") {
    if (g.phase !== "roll") throw Error("不能走棋");
    const ev = g.pending;
    if (!["first", "second"].includes(a.which) || !ev[a.which])
      throw Error("点数无效");
    if (
      ev.source === "compensation" &&
      ev.second &&
      ev[a.which] < Math.max(ev.first, ev.second)
    )
      throw Error("落后补偿须取较优值");
    applyRoll(g, ev[a.which]);
    return;
  }
  const ev = g.pending;
  if (a.type === "swap") {
    if (ev?.type !== "task" || !ev.card || ev.swaps >= 2)
      throw Error("每事件最多换2次");
    const numeric = ["R01", "R02", "R03", "R07", "R09", "R10", "P01", "P02"];
    if (numeric.includes(ev.card))
      throw Error("纯数值卡须正常结算，不能换卡改运气");
    draw(g, ev.card[0], ev.swaps + 1);
    return;
  }
  if (a.type === "task") {
    if (ev?.type !== "task") throw Error("没有角色任务");
    resolveTask(g, !!a.skip, a.title);
    return;
  }
  if (a.type === "shield") {
    if (ev?.type !== "shield") throw Error("没有后退待确认");
    const p = g.players[ev.id];
    if (a.use) {
      if (!p.shield) throw Error("无护盾");
      p.shield--;
      log(g, "主持确认使用护盾，抵消本次后退");
      endEvent(g);
    } else settleMove(g, [[ev.id, -ev.amount]]);
    return;
  }
  if (a.type === "pkChoose") {
    if (ev?.type !== "pkChoose" || !ev.options.includes(a.id))
      throw Error("对手无效");
    ev.b = a.id;
    ev.type = "pk";
    return;
  }
  if (a.type === "pkRoll") {
    if (ev?.type !== "pk") throw Error("没有PK");
    const x = die(g),
      y = die(g);
    ev.values = { [ev.a]: x, [ev.b]: y };
    g.lastDice = { values: { ...ev.values } };
    log(g, `骰子PK ${x} : ${y}`);
    if (x === y) {
      ev.tie = true;
      return;
    }
    ev.winner = x > y ? ev.a : ev.b;
    ev.type = "pkResult";
    return;
  }
  if (a.type === "pkConfirm") {
    if (ev?.type !== "pkResult") throw Error("请先掷PK");
    settleMove(g, [[ev.winner, 2]]);
    return;
  }
  if (a.type === "challenge") {
    if (ev?.type !== "challenge") throw Error("无挑战");
    if (a.skip) {
      log(g, "整个挑战无责跳过");
      afterChallenge(g);
      return;
    }
    if (
      !a.ranks ||
      ev.ids.some(
        (id) =>
          !Number.isInteger(a.ranks[id]) ||
          a.ranks[id] < 1 ||
          a.ranks[id] > ev.ids.length,
      )
    )
      throw Error("请选择每人名次（允许并列）");
    const amounts =
      ev.ids.length === 2
        ? [2, 0]
        : ev.ids.map((_, i) => (i === 0 ? 2 : i === 1 ? 1 : 0));
    const ids = move(
      g,
      ev.ids.map((id) => [id, amounts[a.ranks[id] - 1]]),
    );
    log(g, "主持确定本次表演排名（允许并列）");
    finish(g, ids, () => afterChallenge(g));
    return;
  }
  if (a.type === "tieRoll") {
    if (ev?.type !== "finishTie") throw Error("无同批平局");
    const group = ev.groups[ev.index];
    if (group.length === 1) {
      ev.ordered.push(group[0]);
      ev.index++;
    } else {
      const values = {};
      for (const id of group) values[id] = die(g);
      ev.values = values;
      g.lastDice = { values: { ...values } };
      log(
        g,
        "同批完赛PK：" +
          group.map((id) => `${g.players[id].name} ${values[id]}`).join("，"),
      );
      const buckets = {};
      for (const id of group) (buckets[values[id]] ||= []).push(id);
      const sorted = Object.keys(buckets)
        .map(Number)
        .sort((a, b) => b - a)
        .map((x) => buckets[x]);
      ev.groups.splice(ev.index, 1, ...sorted);
      while (ev.groups[ev.index]?.length === 1) {
        ev.ordered.push(ev.groups[ev.index][0]);
        ev.index++;
      }
    }
    if (ev.index >= ev.groups.length) {
      for (const id of ev.ordered) rank(g, id);
      g.pending = ev.after;
      if (g.pending?.type === "challenge") afterChallenge(g);
      else endEvent(g);
    }
    return;
  }
  if (a.type === "epiloguePk") {
    if (g.phase !== "finished" || g.pending) throw Error("请先完成棋局");
    const a = g.players.find((p) => p.rank === g.players.length)?.id,
      b = g.players.find((p) => p.rank === 1).id;
    if (a === undefined || a === b) throw Error("至少两人才能进行趣味挑战");
    g.pending = { type: "epiloguePk", a, b, values: {} };
    log(g, "季军自愿发起趣味称号挑战，不改变排名");
    return;
  }
  if (a.type === "epilogueRoll") {
    if (ev?.type !== "epiloguePk" || ev.winner !== undefined)
      throw Error("无趣味挑战");
    const x = die(g),
      y = die(g);
    ev.values = { [ev.a]: x, [ev.b]: y };
    g.lastDice = { values: { ...ev.values } };
    log(g, `终局趣味PK ${x} : ${y}（不改排名）`);
    if (x !== y) ev.winner = x > y ? ev.a : ev.b;
    return;
  }
  if (a.type === "epilogueConfirm") {
    if (ev?.type !== "epiloguePk") throw Error("无趣味挑战");
    if (!a.skip && ev.winner === undefined) throw Error("请先完成骰子PK");
    if (!a.skip) {
      g.players[ev.winner].funTitle = a.title || "幸运侍从";
      log(
        g,
        `${g.players[ev.winner].name} 获得趣味称号 ${a.title || "幸运侍从"}`,
      );
    } else log(g, "终局趣味PK无责跳过");
    g.pending = null;
    return;
  }
  if (a.type === "rewardChoice") {
    if (g.phase !== "finished" || !g.players[a.id]?.rank) throw Error("未终局");
    g.rewardChoices[a.id] = String(a.choice);
    log(g, `${g.players[a.id].name} 终局选择：${a.choice}`);
    return;
  }
  throw Error("未知操作");
}
export function dispatch(state, action) {
  if (action.type === "undo") {
    if (!state.history.length) throw Error("没有可撤销操作");
    const g = copy(state),
      previous = g.history.pop();
    const result = {
      ...previous,
      history: g.history,
      redo: {
        action: previous._action,
        state: { ...copy(state), history: [], redo: null },
      },
    };
    delete result._action;
    return result;
  }
  if (action.type === "redo") {
    if (!state.redo) throw Error("没有待恢复结果");
    const next = copy(state.redo.state);
    next.history = [
      ...state.history,
      { ...snapshot(state), _action: state.redo.action },
    ];
    next.redo = null;
    return next;
  }
  if (
    state.redo &&
    JSON.stringify(action) === JSON.stringify(state.redo.action)
  )
    return dispatch(state, { type: "redo" });
  // 随机操作撤销后，先恢复既有结果；不能换操作重新刷骰。
  if (
    state.redo &&
    ["roll", "initiative", "reroll", "pkRoll", "tieRoll", "swap"].includes(
      state.redo.action.type,
    ) &&
    !["pause", "resume", "stop"].includes(action.type)
  )
    throw Error("撤销了随机操作，请先恢复原结果");
  const g = copy(state);
  g.history.push({ ...snapshot(state), _action: copy(action) });
  if (g.history.length > 80) g.history.shift();
  g.redo = null;
  body(g, action);
  g.revision++;
  g.updatedAt = new Date().toISOString();
  return g;
}
function snapshot(g) {
  const s = copy(g);
  delete s.history;
  delete s.redo;
  return s;
}
export function validate(g) {
  if (
    !g ||
    g.schemaVersion !== 1 ||
    !Array.isArray(g.players) ||
    g.players.length < 1 ||
    g.players.length > 6 ||
    !Array.isArray(g.order) ||
    !Array.isArray(g.log) ||
    g.favorRemaining < 0 ||
    g.favorRemaining > 3
  )
    throw Error("存档格式错误");
  for (const p of g.players)
    if (
      !Number.isInteger(p.pos) ||
      p.pos < 0 ||
      p.pos > g.config.goal ||
      p.shield < 0 ||
      p.shield > 2
    )
      throw Error("棋位或道具无效");
  return true;
}
export const NUMERIC_CARDS = [
  "R01",
  "R02",
  "R03",
  "R07",
  "R09",
  "R10",
  "P01",
  "P02",
];
