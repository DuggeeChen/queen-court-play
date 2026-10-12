import { BOARD, CARDS, DEFAULTS } from "./data.js?v=2";
import {
  createGame,
  dispatch,
  current,
  copy,
  validate,
  BOARD_LAYOUT,
  NUMERIC_CARDS,
} from "./engine.js?v=2";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const COLORS = [
    "#be486a",
    "#33879a",
    "#c18c32",
    "#418566",
    "#895abb",
    "#5673bf",
  ],
  ROLES = ["忠诚派", "嘴硬派", "争宠派"];
const ICONS = {
  觐见: "👑",
  恩宠: "✨",
  命令: "📜",
  惩罚: "♠",
  夺宠: "⚔️",
  飞行: "🪽",
  请示: "💬",
  称号: "🎖️",
  援手: "🤝",
  御前争宠: "👑",
  御前评价: "💬",
  护盾: "🛡️",
  逆转: "🔄",
  陷阱: "⚠️",
  最后请求: "💬",
  加冕: "👑",
};
const BRIEFS = {
  C01: "到认可的位置，用正式口吻介绍自己。",
  C02: "保持认可的舒适姿态10秒，可以坐着。",
  C03: "说出三个值得被偏爱的理由。",
  C04: "诚恳申请奖励，女王决定是否回应。",
  C05: "复述女王刚说的短口令。",
  C06: "先演不在乎输赢，再演很想赢。",
  C07: "向对手说一句竞争宣言。",
  C08: "下个回合，以认可的临时称号自称。",
  C09: "15秒争取偏爱，不能说“我”。",
  C10: "夸一名对手，再说自己的优势。",
  C11: "演出期待、失落、被认可三种表情。",
  C12: "只剩一次赏赐，用一句话争取。",
  R01: "前进2格。",
  R02: "获得一次重掷；已持有则前进1格。",
  R03: "获得1枚护盾，最多2枚。",
  R04: "女王给你15秒专属嘉奖。",
  R05: "获得一个双方认可的专属昵称。",
  R06: "女王说一句认可的专属角色台词。",
  R07: "再摇一次，前进最多3格。",
  R08: "问女王一个认可范围的问题，可以跳过。",
  R09: "获得1枚荣誉勋章。",
  R10: "选一名对手，骰子PK。",
  P01: "后退2格，可以使用护盾。",
  P02: "后退1格，可以使用护盾。",
  P03: "在游戏情境里，认真又夸张地申请原谅。",
  P04: "编一句30字以内的趣味检讨。",
  P05: "演10秒看见对手得宠的反应。",
  P06: "一本正经地说：“我才不在乎。”",
  P07: "下个回合，使用认可的搞笑称号。",
  P08: "说出本局最想赢过谁，以及理由。",
  P09: "发表15秒落选感言，不扣勋章。",
  P10: "严肃朗读搞笑句子20秒，笑场不追加惩罚。",
};
let defaults = copy(DEFAULTS),
  g = null,
  screen = "home",
  panel = null,
  busy = false,
  fx = null,
  positions = null,
  controller = null,
  timer = null,
  seconds = 0,
  timerKey = null,
  saved = true,
  animationActor = null,
  setupPlayers = [],
  count = 3;
const GAME_KEY = "queen-game-demo",
  SETTINGS_KEY = "queen-v2-settings";
try {
  defaults =
    JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || defaults;
} catch {}
try {
  const s = JSON.parse(localStorage.getItem(GAME_KEY) || "null");
  if (s) {
    g = s.state || s;
    validate(g);
  }
} catch {
  g = null;
}
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").classList.add("show");
  clearTimeout(toast.id);
  toast.id = setTimeout(() => $("#toast").classList.remove("show"), 3200);
}
function save() {
  try {
    localStorage.setItem(
      GAME_KEY,
      JSON.stringify({ state: g, cloudRevision: 0 }),
    );
    saved = true;
  } catch {
    saved = false;
    toast("存储空间不足，请导出备份");
  }
}
function settingsSave() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults));
  } catch {
    toast("设置保存失败");
  }
}
function step(a) {
  g = dispatch(g, a);
  save();
}
function clearTimer() {
  clearInterval(timer);
  timer = null;
  timerKey = null;
}
function cancel() {
  controller?.abort();
  controller = null;
  busy = false;
  fx = null;
  positions = null;
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}
const motion = () =>
  g?.config.animation !== false &&
  !matchMedia("(prefers-reduced-motion: reduce)").matches;
const token = (p, size = "") =>
  `<span class="token ${size}" style="--p:${esc(p.color)}">${p.id + 1}</span>`;
function dice(v = 1, big = false) {
  const dots = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };
  return `<div class="dice-face ${big ? "large" : ""}" role="img" aria-label="骰子点数${v}">${Array.from({ length: 9 }, (_, i) => `<i class="${dots[v]?.includes(i + 1) ? "pip" : ""}"></i>`).join("")}</div>`;
}
const actor = () => current(g) || g?.players.find((p) => p.rank === null);
const displayActor = () =>
  busy && animationActor !== null ? g.players[animationActor] : actor();
