(function () {
  const STORAGE_KEY = 'elazhary-finance-v2';
  const OLD_STORAGE_KEY = 'money-cycle-v1';
  const LANG_KEY = 'elazhary-lang';
  const ENDING_SOON_DAYS = 30;
  const FREQUENCY_ORDER = ['daily', 'monthly', 'quarterly', 'semiannual', 'annual'];
  const LOAN_TYPES = ['installment', 'interestOnly'];

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const dialog = $('dialog');

  const ARCH_OUTER = 'M12 56V31C12 21 24 15 32 7C40 15 52 21 52 31V56H42V33C42 27 36 23 32 19C28 23 22 27 22 33V56Z';
  const ARCH_BAR = 'M22 38H42V45H22Z';
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14 8l3 3"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    even: '<path d="M5 12h14"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };

  let lang = loadLang();
  let state = loadData();
  let dialogContext = null;
  let toastTimer = null;
  let syncApi = null;
  let syncStatus = window.FIREBASE_CONFIG ? { state: 'starting' } : null;

  // ---------- Storage ----------

  function loadLang() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'en' || saved === 'ar') return saved;
    } catch (err) { /* Storage blocked: use the default language. */ }
    return 'en';
  }

  function loadData() {
    for (const key of [STORAGE_KEY, OLD_STORAGE_KEY]) {
      try {
        const saved = normalizeData(JSON.parse(localStorage.getItem(key)));
        if (saved) return saved;
      } catch (err) {
        console.error('Could not read saved data', err);
      }
    }
    return { version: 2, banks: [] };
  }

  function storeLocally() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      showToast(t('saveFailed'));
    }
  }

  function save() {
    storeLocally();
    if (syncApi) syncApi.changed();
  }

  function isValidCert(c) {
    return typeof c.id === 'string' &&
      Number.isSafeInteger(c.amountCents) && c.amountCents > 0 &&
      Number.isSafeInteger(c.rateMilli) && c.rateMilli >= 0 &&
      FREQUENCY_ORDER.includes(c.frequency) &&
      (c.endDate == null || Calc.isValidDate(c.endDate)) &&
      (c.startDate == null || Calc.isValidDate(c.startDate)) &&
      (c.payoutOverrideCents == null || Number.isSafeInteger(c.payoutOverrideCents));
  }

  function isValidLoan(l) {
    return typeof l.id === 'string' &&
      Number.isSafeInteger(l.balanceCents) && l.balanceCents >= 0 &&
      Number.isSafeInteger(l.rateMilli) && l.rateMilli >= 0 &&
      LOAN_TYPES.includes(l.type) &&
      Calc.isValidDate(l.nextDate) &&
      (l.endDate == null || Calc.isValidDate(l.endDate)) &&
      (l.paymentOverrideCents == null || Number.isSafeInteger(l.paymentOverrideCents));
  }

  // Also accepts data and backups from the first version of the app.
  function normalizeData(data) {
    if (!data || !Array.isArray(data.banks)) return null;
    const banks = data.banks.map((bank) => ({ ...bank, loans: bank.loans || [] }));
    const valid = banks.every((bank) =>
      typeof bank.id === 'string' &&
      (typeof bank.name === 'string' || findCatalog(bank.catalogId)) &&
      Array.isArray(bank.certificates) && bank.certificates.every(isValidCert) &&
      Array.isArray(bank.loans) && bank.loans.every(isValidLoan));
    return valid ? { version: 2, banks } : null;
  }

  // ---------- Helpers ----------

  function t(key, vars) {
    let text = I18N[lang][key] ?? I18N.en[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, value);
    }
    return text;
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icon(name) {
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  function logoMark() {
    return `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path d="${ARCH_OUTER}"/><path d="${ARCH_BAR}"/></svg>`;
  }

  function archWatermark() {
    return `<svg class="watermark" viewBox="0 0 64 64" aria-hidden="true"><path d="${ARCH_OUTER}"/><path d="${ARCH_BAR}"/></svg>`;
  }

  function money(cents) {
    return `<bdi class="num" dir="ltr">${Calc.formatMoney(cents)}</bdi>`;
  }

  function signedMoney(cents) {
    const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
    return `<bdi class="num" dir="ltr">${sign}${Calc.formatMoney(Math.abs(cents))}</bdi>`;
  }

  function rateText(rateMilli) {
    return `<bdi class="num" dir="ltr">${Calc.formatRate(rateMilli)}</bdi>`;
  }

  function count(n) {
    return `<bdi class="num" dir="ltr">${n}</bdi>`;
  }

  function todayIso() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function formatDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(t('locale'), {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
  }

  function findCatalog(id) {
    return BANKS.find((bank) => bank.id === id);
  }

  function findBank(id) {
    return state.banks.find((bank) => bank.id === id);
  }

  function bankName(bank) {
    const catalog = findCatalog(bank.catalogId);
    return catalog ? catalog[lang] : bank.name;
  }

  function bankColor(bank) {
    const catalog = findCatalog(bank.catalogId);
    return catalog ? catalog.color : '#2f4f46';
  }

  function badge(entry, name, color) {
    const mono = entry.mono || name.trim().slice(0, 2).toUpperCase();
    const content = entry.logo
      ? `<img src="logos/${esc(entry.logo)}" alt="">`
      : `<span dir="ltr">${esc(mono)}</span>`;
    const size = mono.length > 3 ? ' badge-long' : '';
    return `<span class="badge${size}" style="--bank:${color}" aria-hidden="true">${content}</span>`;
  }

  function bankBadge(bank) {
    const catalog = findCatalog(bank.catalogId);
    return badge(catalog || {}, bankName(bank), bankColor(bank));
  }

  function statusOf(value) {
    if (value > 0) return { cls: 'gain', icon: 'up', key: 'statusEarning' };
    if (value < 0) return { cls: 'loss', icon: 'down', key: 'statusLosing' };
    return { cls: 'even', icon: 'even', key: 'statusEven' };
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  }

  // ---------- Screens ----------

  function currentBankId() {
    const match = location.hash.match(/^#bank\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function render() {
    document.documentElement.lang = lang;
    document.documentElement.dir = t('dir');
    if (syncStatus && ['starting', 'signedOut', 'denied'].includes(syncStatus.state)) {
      app.innerHTML = renderSignIn();
      document.title = 'ELAZHARY FINANCE';
      return;
    }
    const bank = currentBankId() ? findBank(currentBankId()) : null;
    app.innerHTML = bank ? renderBankScreen(bank) : renderHome();
    document.title = bank
      ? `${bankName(bank)} · ELAZHARY FINANCE`
      : 'ELAZHARY FINANCE';
  }

  function renderTopbar() {
    return `
      <header class="topbar">
        <div class="brand">
          ${logoMark()}
          <div class="brand-text">
            <span class="brand-name">${t('brandName')}</span>
            <span class="brand-sub">${t('brandSub')}</span>
          </div>
        </div>
        <div class="topbar-end">
          <span id="sync-status" class="sync" role="status">${renderSyncBadge()}</span>
          <button type="button" class="lang" data-action="toggle-lang" lang="${lang === 'en' ? 'ar' : 'en'}">${t('otherLang')}</button>
        </div>
      </header>`;
  }

  function renderSyncBadge() {
    if (!syncStatus) return '';
    const labels = { synced: 'syncSynced', saving: 'syncSaving', offline: 'syncOffline' };
    const key = labels[syncStatus.state];
    if (!key) return '';
    return `<span class="sync-dot sync-${syncStatus.state}" aria-hidden="true"></span>${t(key)}`;
  }

  function renderSignIn() {
    const { state: status } = syncStatus;
    const message = status === 'denied' ? `<p class="error sign-in-error" role="alert">${t('signInDenied')}</p>` : '';
    const button = status === 'starting'
      ? `<p class="sign-in-loading">${t('loading')}</p>`
      : `<button type="button" class="btn btn-gold" data-action="sign-in">${t('signInButton')}</button>`;
    return `
      <div class="screen sign-in">
        <div class="hero-wrap">
          ${renderTopbar()}
          <section class="hero hero-home hero-welcome">
            ${archWatermark()}
            <div class="hero-inner">
              <h1>${t('signInTitle')}</h1>
              <p>${t('signInText')}</p>
              ${message}
              ${button}
            </div>
          </section>
        </div>
      </div>`;
  }

  function renderHome() {
    const today = todayIso();
    const sum = Calc.summarizeAll(state.banks, today);
    const hasData = sum.activeCerts > 0 || sum.owed > 0;
    const status = statusOf(sum.monthlyProfit);

    const statusBlock = hasData ? `
      <div class="status status-${status.cls}">
        <p class="status-title">${icon(status.icon)}<span>${t(status.key)}</span></p>
        <p class="status-value">${signedMoney(sum.monthlyProfit)} <small>${t('perMonthShort')}</small></p>
        <p class="status-detail">${t('statusDetail', { earn: money(sum.certMonthly), cost: money(sum.loanInterest) })}</p>
      </div>` : '';

    const haveNote = t('haveNote', { n: count(sum.activeCerts) }) +
      (sum.endedCerts ? ` · ${t('endedNote', { n: count(sum.endedCerts) })}` : '');

    const leftNote = sum.leftToReceive > 0
      ? `<p class="hero-foot">${t('leftTotal', { amount: money(sum.leftToReceive) })}</p>` : '';

    const hero = state.banks.length ? `
      <section class="hero hero-home">
        ${archWatermark()}
        <div class="hero-inner">
          ${renderHeroDate(today)}
          ${statusBlock}
          <dl class="tiles tiles-4">
            ${tile(t('have'), money(sum.worth), haveNote)}
            ${tile(t('owe'), money(sum.owed), t('oweNote', { amount: money(sum.loanPayment) }))}
            ${tile(t('certsMake'), money(sum.certMonthly), t('perMonth'))}
            ${tile(t('youGet'), signedMoney(sum.monthlyGet), t('youGetNote'))}
          </dl>
          ${leftNote}
        </div>
      </section>` : `
      <section class="hero hero-home hero-welcome">
        ${archWatermark()}
        <div class="hero-inner">
          ${renderHeroDate(today)}
          <h1>${t('welcomeTitle')}</h1>
          <p>${t('welcomeText')}</p>
          <button type="button" class="btn btn-gold" data-action="add-bank">${icon('plus')}${t('addBank')}</button>
        </div>
      </section>`;

    const list = state.banks.length ? `
      <section class="block">
        <div class="block-head">
          <h2>${t('yourBanks')}</h2>
          <button type="button" class="btn btn-quiet" data-action="add-bank">${icon('plus')}${t('addBank')}</button>
        </div>
        <ul class="bank-list">${state.banks.map((bank) => renderBankRow(bank, today)).join('')}</ul>
      </section>` : '';

    return `
      <div class="screen">
        <div class="hero-wrap">${renderTopbar()}${hero}</div>
        <main class="content">
          ${list}
          ${renderBackup()}
        </main>
      </div>`;
  }

  function renderHeroDate(today) {
    return `<p class="hero-date">${t('today', { date: formatDate(today) })} · ${t('currencyNote')}</p>`;
  }

  function tile(label, value, note) {
    return `
      <div class="tile">
        <dt>${label}</dt>
        <dd>
          <span class="tile-value">${value}</span>
          ${note ? `<span class="tile-note">${note}</span>` : ''}
        </dd>
      </div>`;
  }

  function renderBankRow(bank, today) {
    const sum = Calc.summarizeBank(bank, today);
    const hasData = sum.activeCerts > 0 || sum.owed > 0;
    const status = statusOf(sum.monthlyProfit);
    const details = [];
    if (sum.worth) details.push(t('bankRowWorth', { amount: money(sum.worth) }));
    if (sum.owed) details.push(t('bankRowOwed', { amount: money(sum.owed) }));
    const trail = hasData ? `
      <span class="row-status status-${status.cls}">
        ${icon(status.icon)}
        <span>${signedMoney(sum.monthlyProfit)}<small>${t('perMonthShort')}</small></span>
      </span>` : '';
    return `
      <li>
        <a class="bank-row" href="#bank/${encodeURIComponent(bank.id)}">
          ${bankBadge(bank)}
          <span class="bank-row-main">
            <span class="bank-row-name">${esc(bankName(bank))}</span>
            <span class="bank-row-detail">${details.length ? details.map((d) => `<span>${d}</span>`).join('') : t('bankRowEmpty')}</span>
          </span>
          ${trail}
          <span class="row-chevron">${icon('chevron')}</span>
        </a>
      </li>`;
  }

  function renderBackup() {
    const shared = Boolean(syncStatus);
    const account = shared && syncStatus.userName
      ? `<p class="backup-account">${t('signedInAs', { name: `<bdi>${esc(syncStatus.userName)}</bdi>` })}</p>` : '';
    const editor = shared && syncStatus.updatedBy
      ? `<p class="backup-account">${t('lastUpdatedBy', { name: `<bdi>${esc(syncStatus.updatedBy)}</bdi>` })}</p>` : '';
    const signOut = shared
      ? `<button type="button" class="btn btn-quiet" data-action="sign-out">${t('signOut')}</button>` : '';
    return `
      <footer class="backup">
        <p>${t(shared ? 'backupNoteShared' : 'backupNote')}</p>
        ${account}
        ${editor}
        <div class="backup-actions">
          <button type="button" class="btn btn-quiet" data-action="export">${icon('download')}${t('saveBackup')}</button>
          <button type="button" class="btn btn-quiet" data-action="import">${icon('upload')}${t('restoreBackup')}</button>
          ${signOut}
        </div>
      </footer>`;
  }

  function renderBankScreen(bank) {
    const today = todayIso();
    const sum = Calc.summarizeBank(bank, today);
    const hasData = sum.activeCerts > 0 || sum.owed > 0;
    const status = statusOf(sum.monthlyProfit);
    const statusBlock = hasData ? `
      <div class="status status-${status.cls} status-compact">
        <p class="status-title">${icon(status.icon)}<span>${t(status.key)}</span></p>
        <p class="status-value">${signedMoney(sum.monthlyProfit)} <small>${t('perMonthShort')}</small></p>
      </div>` : '';

    const renameButton = bank.catalogId ? '' : `
      <button type="button" class="btn btn-quiet" data-action="rename-bank" data-bank="${esc(bank.id)}">${icon('edit')}${t('renameBank')}</button>`;

    return `
      <div class="screen">
        <div class="hero-wrap">
          ${renderTopbar()}
          <section class="hero hero-bank" style="--bank:${bankColor(bank)}">
            ${archWatermark()}
            <div class="hero-inner">
              <a class="back" href="#">${icon('back')}<span>${t('back')}</span></a>
              <div class="hero-bank-title">
                ${bankBadge(bank)}
                <h1>${esc(bankName(bank))}</h1>
              </div>
              ${statusBlock}
              <dl class="tiles tiles-3">
                ${tile(t('certsWorth'), money(sum.worth))}
                ${tile(t('interest'), rateText(sum.averageRate), t('interestAverage'))}
                ${tile(t('monthlyProfit'), money(sum.certMonthly), t('monthlyProfitNote'))}
                ${tile(t('loansDue'), money(sum.owed))}
                ${tile(t('monthlyPayment'), money(sum.loanPayment))}
                ${tile(t('youGet'), signedMoney(sum.monthlyGet), t('youGetNote'))}
              </dl>
            </div>
          </section>
        </div>
        <main class="content content-bank">
          <section class="block">
            <div class="block-head">
              <h2>${t('certificates')}</h2>
              <button type="button" class="btn btn-quiet" data-action="add-cert" data-bank="${esc(bank.id)}">${icon('plus')}${t('addCertificate')}</button>
            </div>
            ${renderCertificates(bank, today)}
          </section>
          <section class="block">
            <div class="block-head">
              <h2>${t('loans')}</h2>
              <button type="button" class="btn btn-quiet" data-action="add-loan" data-bank="${esc(bank.id)}">${icon('plus')}${t('addLoan')}</button>
            </div>
            ${renderLoans(bank, today)}
          </section>
          <footer class="bank-foot">
            ${renameButton}
            <button type="button" class="btn btn-quiet btn-danger" data-action="delete-bank" data-bank="${esc(bank.id)}">${icon('trash')}${t('deleteBank')}</button>
          </footer>
        </main>
      </div>`;
  }

  function renderCertificates(bank, today) {
    if (!bank.certificates.length) return `<p class="empty">${t('noCerts')}</p>`;
    // No end date sorts last; otherwise the soonest to end comes first.
    const sorted = [...bank.certificates].sort((a, b) =>
      (a.endDate || '9999').localeCompare(b.endDate || '9999'));
    return `<ul class="entries">${sorted.map((c) => renderCert(bank, c, today)).join('')}</ul>`;
  }

  function endInfo(cert, s) {
    if (!cert.endDate) return { value: t('noEndDate'), note: '' };
    const date = `<bdi class="num">${formatDate(cert.endDate)}</bdi>`;
    if (s.ended) return { value: date, note: `<span class="tag tag-ended">${t('ended')}</span>` };
    if (s.daysLeft === 0) return { value: date, note: `<span class="tag tag-soon">${t('endsToday')}</span>` };
    if (s.daysLeft <= ENDING_SOON_DAYS) {
      return { value: date, note: `<span class="tag tag-soon">${t('endingSoon', { n: count(s.daysLeft) })}</span>` };
    }
    return { value: date, note: t('daysLeft', { n: count(s.daysLeft) }) };
  }

  function row(label, value, note) {
    return `
      <div class="fact">
        <dt>${label}</dt>
        <dd>${value}${note ? `<span class="fact-note">${note}</span>` : ''}</dd>
      </div>`;
  }

  function entryActions(kind, bank, id) {
    return `
      <div class="entry-actions">
        <button type="button" class="icon-btn" data-action="edit-${kind}" data-bank="${esc(bank.id)}" data-id="${esc(id)}" aria-label="${t('edit')}" title="${t('edit')}">${icon('edit')}</button>
        <button type="button" class="icon-btn icon-btn-danger" data-action="delete-${kind}" data-bank="${esc(bank.id)}" data-id="${esc(id)}" aria-label="${t('delete')}" title="${t('delete')}">${icon('trash')}</button>
      </div>`;
  }

  function renderCert(bank, cert, today) {
    const s = Calc.summarizeCertificate(cert, today);
    const end = endInfo(cert, s);
    const source = cert.payoutOverrideCents != null ? t('enteredByYou') : t('calculated');
    const next = cert.frequency === 'daily'
      ? (s.ended ? '–' : t('everyDay'))
      : (s.nextPayout ? `<bdi class="num">${formatDate(s.nextPayout)}</bdi>` : '–');
    const left = s.leftToReceive == null
      ? row(t('leftToReceive'), '–')
      : row(t('leftToReceive'), money(s.leftToReceive), t('payoutsLeft', { n: count(s.payoutsLeft) }));
    const earned = s.earnedSoFar == null ? '' :
      row(t('earnedSoFar'), money(s.earnedSoFar), t('daysCounted', { n: count(s.daysEarned) }));
    return `
      <li class="entry${s.ended ? ' is-ended' : ''}">
        <div class="entry-head">
          <div class="entry-title">
            <h3><bdi>${esc(cert.name || t('certificate'))}</bdi></h3>
            <p class="entry-amount">${money(cert.amountCents)}</p>
          </div>
          ${entryActions('cert', bank, cert.id)}
        </div>
        <dl class="facts">
          ${row(t('interest'), rateText(cert.rateMilli), t(`freq_${cert.frequency}`))}
          ${row(t('perPayout'), `${money(s.payout)} / ${t(`per_${cert.frequency}`)}`, source)}
          ${row(t('perMonthLabel'), s.ended ? '–' : money(s.monthly))}
          ${row(t('nextPayout'), next)}
          ${row(t('ends'), end.value, end.note)}
          ${left}
          ${earned}
        </dl>
      </li>`;
  }

  function renderLoans(bank, today) {
    if (!bank.loans.length) return `<p class="empty">${t('noLoans')}</p>`;
    return `
      <ul class="entries">${bank.loans.map((l) => renderLoan(bank, l, today)).join('')}</ul>
      <p class="assumption">${t('assumption')}</p>`;
  }

  function renderLoan(bank, loan, today) {
    const s = Calc.summarizeLoan(loan, today);
    let endNote = '';
    if (s.paidOff) endNote = `<span class="tag tag-ended">${t('paidOff')}</span>`;
    else if (s.overdue) endNote = `<span class="tag tag-loss">${t('overdue')}</span>`;
    else if (loan.endDate) endNote = t('daysLeft', { n: count(s.daysLeft) });
    const endValue = loan.endDate ? `<bdi class="num">${formatDate(loan.endDate)}</bdi>` : t('noEndDate');
    const source = loan.paymentOverrideCents != null ? t('enteredByYou') : t('calculated');
    const dueAtEnd = loan.type === 'interestOnly' && loan.endDate && !s.paidOff
      ? row(t('dueAtEnd'), money(s.balance)) : '';
    return `
      <li class="entry${s.paidOff ? ' is-ended' : ''}">
        <div class="entry-head">
          <div class="entry-title">
            <h3><bdi>${esc(loan.name || t('loan'))}</bdi></h3>
            <p class="entry-amount">${money(s.balance)}</p>
          </div>
          ${entryActions('loan', bank, loan.id)}
        </div>
        <dl class="facts">
          ${row(t('interest'), rateText(loan.rateMilli), t(`type_${loan.type}`))}
          ${row(t('monthlyPayment'), money(s.payment), s.payment ? source : '')}
          ${row(t('interestThisMonth'), money(s.interest))}
          ${row(t('nextPayment'), s.nextPayment ? `<bdi class="num">${formatDate(s.nextPayment)}</bdi>` : '–')}
          ${row(t('ends'), endValue, endNote)}
          ${dueAtEnd}
        </dl>
      </li>`;
  }

  // ---------- Dialog shell ----------

  function openDialog(html, context) {
    dialogContext = context || {};
    dialog.innerHTML = html;
    if (!dialog.open) dialog.showModal();
  }

  function dialogHead(title, sub) {
    return `
      <header class="dialog-head">
        <div>
          <h2>${title}</h2>
          ${sub ? `<p class="dialog-sub">${esc(sub)}</p>` : ''}
        </div>
        <button type="button" class="icon-btn" data-action="close-dialog" aria-label="${t('cancel')}">${icon('close')}</button>
      </header>`;
  }

  function field(id, label, control, hint) {
    return `
      <label class="field" for="${id}">
        <span class="field-label">${label}</span>
        ${control}
        ${hint !== undefined ? `<small class="field-hint" id="${id}-hint">${hint}</small>` : ''}
      </label>`;
  }

  function numberInput(id, value, placeholder) {
    return `<input id="${id}" dir="ltr" class="num" inputmode="decimal" autocomplete="off" value="${esc(value)}" placeholder="${esc(placeholder || '')}">`;
  }

  function optional(label) {
    return `${label} <em>${t('optional')}</em>`;
  }

  function fail(message) {
    $('form-error').textContent = message;
    $('form-error').scrollIntoView({ block: 'nearest' });
  }

  // ---------- Bank picker ----------

  function openBankPicker() {
    openDialog(`
      <form id="bank-form" class="form" novalidate>
        ${dialogHead(t('pickBank'))}
        <label class="field" for="bank-search">
          <span class="field-label">${t('searchBank')}</span>
          <input id="bank-search" autocomplete="off" type="search">
        </label>
        <ul class="picker" id="bank-picker"></ul>
        <label class="field" for="bank-custom">
          <span class="field-label">${t('customBank')}</span>
          <input id="bank-custom" autocomplete="off" maxlength="60" placeholder="${t('customPlaceholder')}">
        </label>
        <p class="error" id="form-error" role="alert"></p>
        <div class="dialog-actions">
          <button type="submit" class="btn btn-gold">${t('saveBank')}</button>
        </div>
      </form>`, { kind: 'bank' });
    renderPicker('');
  }

  function renderPicker(query) {
    const q = query.trim().toLowerCase();
    const taken = new Set(state.banks.map((bank) => bank.catalogId));
    const matches = BANKS.filter((bank) =>
      !taken.has(bank.id) &&
      (!q || bank.en.toLowerCase().includes(q) || bank.ar.includes(q) || bank.mono.toLowerCase().includes(q)));
    $('bank-picker').innerHTML = matches.length
      ? matches.map((bank) => `
        <li>
          <button type="button" class="picker-row" data-action="pick-bank" data-catalog="${bank.id}">
            ${badge(bank, bank[lang], bank.color)}
            <span>${esc(bank[lang])}</span>
          </button>
        </li>`).join('')
      : `<li class="picker-empty">${t('noBankMatch')}</li>`;
  }

  function addCatalogBank(catalogId) {
    const id = crypto.randomUUID();
    state.banks.push({ id, catalogId, certificates: [], loans: [] });
    dialog.close();
    commit();
    location.hash = `bank/${encodeURIComponent(id)}`;
  }

  function submitCustomBank() {
    const name = $('bank-custom').value.trim();
    if (!name) return fail(t('errBankName'));
    if (nameTaken(name, null)) return fail(t('errBankExists', { name: esc(name) }));
    const id = crypto.randomUUID();
    state.banks.push({ id, name, certificates: [], loans: [] });
    dialog.close();
    commit();
    location.hash = `bank/${encodeURIComponent(id)}`;
  }

  function nameTaken(name, exceptId) {
    const lower = name.toLowerCase();
    return state.banks.some((bank) => {
      if (bank.id === exceptId) return false;
      const catalog = findCatalog(bank.catalogId);
      return catalog
        ? catalog.en.toLowerCase() === lower || catalog.ar === name
        : bank.name.toLowerCase() === lower;
    });
  }

  function openRename(bank) {
    openDialog(`
      <form id="rename-form" class="form" novalidate>
        ${dialogHead(t('renameTitle'))}
        ${field('rename-name', t('renameBank'), `<input id="rename-name" autocomplete="off" maxlength="60" value="${esc(bank.name)}">`)}
        <p class="error" id="form-error" role="alert"></p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-quiet" data-action="close-dialog">${t('cancel')}</button>
          <button type="submit" class="btn btn-gold">${t('saveName')}</button>
        </div>
      </form>`, { kind: 'rename', bankId: bank.id });
  }

  function submitRename() {
    const name = $('rename-name').value.trim();
    if (!name) return fail(t('errBankName'));
    if (nameTaken(name, dialogContext.bankId)) return fail(t('errBankExists', { name: esc(name) }));
    findBank(dialogContext.bankId).name = name;
    dialog.close();
    commit();
  }

  // ---------- Certificate form ----------

  function openCertForm(bank, cert) {
    const freq = cert ? cert.frequency : 'monthly';
    const options = FREQUENCY_ORDER.map((f) =>
      `<option value="${f}"${f === freq ? ' selected' : ''}>${t(`freq_${f}`)}</option>`).join('');
    openDialog(`
      <form id="cert-form" class="form" novalidate>
        ${dialogHead(cert ? t('certFormEdit') : t('certFormAdd'), bankName(bank))}
        ${field('cert-name', optional(t('certName')), `<input id="cert-name" autocomplete="off" maxlength="60" value="${esc(cert ? cert.name : '')}" placeholder="${t('certNameHint')}">`)}
        <div class="field-row">
          ${field('cert-amount', t('amount'), numberInput('cert-amount', cert ? Calc.formatMoney(cert.amountCents) : '', '100,000'))}
          ${field('cert-rate', t('rate'), numberInput('cert-rate', cert ? Calc.formatRate(cert.rateMilli).replace('%', '') : '', '27.25'))}
        </div>
        <div class="field-row">
          ${field('cert-frequency', t('pays'), `<select id="cert-frequency">${options}</select>`)}
          ${field('cert-end', optional(t('endDate')), `<input id="cert-end" type="date" value="${cert && cert.endDate ? cert.endDate : ''}">`)}
        </div>
        <div id="cert-start-wrap" ${freq === 'daily' ? '' : 'hidden'}>
          ${field('cert-start', t('startDate'), `<input id="cert-start" type="date" value="${cert && cert.startDate ? cert.startDate : todayIso()}">`)}
        </div>
        ${field('cert-payout', t('generates'), numberInput('cert-payout', ''), '')}
        <p class="error" id="form-error" role="alert"></p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-quiet" data-action="close-dialog">${t('cancel')}</button>
          <button type="submit" class="btn btn-gold">${t('saveCert')}</button>
        </div>
      </form>`, {
      kind: 'cert',
      bankId: bank.id,
      id: cert ? cert.id : null,
      manual: Boolean(cert && cert.payoutOverrideCents != null),
    });
    if (dialogContext.manual) $('cert-payout').value = Calc.formatMoney(cert.payoutOverrideCents);
    updateCertPayout();
  }

  function certCalculatedPayout() {
    const amount = Calc.parseMoney($('cert-amount').value);
    const rate = Calc.parseRate($('cert-rate').value);
    if (!amount || rate == null) return null;
    return Calc.calculatedPayout(amount, rate, $('cert-frequency').value);
  }

  function updateCertPayout() {
    const calculated = certCalculatedPayout();
    $('cert-start-wrap').hidden = $('cert-frequency').value !== 'daily';
    if (!dialogContext.manual) {
      $('cert-payout').value = calculated == null ? '' : Calc.formatMoney(calculated);
    }
    $('cert-payout-hint').textContent = calculated == null ? t('calcHintEmpty') : t('calcHint');
  }

  function submitCert() {
    const amountCents = Calc.parseMoney($('cert-amount').value);
    if (!amountCents) return fail(t('errAmount'));
    const rateMilli = Calc.parseRate($('cert-rate').value);
    if (rateMilli == null) return fail(t('errRate'));
    const endDate = $('cert-end').value || null;
    if (endDate && !Calc.isValidDate(endDate)) return fail(t('errEnd'));
    const frequency = $('cert-frequency').value;
    const startDate = frequency === 'daily' ? $('cert-start').value : null;
    if (frequency === 'daily' && !Calc.isValidDate(startDate)) return fail(t('errStart'));

    const payoutText = $('cert-payout').value.trim();
    let payoutOverrideCents = null;
    if (payoutText) {
      const payout = Calc.parseMoney(payoutText);
      if (payout == null) return fail(t('errPayout'));
      if (payout !== Calc.calculatedPayout(amountCents, rateMilli, frequency)) payoutOverrideCents = payout;
    }

    const data = {
      name: $('cert-name').value.trim(),
      amountCents, rateMilli, frequency, endDate, startDate, payoutOverrideCents,
    };
    const bank = findBank(dialogContext.bankId);
    if (dialogContext.id) {
      Object.assign(bank.certificates.find((c) => c.id === dialogContext.id), data);
    } else {
      bank.certificates.push({ id: crypto.randomUUID(), ...data });
    }
    dialog.close();
    commit();
  }

  // ---------- Loan form ----------

  function openLoanForm(bank, loan) {
    const today = todayIso();
    const current = loan ? Calc.summarizeLoan(loan, today) : null;
    const type = loan ? loan.type : 'installment';
    const options = LOAN_TYPES.map((value) =>
      `<option value="${value}"${value === type ? ' selected' : ''}>${t(`type_${value}`)}</option>`).join('');
    const nextDate = current && current.nextPayment ? current.nextPayment : (loan ? loan.nextDate : '');
    openDialog(`
      <form id="loan-form" class="form" novalidate>
        ${dialogHead(loan ? t('loanFormEdit') : t('loanFormAdd'), bankName(bank))}
        ${field('loan-name', optional(t('loanName')), `<input id="loan-name" autocomplete="off" maxlength="60" value="${esc(loan ? loan.name : '')}" placeholder="${t('loanNameHint')}">`)}
        <div class="field-row">
          ${field('loan-balance', t('owedNow'), numberInput('loan-balance', current ? Calc.formatMoney(current.balance) : '', '50,000'))}
          ${field('loan-rate', t('loanRate'), numberInput('loan-rate', loan ? Calc.formatRate(loan.rateMilli).replace('%', '') : '', '29.25'))}
        </div>
        ${field('loan-type', t('howRepay'), `<select id="loan-type">${options}</select>`)}
        <div class="field-row">
          ${field('loan-next', t('nextPaymentDate'), `<input id="loan-next" type="date" value="${nextDate}">`)}
          ${field('loan-end', optional(t('endDate')), `<input id="loan-end" type="date" value="${loan && loan.endDate ? loan.endDate : ''}">`)}
        </div>
        ${field('loan-payment', t('payment'), numberInput('loan-payment', ''), '')}
        <p class="error" id="form-error" role="alert"></p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-quiet" data-action="close-dialog">${t('cancel')}</button>
          <button type="submit" class="btn btn-gold">${t('saveLoan')}</button>
        </div>
      </form>`, {
      kind: 'loan',
      bankId: bank.id,
      id: loan ? loan.id : null,
      manual: Boolean(loan && loan.paymentOverrideCents != null),
    });
    if (dialogContext.manual) $('loan-payment').value = Calc.formatMoney(loan.paymentOverrideCents);
    updateLoanPayment();
  }

  function loanFormCalculated() {
    const balanceCents = Calc.parseMoney($('loan-balance').value);
    const rateMilli = Calc.parseRate($('loan-rate').value);
    if (!balanceCents || rateMilli == null) return null;
    const type = $('loan-type').value;
    const nextDate = $('loan-next').value;
    const endDate = $('loan-end').value;
    if (type === 'installment' && (!nextDate || !endDate || endDate < nextDate)) return null;
    return Calc.calculatedLoanPayment({ balanceCents, rateMilli, type, nextDate, endDate });
  }

  function updateLoanPayment() {
    const calculated = loanFormCalculated();
    if (!dialogContext.manual) {
      $('loan-payment').value = calculated == null ? '' : Calc.formatMoney(calculated);
    }
    $('loan-payment-hint').textContent = calculated == null ? t('paymentHintEmpty') : t('paymentHint');
  }

  function submitLoan() {
    const balanceCents = Calc.parseMoney($('loan-balance').value);
    if (!balanceCents) return fail(t('errOwed'));
    const rateMilli = Calc.parseRate($('loan-rate').value);
    if (rateMilli == null) return fail(t('errRate'));
    const type = $('loan-type').value;
    const nextDate = $('loan-next').value;
    if (!Calc.isValidDate(nextDate)) return fail(t('errNextDate'));
    const endDate = $('loan-end').value || null;
    if (endDate && !Calc.isValidDate(endDate)) return fail(t('errEnd'));
    if (endDate && endDate < nextDate) return fail(t('errEndBeforeNext'));

    const paymentText = $('loan-payment').value.trim();
    const typed = paymentText ? Calc.parseMoney(paymentText) : null;
    if (paymentText && typed == null) return fail(t('errPayment'));

    const base = { balanceCents, rateMilli, type, nextDate, endDate };
    const calculated = Calc.calculatedLoanPayment(base);
    if (type === 'installment' && typed == null && calculated == null) return fail(t('errNeedEnd'));

    const paymentOverrideCents = typed != null && typed !== calculated ? typed : null;
    if (type === 'installment' && paymentOverrideCents != null) {
      const interest = Calc.monthlyInterest(balanceCents, rateMilli);
      if (paymentOverrideCents <= interest) {
        return fail(t('errPaymentLow', { amount: Calc.formatMoney(interest) }));
      }
    }

    const data = { name: $('loan-name').value.trim(), ...base, paymentOverrideCents };
    const bank = findBank(dialogContext.bankId);
    if (dialogContext.id) {
      Object.assign(bank.loans.find((l) => l.id === dialogContext.id), data);
    } else {
      bank.loans.push({ id: crypto.randomUUID(), ...data });
    }
    dialog.close();
    commit();
  }

  // ---------- Confirm ----------

  function askConfirm(title, text, yesLabel, action) {
    openDialog(`
      <div class="form">
        <header class="dialog-head"><h2>${title}</h2></header>
        <p class="confirm-text">${text}</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-quiet" data-action="close-dialog">${t('cancel')}</button>
          <button type="button" class="btn btn-solid-danger" data-action="confirm-yes">${yesLabel}</button>
        </div>
      </div>`, { kind: 'confirm', action });
  }

  function commit() {
    save();
    render();
  }

  // ---------- Backup ----------

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `elazhary-finance-backup-${todayIso()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(t('backupSaved'));
  }

  async function importBackup(file) {
    let data = null;
    try {
      data = normalizeData(JSON.parse(await file.text()));
    } catch (err) {
      data = null;
    }
    if (!data) {
      showToast(t('badBackup'));
      return;
    }
    askConfirm(
      t('confirmRestore'),
      t(syncStatus ? 'confirmRestoreShared' : 'confirmRestoreText', { banks: count(data.banks.length) }),
      t('replaceData'),
      () => {
        state = data;
        location.hash = '';
        showToast(t('restored'));
      }
    );
  }

  // ---------- Events ----------

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, bank: bankId, id } = button.dataset;
    const bank = bankId ? findBank(bankId) : null;
    switch (action) {
      case 'toggle-lang':
        lang = lang === 'en' ? 'ar' : 'en';
        try { localStorage.setItem(LANG_KEY, lang); } catch (err) { /* Language just won't be remembered. */ }
        render();
        break;
      case 'add-bank': openBankPicker(); break;
      case 'pick-bank': addCatalogBank(button.dataset.catalog); break;
      case 'rename-bank': openRename(bank); break;
      case 'delete-bank':
        askConfirm(t('confirmDeleteBank', { name: esc(bankName(bank)) }), t('confirmDeleteBankText'), t('deleteBank'), () => {
          state.banks = state.banks.filter((b) => b.id !== bank.id);
          location.hash = '';
        });
        break;
      case 'add-cert': openCertForm(bank); break;
      case 'edit-cert': openCertForm(bank, bank.certificates.find((c) => c.id === id)); break;
      case 'delete-cert':
        askConfirm(t('confirmDeleteCert'), t('confirmDeleteText', { name: esc(bankName(bank)) }), t('delete'), () => {
          bank.certificates = bank.certificates.filter((c) => c.id !== id);
        });
        break;
      case 'add-loan': openLoanForm(bank); break;
      case 'edit-loan': openLoanForm(bank, bank.loans.find((l) => l.id === id)); break;
      case 'delete-loan':
        askConfirm(t('confirmDeleteLoan'), t('confirmDeleteText', { name: esc(bankName(bank)) }), t('delete'), () => {
          bank.loans = bank.loans.filter((l) => l.id !== id);
        });
        break;
      case 'confirm-yes': {
        const run = dialogContext.action;
        dialog.close();
        // An action returns false when it isn't a change to the data.
        if (run() !== false) commit();
        break;
      }
      case 'sign-in':
        if (syncApi) syncApi.signIn().catch((err) => {
          console.error('Sign-in failed', err);
          showToast(t('signInFailed'));
        });
        break;
      case 'sign-out':
        askConfirm(
          t('confirmSignOut'),
          t(syncStatus.dirty ? 'confirmSignOutUnsaved' : 'confirmSignOutText'),
          t('signOut'),
          () => {
            syncApi.signOut().catch((err) => {
              console.error('Sign-out failed', err);
              showToast(t('signInFailed'));
            });
            return false;
          }
        );
        break;
      case 'export': exportBackup(); break;
      case 'import': $('import-file').click(); break;
      case 'close-dialog': dialog.close(); break;
    }
  });

  dialog.addEventListener('submit', (event) => {
    event.preventDefault();
    $('form-error').textContent = '';
    if (event.target.id === 'bank-form') submitCustomBank();
    if (event.target.id === 'rename-form') submitRename();
    if (event.target.id === 'cert-form') submitCert();
    if (event.target.id === 'loan-form') submitLoan();
  });

  dialog.addEventListener('input', (event) => {
    const id = event.target.id;
    if (id === 'bank-search') renderPicker(event.target.value);
    if (id === 'cert-payout') dialogContext.manual = event.target.value.trim() !== '';
    if (id === 'loan-payment') dialogContext.manual = event.target.value.trim() !== '';
    if (dialogContext && dialogContext.kind === 'cert') updateCertPayout();
    if (dialogContext && dialogContext.kind === 'loan') updateLoanPayment();
  });

  $('import-file').addEventListener('change', (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (file) importBackup(file);
  });

  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo(0, 0);
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable', err));
  }

  function startSharing() {
    import('./sync.js')
      .then((module) => module.startSync({
        config: window.FIREBASE_CONFIG,
        getState: () => state,
        setState: (next) => {
          const clean = normalizeData(next);
          if (!clean) return;
          state = clean;
          storeLocally();
          render();
        },
        clearLocal: () => {
          state = { version: 2, banks: [] };
          try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* Nothing stored to clear. */ }
          render();
        },
        onStatus: (next) => {
          const wasGate = ['starting', 'signedOut', 'denied'].includes(syncStatus.state);
          const isGate = ['starting', 'signedOut', 'denied'].includes(next.state);
          // A denied account stays on the message until someone signs in again.
          syncStatus = syncStatus.state === 'denied' && next.state === 'signedOut' ? { ...next, state: 'denied' } : next;
          if (wasGate || isGate) render();
          else if ($('sync-status')) $('sync-status').innerHTML = renderSyncBadge();
        },
      }))
      .then((api) => { syncApi = api; })
      .catch((err) => {
        // Sign-in needs the network. Fall back to this device's own copy.
        console.warn('Sharing unavailable', err);
        syncStatus = { state: 'offline' };
        render();
      });
  }

  if (window.FIREBASE_CONFIG) startSharing();
  render();
})();
