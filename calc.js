// Exact money maths. Money is stored as whole cents and rates as thousandths
// of a percent, so floating-point rounding can't creep into balances.
(function (root) {
  const FREQUENCIES = {
    daily: { periods: 365, months: 0 },
    monthly: { periods: 12, months: 1 },
    quarterly: { periods: 4, months: 3 },
    semiannual: { periods: 2, months: 6 },
    annual: { periods: 1, months: 12 },
  };
  const MAX_SCHEDULE_MONTHS = 2400;

  function divideRounded(numerator, denominator) {
    const n = BigInt(numerator);
    const d = BigInt(denominator);
    return Number((2n * n + d) / (2n * d));
  }

  // Accepts Arabic-Indic digits and Arabic separators from a phone keyboard.
  function normalizeDigits(text) {
    return String(text)
      .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
      .replace(/٫/g, '.')
      .replace(/[٬،]/g, ',');
  }

  function parseMoney(text) {
    const clean = normalizeDigits(text).replace(/[,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
    const [whole, fraction = ''] = clean.split('.');
    const cents = Number(whole + fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) ? cents : null;
  }

  // Tidies a money field while it's being typed: adds commas, and drops
  // anything that isn't a digit or a first decimal point.
  function groupTypedMoney(text) {
    const clean = normalizeDigits(text).replace(/[^\d.]/g, '');
    const dot = clean.indexOf('.');
    const rawWhole = dot === -1 ? clean : clean.slice(0, dot);
    const whole = rawWhole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (dot === -1) return whole;
    const fraction = clean.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    return `${whole || '0'}.${fraction}`;
  }

  function parseRate(text) {
    const clean = normalizeDigits(text).replace(/[%٪\s]/g, '');
    if (!/^\d+(\.\d{1,3})?$/.test(clean)) return null;
    const [whole, fraction = ''] = clean.split('.');
    const rate = Number(whole + fraction.padEnd(3, '0'));
    return rate <= 100000 ? rate : null;
  }

  function formatMoney(cents) {
    const text = String(Math.abs(cents)).padStart(3, '0');
    const whole = text.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (cents < 0 ? '-' : '') + whole + '.' + text.slice(-2);
  }

  function formatRate(rateMilli) {
    const text = String(rateMilli).padStart(4, '0');
    const decimals = text.slice(-3).replace(/0+$/, '');
    return text.slice(0, -3) + (decimals ? '.' + decimals : '') + '%';
  }

  // ---------- Dates (ISO strings compare correctly as plain text) ----------

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function isValidDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
    const [y, m, d] = iso.split('-').map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function addMonths(iso, count) {
    const [y, m, d] = iso.split('-').map(Number);
    const index = y * 12 + (m - 1) + count;
    const year = Math.floor(index / 12);
    const month = index - year * 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return `${year}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`;
  }

  function daysBetween(fromIso, toIso) {
    const toUtc = (iso) => {
      const [y, m, d] = iso.split('-').map(Number);
      return Date.UTC(y, m - 1, d);
    };
    return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86400000);
  }

  // ---------- Certificates ----------

  function calculatedPayout(amountCents, rateMilli, frequency) {
    return divideRounded(
      BigInt(amountCents) * BigInt(rateMilli),
      100000 * FREQUENCIES[frequency].periods
    );
  }

  function payoutCents(cert) {
    return cert.payoutOverrideCents != null
      ? cert.payoutOverrideCents
      : calculatedPayout(cert.amountCents, cert.rateMilli, cert.frequency);
  }

  // Daily interest builds up unrounded, so a year is the full rate. Other
  // certificates pay rounded amounts, so a year is those payouts added up.
  function annualCents(cert) {
    if (cert.frequency === 'daily' && cert.payoutOverrideCents == null) {
      return divideRounded(BigInt(cert.amountCents) * BigInt(cert.rateMilli), 100000);
    }
    return payoutCents(cert) * FREQUENCIES[cert.frequency].periods;
  }

  function monthlyCents(cert) {
    return divideRounded(annualCents(cert), 12);
  }

  function dailyInterestFor(cert, days) {
    if (cert.payoutOverrideCents != null) return cert.payoutOverrideCents * days;
    return divideRounded(
      BigInt(cert.amountCents) * BigInt(cert.rateMilli) * BigInt(days),
      100000 * 365
    );
  }

  // Scheduled payouts are counted back from the end date, today included.
  function remainingPayoutDates(cert, today) {
    const step = FREQUENCIES[cert.frequency].months;
    const dates = [];
    for (let k = 0; ; k++) {
      const date = addMonths(cert.endDate, -k * step);
      if (date < today) break;
      dates.unshift(date);
    }
    return dates;
  }

  function summarizeCertificate(cert, today) {
    const hasEnd = Boolean(cert.endDate);
    const ended = hasEnd && cert.endDate < today;
    const summary = {
      payout: payoutCents(cert),
      monthly: monthlyCents(cert),
      annual: annualCents(cert),
      ended,
      daysLeft: hasEnd ? daysBetween(today, cert.endDate) : null,
      payoutsLeft: null,
      leftToReceive: null,
      nextPayout: null,
      earnedSoFar: null,
      daysEarned: null,
    };

    if (cert.frequency === 'daily') {
      if (hasEnd) {
        summary.payoutsLeft = Math.max(summary.daysLeft, 0);
        summary.leftToReceive = dailyInterestFor(cert, summary.payoutsLeft);
      }
      if (cert.startDate) {
        const lastDay = ended ? cert.endDate : today;
        summary.daysEarned = Math.max(daysBetween(cert.startDate, lastDay), 0);
        summary.earnedSoFar = dailyInterestFor(cert, summary.daysEarned);
      }
    } else if (hasEnd) {
      const dates = remainingPayoutDates(cert, today);
      summary.payoutsLeft = dates.length;
      summary.leftToReceive = summary.payout * dates.length;
      summary.nextPayout = dates[0] || null;
    }
    return summary;
  }

  // ---------- Loans ----------

  function monthlyInterest(balanceCents, rateMilli) {
    return divideRounded(BigInt(balanceCents) * BigInt(rateMilli), 1200000);
  }

  function countMonthlyPayments(nextDate, endDate) {
    let count = 0;
    while (count < MAX_SCHEDULE_MONTHS && addMonths(nextDate, count) <= endDate) count++;
    return count;
  }

  // Equal monthly installment on a reducing balance.
  function calculatedInstallment(balanceCents, rateMilli, payments) {
    if (payments <= 0) return balanceCents;
    if (rateMilli === 0) return Math.ceil(balanceCents / payments);
    const r = rateMilli / 100000 / 12;
    return Math.round((balanceCents * r) / (1 - Math.pow(1 + r, -payments)));
  }

  function calculatedLoanPayment(loan) {
    if (loan.type === 'interestOnly') return monthlyInterest(loan.balanceCents, loan.rateMilli);
    if (!loan.endDate || !loan.nextDate) return null;
    return calculatedInstallment(
      loan.balanceCents,
      loan.rateMilli,
      countMonthlyPayments(loan.nextDate, loan.endDate)
    );
  }

  function loanPayment(loan) {
    return loan.paymentOverrideCents != null ? loan.paymentOverrideCents : calculatedLoanPayment(loan);
  }

  // Replays the schedule from the saved balance, assuming each payment was
  // made on its date. A payment due today counts as still to come.
  function summarizeLoan(loan, today) {
    const payment = loanPayment(loan) || 0;
    let balance = loan.balanceCents;
    let next = loan.nextDate;

    for (let k = 0; k < MAX_SCHEDULE_MONTHS && balance > 0; k++) {
      next = addMonths(loan.nextDate, k);
      if (next >= today) break;
      if (loan.type === 'interestOnly') continue;
      const interest = monthlyInterest(balance, loan.rateMilli);
      const isLast = loan.paymentOverrideCents == null && loan.endDate && next >= loan.endDate;
      const paid = isLast ? balance + interest : Math.min(payment, balance + interest);
      balance = balance + interest - paid;
    }

    const paidOff = balance === 0;
    const overdue = !paidOff && Boolean(loan.endDate) && loan.endDate < today;
    const active = !paidOff && !overdue;
    let interestDue = 0;
    if (active) {
      interestDue = loan.type === 'interestOnly' ? payment : monthlyInterest(balance, loan.rateMilli);
    }
    return {
      balance,
      paidOff,
      overdue,
      payment: active ? Math.min(payment, loan.type === 'interestOnly' ? payment : balance + interestDue) : 0,
      interest: interestDue,
      nextPayment: active ? next : null,
      daysLeft: loan.endDate ? daysBetween(today, loan.endDate) : null,
    };
  }

  // ---------- Totals ----------

  // Ended certificates no longer hold money or generate income.
  function summarizeBank(bank, today) {
    const sum = {
      worth: 0,
      certMonthly: 0,
      certAnnual: 0,
      leftToReceive: 0,
      activeCerts: 0,
      endedCerts: 0,
      owed: 0,
      loanPayment: 0,
      loanInterest: 0,
      averageRate: 0,
      monthlyProfit: 0,
      monthlyGet: 0,
    };
    let weighted = 0n;
    for (const cert of bank.certificates) {
      const s = summarizeCertificate(cert, today);
      if (s.ended) {
        sum.endedCerts += 1;
        continue;
      }
      sum.activeCerts += 1;
      sum.worth += cert.amountCents;
      sum.certMonthly += s.monthly;
      sum.certAnnual += s.annual;
      sum.leftToReceive += s.leftToReceive || 0;
      weighted += BigInt(cert.amountCents) * BigInt(cert.rateMilli);
    }
    if (sum.worth > 0) sum.averageRate = divideRounded(weighted, sum.worth);
    for (const loan of bank.loans) {
      const s = summarizeLoan(loan, today);
      sum.owed += s.balance;
      sum.loanPayment += s.payment;
      sum.loanInterest += s.interest;
    }
    sum.monthlyProfit = sum.certMonthly - sum.loanInterest;
    sum.monthlyGet = sum.certMonthly - sum.loanPayment;
    return sum;
  }

  function summarizeAll(banks, today) {
    const total = {
      worth: 0, certMonthly: 0, certAnnual: 0, leftToReceive: 0, activeCerts: 0, endedCerts: 0,
      owed: 0, loanPayment: 0, loanInterest: 0, monthlyProfit: 0, monthlyGet: 0,
    };
    for (const bank of banks) {
      const s = summarizeBank(bank, today);
      for (const key of Object.keys(total)) total[key] += s[key];
    }
    return total;
  }

  const api = {
    FREQUENCIES,
    normalizeDigits,
    parseMoney,
    groupTypedMoney,
    parseRate,
    formatMoney,
    formatRate,
    isValidDate,
    addMonths,
    daysBetween,
    calculatedPayout,
    payoutCents,
    annualCents,
    monthlyCents,
    remainingPayoutDates,
    summarizeCertificate,
    monthlyInterest,
    countMonthlyPayments,
    calculatedLoanPayment,
    loanPayment,
    summarizeLoan,
    summarizeBank,
    summarizeAll,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
