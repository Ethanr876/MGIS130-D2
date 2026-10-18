/* =====================================================
   SECTION 1: DATA
   What goes in, and the fixed values the app uses.
   ===================================================== */

const TODAY = new Date(); // first payment is assumed to be next month

const sliders = {
  amount: document.getElementById("amount"),
  payment: document.getElementById("payment"),
  rate: document.getElementById("rate"),
  years: document.getElementById("years"),
  extra: document.getElementById("extra"),
  fee: document.getElementById("fee"),
  penalty: document.getElementById("penalty")
};
const feesToggle = document.getElementById("fees-on");

// Things that change while the app is open.
const state = {
  mode: "loan",   // "loan" = find the payment, "afford" = find the loan size
  pinned: null    // saved copy of the inputs for side-by-side comparison
};

// Rough prices for the "cost translator". Change them to taste.
const EQUIVALENTS = [
  { icon: "☕", singular: "latte", plural: "lattes", price: 5.5 },
  { icon: "📺", singular: "month of streaming", plural: "months of streaming", price: 16 },
  { icon: "🧳", singular: "weekend getaway", plural: "weekend getaways", price: 800 }
];

// Short names used in share links.
const QUERY_KEYS = {
  amount: "a", payment: "p", rate: "r", years: "y",
  extra: "x", fee: "fee", penalty: "pen"
};

// Read every control into one plain object.
function readInputs() {
  return {
    mode: state.mode,
    amount: Number(sliders.amount.value),
    payment: Number(sliders.payment.value),
    rate: Number(sliders.rate.value),
    years: Number(sliders.years.value),
    extra: Number(sliders.extra.value),
    feesOn: feesToggle.checked,
    feePct: Number(sliders.fee.value),
    penaltyPct: Number(sliders.penalty.value)
  };
}

// Turn the inputs into the part of a share link after the "?".
function buildQueryString(inputs) {
  const q = new URLSearchParams();
  q.set("m", inputs.mode);
  q.set(QUERY_KEYS.amount, inputs.amount);
  q.set(QUERY_KEYS.payment, inputs.payment);
  q.set(QUERY_KEYS.rate, inputs.rate);
  q.set(QUERY_KEYS.years, inputs.years);
  q.set(QUERY_KEYS.extra, inputs.extra);
  if (inputs.feesOn) {
    q.set("f", "1");
    q.set(QUERY_KEYS.fee, inputs.feePct);
    q.set(QUERY_KEYS.penalty, inputs.penaltyPct);
  }
  return q.toString();
}

// Fill the controls from a share link. Bad values are ignored, and the
// browser itself clamps each slider to its min, max and step.
function loadFromQueryString(search) {
  const q = new URLSearchParams(search);
  if (q.get("m") === "afford") state.mode = "afford";
  Object.keys(QUERY_KEYS).forEach(function (id) {
    const raw = q.get(QUERY_KEYS[id]);
    if (raw === null || raw.trim() === "") return;
    const n = Number(raw);
    if (Number.isFinite(n)) sliders[id].value = n;
  });
  if (q.get("f") === "1") feesToggle.checked = true;
}


/* =====================================================
   SECTION 2: RULES
   The loan math. Nothing here touches the page.
   ===================================================== */

function monthlyRate(annualPct) {
  return annualPct / 100 / 12;
}

// Fixed monthly payment: M = P * r / (1 - (1 + r)^-n)
function paymentFor(principal, annualPct, months) {
  const r = monthlyRate(annualPct);
  return r === 0
    ? principal / months
    : (principal * r) / (1 - Math.pow(1 + r, -months));
}

// The same formula run backwards: biggest loan a payment can carry.
function maxPrincipalFor(payment, annualPct, months) {
  const r = monthlyRate(annualPct);
  return r === 0
    ? payment * months
    : (payment * (1 - Math.pow(1 + r, -months))) / r;
}

function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

