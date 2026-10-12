import { BOARD, CARDS, DEFAULTS } from "./data.js";
import {
  createGame,
  dispatch,
  current,
  copy,
  validate,
  NUMERIC_CARDS,
  BOARD_LAYOUT,
} from "./engine.js";
import { Cloud } from "./cloud.js";
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
let cloud = new Cloud(
    await fetch("./config.json")
      .then((r) => r.json())
      .catch(() => ({})),
  ),
  g = null,
  settings = copy(DEFAULTS),
  page = "home",
  dialog = null,
  status = "",
  busy = false,
  saveQueue = Promise.resolve(),
  saveError = false,
  localOwner = "demo",
  timer = null,
  count = 0;
function storageKey() {
  return "queen-game-" + localOwner;
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").style.display = "block";
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => ($("#toast").style.display = "none"), 4500);
}
function readLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey()) || "null");
    if (data) {
      validate(data.state || data);
      if (data.state) {
        cloud.revision = data.cloudRevision || 0;
        return data.state;
      }
      return data;
    }
  } catch {
    toast("本机备份格式不兼容，未加载");
  }
  return null;
}
function cache() {
  if (!g) return;
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({ state: g, cloudRevision: cloud.revision }),
    );
  } catch {
    toast("本机存储空间不足，请导出备份");
  }
}
function save() {
  cache();
  if (!cloud.user) {
    status = "仅本机备份 · 未接入云端存档";
    renderStatus();
    return;
  }
  status = "正在保存至云端…";
  renderStatus();
  const snapshot = copy(g);
  saveQueue = saveQueue.then(async () => {
    try {
      if (saveError) throw Error("上次保存失败，请重试或加载云端版本");
      const result = await cloud.save(snapshot);
      status = "云端已保存 · 版本 " + result.revision;
      saveError = false;
      cache();
    } catch (e) {
      saveError = true;
      status = "云端保存失败 · 本机副本已保留";
      if (/revision_conflict|device_busy/.test(e.message)) cloud.locked = true;
      toast(e.message);
    }
    renderStatus();
  });
}
function renderStatus() {
  const el = $("#save-status");
  if (el) el.textContent = status;
}
function run(action) {
  if (busy || cloud.locked) {
    toast(cloud.locked ? "控制权已失效，请加载云端棋局" : "操作处理中");
    return;
  }
  try {
    g = dispatch(g, action);
    clearInterval(timer);
    timer = null;
    save();
    render();
  } catch (e) {
    toast(e.message);
  }
}
async function loadCloud() {
  await saveQueue;
  const row = await cloud.load();
  if (!row) {
    toast("云端尚无棋局，可新建或保存当前试玩棋局");
    return;
  }
  validate(row.state);
  await cloud.acquire(row.game_id);
  g = row.state;
  cloud.revision = row.revision;
  saveError = false;
  page = "game";
  status = "已加载云端 · 版本 " + row.revision;
  cache();
  render();
}
function header() {
  return `<header class="top"><div class="brand"><span class="crown">♛</span>女王争宠棋 <span class="eyebrow">THE ROYAL COURT</span></div><div class="top-actions"><span class="muted">${cloud.user ? esc(cloud.user.email) : "主持人 · 本机试玩"}</span>${cloud.user ? '<button data-act="loadCloud">加载云端</button><button data-act="logout">退出登录</button>' : `<button data-act="login" ${cloud.configured ? "" : "disabled"}>${cloud.configured ? "主持人登录" : "云端尚未配置"}</button>`}<button class="quiet" data-act="home">个人主页</button></div></header>`;
}
function banner() {
  return `<div class="banner" id="save-status">${esc(status || (!cloud.configured ? "仅本机试玩：真实登录与跨设备云端存档尚未配置。" : "尚未登录 · 本机试玩，登录后才可保存至云端。"))}</div>`;
}
function home() {
  return `<div class="hero"><section><div class="eyebrow">一位女王 · 三位侍从 · 一场公平角逐</div><h1>今夜，谁将赢得<br>女王的偏爱？</h1><p>骰子决定运气，表演赢得认可。沿三十格宫廷之路前行，争取首席侍从的加冕。</p><div class="actions"><button class="primary" data-act="setup">♛ 布置新棋局</button>${g ? '<button data-act="continue">继续最近棋局 →</button>' : ""}</div><p class="muted">四人同场共用一台设备。角色只影响风格，不改变数值。<br>所有任务均可无责替换或跳过，暂停永远优先。</p></section><section class="hero-art"><div class="eyebrow">御前之局</div><div class="serif">命令、争宠与加冕</div><hr><div class="tokens">${DEFAULTS.players.map((p, i) => token(p, i)).join("")}</div><p>30 格 / 3 位竞赛者 / 32 张任务卡</p><span class="muted" style="color:#d0b8a2">酒红宫廷 · 暖金恩宠 · 公平起点</span></section></div><div class="grid3"><section class="panel"><h3>♧ 自己的卡池</h3><p class="muted">改写任务、禁用卡片、设置表演时长。修改作为下局默认设置，进行中的规则保持开局快照。</p><button data-act="editor">编辑默认任务池</button></section><section class="panel"><h3>♜ 随时暂停</h3><p class="muted">协商边界与暂停词。没有超时自动惩罚，没有服从分，也没有现实关系排名。</p><button data-act="rules">阅读游戏规则</button></section><section class="panel"><h3>☁ 跨设备继续</h3><p class="muted">${cloud.configured ? "登录后云端保存待结算事件、牌序、道具和排名。单设备控制，旧版本不会覆盖新状态。" : "需要真实 Supabase 认证与数据库配置。当前仅保存本机备份，不具备跨设备同步。"}</p><button data-act="export" ${g ? "" : "disabled"}>导出棋局备份</button></section></div>`;
}
function token(p, i = p.id) {
  return `<span class="token" style="--player:${esc(p.color)}" title="${esc(p.name)}">${i + 1}</span>`;
}
function setup() {
  return `<div class="game-head"><div><div class="eyebrow">PREPARE THE COURT</div><h1>布置御前棋局</h1></div><button data-act="editor">编辑默认卡池</button></div><form id="setup-form"><div class="setup-grid"><div class="panel"><h2>女王与三位侍从</h2><label>主持人称呼<input name="host" value="${esc(settings.host)}" maxlength="40" required></label><div class="grid3">${settings.players.map((p, i) => `<section><h3>侍从 ${i + 1}</h3><label>昵称<input name="name${i}" value="${esc(p.name)}" maxlength="40" required></label><label>角色<select name="role${i}">${["忠诚派", "嘴硬派", "争宠派"].map((r) => `<option ${p.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></label><label>棋子颜色<input name="color${i}" type="color" value="${esc(p.color)}"></label></section>`).join("")}</div><p class="muted">三人各掷一次决定先后，同分者重掷。角色不会改变棋格或数值。</p><label>棋局长度<select name="goal"><option value="30" ${settings.goal === 30 ? "selected" : ""}>默认 30格 · 完整棋盘</option><option value="20" ${settings.goal === 20 ? "selected" : ""}>短局 20格 · 抵达20直接完赛</option></select></label>${g?.phase === "finished" ? `<div class="notice"><label><input name="bonusConsent" type="checkbox"> 下局三名玩家已共同同意，上局亚军使用+2起点奖励（默认不勾选）</label><label>奖励使用者<select name="bonusPlayer">${settings.players.map((p, i) => `<option value="${i}" ${g.players.find((x) => x.rank === 2)?.name === p.name ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label></div>` : ""}<label>默认表演秒数<input name="seconds" type="number" min="5" max="300" value="${settings.seconds}"></label><label><input name="animation" type="checkbox" ${settings.animation ? "checked" : ""}> 启用简短骰子动画（可关闭）</label><details><summary>默认数值规则</summary><p class="muted">护盾初始1、上限2；PK胜者+2；追加位移不触发事件；第3/6轮挑战；三人争宠+2/+1/0、两人+2/0；偏爱令共3张；补偿整局每人一次。此版可选20格短局，其余数值改动需修改独立规则引擎，进行中不能更改。</p></details></div><div class="panel"><h2>先确认彼此的边界</h2><label>可接受的角色任务<textarea name="boundaries" maxlength="2000" required>${esc(settings.boundaries)}</textarea></label><label>可接受称号<input name="titles" value="${esc(settings.titles)}" maxlength="500"></label><label>暂停词<input name="pauseWord" value="${esc(settings.pauseWord)}" maxlength="40" required></label><h3>冠军三选一奖励</h3>${settings.rewards.map((r, i) => `<label>奖励 ${i + 1}<input name="reward${i}" value="${esc(r)}" maxlength="300" required></label>`).join("")}<label><input name="adult" type="checkbox" required> 四人均为成年人，已共同确认任务与奖励边界。</label><label><input name="consent" type="checkbox" required> 可随时暂停、换卡、跳过；无责退出，无自动扣分。</label><p class="notice">当前启用 ${settings.cards.filter((c) => c.enabled).length}/32 张卡。卡片和规则将作为本局快照保存；后续编辑不会悄然改变这局。</p><button class="primary" type="submit">确认边界，抽签开局 →</button></div></div></form>`;
}
function board() {
  const cells = [];
  for (let row = 0; row < 6; row++) {
    const nums = BOARD_LAYOUT[row];
    for (const n of nums) {
      const c = (g.config.board || BOARD)[n - 1],
        ps = g.players.filter((p) => p.pos === n);
      cells.push(
        `<div class="cell ${[6, 12, 15, 16, 23, 27].includes(n) ? "special" : ""} ${n === g.config.goal ? "finish" : ""} ${current(g)?.pos === n ? "current" : ""}" title="${esc(c.text)}"><small>${String(n).padStart(2, "0")}</small><span class="icon">${n === g.config.goal ? "♛" : c.name === "惩罚" ? "♠" : c.name === "恩宠" ? "✧" : c.name === "飞行" ? "↗" : c.name === "夺宠" ? "⚔" : c.name === "御前争宠" ? "♛" : "◇"}</span><span class="cell-title">${n === g.config.goal ? "加冕" : esc(c.name)}</span><div class="tokens">${ps.map((p) => token(p)).join("")}</div></div>`,
      );
    }
  }
  return `<div class="board" aria-label="从右下角1至左上角30的蛇形棋盘">${cells.join("")}</div><div class="start"><span>起点 0</span>${g.players
    .filter((p) => p.pos === 0)
    .map((p) => token(p))
    .join(
      "",
    )}<span class="muted">右下角1入场，按列蛇形前行 ↑↓，至左上角30</span></div>`;
}
function player(p) {
  return `<section class="panel player ${current(g)?.id === p.id && p.rank === null ? "acting" : ""}" style="--player:${esc(p.color)}"><div class="player-name">${token(p)}${esc(p.name)}${p.rank ? `<span class="badge">第${p.rank}名</span>` : ""}</div><span class="muted">${esc(p.role)} · ${p.pos}/${g.config.goal}格</span><div class="stats"><span>护盾<b>${p.shield}</b></span><span>偏爱令<b>${p.favor}</b></span><span>勋章<b>${p.medals}</b></span><span>重掷<b>${p.reroll ? "可用" : "—"}</b></span><span>补偿<b>${p.compensation ? "已用" : "未用"}</b></span><span>常规回合<b>${p.turns}</b></span></div>${p.temporary || p.title ? `<div class="title">♛ ${esc(p.temporary?.text || p.title)}${p.temporary ? " · 临时" : ""}</div>` : ""}</section>`;
}
function game() {
  if (!g) return home();
  if (g.phase === "finished") return finished();
  if (g.phase === "stopped")
    return `<section class="panel"><h1>棋局已安全结束</h1><p>角色解除。没有因停止而扣分，未完赛者不强制排名。请简短确认彼此感受。</p><button class="primary" data-act="setup">重新配置下一局</button></section>`;
  return `<div class="game-head"><div><div class="eyebrow">${esc(g.config.host)} 的御前之局</div><h1>争宠之路</h1></div><div class="actions"><span class="badge">第 ${g.round} 轮</span><button data-act="rules">规则</button><button data-act="host">主持面板</button><button data-act="pause" class="danger">Ⅱ 暂停</button></div></div><div class="game-layout"><section>${board()}<div class="panel turnbar"><div><div class="eyebrow">当前行动</div><h3>${esc(current(g)?.name || "抽签决定先手")}</h3><span class="muted">${g.phase === "turn_start" ? "常规回合 · 请掷骰" : g.phase === "setup" ? "三人掷骰，决定固定顺序" : "等待当前事件结算"}</span></div><div class="actions">${g.lastRoll ? `<div class="die">${g.lastRoll.chosen}</div>` : ""}${g.phase === "turn_start" ? `<label class="muted"><input id="use-favor" type="checkbox" ${current(g)?.favor ? "" : "disabled"}> 使用偏爱令 +1</label><button class="primary" data-act="roll" ${cloud.locked ? "disabled" : ""}>⚄ 掷骰前进</button>` : '<button class="primary" data-act="event">查看待结算事件</button>'}</div></div><div class="panel" style="margin-top:16px"><div class="actions"><h3 style="margin:0;margin-right:auto">御前记录</h3><button class="compact" data-act="undo" ${g.history.length ? "" : "disabled"}>↶ 撤销</button>${g.redo ? '<button class="compact" data-act="redo">恢复原结果</button>' : ""}<button class="compact" data-act="export">导出</button>${cloud.user ? '<button class="compact" data-act="retry">重试云端保存</button>' : ""}</div><div class="log">${
    g.log
      .slice(-80)
      .reverse()
      .map((l) => `<div>${esc(l.text)}</div>`)
      .join("") || "<div>棋局尚未开始。</div>"
  }</div></div></section><aside class="players">${g.players.map(player).join("")}<section class="panel"><div class="eyebrow">主持提醒</div><p class="muted">暂停词：${esc(g.config.pauseWord)}<br>偏爱令余量：${g.favorRemaining}/3<br>角色只决定表演风格。任务可替换、可跳过，不强制完成。</p><button class="compact" data-act="boundaries">查看开局认可清单</button></section></aside></div>`;
}
function finished() {
  const ranks = [...g.players].sort((a, b) => a.rank - b.rank);
  return `<div class="eyebrow">THE CORONATION</div><h1>今夜的加冕</h1><p>角色已解除。请彼此确认感受，感谢每位参与者。</p><div class="panel">${ranks.map((p) => `<div class="rank-row"><div class="rank-number">${p.rank}</div><div><h2>${esc(p.name)} · ${["女王首席侍从", "荣誉侍从", "待考察侍从"][p.rank - 1]}</h2><div class="muted">荣誉勋章 ${p.medals} · ${esc(p.funTitle || p.title || "期待下次觐见")}</div><label>自愿选择终局奖励<select data-reward="${p.id}"><option value="">请选择或跳过</option>${(p.rank === 1 ? g.config.rewards : p.rank === 2 ? ["专属评语", "下局+2格（仅当下局三人重新同意）"] : ["自愿落选感言", "与冠军骰子PK争取趣味称号（不改排名）", "跳过"]).map((r) => `<option ${g.rewardChoices[p.id] === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></label>${p.rank === 3 ? '<button data-act="epiloguePk">自愿骰子PK · 趣味称号</button>' : ""}</div></div>`).join("")}</div><div class="actions" style="margin-top:22px"><button class="primary" data-act="setup">重新配置下一局</button><button data-act="export">导出本局记录</button></div>`;
}
function modal(content, wide = false) {
  return `<div class="modal-wrap"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title">${content}</section></div>`;
}
function event() {
  const ev = g.pending;
  if (g.phase === "paused")
    return modal(
      `<div class="pause"><span class="crown">♛</span><h2 id="dialog-title">棋局已暂停</h2><p>所有任务与倒计时已隐藏。<br>暂停不扣分，先照顾彼此的感受。</p><div class="actions"><button class="primary" data-act="resume">继续棋局</button><button class="danger" data-act="stop">安全结束</button></div></div>`,
    );
  if (!ev) return "";
  const buttons = (text, act, attrs = "") =>
    `<button data-act="${act}" ${attrs}>${text}</button>`;
  let title = "",
    body = "",
    actions = "";
  if (ev.type === "initiative") {
    title = "抽签决定行动次序";
    body = `<p>点数高者先行，同分者单独重掷。${ev.groups ? "本次仅重掷同分组。" : ""}</p><p>${ev.ids.map((id) => esc(g.players[id].name)).join(" · ")}</p>`;
    actions = buttons("⚄ 掷顺序骰", "initiative", 'class="primary"');
  }
  if (ev.type === "roll") {
    title = `${esc(current(g).name)} 的常规掷骰`;
    body = `<div class="dice-row"><div><span class="muted">首掷</span><div class="die">${ev.first}</div></div>${ev.second ? `<div><span class="muted">重掷</span><div class="die">${ev.second}</div></div>` : ""}</div><p class="muted">${ev.bonus ? "偏爱令已消耗，本次+1。" : ""}${ev.source === "compensation" ? "落后补偿取较优值。" : "可保留首掷，奖励重掷两值任选。"}重掷资格不可叠加。</p>`;
    if (!ev.second) {
      if (ev.compensation)
        actions += buttons(
          "用一次落后补偿重掷",
          "reroll",
          'data-source="compensation"',
        );
      if (ev.reward)
        actions += buttons("用奖励资格重掷", "reroll", 'data-source="reward"');
    }
    actions += buttons(
      `采用首掷 ${ev.first}`,
      "chooseRoll",
      `data-which="first" class="primary" ${ev.source === "compensation" && ev.second > ev.first ? "disabled" : ""}`,
    );
    if (ev.second)
      actions += buttons(
        `采用重掷 ${ev.second}`,
        "chooseRoll",
        `data-which="second" ${ev.source === "compensation" && ev.first > ev.second ? "disabled" : ""}`,
      );
  }
  if (ev.type === "task") {
    title = esc(ev.title);
    const numeric = NUMERIC_CARDS.includes(ev.card);
    body = `${ev.card ? `<span class="badge">${ev.card} · ${numeric ? "纯数值事件" : "角色任务"}</span>` : ""}<p>${esc(ev.text)}</p><div class="notice">${numeric ? "数值部分正常结算，不能通过跳过改成奖励。" : "主持确认即可。拒绝或跳过不损失棋格、道具或评分资格。"}</div>${["C08", "P07", "R05"].includes(ev.card) || (!ev.card && current(g).pos === 8) ? `<label>双方接受的称号<input id="task-title" placeholder="${esc(g.config.titles)}" maxlength="40"></label>` : ""}${!numeric ? `<div class="actions"><button class="compact" data-act="timer">开启 / 关闭 ${ev.seconds} 秒提醒</button><span class="timer" id="timer"></span></div><p class="muted">倒计时只提醒，不会自动扣分或结算。</p>` : ""}`;
    actions = buttons(
      numeric ? "确认数值结算" : "完成任务",
      "task",
      'class="primary"',
    );
    if (!numeric) {
      actions += buttons(
        `换卡 (${ev.swaps}/2)`,
        "swap",
        !ev.card || ev.swaps >= 2 ? "disabled" : "",
      );
      actions += buttons("无责跳过", "skip");
    }
  }
  if (ev.type === "shield") {
    title = "后退前，请示护盾";
    body = `<p>${esc(g.players[ev.id].name)} 将后退 ${ev.amount} 格。</p><p class="muted">持有 ${g.players[ev.id].shield} 枚护盾。护盾只抵消本次后退，不取消整个事件。</p>`;
    actions =
      buttons("主持确认使用护盾", "shield", 'data-use="yes" class="primary"') +
      buttons("保留护盾，执行后退", "shield", 'data-use="no"');
  }
  if (ev.type === "pkChoose") {
    title = "选择一位对手";
    body =
      "<p>每次移动最多一次PK。碰撞时由移动者选择同格的一名未完赛对手。</p>";
    actions = ev.options
      .map((id) =>
        buttons(esc(g.players[id].name), "pkChoose", `data-id="${id}"`),
      )
      .join("");
  }
  if (["pk", "pkResult"].includes(ev.type)) {
    title = "骰子夺宠";
    body = `<p>${esc(g.players[ev.a].name)} ⚔ ${esc(g.players[ev.b].name)}</p><p class="muted">双方各掷一次，大者前进2格，平局重掷。没有现实关系或偏爱程度的含义。</p>${Object.keys(ev.values).length ? `<div class="dice-row">${[ev.a, ev.b].map((id) => `<div><span class="muted">${esc(g.players[id].name)}</span><div class="die">${ev.values[id]}</div></div>`).join("")}</div>` : ""}${ev.tie && ev.type === "pk" ? "<p>平局，双方重掷。</p>" : ""}${ev.type === "pkResult" ? `<p>${esc(g.players[ev.winner].name)} 胜出，前进2格。</p>` : ""}`;
    actions = buttons(
      ev.type === "pk" ? "⚄ 双方掷骰" : "确认PK结果",
      ev.type === "pk" ? "pkRoll" : "pkConfirm",
      'class="primary"',
    );
  }
  if (ev.type === "challenge") {
    title = ev.source === "round" ? `第${g.round}轮 · 御前争宠` : "御前争宠";
    body = `<p>“${esc(ev.text)}”</p><p class="muted">按以下顺序表演。参考：代入40% / 表达40% / 创意20%，仅供主持判断，不自动评分。可安排等价认可任务，或无责跳过整个挑战。</p>${ev.ids.map((id) => `<label>${esc(g.players[id].name)} 的本次名次<select data-rank="${id}"><option value="">请选择名次</option>${Array.from({ length: ev.ids.length }, (_, i) => `<option value="${i + 1}">${i + 1} · +${(ev.ids.length === 3 ? [2, 1, 0] : [2, 0])[i]}格</option>`).join("")}</select></label>`).join("")}<p class="notice">请逐个选择名次；允许并列，给予相同奖励，位移同时结算。</p>`;
    actions =
      buttons("主持确认名次（含并列）", "challenge", 'class="primary"') +
      buttons("跳过整个挑战", "challengeSkip");
  }
  if (ev.type === "epiloguePk") {
    title = "终局趣味挑战 · 不改排名";
    body = `<p>${esc(g.players[ev.a].name)} ⚔ ${esc(g.players[ev.b].name)}</p><div class="dice-row">${Object.keys(
      ev.values,
    )
      .map(
        (id) =>
          `<div><span class="muted">${esc(g.players[id].name)}</span><div class="die">${ev.values[id]}</div></div>`,
      )
      .join(
        "",
      )}</div>${ev.winner !== undefined ? `<p>${esc(g.players[ev.winner].name)} 赢得趣味称号</p><label>双方接受的称号<input id="fun-title" value="幸运侍从" maxlength="40"></label>` : ""}`;
    actions =
      buttons(
        ev.winner !== undefined ? "确认趣味称号" : "⚄ 趣味PK掷骰",
        ev.winner !== undefined ? "epilogueConfirm" : "epilogueRoll",
        'class="primary"',
      ) + buttons("无责结束趣味挑战", "epilogueSkip");
  }
  if (ev.type === "finishTie") {
    title = "同批完赛 · 加冕决胜";
    body =
      "<p>本批先按荣誉勋章数排序；相同勋章者各掷一次，高点优先，同点重掷。</p>" +
      ev.groups
        .map(
          (ids, i) =>
            `<p class="muted">${i + 1}组：${ids.map((id) => esc(g.players[id].name) + "（勋章" + g.players[id].medals + "）").join("、")}</p>`,
        )
        .join("");
    actions = buttons("⚄ 结算本组顺序", "tieRoll", 'class="primary"');
  }
  return modal(
    `<div class="eyebrow">${esc(g.config.host)} 的御前裁定</div><h2 id="dialog-title">${title}</h2>${body}<div class="actions">${actions}${g.phase === "finished" ? "" : '<button class="quiet" data-act="pause">Ⅱ 暂停</button>'}</div>`,
  );
}
function editor() {
  return modal(
    `<h2 id="dialog-title">编辑默认任务池</h2><p class="muted">仅改变下局默认设置。本局继续使用开局快照。数值效果由卡片ID决定，修改文字不会改变效果。</p><form id="editor-form"><label>表演时长（秒）<input name="seconds" type="number" min="5" max="300" value="${settings.seconds}"></label><div class="card-editor">${settings.cards.map((c) => `<div class="card-edit"><label><input name="enabled_${c.id}" type="checkbox" ${c.enabled ? "checked" : ""}> ${c.id} · 启用</label><input name="name_${c.id}" value="${esc(c.name)}" maxlength="100" required aria-label="${c.id}卡名"><label>角色任务 / 显示说明<textarea name="text_${c.id}" maxlength="2000" required>${esc(c.text)}</textarea></label><label>本卡提醒秒数（留空使用默认）<input name="seconds_${c.id}" type="number" min="5" max="300" value="${c.seconds || ""}"></label>${NUMERIC_CARDS.includes(c.id) ? '<span class="muted">此卡有固定数值效果，文字需与数值一致。</span>' : ""}</div>`).join("")}</div><div class="actions"><button type="submit" class="primary">保存默认设置</button><button type="button" data-act="resetCards">恢复原始卡池</button><button type="button" data-act="close">关闭</button></div></form>`,
    true,
  );
}
function host() {
  return modal(
    `<h2 id="dialog-title">主持面板</h2><p class="muted">偏爱令全局余 ${g.favorRemaining}/3，仅通过表演或公开挑战颁发。所有改变写入日志，可以撤销。</p>${g.players
      .filter((p) => p.rank === null)
      .map(
        (p) =>
          `<div class="subtle"><h3>${token(p)} ${esc(p.name)}</h3><div class="actions"><button data-act="award" data-id="${p.id}" ${g.favorRemaining ? "" : "disabled"}>颁发偏爱令</button><button data-act="interaction" data-id="${p.id}" ${p.favor ? "" : "disabled"}>使用偏爱令 · 15秒互动</button></div></div>`,
      )
      .join(
        "",
      )}<form id="adjust-form"><h3>公开调整位置</h3><p class="muted">仅在回合开始时可用；请填写原因，调整可撤销。</p><div class="grid3"><select name="player">${g.players
      .filter((p) => p.rank === null)
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join(
        "",
      )}</select><input name="pos" type="number" min="0" max="${g.config.goal}" required placeholder="新位置"><input name="reason" maxlength="100" required placeholder="原因"></div><button type="submit" ${g.phase === "turn_start" ? "" : "disabled"}>确认位置调整</button></form><div class="actions"><button data-act="hostChallenge" ${g.phase === "turn_start" ? "" : "disabled"}>公开发起争宠</button><button data-act="release" ${cloud.user ? "" : "disabled"}>释放设备控制权</button><button data-act="close">关闭</button></div>`,
  );
}
function rules() {
  return modal(
    `<h2 id="dialog-title">御前之局 · 规则</h2><p>三人按开局顺序轮流掷骰，抵达或超过终点立即完赛。第一名产生后，其余两人继续，直到完整排名。</p><p class="muted">碰撞替代格子事件；PK胜者+2，平局重掷。追加位移不触发事件或碰撞。每人初始1枚护盾，上限2，后退前由主持确认使用。落后最前方未完赛对手至少6格，可整局一次重掷取较优；奖励重掷可两值任选，两种资格不叠加。第3、6轮结束且至少两人未完赛时各触发一次挑战，第15格独立触发。争宠主持决定，允许并列；同批完赛先比勋章、再骰子决胜。偏爱令共3张，使用时选择下一掷+1或15秒互动。</p><p class="muted">角色任务可完成、换卡（每事件2次）、跳过。纯数值事件正常结算。所有卡禁用也不会阻塞。称号要双方认可。暂停优先，计时不会自动惩罚。撤销恢复完整快照；随机操作撤销后必须恢复原结果，不能刷骰。</p><details><summary>完整棋盘30格</summary>${BOARD.map((c) => `<p class="muted">${c.n} · ${esc(c.name)}：${esc(c.text)}</p>`).join("")}</details><button data-act="close">知道了</button>`,
    true,
  );
}
function login() {
  return modal(
    `<h2 id="dialog-title">主持人登录</h2><p class="muted">使用 Supabase 托管邮件验证码认证。发送验证码成功不等于登录成功；仅验证通过后才可读取云端存档。</p><form id="email-form"><label>邮箱<input name="email" id="email" type="email" autocomplete="email" required></label><button type="submit">发送验证码邮件</button></form><form id="verify-form"><label>邮件验证码<input name="token" type="text" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="10" required></label><button type="submit" class="primary">验证并登录</button></form><p class="muted">服务需将邮件模板设为验证码模式（详见部署说明）。</p><button data-act="close">稍后</button>`,
  );
}
function render() {
  const content =
    page === "home"
      ? home()
      : page === "setup"
        ? setup()
        : g?.phase === "paused"
          ? '<section class="panel"><h1>棋局已暂停</h1><p>任务与记录暂时隐藏。</p></section>'
          : game();
  let overlay = "";
  if (dialog === "editor") overlay = editor();
  else if (dialog === "host") overlay = host();
  else if (dialog === "rules") overlay = rules();
  else if (dialog === "login") overlay = login();
  else if (dialog === "boundaries")
    overlay = modal(
      `<h2 id="dialog-title">本局认可清单</h2><p>${esc(g.config.boundaries)}</p><p>称号：${esc(g.config.titles)}</p><p>暂停词：${esc(g.config.pauseWord)}</p><button data-act="close">关闭</button>`,
    );
  else if (page === "game" && g && (g.pending || g.phase === "paused"))
    overlay = event();
  $("#app").innerHTML =
    header() +
    `<main class="shell">${banner()}${content}</main><footer>成年参与者 · 虚构角色表演 · 暂停与无责退出永远优先</footer>` +
    overlay;
  const focus = $(".modal button:not(:disabled),.modal input");
  if (focus) focus.focus({ preventScroll: true });
}
async function act(name, el) {
  if (
    [
      "home",
      "setup",
      "continue",
      "editor",
      "rules",
      "login",
      "host",
      "boundaries",
      "close",
    ].includes(name)
  ) {
    if (g?.phase === "paused" && name !== "home") {
      toast("请先恢复或结束暂停");
      return;
    }
    if (name === "home") {
      page = "home";
      dialog = null;
    } else if (name === "setup") {
      if (page === "setup") readSetupDraft();
      page = "setup";
      dialog = null;
    } else if (name === "continue") {
      page = "game";
      dialog = null;
    } else if (name === "close") dialog = null;
    else {
      if (page === "setup" && name === "editor") readSetupDraft();
      dialog = name;
    }
    render();
    return;
  }
  if (name === "resetCards") {
    settings.cards = copy(CARDS);
    render();
    return;
  }
  if (name === "export") {
    const blob = new Blob(
        [
          JSON.stringify(
            { kind: "queen-game-backup", state: g, settings },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download =
      "女王争宠棋_" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (name === "loadCloud") {
    await loadCloud();
    return;
  }
  if (name === "logout") {
    await saveQueue;
    await cloud.release();
    await cloud.signout();
    localOwner = "demo";
    g = readLocal();
    page = "home";
    status = "已退出真实账号 · 本机试玩";
    render();
    return;
  }
  if (name === "release") {
    await saveQueue;
    await cloud.release();
    cloud.locked = true;
    status = "已释放控制权 · 本设备只读，请重新加载后继续";
    dialog = null;
    render();
    return;
  }
  if (name === "retry") {
    await saveQueue;
    if (cloud.locked) {
      toast("版本或设备冲突，必须加载云端版本，不能覆盖");
      return;
    }
    saveError = false;
    save();
    return;
  }
  if (name === "timer") {
    if (timer) {
      clearInterval(timer);
      timer = null;
      $("#timer").textContent = "已关闭";
      return;
    }
    count = g.pending.seconds;
    $("#timer").textContent = count;
    timer = setInterval(() => {
      if (!$("#timer")) {
        clearInterval(timer);
        timer = null;
        return;
      }
      $("#timer").textContent = --count > 0 ? count : "时间到 · 不自动结算";
      if (count <= 0) {
        clearInterval(timer);
        timer = null;
      }
    }, 1000);
    return;
  }
  if (name === "roll") {
    const favor = $("#use-favor")?.checked;
    if (
      g.config.animation &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      busy = true;
      el.disabled = true;
      el.classList.add("animate");
      setTimeout(() => {
        busy = false;
        run({ type: "roll", favor });
      }, 450);
    } else run({ type: "roll", favor });
    return;
  }
  if (name === "event") {
    dialog = null;
    render();
    return;
  }
  if (name === "challenge") {
    const ranks = {};
    document
      .querySelectorAll("[data-rank]")
      .forEach((s) => (ranks[s.dataset.rank] = Number(s.value)));
    run({ type: "challenge", ranks });
    return;
  }
  if (name === "challengeSkip") {
    run({ type: "challenge", skip: true });
    return;
  }
  if (name === "epilogueConfirm") {
    run({ type: name, title: $("#fun-title")?.value });
    return;
  }
  if (name === "epilogueSkip") {
    run({ type: "epilogueConfirm", skip: true });
    return;
  }
  if (["task", "skip"].includes(name)) {
    run({
      type: "task",
      skip: name === "skip",
      title: $("#task-title")?.value,
    });
    return;
  }
  const a = { type: name };
  if (el.dataset.id !== undefined) a.id = Number(el.dataset.id);
  if (el.dataset.source) a.source = el.dataset.source;
  if (el.dataset.which) a.which = el.dataset.which;
  if (name === "shield") a.use = el.dataset.use === "yes";
  if (["award", "interaction", "hostChallenge"].includes(name)) dialog = null;
  run(a);
}
function readSetupDraft() {
  const f = $("#setup-form");
  if (!f) return;
  const d = new FormData(f);
  settings = {
    ...settings,
    host: String(d.get("host") || ""),
    players: [0, 1, 2].map((i) => ({
      name: String(d.get("name" + i) || ""),
      role: d.get("role" + i),
      color: d.get("color" + i),
    })),
    goal: Number(d.get("goal")),
    seconds: Number(d.get("seconds")),
    animation: d.has("animation"),
    startBonus: d.has("bonusConsent")
      ? { id: Number(d.get("bonusPlayer")), consented: true }
      : null,
    boundaries: String(d.get("boundaries") || ""),
    titles: String(d.get("titles") || ""),
    pauseWord: String(d.get("pauseWord") || ""),
    rewards: [0, 1, 2].map((i) => String(d.get("reward" + i) || "")),
  };
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  act(el.dataset.act, el).catch((error) => toast(error.message));
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.reward !== undefined)
    run({
      type: "rewardChoice",
      id: Number(e.target.dataset.reward),
      choice: e.target.value,
    });
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target,
    data = new FormData(form);
  const submit = form.querySelector("[type=submit]");
  if (submit) submit.disabled = true;
  try {
    if (form.id === "setup-form") {
      if (cloud.locked) throw Error("先加载云端棋局或释放原控制权");
      await saveQueue;
      readSetupDraft();
      if (new Set(settings.players.map((p) => p.name.trim())).size !== 3)
        throw Error("三位玩家昵称需要不同");
      if (settings.players.some((p) => !p.name.trim()))
        throw Error("请输入昵称");
      if (cloud.user) await cloud.settings(settings);
      if (cloud.gameId) await cloud.release();
      cloud.revision = 0;
      saveError = false;
      g = createGame(settings);
      localStorage.setItem(
        "queen-settings-" + localOwner,
        JSON.stringify(settings),
      );
      page = "game";
      dialog = null;
      save();
      render();
    }
    if (form.id === "editor-form") {
      settings.seconds = Number(data.get("seconds"));
      settings.cards = settings.cards.map((c) => ({
        ...c,
        enabled: data.has("enabled_" + c.id),
        name: String(data.get("name_" + c.id)),
        text: String(data.get("text_" + c.id)),
        seconds: data.get("seconds_" + c.id)
          ? Number(data.get("seconds_" + c.id))
          : null,
      }));
      localStorage.setItem(
        "queen-settings-" + localOwner,
        JSON.stringify(settings),
      );
      if (cloud.user) {
        await cloud.settings(settings);
        toast("默认卡池已保存至真实云端");
      } else toast("默认卡池已保存至本机，尚未云端同步");
      dialog = null;
      render();
    }
    if (form.id === "adjust-form") {
      dialog = null;
      run({
        type: "adjust",
        id: Number(data.get("player")),
        pos: Number(data.get("pos")),
        reason: String(data.get("reason")),
      });
    }
    if (form.id === "email-form") {
      await cloud.sendCode(data.get("email"));
      toast("验证码邮件已请求发送，请检查邮箱");
    }
    if (form.id === "verify-form") {
      const email = $("#email").value;
      if (!email) throw Error("请先填写邮箱");
      await cloud.verify(email, data.get("token"));
      localOwner = cloud.user.id;
      const defaults = await cloud.settings();
      settings = defaults || copy(DEFAULTS);
      g = readLocal();
      page = "home";
      dialog = null;
      status = "真实账号已登录 · 请加载最近云端棋局或新建";
      render();
      await loadCloud();
    }
  } catch (error) {
    toast(error.message);
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (dialog) {
      dialog = null;
      render();
    } else if (
      page === "game" &&
      g &&
      !["paused", "finished", "stopped"].includes(g.phase)
    )
      run({ type: "pause" });
  }
  if (e.key === "Tab" && $(".modal")) {
    const els = [
      ...$(".modal").querySelectorAll(
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
window.addEventListener("offline", () => {
  status = "网络已断开 · 本机副本已保留，云端尚未保存";
  renderStatus();
});
window.addEventListener("online", () => {
  status = "网络已恢复 · 请重试云端保存或加载云端版本";
  renderStatus();
});
try {
  await cloud.init();
  if (cloud.user) localOwner = cloud.user.id;
} catch (e) {
  toast("登录会话验证失败：" + e.message);
}
try {
  settings =
    JSON.parse(
      localStorage.getItem("queen-settings-" + localOwner) || "null",
    ) || copy(DEFAULTS);
} catch {}
g = readLocal();
render();
if (cloud.user) {
  try {
    await loadCloud();
  } catch (e) {
    status = "云端加载失败 · 本机备份仍在";
    cloud.locked = true;
    renderStatus();
    toast(e.message);
  }
}
setInterval(async () => {
  if (!cloud.user || !cloud.gameId || cloud.locked) return;
  try {
    await cloud.heartbeat();
  } catch (e) {
    status = "设备锁续期失败 · 本机副本保留";
    renderStatus();
    if (/device_busy/.test(e.message)) toast(e.message);
  }
}, 30000);
