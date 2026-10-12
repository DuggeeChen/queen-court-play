import test from "node:test";
import assert from "node:assert/strict";
import { createGame, dispatch, validate, copy, current } from "../engine.js";
import { DEFAULTS } from "../data.js";
const cfg = (n) => ({
  ...copy(DEFAULTS),
  orderMode: "seated",
  players: Array.from({ length: n }, (_, i) => ({
    name: `参与者${i + 1}`,
    color: "#be486a",
    role: "忠诚派",
  })),
});
function auto(g) {
  let e = g.pending;
  const action =
    e?.type === "initiative"
      ? { type: "initiative" }
      : e?.type === "roll"
        ? { type: "chooseRoll", which: "first" }
        : e?.type === "task"
          ? { type: "task", skip: true }
          : e?.type === "shield"
            ? { type: "shield", use: true }
            : e?.type === "pkChoose"
              ? { type: "pkChoose", id: e.options[0] }
              : e?.type === "pk"
                ? { type: "pkRoll" }
                : e?.type === "pkResult"
                  ? { type: "pkConfirm" }
                  : e?.type === "challenge"
                    ? {
                        type: "challenge",
                        ranks: Object.fromEntries(
                          e.ids.map((id, i) => [id, i + 1]),
                        ),
                      }
                    : e?.type === "finishTie"
                      ? { type: "tieRoll" }
                      : g.phase === "turn_start"
                        ? { type: "roll" }
                        : null;
  if (!action) throw Error("stuck " + g.phase);
  return dispatch(g, action);
}
test("1—6人直接开局，默认主持顺序，无须多次顺序骰", () => {
  for (let n = 1; n <= 6; n++) {
    let g = createGame(cfg(n), 123);
    assert.equal(g.phase, "turn_start");
    assert.deepEqual(
      g.order,
      Array.from({ length: n }, (_, i) => i),
    );
    assert.equal(current(g).id, 0);
    assert.ok(validate(g));
    assert.deepEqual(JSON.parse(JSON.stringify(g)).players, g.players);
  }
});
test("人数越界、空昵称和同名不产生棋局", () => {
  assert.throws(() => createGame(cfg(0)));
  assert.throws(() => createGame(cfg(7)));
  let c = cfg(2);
  c.players[1].name = c.players[0].name;
  assert.throws(() => createGame(c));
  c.players[1].name = " ";
  assert.throws(() => createGame(c));
});
test("1—6人全部完成完整30格棋局，位置及名次不出现NaN", () => {
  for (let n = 1; n <= 6; n++)
    for (let seed = 101; seed <= 105; seed++) {
      let g = createGame(cfg(n), seed);
      for (let i = 0; i < 1600 && g.phase !== "finished"; i++) {
        g = auto(g);
        validate(g);
        assert.ok(g.players.every((p) => Number.isFinite(p.pos)));
      }
      assert.equal(g.phase, "finished", `${n}人 seed${seed}`);
      assert.deepEqual(
        g.players.map((p) => p.rank).sort((a, b) => a - b),
        Array.from({ length: n }, (_, i) => i + 1),
      );
    }
});
test("4—6人挑战奖励+2/+1/0，其余0；并列奖励一致", () => {
  for (let n = 4; n <= 6; n++) {
    let g = createGame(cfg(n), 3);
    g.pending = { type: "challenge", source: "host", ids: g.order };
    g.extraChallenge = true;
    g.phase = "host_judgement";
    g = dispatch(g, {
      type: "challenge",
      ranks: Object.fromEntries(g.order.map((id, i) => [id, i + 1])),
    });
    assert.deepEqual(
      g.players.map((p) => p.pos),
      [2, 1, ...Array(n - 2).fill(0)],
    );
    g.pending = { type: "challenge", source: "host", ids: g.order };
    g.extraChallenge = true;
    g.phase = "host_judgement";
    g = dispatch(g, {
      type: "challenge",
      ranks: Object.fromEntries(g.order.map((id) => [id, 1])),
    });
    assert.deepEqual(
      g.players.map((p) => p.pos),
      [4, 3, ...Array(n - 2).fill(2)],
    );
  }
});
test("单人无对手PK不阻塞，结束后禁止自我趣味PK", () => {
  let g = createGame(cfg(1), 9);
  g.players[0].pos = 4;
  g.phase = "roll";
  g.pending = { type: "roll", first: 1, bonus: 0 };
  g = dispatch(g, { type: "chooseRoll", which: "first" });
  assert.equal(g.phase, "turn_start");
  g.players[0].pos = 30;
  g.players[0].rank = 1;
  g.rankCount = 1;
  g.phase = "finished";
  g.pending = null;
  assert.throws(() => dispatch(g, { type: "epiloguePk" }));
});
test("多人同批完赛保留勋章优先，全部名次连续", () => {
  let g = createGame(cfg(6), 7);
  g.players.forEach((p) => {
    p.pos = 29;
    p.medals = p.id === 4 ? 2 : 0;
  });
  g.pending = { type: "challenge", source: "board", ids: g.order };
  g.phase = "host_judgement";
  g = dispatch(g, {
    type: "challenge",
    ranks: Object.fromEntries(g.order.map((id) => [id, 1])),
  });
  for (let i = 0; i < 80 && g.phase !== "finished"; i++)
    g = dispatch(g, { type: "tieRoll" });
  assert.equal(g.phase, "finished");
  assert.equal(g.players[4].rank, 1);
  assert.deepEqual(
    g.players.map((p) => p.rank).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6],
  );
});