// Month-by-month schedule, with an optional extra payment each month.
function buildSchedule(principal, annualPct, months, extra, startDate) {
  const r = monthlyRate(annualPct);
  const pmt = paymentFor(principal, annualPct, months);
  const rows = [];
  let balance = principal;

  for (let n = 1; n <= months && balance > 0.005; n++) {
    const interest = balance * r;
    const owed = balance + interest;
    // The last scheduled month clears whatever is left (avoids rounding crumbs).
    const due = n === months ? owed : Math.min(pmt, owed);
    const paid = Math.min(due + extra, owed);
    const principalPaid = paid - interest;
    balance = Math.max(0, balance - principalPaid);
    if (balance < 0.005) balance = 0;

    rows.push({
      n: n,
      date: addMonths(startDate, n),
      payment: paid,
      interest: interest,
      principal: principalPaid,
      extraPaid: paid - due,
      balance: balance
    });
  }
  return rows;
}

function totals(rows) {
  return rows.reduce(function (t, row) {
    t.paid += row.payment;
    t.interest += row.interest;
    t.extraPaid += row.extraPaid;
    return t;
  }, { paid: 0, interest: 0, extraPaid: 0 });
}

// The true yearly rate once fees are counted: find the monthly rate that
// makes the payments worth exactly the money you actually received.
function effectiveApr(received, flows) {
  function gap(r) {
    return flows.reduce(function (sum, cash, i) {
      return sum + cash / Math.pow(1 + r, i + 1);
    }, 0) - received;
  }
  if (gap(0) <= 0) return 0;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (gap(mid) > 0) low = mid; else high = mid;
  }
  return ((low + high) / 2) * 12 * 100;
}

// Everything the display needs, from one set of inputs.
function calculateLoan(inputs, startDate) {
  const months = Math.max(1, Math.round(inputs.years * 12));
  const principal = inputs.mode === "afford"
    ? maxPrincipalFor(inputs.payment, inputs.rate, months)
    : inputs.amount;

  const base = buildSchedule(principal, inputs.rate, months, 0, startDate);
  const plan = buildSchedule(principal, inputs.rate, months, inputs.extra, startDate);
  const baseTotals = totals(base);
  const planTotals = totals(plan);

  const feePct = inputs.feesOn ? inputs.feePct : 0;
  const penaltyPct = inputs.feesOn ? inputs.penaltyPct : 0;
  const fee = principal * feePct / 100;
  const penalties = planTotals.extraPaid * penaltyPct / 100;

  const flows = plan.map(function (row) {
    return row.payment + row.extraPaid * penaltyPct / 100;
  });

  return {
    principal: principal,
    months: months,
    monthlyPayment: paymentFor(principal, inputs.rate, months),
    schedule: plan,
    paymentCount: plan.length,
    interest: planTotals.interest,
    fee: fee,
    penalties: penalties,
    feesTotal: fee + penalties,
    totalCost: planTotals.interest + fee + penalties,
    totalOut: planTotals.paid + penalties + fee,
    apr: effectiveApr(principal - fee, flows),
    monthsSaved: base.length - plan.length,
    interestSaved: baseTotals.interest - planTotals.interest,
    payoffDate: plan[plan.length - 1].date
  };
}


/* =====================================================
   SECTION 3: DISPLAY
   Everything that changes what is on the page.
   ===================================================== */

const $ = function (id) { return document.getElementById(id); };