function next() {
  for (let n = 1; n < g.order.length; n++) {
    const p = g.players[g.order[(g.turnIndex + n) % g.order.length]];
    if (p.rank === null) return p;
  }
  return null;
}
function header() {
  return `<header class="topbar"><button class="brand" data-act="home"><span>♛</span> 女王争宠棋 <small>御前之局</small></button><div class="top-tools"><button class="save-dot" data-act="storage" aria-label="${saved ? "当前浏览器已保存" : "保存失败"}"><i class="${saved ? "" : "failed"}"></i></button>${screen === "game" && g && !["finished", "stopped", "paused"].includes(g.phase) ? '<button class="pause-button" data-act="pause">Ⅱ 暂停</button>' : ""}<button class="menu-button" data-act="menu" aria-label="打开菜单">☰</button></div></header>`;
}
function home() {
  return `<div class="home"><div class="home-crown">♛</div><div class="eyebrow">女王的棋局，你来掌控</div><h1>今晚，谁最得宠？</h1><p>你来主持。轮到谁，你可以代摇，<br>也可以把手机递给他，只点一下 🎲。</p><button class="big-button primary" data-act="new">👑 开一局</button>${g ? '<button class="big-button subtle" data-act="continue">继续上次棋局 →</button>' : ""}<div class="home-note">免登录 · 1—6人 · 30格<br>进度只保存在当前浏览器，不跨设备同步</div><button class="text-button" data-act="editor">编辑卡片与默认设置</button></div>`;
}
function prepare() {
  count = defaults.players.length;
  setupPlayers = Array.from({ length: 6 }, (_, i) => ({
    ...(defaults.players[i] || {
      name: `参与者${i + 1}`,
      role: ROLES[i % 3],
      color: COLORS[i],
    }),
    color: defaults.players[i]?.color || COLORS[i],
  }));
}
function setup() {
  return `<div class="setup"><div class="eyebrow">你主持，他们入局</div><h1>谁来争宠？</h1><p class="muted">所有操作由你控制，不需要玩家账号。</p><form id="setup-form"><div class="count-row"><span>参与人数</span><div class="stepper"><button type="button" data-act="count" data-delta="-1" aria-label="减少参与人数" ${count === 1 ? "disabled" : ""}>−</button><b>${count}</b><button type="button" data-act="count" data-delta="1" aria-label="增加参与人数" ${count === 6 ? "disabled" : ""}>＋</button></div></div>${setupPlayers
    .slice(0, count)
    .map(
      (p, i) =>
        `<label class="setup-player"><span class="token" style="--p:${p.color}">${i + 1}</span><input name="name${i}" aria-label="参与者${i + 1}昵称" value="${esc(p.name)}" maxlength="30" required><small>第${i + 1}位</small></label>`,
    )
    .join(
      "",
    )}<details class="options"><summary>更多设置 · 卡片、角色、奖励</summary><label>你的称呼<input name="host" value="${esc(defaults.host)}" maxlength="40" required></label><label>行动顺序<select name="orderMode"><option value="seated" ${defaults.orderMode !== "dice" ? "selected" : ""}>按上面顺序 · 直接开始</option><option value="dice" ${defaults.orderMode === "dice" ? "selected" : ""}>掷骰决定先后</option></select></label><label>棋局长度<select name="goal"><option value="30" ${defaults.goal === 30 ? "selected" : ""}>30格完整局</option><option value="20" ${defaults.goal === 20 ? "selected" : ""}>20格短局</option></select></label><label><input type="checkbox" name="animation" ${defaults.animation ? "checked" : ""}> 骰子与走棋动画</label><label>默认提醒秒数<input name="seconds" type="number" min="5" max="300" value="${defaults.seconds}"></label><label>暂停词<input name="pauseWord" value="${esc(defaults.pauseWord)}" maxlength="40" required></label>${setupPlayers
    .slice(0, count)
    .map(
      (p, i) =>
        `<div class="role-row"><span>${esc(p.name)}</span><select name="role${i}" aria-label="参与者${i + 1}角色">${ROLES.map((r) => `<option ${p.role === r ? "selected" : ""}>${r}</option>`).join("")}</select><input name="color${i}" type="color" aria-label="参与者${i + 1}颜色" value="${p.color}"></div>`,
    )
    .join(
      "",
    )}<label>认可的称号<input name="titles" value="${esc(defaults.titles)}" maxlength="400"></label><label>认可的任务范围<textarea name="boundaries" maxlength="2000">${esc(defaults.boundaries)}</textarea></label>${defaults.rewards.map((r, i) => `<label>冠军奖励${i + 1}<input name="reward${i}" value="${esc(r)}" maxlength="200"></label>`).join("")}<button type="button" class="small-button" data-act="editor">编辑32张卡片</button></details><label class="consent"><input type="checkbox" name="consent" required><span>所有人均为成年人，已认可任务和奖励；随时可暂停、换卡或跳过。</span></label><button type="submit" class="big-button primary">👑 开始棋局</button><button type="button" class="text-button" data-act="home">返回</button></form></div>`;
}
function capture() {
  const f = $("#setup-form");
  if (!f) return;
  const d = new FormData(f);
  for (let i = 0; i < count; i++) {
    setupPlayers[i].name = String(d.get("name" + i) || "");
    setupPlayers[i].role = String(d.get("role" + i) || ROLES[i % 3]);
    setupPlayers[i].color = String(d.get("color" + i) || COLORS[i]);
  }
  defaults = {
    ...defaults,
    host: String(d.get("host") || "女王"),
    orderMode: d.get("orderMode") || "seated",
    goal: Number(d.get("goal") || 30),
    animation: d.has("animation"),
    seconds: Number(d.get("seconds") || 15),
    pauseWord: String(d.get("pauseWord") || "暂停"),
    titles: String(d.get("titles") || ""),
    boundaries: String(d.get("boundaries") || ""),
    rewards: [0, 1, 2].map((i) =>
      String(d.get("reward" + i) || DEFAULTS.rewards[i]),
    ),
  };
}
function board() {
  return `<div class="board" aria-label="30格棋盘，1在右下，30在左上">${BOARD_LAYOUT.flat()
    .map((n) => {
      const c = (g.config.board || BOARD)[n - 1],
        ps = g.players.filter((p) => (positions?.[p.id] ?? p.pos) === n);
      return `<div class="cell ${n === g.config.goal ? "goal" : n > g.config.goal ? "inactive-cell" : ""} ${ps.some((p) => p.id === displayActor()?.id) ? "active-cell" : ""} ${ps.length ? "occupied" : ""}" data-cell="${n}"><span class="cell-number">${n}</span><span class="cell-symbol">${n === g.config.goal ? "♛" : n > g.config.goal ? "—" : ICONS[c.name] || "◇"}</span><span class="cell-name">${n === g.config.goal ? "加冕" : n > g.config.goal ? "未启用" : esc(c.name)}</span><div class="cell-tokens">${ps.map((p) => token(p, "mini")).join("")}</div></div>`;
    })
    .join("")}</div>`;
}
function players() {
  return `<div class="player-strip">${g.players.map((p) => `<button data-act="player" data-id="${p.id}" class="player-chip ${actor()?.id === p.id && p.rank === null ? "active" : ""}" style="--p:${p.color}">${token(p)}<div><strong>${esc(p.name)}</strong><small>${p.rank ? `第${p.rank}名` : `<b>${p.pos}</b>/${g.config.goal}格`}</small></div><span class="chip-tools">${p.shield ? `🛡️${p.shield}` : ""}${p.favor ? ` ✨${p.favor}` : ""}${p.medals ? ` 🎖️${p.medals}` : ""}</span></button>`).join("")}</div>`;
}
function game() {
  if (g.phase === "paused")
    return `<div class="paused"><span>Ⅱ</span><h1>先暂停一下</h1><p>任务和计时已隐藏，不扣分。</p><button class="big-button primary" data-act="resume">继续棋局</button><button class="text-button" data-act="stop">结束这局</button></div>`;
  if (g.phase === "stopped")
    return `<div class="home"><div class="home-crown">♛</div><h1>棋局已结束</h1><p>角色解除，请确认彼此感受。</p><button class="big-button primary" data-act="new">重新开局</button></div>`;
  if (g.phase === "finished") return finished();
  const p = displayActor(),
    n = next();
  return `<div class="game-wrap"><div class="turn-heading"><div><div class="eyebrow">第${g.round}轮 · ${esc(g.config.host)}主持</div><h1>${g.phase === "setup" ? "决定出场顺序" : `${esc(p?.name)}，轮到你了`}</h1></div>${g.lastRoll ? `<div class="last-die">${dice(g.lastRoll.chosen)}<span>上次 <b>${g.lastRoll.chosen}</b>点</span></div>` : ""}</div>${players()}<div class="play-layout"><section class="board-area">${board()}<div class="start-line"><span>起点0</span>${g.players
    .filter((p) => (positions?.[p.id] ?? p.pos) === 0)
    .map((p) => token(p, "mini"))
    .join(
      "",
    )}<span>↑ ↓ 按编号前进</span><b>👑 ${g.config.goal}格加冕</b></div></section><section class="action-area">${g.phase === "turn_start" && !busy ? `<div class="ready-card"><div class="eyebrow">${esc(p.name)} 的回合</div><div class="ready-title">交给他摇，或你来代摇</div><button class="roll-button" data-act="roll"><span class="roll-emoji">🎲</span><strong>摇骰子</strong></button>${p.favor ? '<label class="favor-toggle"><input type="checkbox" id="favor"> 偏爱令 · 本次+1</label>' : ""}<div class="next-turn">接下来：<b>${esc(n?.name || "本人继续")}</b></div></div>` : `<div class="ready-card waiting"><span>${busy ? "🎲" : "📜"}</span><h2>${busy ? "棋局正在推进" : "请处理当前事件"}</h2><p>${busy ? "摇骰 → 走棋 → 落点事件" : "裁定完成后，自动交给下一位。"}</p></div>`}</section></div><div class="host-shortcuts"><button data-act="host">👑 主持工具</button><button data-act="undo" ${busy || !g.history.length ? "disabled" : ""}>↶ 撤销</button>${g.redo ? '<button data-act="redo">恢复结果</button>' : ""}<button data-act="log">☷ 记录</button></div></div>`;
}
function finished() {
  const ps = [...g.players].sort((a, b) => a.rank - b.rank);
  return `<div class="finish"><div class="home-crown">♛</div><div class="eyebrow">今夜的加冕</div><h1>${esc(ps[0].name)} 赢得首席</h1><div class="rank-list">${ps.map((p) => `<div class="rank-row ${p.rank === 1 ? "champion" : ""}"><b>${p.rank === 1 ? "👑" : p.rank}</b>${token(p)}<div><strong>${esc(p.name)}</strong><span>${p.rank === 1 ? "女王首席侍从" : p.rank === 2 ? "荣誉侍从" : p.rank === ps.length ? "待考察侍从" : "宫廷侍从"} · 🎖️${p.medals}${p.funTitle ? " · " + esc(p.funTitle) : ""}</span></div></div>`).join("")}</div><label>冠军自愿选择奖励<select id="champion-reward"><option value="">稍后决定 / 跳过</option>${g.config.rewards.map((r) => `<option ${g.rewardChoices[ps[0].id] === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></label>${ps.length > 1 ? '<button class="small-button" data-act="epiloguePk">末位自愿趣味PK · 不改排名</button>' : ""}<p class="muted">角色解除。请简短确认彼此感受。</p><button class="big-button primary" data-act="new">再开一局</button><button class="text-button" data-act="log">查看本局记录</button></div>`;
}
function modal(body, kind = "") {
  return `<div class="overlay ${kind}"><section class="spotlight ${kind}" role="dialog" aria-modal="true" aria-labelledby="event-title">${body}</section></div>`;
}
function fxView() {
  if (!fx || fx.type === "move") return "";
  const pause =
    '<button class="spot-pause" data-act="pause" aria-label="暂停动画">Ⅱ</button>';
  if (fx.type === "dice")
    return modal(
      `${pause}<div class="eyebrow">${esc(fx.name)} 正在摇骰</div><h2 id="event-title">这一掷，会去哪？</h2><div class="dice-stage rolling">🎲</div>`,
      "dice-spot",
    );
  if (fx.type === "result")
    return modal(
      `${pause}<div class="eyebrow">${esc(fx.name)} 摇到了</div><h2 class="result-number" id="event-title">${fx.value}<small>点</small></h2>${dice(fx.value, true)}<p class="movement-note">${fx.bonus ? `偏爱令+${fx.bonus} · ` : ""}${fx.extra ? "额外机会 · " : ""}前进${fx.extra ? Math.min(fx.value, 3) : fx.value + (fx.bonus || 0)}格</p>`,
      "dice-spot",
    );
  return modal(
    `${pause}<span class="card-category ${fx.card?.[0]}">${fx.card?.[0] === "P" ? "♠ 惩罚" : "✨ 恩宠"}</span><h2 id="event-title">${esc(fx.title)}</h2><p class="task-brief">${esc(fx.text)}</p><div class="auto-status">● 数值自动结算</div>`,
    "card-spot",
  );
}
const btn = (text, act, attrs = "") =>
  `<button class="big-button" data-act="${act}" ${attrs}>${text}</button>`;
function eventView() {
  const e = g?.pending,
    p = actor();
  if (!e || g.phase === "paused") return "";
  let title = "",
    body = "",
    buttons = "";
  if (e.type === "initiative") {
    title = "谁先出场？";
    body = `<p class="task-brief">${e.ids.map((id) => esc(g.players[id].name)).join(" · ")}</p><p class="muted">点数高者先行，同分者重掷。</p>`;
    buttons = btn("🎲 摇出行动顺序", "initiative");
  }
  if (e.type === "roll") {
    title = `${esc(p.name)} 摇到${e.first}点`;
    body = `<div class="roll-options"><div>${dice(e.first, true)}<span>首掷${e.first}</span></div>${e.second ? `<div>${dice(e.second, true)}<span>重掷${e.second}</span></div>` : ""}</div>${e.bonus ? '<p class="movement-note">偏爱令，本次额外+1</p>' : ""}`;
    if (e.second) {
      body += `<p class="muted">${e.source === "compensation" ? "补偿取较优点数。" : "你决定采用哪次点数。"}</p>`;
      buttons =
        btn(
          `用${e.first}点`,
          "chooseRoll",
          `data-which="first" ${e.source === "compensation" && e.first < e.second ? "disabled" : ""}`,
        ) +
        btn(
          `用${e.second}点`,
          "chooseRoll",
          `data-which="second" ${e.source === "compensation" && e.second < e.first ? "disabled" : ""}`,
        );
    } else {
      if (e.compensation)
        buttons += btn(
          "🎲 落后补偿 · 重摇一次",
          "reroll",
          'data-source="compensation"',
        );
      if (e.reward)
        buttons += btn("🎲 用重掷资格", "reroll", 'data-source="reward"');
      buttons += btn(
        `就用${e.first}点，走棋 →`,
        "chooseRoll",
        'data-which="first"',
      );
    }
  }
  if (e.type === "task") {
    const original = CARDS.find((c) => c.id === e.card),
      brief = briefFor(e),
      kind = e.card?.[0];
    title = esc(e.title);
    body = `<span class="card-category ${kind || "C"}">${kind === "R" ? "✨ 恩宠卡" : kind === "P" ? "♠ 惩罚卡" : "📜 女王命令"}</span><div class="event-player">给 ${esc(p.name)}</div>${g.lastRoll ? `<div class="landing-path">🎲 ${g.lastRoll.chosen}点 → 第${p.pos}格</div>` : ""}<p class="task-brief">${esc(brief)}</p>${["C08", "P07", "R05"].includes(e.card) || (!e.card && p.pos === 8) ? '<label>双方接受的称号<input id="task-title" maxlength="40" placeholder="输入称号"></label>' : ""}${brief !== e.text ? `<details class="card-detail"><summary>完整说明</summary><p>${esc(e.text)}</p></details>` : ""}<div class="timer-row"><button class="timer-button" data-act="timer">◷ ${e.seconds}秒提醒</button><span id="timer-value">${timer && timerKey === key() ? seconds : ""}</span><small>可关闭，不自动惩罚</small></div>`;
    buttons =
      btn("完成，下一位 →", "task", 'data-skip="no"') +
      `<div class="secondary-actions"><button data-act="swap" ${!e.card || e.swaps >= 2 || NUMERIC_CARDS.includes(e.card) ? "disabled" : ""}>↻ 换一张${e.swaps ? ` (${e.swaps}/2)` : ""}</button><button data-act="task" data-skip="yes">跳过</button></div>`;
    if (NUMERIC_CARDS.includes(e.card))
      buttons = btn("继续自动结算 →", "settle");
  }
  if (e.type === "shield") {
    title = "要用护盾吗？";
    body = `<div class="shield-icon">🛡️</div><div class="event-player">${esc(g.players[e.id].name)} · 持有${g.players[e.id].shield}枚</div><p class="task-brief">即将后退 <b>${e.amount}</b> 格</p>`;
    buttons =
      btn("🛡️ 用一枚，留在原位", "shield", 'data-use="yes"') +
      btn("保留护盾，后退", "shield", 'data-use="no"');
  }
  if (e.type === "pkChoose") {
    title = "和谁争宠？";
    body = '<p class="muted">你选择一名对手，各摇一次。</p>';
    buttons = e.options
      .map((id) =>
        btn(
          `${esc(g.players[id].name)} · ${g.players[id].pos}格`,
          "pkChoose",
          `data-id="${id}"`,
        ),
      )
      .join("");
  }
  if (["pk", "pkResult", "epiloguePk"].includes(e.type)) {
    title = e.type === "epiloguePk" ? "终局趣味PK" : "骰子争宠";
    body = `<div class="versus"><div>${token(g.players[e.a], "big")}<b>${esc(g.players[e.a].name)}</b>${e.values[e.a] ? dice(e.values[e.a], true) : ""}</div><span>VS</span><div>${token(g.players[e.b], "big")}<b>${esc(g.players[e.b].name)}</b>${e.values[e.b] ? dice(e.values[e.b], true) : ""}</div></div>`;
    if (e.type === "pkResult") {
      body += `<p class="task-brief">${esc(g.players[e.winner].name)} 胜出，前进2格</p>`;
      buttons = btn("确认结果 →", "pkConfirm");
    } else if (e.type === "epiloguePk" && e.winner !== undefined) {
      body += `<p class="task-brief">${esc(g.players[e.winner].name)} 赢得趣味称号</p><label>认可的称号<input id="fun-title" value="幸运侍从" maxlength="40"></label>`;
      buttons = btn("确认称号", "epilogueConfirm");
    } else {
      body += `<p class="muted">${e.tie || Object.keys(e.values).length ? "同点，重摇一次。" : "高点胜出，" + (e.type === "epiloguePk" ? "不改排名。" : "前进2格。")}</p>`;
      buttons = btn(
        "🎲 双方摇骰",
        e.type === "epiloguePk" ? "epilogueRoll" : "pkRoll",
      );
    }
    if (e.type === "epiloguePk")
      buttons +=
        '<button class="text-button" data-act="epilogueSkip">无责跳过</button>';
  }
  if (e.type === "challenge") {
    title = "御前争宠";
    body = `<span class="card-category R">👑 ${e.source === "round" ? `第${g.round}轮挑战` : "共同挑战"}</span><p class="task-brief">${esc(e.text)}</p><p class="muted">按下面顺序表演，你来裁定，允许并列。</p><div class="challenge-players">${e.ids.map((id) => `<label>${token(g.players[id])}<b>${esc(g.players[id].name)}</b><select data-rank="${id}" aria-label="${esc(g.players[id].name)}本次名次"><option value="">名次</option>${e.ids.map((_, i) => `<option value="${i + 1}">第${i + 1} · +${e.ids.length === 2 ? (i === 0 ? 2 : 0) : i === 0 ? 2 : i === 1 ? 1 : 0}格</option>`).join("")}</select></label>`).join("")}</div>`;
    buttons =
      btn("确认裁定 →", "challenge") +
      '<button class="text-button" data-act="challengeSkip">跳过这次挑战</button>';
  }
  if (e.type === "finishTie") {
    title = "同时抵达，决胜加冕";
    body =
      '<p class="task-brief">先比勋章，再摇骰决定顺序。</p>' +
      e.groups
        .slice(e.index)
        .map(
          (ids) =>
            `<p class="muted">${ids.map((id) => esc(g.players[id].name)).join(" · ")}</p>`,
        )
        .join("");
    buttons = btn("🎲 摇骰决胜", "tieRoll");
  }
  return modal(
    `<div class="spot-top"><span class="eyebrow">${e.type === "task" ? `落点${p.pos} · ${(g.config.board || BOARD)[p.pos - 1]?.name || "角色任务"}` : "女王的现场裁定"}</span><div class="spot-tools">${g.history.length && !busy ? '<button class="spot-pause" data-act="undo" aria-label="撤销上一操作">↶</button>' : ""}${g.phase !== "finished" ? '<button class="spot-pause" data-act="pause" aria-label="暂停棋局">Ⅱ</button>' : ""}</div></div><h2 id="event-title">${title}</h2>${body}<div class="event-actions">${buttons}</div>`,
    "card-spot",
  );
}
function briefFor(e) {
  if (g.players.length === 1) {
    const single = {
      C07: "向女王说一句争宠宣言。",
      C10: "说出自己的一个优点和本局优势。",
      P05: "演10秒期待女王认可的反应。",
      P08: "说出自己这局的小目标和理由。",
      R10: "没有未完赛对手，前进1格。",
    };
    if (single[e.card]) return single[e.card];
  }
  return e.card && e.text === CARDS.find((c) => c.id === e.card)?.text
    ? BRIEFS[e.card]
    : e.text;
}
const key = () =>
  `${g?.gameId}:${g?.turnIndex}:${g?.pending?.card}:${g?.pending?.swaps}`;
function drawer() {
  let title = "",
    body = "";
  if (panel === "menu") {
    title = "棋局菜单";
    body = `<div class="menu-list"><button data-act="continue" ${g ? "" : "disabled"}>返回棋局</button><button data-act="new">重新配置一局</button><button data-act="editor">编辑默认卡片</button><button data-act="rules">查看规则</button><button data-act="export" ${g ? "" : "disabled"}>导出备份</button><button data-act="storage">存档说明</button></div>`;
  }
  if (panel === "storage") {
    title = "进度保存在这个浏览器";
    body =
      "<p>网站已经上线，打开就能玩。</p><p>刷新后可以继续；换手机、换浏览器或清除数据，进度不会同步。此版没有接入登录与云存档。</p>" +
      btn("导出当前棋局", "export", g ? "" : "disabled");
  }
  if (panel === "log") {
    title = "御前记录";
    body = `<div class="logs">${g.log
      .slice()
      .reverse()
      .map((l) => `<div>${esc(l.text)}</div>`)
      .join("")}</div>`;
  }
  if (panel === "rules") {
    title = "一分钟看懂";
    body =
      '<div class="rule-cards"><p>🎲 轮流摇骰，先到终点先加冕，其余人继续。</p><p>📜 落点触发卡片，你来完成、换卡或跳过。</p><p>⚔️ 同格先PK，胜者+2；追加位移不再抽卡。</p><p>🛡️ 护盾抵消后退；偏爱令换本次+1或角色互动。</p><p>👑 争宠由你裁定，可并列。2人+2/0；3—6人+2/+1，其余0。</p><p>Ⅱ 随时暂停，无责结束；计时不自动惩罚。</p><p>人数1—6，一人时不触发对手PK和共同挑战。</p></div><details><summary>本局认可范围</summary><p>' +
      esc(g?.config.boundaries || defaults.boundaries) +
      "</p></details>";
  }
  if (panel === "host") {
    title = "女王的主持台";
    body = `<div class="eyebrow">偏爱令剩余 ${g.favorRemaining}/3</div><div class="host-players">${g.players
      .filter((p) => p.rank === null)
      .map(
        (p) =>
          `<section>${token(p)}<b>${esc(p.name)}</b><button data-act="award" data-id="${p.id}" ${g.favorRemaining ? "" : "disabled"}>✨ 颁发</button>${p.favor ? `<button data-act="interaction" data-id="${p.id}">15秒互动</button>` : ""}</section>`,
      )
      .join(
        "",
      )}</div>${btn("👑 发起争宠挑战", "hostChallenge", g.phase === "turn_start" ? "" : "disabled")}<details><summary>调整位置</summary><form id="adjust-form"><label>参与者<select name="id">${g.players
      .filter((p) => p.rank === null)
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join(
        "",
      )}</select></label><label>新位置<input name="pos" type="number" min="0" max="${g.config.goal}" required></label><label>原因<input name="reason" maxlength="100" required></label><button type="submit" class="big-button" ${g.phase === "turn_start" ? "" : "disabled"}>确认调整</button></form></details><button class="text-button" data-act="stop">安全结束这局</button>`;
  }
  if (typeof panel === "object" && panel?.player !== undefined) {
    const p = g.players[panel.player];
    title = esc(p.name);
    body = `<div class="player-detail">${token(p, "big")}<strong>${p.pos}<small>/${g.config.goal}格</small></strong></div><div class="detail-stats"><span>🛡️ 护盾 <b>${p.shield}</b></span><span>✨ 偏爱令 <b>${p.favor}</b></span><span>🎖️ 勋章 <b>${p.medals}</b></span><span>重掷 <b>${p.reroll ? "可用" : "无"}</b></span><span>补偿 <b>${p.compensation ? "已用" : "未用"}</b></span><span>角色 <b>${esc(p.role)}</b></span></div><p>${esc(p.temporary?.text || p.title || "")}</p>`;
  }
  if (panel === "editor") {
    title = "你的卡片";
    body = `<p class="muted">只影响下一局。数值效果不随文字改变。</p><form id="editor-form">${defaults.cards.map((c) => `<details class="edit-card"><summary>${c.id[0] === "R" ? "✨" : c.id[0] === "P" ? "♠" : "📜"} ${esc(c.name)} ${c.enabled ? "" : "· 已禁用"}</summary><label><input type="checkbox" name="enabled_${c.id}" ${c.enabled ? "checked" : ""}> 启用</label><label>卡名<input name="name_${c.id}" value="${esc(c.name)}" maxlength="100" required></label><label>任务<textarea name="text_${c.id}" maxlength="2000" required>${esc(c.text)}</textarea></label><label>提醒秒数<input name="seconds_${c.id}" type="number" min="5" max="300" value="${c.seconds || defaults.seconds}"></label></details>`).join("")}<button class="big-button primary" type="submit">保存默认卡片</button><button class="text-button" type="button" data-act="resetCards">恢复原始卡池</button></form>`;
  }
  return modal(
    `<button class="close" data-act="close" aria-label="关闭">×</button><h2 id="event-title">${title}</h2>${body}`,
    "drawer",
  );
}
function render() {
  const body =
    screen === "home" ? home() : screen === "setup" ? setup() : game();
  const overlay = panel
    ? drawer()
    : fx
      ? fxView()
      : screen === "game" && g && g.phase !== "paused"
        ? eventView()
        : "";
  $("#app").innerHTML = header() + `<main>${body}</main>` + overlay;
  $(".overlay button:not(:disabled),.overlay input")?.focus({
    preventScroll: true,
  });
}
async function walk(before, signal) {
  const changes = g.players.filter((p) => p.pos !== before.players[p.id].pos);
  if (!changes.length) return;
  positions = Object.fromEntries(before.players.map((p) => [p.id, p.pos]));
  fx = { type: "move" };
  render();
  const max = Math.max(
    ...changes.map((p) => Math.abs(p.pos - positions[p.id])),
  );
  for (let i = 0; i < max; i++) {
    for (const p of changes)
      if (positions[p.id] !== p.pos)
        positions[p.id] += Math.sign(p.pos - positions[p.id]);
    render();
    await delay(motion() ? 100 : 0, signal);
  }
  positions = null;
  fx = null;
  render();
}
async function numeric(signal) {
  let n = 0;
  while (
    g.pending?.type === "task" &&
    NUMERIC_CARDS.includes(g.pending.card) &&
    n++ < 6
  ) {
    const e = copy(g.pending);
    fx = { type: "numeric", title: e.title, text: briefFor(e), card: e.card };
    render();
    await delay(motion() ? 1150 : 350, signal);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const before = copy(g);
    step({ type: "task" });
    if (e.card === "R07") {
      fx = { type: "dice", name: before.players[g.lastExtraRoll.id].name };
      render();
      await delay(motion() ? 500 : 0, signal);
      fx = {
        type: "result",
        name: before.players[g.lastExtraRoll.id].name,
        value: g.lastExtraRoll.value,
        bonus: 0,
        extra: true,
      };
      render();
      await delay(motion() ? 950 : 500, signal);
    }
    fx = null;
    await walk(before, signal);
  }
}
async function animate(a, rolling = false) {
  if (busy) return;
  busy = true;
  clearTimer();
  controller = new AbortController();
  const signal = controller.signal;
  try {
    const before = copy(g),
      name = actor()?.name;
    animationActor = actor()?.id ?? null;
    step(a);
    if (rolling) {
      const e = g.pending;
      fx = { type: "dice", name };
      render();
      await delay(motion() ? 650 : 0, signal);
      fx = {
        type: "result",
        name,
        value: a.type === "reroll" ? e.second : e.first,
        bonus: e.bonus || 0,
      };
      render();
      await delay(motion() ? 950 : 500, signal);
      fx = null;
      if (a.type === "roll" && !e.compensation && !e.reward) {
        const rollBefore = copy(g);
        step({ type: "chooseRoll", which: "first" });
        await walk(rollBefore, signal);
      }
    } else await walk(before, signal);
    await numeric(signal);
  } catch (e) {
    if (e.name !== "AbortError") toast(e.message);
  } finally {
    if (controller?.signal === signal) {
      busy = false;
      controller = null;
      fx = null;
      positions = null;
      render();
    }
  }
}
async function act(type, el) {
  if (type === "pause") {
    cancel();
    clearTimer();
    panel = null;
    step({ type: "pause" });
    render();
    return;
  }
  if (type === "resume") {
    step({ type: "resume" });
    render();
    return;
  }
  if (type === "stop") {
    cancel();
    clearTimer();
    step({ type: "stop" });
    panel = null;
    render();
    return;
  }
  if (busy) {
    toast("正在走棋，请稍等");
    return;
  }
  if (type === "home") {
    clearTimer();
    screen = "home";
    panel = null;
    render();
    return;
  }
  if (type === "new") {
    clearTimer();
    prepare();
    screen = "setup";
    panel = null;
    render();
    return;
  }
  if (type === "continue") {
    screen = "game";
    panel = null;
    render();
    return;
  }
  if (type === "close") {
    panel = null;
    render();
    return;
  }
  if (["menu", "storage", "log", "rules", "host", "editor"].includes(type)) {
    if (screen === "setup") capture();
    panel = type;
    render();
    return;
  }
  if (type === "player") {
    panel = { player: Number(el.dataset.id) };
    render();
    return;
  }
  if (type === "count") {
    capture();
    count = Math.max(1, Math.min(6, count + Number(el.dataset.delta)));
    render();
    return;
  }
  if (type === "resetCards") {
    defaults.cards = copy(CARDS);
    render();
    return;
  }
  if (type === "export") {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify({ state: g, settings: defaults }, null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "女王棋局备份.json";
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (type === "timer") {
    if (timer) {
      clearTimer();
      $("#timer-value").textContent = "已关闭";
      return;
    }
    seconds = g.pending.seconds;
    timerKey = key();
    $("#timer-value").textContent = seconds;
    timer = setInterval(() => {
      seconds--;
      const e = $("#timer-value");
      if (e) e.textContent = seconds > 0 ? seconds : "时间到 · 由你确认";
      if (seconds <= 0) clearTimer();
    }, 1000);
    return;
  }
  if (type === "roll") {
    await animate({ type: "roll", favor: $("#favor")?.checked || false }, true);
    return;
  }
  if (type === "reroll") {
    await animate({ type: "reroll", source: el.dataset.source }, true);
    return;
  }
  if (type === "settle") {
    busy = true;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      await numeric(signal);
    } catch (e) {
      if (e.name !== "AbortError") toast(e.message);
    } finally {
      if (controller?.signal === signal) {
        busy = false;
        controller = null;
        fx = null;
        positions = null;
        render();
      }
    }
    return;
  }
  const a = { type };
  if (el.dataset.id !== undefined) a.id = Number(el.dataset.id);
  if (type === "chooseRoll") a.which = el.dataset.which;
  if (type === "task") {
    a.skip = el.dataset.skip === "yes";
    a.title = $("#task-title")?.value;
  }
  if (type === "shield") a.use = el.dataset.use === "yes";
  if (type === "challenge") {
    a.ranks = {};
    document
      .querySelectorAll("[data-rank]")
      .forEach((s) => (a.ranks[s.dataset.rank] = Number(s.value)));
  }
  if (type === "challengeSkip") {
    a.type = "challenge";
    a.skip = true;
  }
  if (type === "epilogueConfirm") a.title = $("#fun-title")?.value;
  if (type === "epilogueSkip") {
    a.type = "epilogueConfirm";
    a.skip = true;
  }
  panel = null;
  await animate(a);
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (el && !el.disabled)
    act(el.dataset.act, el).catch((e) => toast(e.message));
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target,
    d = new FormData(f);
  try {
    if (busy) throw Error("请等待当前动作结束");
    if (f.id === "setup-form") {
      capture();
      const c = {
        ...copy(defaults),
        players: setupPlayers
          .slice(0, count)
          .map((p) => ({ ...p, name: p.name.trim() })),
        startBonus: null,
      };
      g = createGame(c);
      defaults.players = copy(c.players);
      settingsSave();
      save();
      screen = "game";
      panel = null;
      render();
    }
    if (f.id === "editor-form") {
      defaults.cards = defaults.cards.map((c) => ({
        ...c,
        name: String(d.get("name_" + c.id)),
        text: String(d.get("text_" + c.id)),
        seconds: Number(d.get("seconds_" + c.id)),
        enabled: d.has("enabled_" + c.id),
      }));
      settingsSave();
      panel = null;
      render();
      toast("已保存，下局生效");
    }
    if (f.id === "adjust-form") {
      panel = null;
      await animate({
        type: "adjust",
        id: Number(d.get("id")),
        pos: Number(d.get("pos")),
        reason: String(d.get("reason")),
      });
    }
  } catch (e) {
    toast(e.message);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "champion-reward") {
    step({
      type: "rewardChoice",
      id: g.players.find((p) => p.rank === 1).id,
      choice: e.target.value,
    });
    render();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (panel) {
      panel = null;
      render();
    } else if (
      screen === "game" &&
      g &&
      !["paused", "finished", "stopped"].includes(g.phase)
    )
      act("pause");
  }
  if (e.key === "Tab" && $(".overlay")) {
    const els = [
      ...$(".overlay").querySelectorAll(
        "button:not(:disabled),input,select,textarea,summary",
      ),
    ];
    if (e.shiftKey && document.activeElement === els[0]) {
      e.preventDefault();
      els.at(-1)?.focus();
    } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
      e.preventDefault();
      els[0]?.focus();
    }
  }
});
render();
