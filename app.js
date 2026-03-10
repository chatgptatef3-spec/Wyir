const DB_NAME = 'miah_al_fateh_db';
const DB_VERSION = 3;
let db;
let reportCache = [];
let chartA, chartB;

const settings = {
  waterPrice: Number(localStorage.getItem('waterPrice')) || 1,
  companyName: localStorage.getItem('companyName') || 'مياه الفتح',
  companyPhone: localStorage.getItem('companyPhone') || '',
  companyAddress: localStorage.getItem('companyAddress') || '',
  cycleDay1: Number(localStorage.getItem('cycleDay1')) || 15,
  cycleDay2: Number(localStorage.getItem('cycleDay2')) || 30
};

const $ = (id) => document.getElementById(id);

document.querySelectorAll('.nav').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.nav').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    $(btn.dataset.page).classList.add('active');
    if (btn.dataset.page === 'dashboard') refreshDashboard();
    if (btn.dataset.page === 'edit') loadEditTables();
  };
});

function initSettingsForm() {
  ['waterPrice', 'companyName', 'companyPhone', 'companyAddress', 'cycleDay1', 'cycleDay2'].forEach((k) => {
    $(k).value = settings[k];
  });
  $('readPrice').value = settings.waterPrice;
}

const request = indexedDB.open(DB_NAME, DB_VERSION);
request.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains('subscribers')) db.createObjectStore('subscribers', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('readings')) db.createObjectStore('readings', { keyPath: 'rid', autoIncrement: true });
  if (!db.objectStoreNames.contains('payments')) db.createObjectStore('payments', { keyPath: 'pid', autoIncrement: true });
};
request.onsuccess = (e) => {
  db = e.target.result;
  initSettingsForm();
  setTodayDefaults();
  loadSubscribers();
  refreshDashboard();
};

function setTodayDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  ['readDate', 'payDate', 'reportFrom', 'reportTo'].forEach((id) => { if ($(id)) $(id).value = today; });
}

$('addSubscriber').onclick = () => {
  const id = $('subId').value.trim();
  const name = $('subName').value.trim();
  if (!id || !name) return alert('أدخل رقم المشترك والاسم');
  db.transaction('subscribers', 'readwrite').objectStore('subscribers').put({
    id, name, phone: $('subPhone').value.trim(), address: $('subAddress').value.trim()
  }).transaction.oncomplete = () => {
    ['subId', 'subName', 'subPhone', 'subAddress'].forEach((id2) => ($(id2).value = ''));
    loadSubscribers();
    refreshDashboard();
  };
};