const money0 = new Intl.NumberFormat("en-US",
  { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US",
  { style: "currency", currency: "USD" });
const monthYear = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const monthYearShort = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

// The latest numbers, kept so the print view can use them.
let lastInputs = null;
let lastResult = null;

function make(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

function percent(n) {
  return n.toFixed(1) + "%";
}

// Slider labels, the filled part of each track, and the quick-pick chips.
function renderSliders(inputs, result) {
  const labels = {
    amount: function (v) { return money0.format(v); },
    payment: function (v) { return money0.format(v) + "/mo"; },
    rate: function (v) { return v.toFixed(1) + "%"; },
    years: function (v) { return v + (v === 1 ? " year" : " years"); },
    extra: function (v) { return v === 0 ? "None" : "+" + money0.format(v) + "/mo"; },
    fee: function (v) { return v + "% (" + money0.format(result.principal * v / 100) + ")"; },
    penalty: function (v) { return v + "% of extra payments"; }
  };

  Object.keys(sliders).forEach(function (id) {
    const slider = sliders[id];
    const value = Number(slider.value);
    const min = Number(slider.min);
    const max = Number(slider.max);
    $("out-" + id).textContent = labels[id](value);
    slider.style.setProperty("--fill", ((value - min) / (max - min)) * 100 + "%");
  });

  document.querySelectorAll(".chip").forEach(function (chip) {
    chip.setAttribute("aria-pressed", String(Number(chip.dataset.extra) === inputs.extra));
  });
}

// Conic gradient from a list of { color, value } slices.
function pieGradient(parts) {
  const total = parts.reduce(function (sum, p) { return sum + p.value; }, 0);
  let running = 0;
  const stops = [];
  parts.forEach(function (p) {
    if (p.value <= 0) return;
    const start = (running / total) * 100;
    running += p.value;
    stops.push(p.color + " " + start + "% " + (running / total) * 100 + "%");
  });
  return "conic-gradient(" + stops.join(", ") + ")";
}

function renderResults(inputs, r) {
  const afford = inputs.mode === "afford";

  // Headline number
  $("primary-label").textContent = afford ? "You could borrow up to" : "Monthly payment";
  $("primary-value").textContent = afford
    ? money0.format(r.principal)
    : money2.format(r.monthlyPayment);

  const sub = $("primary-sub");
  if (afford) {
    sub.textContent = "with payments of " + money2.format(r.monthlyPayment) + " a month" +
      (inputs.extra > 0 ? " (plus " + money0.format(inputs.extra) + " extra)" : "");
    sub.hidden = false;
  } else if (inputs.extra > 0) {
    sub.textContent = "+ " + money0.format(inputs.extra) + " extra = " +
      money2.format(r.monthlyPayment + inputs.extra) + " a month in total";
    sub.hidden = false;
  } else {
    sub.hidden = true;
  }

  $("payoff-date").textContent = monthYear.format(r.payoffDate);

  // Pie chart and legend
  const grand = r.principal + r.interest + r.feesTotal;
  $("pie").style.background = pieGradient([
    { color: "var(--principal)", value: r.principal },
    { color: "var(--interest)", value: r.interest },
    { color: "var(--fees)", value: r.feesTotal }
  ]);
  $("pie").setAttribute("aria-label",
    "Pie chart: " + percent(r.principal / grand * 100) + " principal, " +
    percent(r.interest / grand * 100) + " interest" +
    (r.feesTotal > 0 ? ", " + percent(r.feesTotal / grand * 100) + " fees and penalties" : ""));

  $("principal-total").textContent = money0.format(r.principal);
  $("principal-pct").textContent = percent(r.principal / grand * 100);
  $("interest-total").textContent = money0.format(r.interest);
  $("interest-pct").textContent = percent(r.interest / grand * 100);
  $("legend-fees").hidden = r.feesTotal <= 0;
  $("fees-total").textContent = money0.format(r.feesTotal);
  $("fees-pct").textContent = percent(r.feesTotal / grand * 100);

  // Summary rows
  $("sum-monthly").textContent = money2.format(r.monthlyPayment + inputs.extra);
  $("sum-count").textContent = r.paymentCount;
  $("sum-interest").textContent = money0.format(r.interest);
  $("row-fees").hidden = !inputs.feesOn;
  $("sum-fees").textContent = money0.format(r.feesTotal);
  $("row-apr").hidden = !inputs.feesOn;
  $("sum-apr").textContent = percent(r.apr) + " (rate: " + percent(inputs.rate) + ")";
  $("sum-total").textContent = money0.format(r.totalOut);
}

// "Months saved" and "interest saved" badges for the extra payment.
function renderBadges(inputs, r) {
  const monthsBadge = $("badge-months");
  const interestBadge = $("badge-interest");
  monthsBadge.hidden = !(inputs.extra > 0 && r.monthsSaved > 0);
  interestBadge.hidden = !(inputs.extra > 0 && r.interestSaved >= 1);
  monthsBadge.textContent = "⏱️ " + plural(r.monthsSaved, "month", "months") + " sooner";
  interestBadge.textContent = "💰 " + money0.format(r.interestSaved) + " interest saved";
  $("extra-hint").hidden = inputs.extra > 0;
}

// Turn the interest into everyday items.
function renderEquivalents(r) {
  const list = $("equiv-list");
  list.textContent = "";

  if (r.interest < 1) {
    list.appendChild(make("li", "No interest at all. Nice!"));
  } else {
    EQUIVALENTS.forEach(function (item) {
      const count = r.interest / item.price;
      const shown = count >= 10 ? String(Math.round(count)) : count.toFixed(1);
      const li = make("li");
      li.appendChild(make("span", item.icon, "icon"));
      li.appendChild(make("span", "≈ " + Number(shown).toLocaleString("en-US"), "count"));
      li.appendChild(make("span", Number(shown) === 1 ? item.singular : item.plural));
      list.appendChild(li);
    });
  }

  $("equiv-note").textContent = "Rough prices: " + EQUIVALENTS.map(function (item) {
    return item.plural + " " + money2.format(item.price);
  }).join(", ") + ".";
}

// Pinned setup next to the current one.
function renderComparison(inputs, current) {
  const has = state.pinned !== null;
  $("unpin").hidden = !has;
  $("compare-table").hidden = !has;
  $("compare-summary").hidden = !has;
  $("compare-hint").hidden = has;
  $("pin").textContent = has ? "📌 Re-pin current setup" : "📌 Pin this setup";
  if (!has) return;

  const pinnedInputs = state.pinned;
  const pinned = calculateLoan(pinnedInputs, TODAY);

  const rows = [
    ["Loan amount", function (i, r) { return money0.format(r.principal); }],
    ["Interest rate", function (i) { return percent(i.rate); }],
    ["Term", function (i) { return i.years + (i.years === 1 ? " yr" : " yrs"); }],
    ["Monthly payment", function (i, r) { return money2.format(r.monthlyPayment + i.extra); }],
    ["Total interest", function (i, r) { return money0.format(r.interest); }],
    ["Total cost", function (i, r) { return money0.format(r.totalCost); }],
    ["Debt-free by", function (i, r) { return monthYearShort.format(r.payoffDate); }]
  ];

  const body = document.querySelector("#compare-table tbody");
  body.textContent = "";
  rows.forEach(function (row) {
    const tr = make("tr");
    tr.appendChild(make("td", row[0]));
    tr.appendChild(make("td", row[1](pinnedInputs, pinned)));
    tr.appendChild(make("td", row[1](inputs, current)));
    body.appendChild(tr);
  });

  const costDiff = current.totalCost - pinned.totalCost;
  const payDiff = (current.monthlyPayment + inputs.extra) -
                  (pinned.monthlyPayment + pinnedInputs.extra);

  let text = Math.abs(costDiff) < 1
    ? "Both setups cost about the same in total"
    : "Your current setup costs " + money0.format(Math.abs(costDiff)) +
      (costDiff < 0 ? " less" : " more") + " in total than the pinned one";
  text += Math.abs(payDiff) < 1
    ? ", with about the same monthly payment."
    : ", and the monthly payment is " + money0.format(Math.abs(payDiff)) +
      (payDiff < 0 ? " lower." : " higher.");

  const summary = $("compare-summary");
  summary.textContent = text;
  summary.className = "compare-summary" +
    (Math.abs(costDiff) < 1 ? "" : costDiff < 0 ? " good" : " bad");
}

// Printable summary and full payment schedule (built only when needed).
function renderPrintArea() {
  const area = $("print-area");
  area.textContent = "";
  if (!lastResult) return;
  const i = lastInputs;
  const r = lastResult;

  area.appendChild(make("h1", "Loan Summary"));
  area.appendChild(make("p", "Prepared " +
    new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date()), "print-date"));

  const facts = [
    ["Loan amount", money0.format(r.principal)],
    ["Interest rate", percent(i.rate)],
    ["Term", plural(i.years, "year", "years")],
    ["Monthly payment", money2.format(r.monthlyPayment)],
    ["Extra payment", money2.format(i.extra) + " per month"],
    ["Total interest", money2.format(r.interest)]
  ];
  if (i.feesOn) {
    facts.push(["Fees & penalties", money2.format(r.feesTotal)]);
    facts.push(["Effective APR", percent(r.apr)]);
  }
  facts.push(["Total you'll pay", money2.format(r.totalOut)]);
  facts.push(["Debt-free by", monthYear.format(r.payoffDate)]);

  const factsTable = make("table", undefined, "facts");
  facts.forEach(function (f) {
    const tr = make("tr");
    tr.appendChild(make("th", f[0]));
    tr.appendChild(make("td", f[1]));
    factsTable.appendChild(tr);
  });
  area.appendChild(factsTable);

  area.appendChild(make("h2", "Payment schedule"));
  const table = make("table", undefined, "schedule");
  const head = make("tr");
  ["#", "Date", "Payment", "Principal", "Interest", "Balance"].forEach(function (h) {
    head.appendChild(make("th", h));
  });
  table.appendChild(make("thead")).appendChild(head);

  const body = make("tbody");
  r.schedule.forEach(function (row) {
    const tr = make("tr");
    [row.n, monthYearShort.format(row.date), money2.format(row.payment),
     money2.format(row.principal), money2.format(row.interest),
     money2.format(row.balance)].forEach(function (cell) {
      tr.appendChild(make("td", String(cell)));
    });
    body.appendChild(tr);
  });
  table.appendChild(body);
  area.appendChild(table);
}

function renderEverything(inputs, result) {
  renderSliders(inputs, result);
  renderResults(inputs, result);
  renderBadges(inputs, result);
  renderEquivalents(result);
  renderComparison(inputs, result);
}


/* =====================================================
   SECTION 4: WIRING
   Connects the controls to the rules and the display.
   ===================================================== */

function update() {
  const inputs = readInputs();
  const result = calculateLoan(inputs, TODAY);
  lastInputs = inputs;
  lastResult = result;
  renderEverything(inputs, result);
}

function syncModeUi() {
  const afford = state.mode === "afford";
  $("mode-loan").setAttribute("aria-pressed", String(!afford));
  $("mode-afford").setAttribute("aria-pressed", String(afford));
  $("field-amount").hidden = afford;
  $("field-payment").hidden = !afford;
}

function syncFeeUi() {
  $("fee-fields").hidden = !feesToggle.checked;
}

function copyShareLink() {
  const base = location.href.split(/[?#]/)[0];
  const url = base + "?" + buildQueryString(readInputs());
  const status = $("share-status");

  function fallback() {
    window.prompt("Copy this link:", url);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function () {
      status.textContent = "Link copied! Anyone who opens it sees this exact setup.";
    }, fallback);
  } else {
    fallback();
  }
}

Object.keys(sliders).forEach(function (id) {
  sliders[id].addEventListener("input", update);
});

feesToggle.addEventListener("change", function () {
  syncFeeUi();
  update();
});

$("mode-loan").addEventListener("click", function () {
  state.mode = "loan";
  syncModeUi();
  update();
});
$("mode-afford").addEventListener("click", function () {
  state.mode = "afford";
  syncModeUi();
  update();
});

document.querySelectorAll(".chip").forEach(function (chip) {
  chip.addEventListener("click", function () {
    sliders.extra.value = chip.dataset.extra;
    update();
  });
});

$("pin").addEventListener("click", function () {
  state.pinned = readInputs();
  update();
});
$("unpin").addEventListener("click", function () {
  state.pinned = null;
  update();
});

$("print").addEventListener("click", function () {
  renderPrintArea();
  window.print();
});
window.addEventListener("beforeprint", renderPrintArea);

$("share").addEventListener("click", copyShareLink);

// Start up: apply a share link if there is one, then draw everything.
loadFromQueryString(location.search);
syncModeUi();
syncFeeUi();
update();
