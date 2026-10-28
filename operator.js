/* Operator Console — prototype logic. All data is simulated, in memory only. */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const naira = (n) => "₦" + Number(n).toLocaleString("en-NG");

  /* ---------- standing rules (the movable part of the boundary) ---------- */
  const defaultRules = () => ({
    autoOffer: { on: false, maxSeverity: "medium", maxMinutes: 30 },
    spend: { limit: 50000 },
    extend: { on: true },
  });
  let rules = defaultRules();

  /* ---------- seed data ---------- */
  const seed = () => ({
    needs: [
      {
        id: "d1", type: "offer", title: "Fix authentication timeout", issue: "#104", agent: "Ada’s Claude",
        severity: "medium", minutes: 30, expiresIn: 58,
        ask: "Take this issue on your behalf?",
        facts: [
          ["good", "Plan: reproduce timeout, patch refresh logic, add regression test"],
          ["good", "Confirmed by 2 independent reviewers, 4 upvotes"],
          ["", "Estimate 30 min, delivery window 15 min after you accept"],
          ["bad", "You already hold 1 of 2 active claims"],
        ],
        ifIgnored: "The offer passes to the next person’s agent. Nothing is lost.",
        why: "claim.offered",
      },
      {
        id: "d2", type: "spend", title: "Split ₦120,000 of the “Auth audit” budget across 3 issues", issue: "Goal", agent: "Ada’s Claude",
        amount: 120000, expiresIn: null,
        ask: "Approve this allocation? It is above your ₦50,000 limit.",
        facts: [
          ["", "Proportional split: #104 (3), #112 (2), audit report (1)"],
          ["good", "Pool has ₦400,000 remaining, this leaves ₦280,000"],
          ["bad", "Allocations can’t be undone once issues are claimed"],
        ],
        ifIgnored: "The split waits. No work is blocked yet.",
        why: "goals/allocations",
      },
      {
        id: "d3", type: "scope", title: "Fix needs a database migration", issue: "#118", agent: "Tola’s Claude",
        expiresIn: null, paused: true,
        ask: "Allow a change beyond the ticket’s scope?",
        facts: [
          ["", "Login lockout bug traced to a missing index on sessions"],
          ["bad", "Migration touches production schema"],
          ["good", "Agent proposes a reversible migration with a rollback script"],
        ],
        ifIgnored: "The agent’s delivery clock stays paused. After 4 hours the claim is released to the queue.",
        why: "escalation: scope_change",
      },
      {
        id: "d4", type: "merge", title: "Merge: new session handling", issue: "#97", agent: "Merger agent",
        expiresIn: null,
        ask: "This change affects architecture. A person must sign off.",
        facts: [
          ["good", "2 independent testers passed on the exact commit"],
          ["good", "47 of 47 checks green"],
          ["bad", "Touches auth for every user. Cannot auto-merge."],
        ],
        ifIgnored: "The fix stays ready. The solver’s points are not paid until merge.",
        why: "human gate",
        locked: true,
      },
    ],
    agents: [
      { id: "a1", name: "Ada’s Claude", role: "contributor", doing: "Waiting on you for #104", phase: 2, health: "ok", beat: 2 },
      { id: "a2", name: "Tola’s Claude", role: "contributor", doing: "Paused on #118, waiting on your answer", phase: 3, health: "warn", beat: 0, paused: true },
      { id: "a3", name: "Reviewer-1", role: "reviewer", doing: "Testing the fix for #101 at 375 px", phase: 4, health: "ok", beat: 6 },
      { id: "a4", name: "Triager-1", role: "triager", doing: "Idle. No new reports in the feed", phase: 0, health: "idle", beat: 14 },
    ],
    done: [
      { kind: "you", text: "You approved Reviewer-1 to take #99", sub: "Delivered, merged, +300 pts", t: "1h ago" },
      { kind: "you", text: "You declined an offer on #93", sub: "Passed to the next agent", t: "2h ago" },
      { kind: "lapse", text: "An offer on #90 expired before you saw it", sub: "No cost. Offered on to the next person", t: "2h ago" },
      { kind: "auto", text: "Ada’s Claude commented a reproduction on #104", t: "2h ago" },
      { kind: "auto", text: "Ada’s Claude upvoted #112", t: "2h ago" },
      { kind: "auto", text: "Triager-1 cleared #115 as not a duplicate (+30 pts)", t: "3h ago" },
      { kind: "auto", text: "Ada’s Claude sent 11 heartbeats on #99", t: "3h ago" },
      { kind: "auto", text: "Reviewer-1 filed #120 with a screenshot", t: "3h ago" },
    ],
  });

  let state = seed();
  let timers = [];
  let autoOpen = false;

  /* ---------- helpers ---------- */
  const typeChip = (n) => {
    if (n.type === "spend") return '<span class="chip spend">Spend</span>';
    if (n.type === "merge") return '<span class="chip gate">Human gate</span>';
    if (n.type === "scope") return '<span class="chip gate">Scope change</span>';
    if (n.type === "blocker") return '<span class="chip gate">Blocker</span>';
    return '<span class="chip">Work offer</span>';
  };
  const fmt = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  const sevRank = { low: 1, medium: 2, high: 3, critical: 4 };

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg, actLabel, act) {
    $("#toast-msg").textContent = msg;
    const b = $("#toast-act");
    if (actLabel) { b.hidden = false; b.textContent = actLabel; b.onclick = () => { act(); $("#toast").classList.remove("show"); }; }
    else { b.hidden = true; b.onclick = null; }
    $("#toast").classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => $("#toast").classList.remove("show"), actLabel ? 8000 : 3500);
  }

  /* ---------- rendering ---------- */
  function renderStrip() {
    const working = state.agents.filter((a) => a.health !== "idle").length;
    const doneN = state.done.length;
    const need = state.needs.length;
    $("#inbox-count").textContent = need; $("#need-count").textContent = need; $("#ag-line").textContent = state.agents.length + " agents, " + working + " working";
    $("#strip").innerHTML =
      `<div class="stat ${need ? "need" : "calm"}"><span class="v">${need}</span><span class="l">${need ? (need === 1 ? "decision waiting on you" : "decisions waiting on you") : "Nothing needs you"}</span></div>` +
      `<div class="stat"><span class="v">${working}</span><span class="l">of ${state.agents.length} agents working</span></div>` +
      `<div class="stat"><span class="v">${doneN}</span><span class="l">things finished since your last visit</span></div>`;
  }

  function needCard(n) {
    const facts = n.facts.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join("");
    const timer = n.expiresIn != null
      ? `<span class="timer ${n.expiresIn <= 20 ? "hot" : ""}" data-timer="${n.id}">⏱ ${fmt(n.expiresIn)}</span>`
      : n.paused ? `<span class="timer">⏸ agent clock paused</span>` : "";
    const approveLabel = { offer: "Approve", spend: "Approve split", scope: "Allow", blocker: "Unblock", merge: "Review &amp; merge" }[n.type];
    const meta = n.type === "offer" ? ` · ${esc(n.severity)} · ~${n.minutes} min` : "";
    return `
    <article class="decision ${n.expiresIn != null && n.expiresIn <= 20 ? "urgent" : ""}" data-id="${n.id}" aria-label="${esc(n.title)}">
      <div class="d-top">${typeChip(n)}<span class="who">${esc(n.agent)} · ${esc(n.issue)}${meta}</span>${timer}</div>
      <div class="d-body">
        <h3>${esc(n.title)}</h3>
        <p class="ask">${esc(n.ask)}</p>
        <ul class="facts">${facts}</ul>
        <p class="consequence"><b>If you do nothing:</b> ${esc(n.ifIgnored)}</p>
        <p class="why">Ziki event <code>${esc(n.why)}</code></p>
      </div>
      <div class="d-actions">
        <button class="btn sm accent" data-act="approve">${approveLabel}</button>
        ${n.locked ? "" : '<button class="btn sm" data-act="decline">Decline</button>'}
        <div class="more">
          <button class="btn sm ghost" data-act="more" aria-haspopup="true" aria-expanded="false">More ▾</button>
          <div class="menu" hidden>
            <button data-act="ask">Ask the agent to explain</button>
            <button data-act="reestimate">Ask for a smaller plan</button>
            ${n.locked ? "" : '<button data-act="decline-why">Decline and tell the agent why</button>'}
          </div>
        </div>
      </div>
    </article>`;
  }

  function renderNeeds() {
    const box = $("#needs");
    if (!state.needs.length) {
      box.innerHTML = `<div class="empty"><b>You’re clear.</b>Agents are working inside the boundary below. They’ll stop and ask the moment they need you.</div>`;
      $("#need-sub").textContent = "";
      return;
    }
    $("#need-sub").textContent = "Most urgent first";
    box.innerHTML = state.needs.map(needCard).join("");
  }

  function renderAgents() {
    $("#agents").innerHTML = state.agents.map((a) => {
      const dots = Array.from({ length: 6 }, (_, i) => `<i class="${i < a.phase ? "on" : i === a.phase && a.health !== "idle" ? "now" : ""}"></i>`).join("");
      const label = a.paused ? "Paused" : a.health === "warn" ? "Waiting on you" : a.health === "idle" ? "Idle" : "On track";
      const cls = a.paused || a.health === "warn" ? "warn" : a.health === "idle" ? "idle" : "";
      const initials = a.name.replace(/[^A-Za-z]/g, " ").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      return `
      <div class="agent ${a.stopped ? "paused" : ""}" data-agent="${a.id}">
        <div class="agent-top"><div class="avatar">${esc(initials)}</div><div><div class="nm">${esc(a.name)}</div><div class="role">${esc(a.role)}</div></div><span class="health ${cls}">${a.stopped ? "Stopped" : label}</span></div>
        <p class="doing">${esc(a.doing)}</p>
        <div class="dots" title="Step ${a.phase} of 6" aria-label="Step ${a.phase} of 6">${dots}</div>
        <div class="agent-foot"><span>Last heartbeat ${a.beat} min ago</span>${a.stopped ? '<button data-resume="' + a.id + '">Resume</button>' : '<button data-stop="' + a.id + '">Stop this agent</button>'}</div>
      </div>`;
    }).join("");
  }

  function renderDone() {
    const manual = state.done.filter((d) => d.kind !== "auto");
    const auto = state.done.filter((d) => d.kind === "auto");
    const ic = { you: ["you", "✓"], lapse: ["lapse", "!"], auto: ["", "•"] };
    const row = (d) => `<div class="done-item"><span class="ic ${ic[d.kind][0]}">${ic[d.kind][1]}</span><div>${esc(d.text)}${d.sub ? `<small>${esc(d.sub)}</small>` : ""}${d.kind === "auto" ? '<button class="undo" data-undo="1" title="Tenant admins can mark any agent action undone">Undo</button>' : ""}</div><time>${esc(d.t)}</time></div>`;
    $("#done").innerHTML =
      manual.map(row).join("") +
      (auto.length
        ? `<button class="group-toggle" id="auto-toggle" aria-expanded="${autoOpen}"><span>${auto.length} routine actions your agents handled alone</span><span>${autoOpen ? "Hide" : "Show"}</span></button><div class="auto-group" ${autoOpen ? "" : "hidden"}>${auto.map(row).join("")}</div>`
        : "");
    $("#done-sub").textContent = `${manual.length} decisions, ${auto.length} routine`;
  }

  function renderRules() {
    $("#rules").innerHTML = `
      <div class="rule-card">
        <div class="rt"><span>Work offers</span><label class="switch"><input type="checkbox" id="r-auto" ${rules.autoOffer.on ? "checked" : ""} aria-label="Auto-accept small offers"><span></span></label></div>
        <p class="rd">${rules.autoOffer.on ? "Agents accept offers that fit below. Everything else still asks you." : "Off. Agents ask you before every bid or offer."}</p>
        <div class="controls" ${rules.autoOffer.on ? "" : 'style="opacity:.5"'}>
          up to
          <select id="r-sev" ${rules.autoOffer.on ? "" : "disabled"} aria-label="Maximum severity">
            ${["low", "medium", "high"].map((s) => `<option ${rules.autoOffer.maxSeverity === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          and
          <input type="number" id="r-min" min="5" max="120" step="5" value="${rules.autoOffer.maxMinutes}" ${rules.autoOffer.on ? "" : "disabled"} aria-label="Maximum minutes"> min
        </div>
      </div>
      <div class="rule-card">
        <div class="rt"><span>Spending</span></div>
        <p class="rd">Agents may split budget alone up to this amount. Above it, they ask.</p>
        <div class="controls">₦ <input type="number" id="r-spend" min="0" step="5000" value="${rules.spend.limit}" aria-label="Spend limit in naira"></div>
      </div>
      <div class="rule-card">
        <div class="rt"><span>Deadline extension</span><label class="switch"><input type="checkbox" id="r-ext" ${rules.extend.on ? "checked" : ""} aria-label="Allow one extension"><span></span></label></div>
        <p class="rd">${rules.extend.on ? "An agent may use its one extension and tell you why." : "Agents must ask before extending."}</p>
      </div>
      <div class="rule-card">
        <div class="rt"><span>Sensitive merges</span><span class="locked">Locked: always you</span></div>
        <p class="rd">Architecture, auth and schema changes always stop at a human gate.</p>
      </div>`;
  }

  function renderAll() { renderStrip(); renderNeeds(); renderAgents(); renderDone(); renderRules(); }

  /* ---------- decisions ---------- */
  function find(id) { return state.needs.find((n) => n.id === id); }
  function removeNeed(id) { state.needs = state.needs.filter((n) => n.id !== id); }
  function pushDone(kind, text, sub) { state.done.unshift({ kind, text, sub, t: "just now" }); }

  function approve(id) {
    const n = find(id); if (!n) return;
    removeNeed(id);
    if (n.type === "offer") {
      pushDone("you", `You approved ${n.agent} to take ${n.issue}`, "Delivery window started: 15 min");
      const ag = state.agents.find((a) => a.name === n.agent);
      if (ag) { ag.doing = `Working on ${n.issue}`; ag.phase = 3; ag.health = "ok"; }
      state.offersApproved = (state.offersApproved || 0) + 1;
      renderAll();
      if (!rules.autoOffer.on && state.offersApproved >= 2 && n.severity !== "high") {
        toast("You’ve approved this kind of offer twice. Let agents handle it?", "Make it a rule", () => {
          rules.autoOffer = { on: true, maxSeverity: n.severity, maxMinutes: n.minutes }; renderRules(); renderStrip();
          toast(`Rule on: up to ${n.severity}, ${n.minutes} min. Bigger work still asks you.`);
        });
      } else toast("Approved. The agent has started.");
      return;
    }
    if (n.type === "spend") { pushDone("you", `You approved a ${naira(n.amount)} split`, "3 allocations written to the ledger"); toast("Allocation approved."); }
    else if (n.type === "scope") {
      pushDone("you", `You allowed a scope change on ${n.issue}`, "Agent clock resumed, time added back");
      const ag = state.agents.find((a) => a.name === n.agent);
      if (ag) { ag.paused = false; ag.health = "ok"; ag.doing = `Writing the migration for ${n.issue}`; ag.phase = 3; }
      toast("Allowed. The agent’s clock is running again.");
    } else if (n.type === "merge") { pushDone("you", `You reviewed and merged ${n.issue}`, "Solver and reviewers paid"); toast("Merged. Points written to the ledger."); }
    else { pushDone("you", `You unblocked ${n.agent} on ${n.issue}`, ""); toast("Unblocked."); }
    renderAll();
  }

  function decline(id, why) {
    const n = find(id); if (!n) return;
    removeNeed(id);
    pushDone("you", `You declined: ${n.title}`, why ? "Reason sent to the agent" : "The agent was told and moved on");
    const ag = state.agents.find((a) => a.name === n.agent);
    if (ag && n.type === "scope") { ag.paused = false; ag.health = "ok"; ag.doing = `Looking for another approach on ${n.issue}`; }
    renderAll();
    toast("Declined. The agent will look for another way.");
  }

  /* ---------- events ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) { document.querySelectorAll(".menu").forEach((m) => (m.hidden = true)); return; }
    const card = t.closest(".decision");
    const act = t.dataset.act;
    if (act === "more") {
      const m = t.nextElementSibling; const open = m.hidden;
      document.querySelectorAll(".menu").forEach((x) => (x.hidden = true));
      m.hidden = !open; t.setAttribute("aria-expanded", String(open)); return;
    }
    document.querySelectorAll(".menu").forEach((m) => (m.hidden = true));
    if (act && card) {
      const id = card.dataset.id;
      if (act === "approve") approve(id);
      else if (act === "decline") decline(id, false);
      else if (act === "decline-why") { const r = prompt("Tell the agent why (it will read this):"); if (r !== null) decline(id, true); }
      else if (act === "ask") toast("Question sent. The agent’s clock is paused while it answers.");
      else if (act === "reestimate") toast("Asked for a smaller plan. The offer timer keeps running.");
      return;
    }
    if (t.dataset.stop) { const a = state.agents.find((x) => x.id === t.dataset.stop); a.stopped = true; a.doing = "Stopped by you. No further actions."; renderAgents(); toast(`${a.name} stopped.`); return; }
    if (t.dataset.resume) { const a = state.agents.find((x) => x.id === t.dataset.resume); a.stopped = false; a.doing = "Resumed"; renderAgents(); return; }
    if (t.id === "auto-toggle") { autoOpen = !autoOpen; renderDone(); return; }
    if (t.dataset.undo) { toast("Undo is an admin action in Ziki: the original is kept and the reversal is logged."); return; }
  });

  document.addEventListener("change", (e) => {
    const i = e.target;
    if (i.id === "r-auto") rules.autoOffer.on = i.checked;
    else if (i.id === "r-sev") rules.autoOffer.maxSeverity = i.value;
    else if (i.id === "r-min") rules.autoOffer.maxMinutes = Math.max(5, Number(i.value) || 30);
    else if (i.id === "r-spend") rules.spend.limit = Math.max(0, Number(i.value) || 0);
    else if (i.id === "r-ext") rules.extend.on = i.checked;
    else return;
    renderRules();
    // Rules apply to what is already waiting, and the human sees that happen.
    state.needs.filter((n) => n.type === "spend").forEach((n) => { n.ask = n.amount > rules.spend.limit ? `Approve this allocation? It is above your ${naira(rules.spend.limit)} limit.` : `Within your ${naira(rules.spend.limit)} limit.`; });
    applyAutoOffers();
    renderAll();
  });

  function applyAutoOffers() {
    if (!rules.autoOffer.on) return;
    state.needs.filter((n) => n.type === "offer").forEach((n) => {
      if (sevRank[n.severity] <= sevRank[rules.autoOffer.maxSeverity] && n.minutes <= rules.autoOffer.maxMinutes) {
        removeNeed(n.id);
        state.done.unshift({ kind: "auto", text: `${n.agent} accepted ${n.issue} under your rule (${n.severity}, ${n.minutes} min)`, t: "just now" });
      }
    });
  }

  /* ---------- ticking ---------- */
  function tick() {
    state.needs.forEach((n) => {
      if (n.expiresIn == null) return;
      n.expiresIn -= 1;
      if (n.expiresIn <= 0) {
        removeNeed(n.id);
        state.done.unshift({ kind: "lapse", text: `The offer on ${n.issue} expired before you decided`, sub: "No cost. It was offered on to the next person", t: "just now" });
        const ag = state.agents.find((a) => a.name === n.agent);
        if (ag) { ag.doing = "Offer lapsed. Looking for new work"; ag.health = "ok"; ag.phase = 1; }
        renderAll(); toast("An offer expired. It passed to the next person, nothing lost.");
        return;
      }
      const el = document.querySelector(`[data-timer="${n.id}"]`);
      if (el) { el.textContent = "⏱ " + fmt(n.expiresIn); el.classList.toggle("hot", n.expiresIn <= 20); el.closest(".decision").classList.toggle("urgent", n.expiresIn <= 20); }
    });
  }

  /* ---------- prototype controls ---------- */
  let n = 200;
  $("#sim-offer").addEventListener("click", () => {
    n++;
    const sev = ["low", "medium", "high"][n % 3];
    const item = { id: "d" + n, type: "offer", title: ["Footer links wrap on 375 px", "Search returns stale results", "Export button does nothing"][n % 3], issue: "#" + n, agent: "Ada’s Claude", severity: sev, minutes: [15, 25, 60][n % 3], expiresIn: 60, ask: "Take this issue on your behalf?", facts: [["good", "Confirmed by 2 independent reviewers"], ["", `Estimate ${[15, 25, 60][n % 3]} min`]], ifIgnored: "The offer passes to the next person’s agent. Nothing is lost.", why: "claim.offered" };
    state.needs.push(item);
    applyAutoOffers();
    renderAll();
    toast(rules.autoOffer.on && !state.needs.includes(item) ? "Your rule handled it. You’ll see it under Done." : "New offer. 60 seconds to decide.");
  });
  $("#sim-block").addEventListener("click", () => {
    n++;
    state.needs.push({ id: "d" + n, type: "blocker", title: "Can’t reach the staging site", issue: "#" + n, agent: "Reviewer-1", expiresIn: null, paused: true, ask: "Provide the staging URL or credentials?", facts: [["bad", "Staging returned 403 for 3 attempts"], ["", "Agent has not guessed or tried other routes"]], ifIgnored: "The agent waits. After 4 hours the claim is released, which does not count against it.", why: "escalation: blocker" });
    renderAll(); toast("An agent is blocked and needs you.");
  });
  $("#reset").addEventListener("click", () => { state = seed(); rules = defaultRules(); autoOpen = false; renderAll(); toast("Reset."); });

  renderAll();
  timers.push(setInterval(tick, 1000));
})();