function loadSubscribers() {
  $('subsTable').innerHTML = '';
  db.transaction('subscribers').objectStore('subscribers').openCursor().onsuccess = (e) => {
    const c = e.target.result;
    if (!c) return;
    const s = c.value;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.id}</td><td>${s.name}</td><td>${s.phone || ''}</td><td>${s.address || ''}</td>
      <td><button onclick="fillSubscriber('${s.id}')">تعديل</button> <button class="danger" onclick="deleteSubscriber('${s.id}')">حذف</button></td>`;
    $('subsTable').appendChild(tr);
    c.continue();
  };
}

window.fillSubscriber = async (id) => {
  const s = await getSubscriber(id);
  $('subId').value = s.id; $('subName').value = s.name; $('subPhone').value = s.phone || ''; $('subAddress').value = s.address || '';
};
window.deleteSubscriber = (id) => {
  if (!confirm('حذف المشترك؟')) return;
  db.transaction('subscribers', 'readwrite').objectStore('subscribers').delete(id).transaction.oncomplete = () => { loadSubscribers(); refreshDashboard(); };
};

$('searchSubscriber').oninput = function () {
  const v = this.value.toLowerCase();
  document.querySelectorAll('#subsTable tr').forEach((r) => (r.style.display = r.innerText.toLowerCase().includes(v) ? '' : 'none'));
};

function getSubscriber(id) {
  return new Promise((resolve) => {
    const req = db.transaction('subscribers').objectStore('subscribers').get(id);
    req.onsuccess = () => resolve(req.result);
  });
}

$('readSub').addEventListener('input', async () => {
  const s = await getSubscriber($('readSub').value.trim());
  $('readName').value = s ? s.name : '';
  const last = await getLastReading($('readSub').value.trim());
  $('readPrev').value = last ? last.curr : 0;
});

$('readCurr').addEventListener('input', () => {
  const p = Number($('readPrev').value || 0); const c = Number($('readCurr').value || 0);
  if (c < p) return;
  const cons = c - p; const due = cons * settings.waterPrice;
  $('readCons').value = cons; $('readPrice').value = settings.waterPrice; $('readDue').value = due;
});

$('saveReading').onclick = async () => {
  const sub = $('readSub').value.trim();
  const s = await getSubscriber(sub);
  if (!s) return alert('المشترك غير موجود');
  const rec = {
    subscriber: sub,
    prev: Number($('readPrev').value || 0),
    curr: Number($('readCurr').value || 0),
    cons: Number($('readCons').value || 0),
    unitPrice: Number($('readPrice').value || settings.waterPrice),
    due: Number($('readDue').value || 0),
    date: $('readDate').value || new Date().toISOString().slice(0, 10)
  };
  db.transaction('readings', 'readwrite').objectStore('readings').add(rec).transaction.oncomplete = () => {
    alert('تم حفظ القراءة'); refreshDashboard(); loadEditTables();
  };
};

$('statementSearch').addEventListener('input', () => buildStatement($('statementSearch').value.trim()));

async function buildStatement(id) {
  if (!id) return $('statementBox').innerHTML = '';
  const s = await getSubscriber(id);
  if (!s) return $('statementBox').innerHTML = 'المشترك غير موجود';
  const [readings, payments] = await Promise.all([getBySubscriber('readings', id), getBySubscriber('payments', id)]);
  const cons = readings.reduce((a, r) => a + r.cons, 0);
  const due = readings.reduce((a, r) => a + r.due, 0);
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const balance = due - paid;
  $('statementBox').innerHTML = `<h3>${s.name} - ${s.id}</h3><p class="muted">الهاتف: ${s.phone || '-'}</p><hr>
  <p>إجمالي الاستهلاك: ${cons} وحدة</p><p>إجمالي المستحق: ${due}</p><p>إجمالي المدفوع: ${paid}</p><p>الرصيد: ${balance}</p>`;
}

$('paySub').addEventListener('input', fillPaymentInfo);
async function fillPaymentInfo() {
  const id = $('paySub').value.trim();
  const s = await getSubscriber(id);
  $('payName').value = s ? s.name : '';
  const readings = await getBySubscriber('readings', id);
  const payments = await getBySubscriber('payments', id);
  const units = readings.reduce((a, r) => a + r.cons, 0);
  const due = readings.reduce((a, r) => a + r.due, 0);
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  $('payUnits').value = units;
  $('payCurrentDue').value = due;
  $('payPrevBalance').value = due - paid;
  $('payTotalDue').value = due - paid;
}

$('savePayment').onclick = async () => {
  const sub = $('paySub').value.trim();
  const s = await getSubscriber(sub);
  if (!s) return alert('المشترك غير موجود');
  const amount = Number($('payAmount').value || 0);
  if (amount <= 0) return alert('أدخل مبلغ صحيح');
  db.transaction('payments', 'readwrite').objectStore('payments').add({
    subscriber: sub,
    amount,
    method: $('payMethod').value,
    date: $('payDate').value || new Date().toISOString().slice(0, 10)
  }).transaction.oncomplete = () => { alert('تم تسجيل الدفع'); fillPaymentInfo(); refreshDashboard(); loadEditTables(); };
};

async function refreshDashboard() {
  const subs = await getAll('subscribers');
  const readings = await getAll('readings');
  const payments = await getAll('payments');
  const cons = readings.reduce((a, r) => a + r.cons, 0);
  const due = readings.reduce((a, r) => a + r.due, 0);
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  $('statSubscribers').innerText = subs.length;
  $('statConsumption').innerText = cons;
  $('statDue').innerText = due;
  $('statPaid').innerText = paid;
  $('statBalance').innerText = due - paid;
  drawCharts(cons, paid, due);
}

function drawCharts(cons, paid, due) {
  const balance = due - paid;
  if (chartA) chartA.destroy();
  if (chartB) chartB.destroy();
  chartA = new Chart($('chartConsumption'), { type: 'bar', data: { labels: ['الاستهلاك'], datasets: [{ data: [cons] }] } });
  chartB = new Chart($('chartFinance'), { type: 'doughnut', data: { labels: ['مدفوع', 'متبقي'], datasets: [{ data: [paid, balance] }] } });
}

$('invoiceSub').addEventListener('input', async () => {
  const s = await getSubscriber($('invoiceSub').value.trim());
  $('invoiceName').value = s ? s.name : '';
});

$('generateInvoiceBtn').onclick = async () => {
  const id = $('invoiceSub').value.trim();
  const html = await invoiceHtmlFor(id);
  $('invoiceView').innerHTML = html || 'لا توجد بيانات';
};

$('generateAllInvoicesBtn').onclick = async () => {
  const subs = await getAll('subscribers');
  const blocks = [];
  for (const s of subs) {
    blocks.push(await invoiceHtmlFor(s.id));
  }
  $('invoiceView').innerHTML = blocks.join('<hr>');
};

async function invoiceHtmlFor(id) {
  const s = await getSubscriber(id);
  if (!s) return '';
  const readings = await getBySubscriber('readings', id);
  const payments = await getBySubscriber('payments', id);
  const units = readings.reduce((a, r) => a + r.cons, 0);
  const due = readings.reduce((a, r) => a + r.due, 0);
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  return `<h2>${settings.companyName}</h2><p>${settings.companyAddress} | ${settings.companyPhone}</p>
  <p>المشترك: ${s.name} (${s.id})</p><table><tr><th>الوحدات</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th></tr>
  <tr><td>${units}</td><td>${due}</td><td>${paid}</td><td>${due - paid}</td></tr></table>`;
}

$('printInvoice').onclick = () => window.print();
$('pdfInvoice').onclick = () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text('Water Invoice', 10, 10);
  doc.text($('invoiceView').innerText.slice(0, 2500), 10, 20);
  doc.save('invoice.pdf');
};

$('buildReport').onclick = buildReport;
async function buildReport() {
  const from = $('reportFrom').value;
  const to = $('reportTo').value;
  const [subs, readings, payments] = await Promise.all([getAll('subscribers'), getAll('readings'), getAll('payments')]);
  const inRange = (d) => !from || !to || (d >= from && d <= to);
  reportCache = subs.map((s) => {
    const sr = readings.filter((r) => r.subscriber === s.id && inRange(r.date));
    const sp = payments.filter((p) => p.subscriber === s.id && inRange(p.date));
    const due = sr.reduce((a, r) => a + r.due, 0);
    const paid = sp.reduce((a, p) => a + p.amount, 0);
    return {
      id: s.id, name: s.name, prev: sr.at(0)?.prev || 0, curr: sr.at(-1)?.curr || 0,
      units: sr.reduce((a, r) => a + r.cons, 0), due, paid, balance: due - paid
    };
  });
  $('reportTable').innerHTML = reportCache.map((r) => `<tr><td>${r.id}</td><td>${r.name}</td><td>${r.prev}</td><td>${r.curr}</td><td>${r.units}</td><td>${r.due}</td><td>${r.paid}</td><td>${r.balance}</td></tr>`).join('');
}

$('exportReportPdf').onclick = () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text(`Report ${$('reportFrom').value} - ${$('reportTo').value}`, 10, 10);
  let y = 20;
  reportCache.forEach((r) => { doc.text(`${r.id} ${r.name} units:${r.units} due:${r.due} paid:${r.paid} balance:${r.balance}`, 10, y); y += 8; });
  doc.save('report.pdf');
};

$('saveSettings').onclick = () => {
  Object.keys(settings).forEach((k) => {
    settings[k] = ['waterPrice', 'cycleDay1', 'cycleDay2'].includes(k) ? Number($(k).value) : $(k).value;
    localStorage.setItem(k, settings[k]);
  });
  $('readPrice').value = settings.waterPrice;
  alert('تم حفظ الإعدادات');
};

$('resetData').onclick = () => {
  if (!confirm('سيتم حذف كل البيانات. متابعة؟')) return;
  indexedDB.deleteDatabase(DB_NAME);
  alert('تمت إعادة التهيئة. أعد تحميل الصفحة.');
};

async function loadEditTables() {
  const readings = (await getAll('readings')).slice(-20).reverse();
  const payments = (await getAll('payments')).slice(-20).reverse();
  $('editReadings').innerHTML = readings.map((r) => `<tr><td>${r.rid}</td><td>${r.subscriber}</td><td>${r.date}</td><td>${r.curr}</td><td>${r.due}</td><td><button class="danger" onclick="deleteReading(${r.rid})">حذف</button></td></tr>`).join('');
  $('editPayments').innerHTML = payments.map((p) => `<tr><td>${p.pid}</td><td>${p.subscriber}</td><td>${p.date}</td><td>${p.amount}</td><td>${p.method}</td><td><button class="danger" onclick="deletePayment(${p.pid})">حذف</button></td></tr>`).join('');
}
window.deleteReading = (rid) => db.transaction('readings', 'readwrite').objectStore('readings').delete(rid).transaction.oncomplete = () => { loadEditTables(); refreshDashboard(); };
window.deletePayment = (pid) => db.transaction('payments', 'readwrite').objectStore('payments').delete(pid).transaction.oncomplete = () => { loadEditTables(); refreshDashboard(); };

function getAll(store) {
  return new Promise((resolve) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}
async function getBySubscriber(store, subscriber) {
  const all = await getAll(store);
  return all.filter((x) => x.subscriber === subscriber);
}
async function getLastReading(subscriber) {
  const items = await getBySubscriber('readings', subscriber);
  return items.sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
}
