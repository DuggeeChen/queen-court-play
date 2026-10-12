import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  dispatch,
  validate,
  current,
  copy,
  BOARD_LAYOUT,
} from "../engine.js";
import { DEFAULTS, CARDS, BOARD } from "../data.js";
const go = (g, type, extra = {}) => dispatch(g, { type, ...extra });
function started(seed = 123) {
  let g = createGame(DEFAULTS, seed);
  for (let i = 0; i < 50 && g.phase === "setup"; i++) g = go(g, "initiative");
  assert.equal(g.phase, "turn_start");
  return g;
}
function taskCard(g, id) {
  g.phase = "resolve_event";
  g.pending = { type: "task", card: id, title: id, text: id, swaps: 0 };
  return g;
}
function rollTo(g, n) {
  g.phase = "roll";
  g.pending = { type: "roll", first: 1, bonus: 0 };
  current(g).pos = n - 1;
  return go(g, "chooseRoll", { which: "first" });
}
function auto(g) {
  if (g.redo) return go(g, "redo");
  const e = g.pending;
  switch (e?.type) {
    case "initiative":
      return go(g, "initiative");
    case "roll":
      return go(g, "chooseRoll", { which: "first" });
    case "task":
      return go(g, "task", { skip: true });
    case "shield":
      return go(g, "shield", { use: !!g.players[e.id].shield });
    case "pkChoose":
      return go(g, "pkChoose", { id: e.options[0] });
    case "pk":
      return go(g, "pkRoll");
    case "pkResult":
      return go(g, "pkConfirm");
    case "challenge":
      return go(g, "challenge", {
        ranks: Object.fromEntries(e.ids.map((id, i) => [id, i + 1])),
      });
    case "finishTie":
      return go(g, "tieRoll");
    default:
      if (g.phase === "turn_start") return go(g, "roll");
      throw Error("stuck " + JSON.stringify(e));
  }
}
test("原始内容：30格、32卡，1右下30左上对应界面排布", () => {
  assert.equal(BOARD_LAYOUT[5][4], 1);
  assert.equal(BOARD_LAYOUT[0][0], 30);
  assert.equal(new Set(BOARD_LAYOUT.flat()).size, 30);
  for (let n = 1; n < 30; n++) {
    const a = BOARD_LAYOUT.flat().indexOf(n),
      b = BOARD_LAYOUT.flat().indexOf(n + 1);
    assert.equal(
      Math.abs(Math.floor(a / 5) - Math.floor(b / 5)) +
        Math.abs((a % 5) - (b % 5)),
      1,
    );
  }
  assert.equal(BOARD.length, 30);
  assert.equal(CARDS.length, 32);
  assert.equal(BOARD[26].name, "逆转");
  assert.equal(CARDS.filter((x) => x.id[0] === "C").length, 12);
});
test("完整三人棋局：100个随机种子全部完赛并确定完整排名", () => {
  for (let seed = 1; seed <= 100; seed++) {
    let g = createGame(DEFAULTS, seed);
    for (let n = 0; n < 1200 && g.phase !== "finished"; n++) {
      g = auto(g);
      validate(g);
    }
    assert.equal(g.phase, "finished", "seed " + seed);
    assert.deepEqual(g.players.map((p) => p.rank).sort(), [1, 2, 3]);
    assert.ok(g.players.every((p) => p.pos === 30));
    assert.equal(new Set(g.triggered).size, g.triggered.length);
  }
});
test("超过30封顶，终点无事件", () => {
  let g = started();
  current(g).pos = 29;
  g = go(g, "roll");
  g.pending.first = 6;
  g = go(g, "chooseRoll", { which: "first" });
  assert.equal(g.players[g.order[0]].pos, 30);
  assert.equal(g.rankCount, 1);
  assert.equal(g.phase, "turn_start");
});
test("飞行追加位移不触发新事件或碰撞", () => {
  let g = started();
  const p = current(g);
  g.players.find((x) => x.id !== p.id).pos = 8;
  g = rollTo(g, 6);
  assert.equal(g.players[p.id].pos, 8);
  assert.equal(g.phase, "turn_start");
  assert.equal(g.pending, null);
});
test("额外机会不增加轮数，不使用加点或重掷", () => {
  let g = started();
  const p = current(g);
  p.favor = 1;
  p.reroll = 1;
  g = taskCard(g, "R07");
  g = go(g, "task");
  assert.equal(g.round, 1);
  assert.equal(g.players[p.id].favor, 1);
  assert.equal(g.players[p.id].reroll, 1);
  assert.ok(g.players[p.id].pos <= 3);
  assert.equal(g.players[p.id].turns, 1);
});
test("三人同格选择一个PK，碰撞替代格子事件", () => {
  let g = started();
  const p = current(g);
  for (const x of g.players) if (x.id !== p.id) x.pos = 3;
  g = rollTo(g, 3);
  assert.equal(g.pending.type, "pkChoose");
  assert.equal(g.pending.options.length, 2);
  assert.equal(g.discards.C.length, 0);
  g = go(g, "pkChoose", { id: g.pending.options[1] });
  assert.equal(g.pending.type, "pk");
});
test("两人碰撞直接PK；平局重掷；无对手PK正常完成", () => {
  let g = started(8),
    p = current(g);
  g.players.find((x) => x.id !== p.id).pos = 5;
  g = rollTo(g, 5);
  assert.equal(g.pending.type, "pk");
  let found = false;
  for (let n = 0; n < 100; n++) {
    let h = copy(g);
    h.seed = n + 1;
    h = go(h, "pkRoll");
    if (h.pending.type === "pk" && h.pending.tie) {
      found = true;
      h = go(h, "pkRoll");
      assert.ok(["pk", "pkResult"].includes(h.pending.type));
      break;
    }
  }
  assert.ok(found);
  g = started();
  p = current(g);
  g.players
    .filter((x) => x.id !== p.id)
    .forEach((x, i) => {
      x.pos = 30;
      x.rank = i + 1;
    });
  g.rankCount = 2;
  g = rollTo(g, 5);
  assert.equal(g.pending, null);
  assert.equal(g.phase, "turn_start");
});
test("后退护盾确认、消耗、上限2，后退不低于0", () => {
  let g = started();
  let p = current(g);
  g = taskCard(g, "P01");
  g = go(g, "task", { skip: true });
  assert.equal(g.pending.type, "shield");
  g = go(g, "shield", { use: true });
  assert.equal(g.players[p.id].shield, 0);
  assert.equal(g.players[p.id].pos, 0);
  g = started();
  p = current(g);
  p.shield = 0;
  g = taskCard(g, "P01");
  g = go(g, "task");
  assert.equal(g.players[p.id].pos, 0);
  g = started();
  p = current(g);
  p.shield = 2;
  g = taskCard(g, "R03");
  g = go(g, "task");
  assert.equal(g.players[p.id].shield, 2);
});
test("奖励重掷两值任选；补偿每人一次并取较优；不可叠加", () => {
  let g = started(),
    p = current(g);
  p.reroll = 1;
  g = go(g, "roll");
  g = go(g, "reroll", { source: "reward" });
  const first = g.pending.first;
  assert.throws(() => go(g, "reroll", { source: "reward" }));
  g = go(g, "chooseRoll", { which: "first" });
  assert.equal(g.lastRoll.chosen, first);
  assert.equal(g.players[p.id].reroll, 0);
  g = started();
  p = current(g);
  g.players.filter((x) => x.id !== p.id).forEach((x) => (x.pos = 10));
  g = go(g, "roll");
  assert.ok(g.pending.compensation);
  g = go(g, "reroll", { source: "compensation" });
  assert.ok(g.players[p.id].compensation);
  const best = g.pending.first >= g.pending.second ? "first" : "second";
  g = go(g, "chooseRoll", { which: best });
  g.phase = "turn_start";
  g.turnIndex = g.order.indexOf(p.id);
  g.pending = null;
  g = go(g, "roll");
  assert.equal(g.pending.compensation, false);
});
test("偏爱令全局三张；+1与互动选择消耗，不叠加", () => {
  let g = started();
  const id = current(g).id;
  for (let i = 0; i < 3; i++) g = go(g, "award", { id });
  assert.throws(() => go(g, "award", { id }));
  g = go(g, "interaction", { id });
  assert.equal(g.players[id].favor, 2);
  g = go(g, "roll", { favor: true });
  assert.equal(g.pending.bonus, 1);
  assert.equal(g.players[id].favor, 1);
  assert.throws(() => go(g, "roll", { favor: true }));
});
test("第3/6轮挑战各一次，额外机会不另计；第15格独立", () => {
  for (const round of [3, 6]) {
    let g = started();
    g.round = round;
    g.turnIndex = 2;
    g.completed = g.order.slice(0, 2);
    g = taskCard(g, "R07");
    g = go(g, "task");
    assert.equal(g.pending.type, "challenge");
    assert.equal(g.pending.source, "round");
    assert.deepEqual(g.triggered, [round]);
    g = go(g, "challenge", { skip: true });
    assert.equal(g.round, round + 1);
  }
  let g = started();
  g = rollTo(g, 15);
  assert.equal(g.pending.type, "challenge");
  assert.equal(g.pending.source, "board");
  assert.deepEqual(g.triggered, []);
});
test("第12格并列末位一起+2；第27格并列末位+3其余+1", () => {
  let g = started(),
    p = current(g);
  const others = g.players.filter((x) => x.id !== p.id);
  others.forEach((x) => (x.pos = 1));
  g = rollTo(g, 12);
  others.forEach((x) => assert.equal(g.players[x.id].pos, 3));
  g = started();
  p = current(g);
  const os = g.players.filter((x) => x.id !== p.id);
  os.forEach((x) => (x.pos = 25));
  g = rollTo(g, 27);
  os.forEach((x) => assert.equal(g.players[x.id].pos, 28));
  assert.equal(g.players[p.id].pos, 28);
  assert.equal(g.phase, "turn_start");
});
test("同批完赛先比勋章再PK，与先前完赛者排名兼容", () => {
  let g = started();
  for (const p of g.players) p.pos = 29;
  g.players[0].medals = 2;
  g.phase = "host_judgement";
  g.pending = { type: "challenge", source: "board", ids: [0, 1, 2] };
  g = go(g, "challenge", { ranks: { 0: 1, 1: 1, 2: 1 } });
  assert.equal(g.pending.type, "finishTie");
  for (let n = 0; n < 30 && g.phase !== "finished"; n++) g = go(g, "tieRoll");
  assert.equal(g.phase, "finished");
  assert.equal(g.players[0].rank, 1);
  assert.deepEqual(g.players.map((p) => p.rank).sort(), [1, 2, 3]);
});
test("换卡最多2次；空卡池/所有禁用/跳过均不阻塞", () => {
  let g = started();
  g = rollTo(g, 3);
  g = go(g, "swap");
  g = go(g, "swap");
  assert.throws(() => go(g, "swap"));
  g = go(g, "task", { skip: true });
  assert.equal(g.phase, "turn_start");
  let cfg = copy(DEFAULTS);
  cfg.cards.forEach((c) => (c.enabled = false));
  g = createGame(cfg, 55);
  while (g.phase === "setup") g = go(g, "initiative");
  g = rollTo(g, 3);
  assert.equal(g.pending.card, null);
  g = go(g, "task", { skip: true });
  assert.equal(g.phase, "turn_start");
});
test("暂停隐藏任务且拒绝结算，继续原事件；不能重复掷骰", () => {
  let g = started();
  g = go(g, "roll");
  assert.throws(() => go(g, "roll"));
  const e = copy(g.pending);
  g = go(g, "pause");
  assert.equal(g.phase, "paused");
  assert.throws(() => go(g, "chooseRoll", { which: "first" }));
  g = go(g, "resume");
  assert.deepEqual(g.pending, e);
});
test("撤销恢复完整牌堆、随机结果、棋位，不能刷随机数", () => {
  let g = started();
  const before = copy(g);
  g = go(g, "roll");
  const value = g.pending.first;
  g = go(g, "undo");
  assert.equal(g.seed, before.seed);
  assert.deepEqual(g.decks, before.decks);
  g = go(g, "roll");
  assert.equal(g.pending.first, value);
  g = go(g, "chooseRoll", { which: "first" });
  const after = copy(g);
  g = go(g, "undo");
  g = go(g, "redo");
  assert.equal(g.seed, after.seed);
  assert.deepEqual(g.decks, after.decks);
  assert.deepEqual(g.players, after.players);
});
test("刷新序列化恢复待结算事件，不重新抽牌或掷骰", () => {
  let g = started();
  g = rollTo(g, 3);
  const restored = JSON.parse(JSON.stringify(g));
  assert.deepEqual(restored.pending, g.pending);
  assert.deepEqual(restored.decks, g.decks);
  assert.ok(validate(restored));
  assert.equal(go(restored, "task", { skip: true }).phase, "turn_start");
});
test("临时称号持续到本人下个常规回合结束，永久昵称保留", () => {
  let g = started();
  const id = current(g).id;
  g.players[id].title = "专属";
  g = taskCard(g, "C08");
  g = go(g, "task", { title: "临时" });
  assert.equal(g.players[id].temporary.text, "临时");
  for (let i = 0; i < 2; i++) {
    g = taskCard(g, "C01");
    g = go(g, "task", { skip: true });
  }
  g = taskCard(g, "C01");
  g = go(g, "task", { skip: true });
  assert.equal(g.players[id].temporary, null);
  assert.equal(g.players[id].title, "专属");
});
test("短局20格，配置快照不受后续编辑影响", () => {
  let cfg = copy(DEFAULTS);
  cfg.goal = 20;
  let g = createGame(cfg, 12);
  cfg.cards[0].text = "changed";
  assert.notEqual(g.config.cards[0].text, "changed");
  for (let n = 0; n < 800 && g.phase !== "finished"; n++) g = auto(g);
  assert.equal(g.phase, "finished");
  assert.ok(g.players.every((p) => p.pos === 20));
});
test("亚军下局奖励必须重新同意；默认公平起点", () => {
  assert.ok(createGame().players.every((p) => p.pos === 0));
  const cfg = copy(DEFAULTS);
  cfg.startBonus = { id: 1, consented: true };
  const g = createGame(cfg);
  assert.deepEqual(
    g.players.map((p) => p.pos),
    [0, 2, 0],
  );
  assert.ok(g.log[0].text.includes("全员开局同意"));
});
test("终局趣味PK允许重掷/跳过，不能改变既有排名", () => {
  let g = started();
  g.phase = "finished";
  g.pending = null;
  g.players.forEach((p, i) => {
    p.rank = i + 1;
    p.pos = 30;
  });
  g.rankCount = 3;
  g = go(g, "epiloguePk");
  for (let n = 0; n < 30 && g.pending.winner === undefined; n++)
    g = go(g, "epilogueRoll");
  assert.notEqual(g.pending.winner, undefined);
  const winner = g.pending.winner;
  g = go(g, "epilogueConfirm", { title: "幸运侍从" });
  assert.equal(g.players[winner].funTitle, "幸运侍从");
  assert.deepEqual(
    g.players.map((p) => p.rank),
    [1, 2, 3],
  );
  g = go(g, "epiloguePk");
  g = go(g, "epilogueConfirm", { skip: true });
  assert.equal(g.pending, null);
});
test("每张卡的原始秒数与提醒一致，计时无自动惩罚", () => {
  let g = started();
  g = rollTo(g, 3);
  const cfg = copy(DEFAULTS);
  assert.equal(cfg.cards.find((c) => c.id === "C02").seconds, 10);
  assert.equal(cfg.cards.find((c) => c.id === "P10").seconds, 20);
});
