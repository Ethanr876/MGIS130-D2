/* =====================================================
   SECTION 1: DATA
   What goes in, and the fixed values the app uses.
   ===================================================== */

const MAX_AMOUNT = 100000000;  // sanity limits
const MAX_RATE = 100;          // percent per year
const MAX_MONTHS = 1200;       // 100 years

const form = document.getElementById("loan-form");

// Read the three inputs (plus the term unit) from the form.
function readInputs() {
  return {
    amount: parseFloat(form.amount.value),
    annualRate: parseFloat(form.rate.value),
    termValue: parseFloat(form.term.value),
    termUnit: form.termUnit.value // "years" or "months"
  };
}


/* =====================================================
   SECTION 2: RULES
   Validation and the payment math. No DOM access here.
   ===================================================== */

// Convert the term to a whole number of months.
function termInMonths(inputs) {
  return Math.round(
    inputs.termUnit === "years" ? inputs.termValue * 12 : inputs.termValue
  );
}

// Returns a list of problems; empty list means the inputs are fine.
function validate(inputs) {
  const errors = [];
  if (!Number.isFinite(inputs.amount) || inputs.amount <= 0) {
    errors.push("Enter a loan amount greater than 0.");
  } else if (inputs.amount > MAX_AMOUNT) {
    errors.push("Loan amount is too large.");
  }
  if (!Number.isFinite(inputs.annualRate) || inputs.annualRate < 0) {
    errors.push("Enter an interest rate of 0 or more.");
  } else if (inputs.annualRate > MAX_RATE) {
    errors.push("Interest rate can't be over " + MAX_RATE + "%.");
  }
  if (!Number.isFinite(inputs.termValue) || termInMonths(inputs) < 1) {
    errors.push("Enter a loan term of at least 1 month.");
  } else if (termInMonths(inputs) > MAX_MONTHS) {
    errors.push("Loan term can't be over 100 years.");
  }
  return errors;
}

// Standard fixed-payment formula: M = P * r / (1 - (1 + r)^-n)
function calculateLoan(inputs) {
  const principal = inputs.amount;
  const months = termInMonths(inputs);
  const monthlyRate = inputs.annualRate / 100 / 12;

  const monthlyPayment = monthlyRate === 0
    ? principal / months
    : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));

  const totalPaid = monthlyPayment * months;
  const totalInterest = totalPaid - principal;

  return {
    principal,
    months,
    monthlyPayment,
    totalPaid,
    totalInterest,
    principalShare: principal / totalPaid // 0..1, used by the pie chart
  };
}


/* =====================================================
   SECTION 3: DISPLAY
   Everything that touches the page.
   ===================================================== */

const el = {
  errors: document.getElementById("errors"),
  results: document.getElementById("results"),
  monthly: document.getElementById("monthly"),
  pie: document.getElementById("pie"),
  principalTotal: document.getElementById("principal-total"),
  interestTotal: document.getElementById("interest-total"),
  principalPct: document.getElementById("principal-pct"),
  interestPct: document.getElementById("interest-pct"),
  payments: document.getElementById("payments"),
  totalPaid: document.getElementById("total-paid")
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

function showErrors(errors) {
  el.errors.textContent = errors.join(" ");
  el.errors.hidden = false;
  el.results.hidden = true;
}

function clearErrors() {
  el.errors.hidden = true;
  el.errors.textContent = "";
}

function showResults(r) {
  const principalPct = r.principalShare * 100;
  const interestPct = 100 - principalPct;

  el.monthly.textContent = money.format(r.monthlyPayment);
  el.principalTotal.textContent = money.format(r.principal);
  el.interestTotal.textContent = money.format(r.totalInterest);
  el.principalPct.textContent = principalPct.toFixed(1) + "%";
  el.interestPct.textContent = interestPct.toFixed(1) + "%";
  el.payments.textContent = r.months;
  el.totalPaid.textContent = money.format(r.totalPaid);

  // Pie chart: a CSS conic gradient split at the principal share.
  el.pie.style.background =
    "conic-gradient(var(--principal) 0 " + principalPct + "%, " +
    "var(--interest) 0)";
  el.pie.setAttribute(
    "aria-label",
    "Pie chart: " + principalPct.toFixed(1) + "% principal, " +
    interestPct.toFixed(1) + "% interest"
  );

  el.results.hidden = false;
}


/* =====================================================
   SECTION 4: WIRING
   Connects the form to the rules and the display.
   ===================================================== */

form.addEventListener("submit", function (event) {
  event.preventDefault();
  const inputs = readInputs();
  const errors = validate(inputs);

  if (errors.length > 0) {
    showErrors(errors);
    return;
  }
  clearErrors();
  showResults(calculateLoan(inputs));
});
