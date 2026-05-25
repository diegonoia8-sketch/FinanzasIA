import { auth, db, dbCollections } from "./config.js";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, getRedirectResult } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, onSnapshot, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, serverTimestamp, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showTab, populateSelectOptions, toggleBalancesVisibility, showLoadingOverlay, hideLoadingOverlay } from "./ui.js";
import { saveTransaction, deleteDocument, addSetting, saveRecurring, savePayroll, updatePayrollIRPF } from "./db.js";
import { renderIncomeExpenseChart, renderCategoryAnalysisChart, renderCashFlowChart, renderTendenciasChart, renderHeatmap, renderHistoryCategoryChart } from "./charts.js";
import { callGemini, callGeminiChat, resetChatHistory, categorizarConcepto, getConsejoDelDia, buildFinancialContext, compressImage, analizarNomina } from "./api.js";
import { generateAiReport, generateExlabesaReport, generateFuelReport } from "./reports.js";
import { showToast, showSaveToast, showDeleteToast, showErrorToast, showInfoToast } from "./toast.js";
import { setupRecurringListener, renderRecurringList, renderUpcomingPayments, checkAndRegisterRecurring } from "./features.js";
import { calcHealthScore, getHealthLabel, calcEndOfMonthPrediction, calcMonthComparison, detectAlerts, calcHeatmapData, calcTendencias } from "./analytics.js";
import { parseCSVFile, guessCategory } from "./csv-importer.js";

// ─── STATE ───────────────────────────────────────────────────────────────────
let userId = null;
let allUserTransactions = [];
let allRecurringItems = [];

let userCategories = [];
let userAccounts = [];
let userAccountingBooks = [];
let currentScannedImage = null;

let recurringUnsubscribe = null;
let compactMode = false;
let pendingCsvTransactions = [];
let allUserPayrolls = [];
let payrollsPassword = "";
let currentPayrollPDF = null;
let currentPayrollData = null;
let payrollTabUnlocked = false;
let payrollChartInstance = null;

// ─── AUTH ─────────────────────────────────────────────────────────────────────
const showAuthScreen = () => { document.getElementById('authScreen').classList.remove('hidden'); document.getElementById('mainApp').classList.add('hidden'); };
const showMainApp = (user) => { document.getElementById('authScreen').classList.add('hidden'); document.getElementById('mainApp').classList.remove('hidden'); document.getElementById('userGreeting').textContent = user.displayName?.split(' ')[0] || 'Hola'; };

document.getElementById('signInBtn').addEventListener('click', async () => {
    const btn = document.getElementById('signInBtn');
    btn.textContent = 'Conectando...'; btn.disabled = true;
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (error) {
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
            const { signInWithRedirect } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
            await signInWithRedirect(auth, new GoogleAuthProvider());
        } else {
            const b = document.getElementById('jsBanner');
            if (b) { b.textContent = `Error: ${error.message}`; b.classList.remove('hidden'); }
            btn.textContent = 'Acceder con Google'; btn.disabled = false;
        }
    }
});
document.getElementById('signOutBtn').addEventListener('click', () => signOut(auth));
getRedirectResult(auth).catch(() => { });

// ─── FIRESTORE LISTENERS ──────────────────────────────────────────────────────
const setupRealtimeListeners = (uid) => {
    // Transactions
    onSnapshot(query(collection(db, dbCollections.transactions), where("userId", "==", uid)), (snapshot) => {
        allUserTransactions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderDashboard();
        renderPayrollsTable();
        updatePayrollStats();
        renderPayrollsChart();
        if (!document.getElementById('transactionHistory').classList.contains('hidden')) applyFiltersAndRender();
        if (!document.getElementById('investments').classList.contains('hidden')) renderInvestments();
    });

    // Settings
    onSnapshot(doc(db, dbCollections.userSettings, uid), (snap) => {
        if (snap.exists()) {
            renderSettings(snap.data());
        } else {
            setDoc(snap.ref, {
                categories: ["Salario", "Inversiones", "Regalo", "Otros Ingresos", "Alquiler", "Comida", "Transporte", "Combustible", "Ocio", "Facturas", "Salud", "Educación", "Ropa", "Otros Gastos", "Transferencia", "Saldo Inicial", "No Contabilizados", "EXLABESA"],
                accounts: ["Efectivo", "Cuenta Bancaria", "Tarjeta de Crédito"],
                accountingBooks: ["Principal"]
            });
        }
    });

    // Recurring
    if (recurringUnsubscribe) recurringUnsubscribe();
    recurringUnsubscribe = setupRecurringListener(uid, async (items) => {
        allRecurringItems = items;
        renderRecurringList(items);
        renderUpcomingPayments(items);
        populateSelectOptions('recurringCategory', userCategories.filter(c => !['Transferencia', 'Saldo Inicial'].includes(c)));
        populateSelectOptions('recurringAccount', userAccounts);
        // Listeners para activar/desactivar, editar y eliminar
        document.querySelectorAll('.toggle-active-recurring').forEach(toggle =>
            toggle.addEventListener('change', async (e) => {
                const id = e.currentTarget.dataset.id;
                const active = e.currentTarget.checked;
                const updateData = { active };
                if (active) updateData.lastActivatedAt = serverTimestamp();
                await updateDoc(doc(db, dbCollections.recurring, id), updateData);
                showInfoToast(active ? 'Suscripción activada' : 'Suscripción pausada');
            })
        );

        document.querySelectorAll('.edit-recurring').forEach(btn =>
            btn.addEventListener('click', (e) => {
                const el = e.currentTarget;
                document.getElementById('recurringId').value = el.dataset.id;
                document.getElementById('recurringName').value = el.dataset.name;
                document.getElementById('recurringAmount').value = el.dataset.amount;
                document.getElementById('recurringDay').value = el.dataset.day;
                document.getElementById('recurringCategory').value = el.dataset.category || '';
                document.getElementById('recurringAccount').value = el.dataset.account || '';
                document.getElementById('recurringFormTitle').textContent = 'Editar Suscripción';
                document.getElementById('submitRecurringBtn').textContent = 'Guardar';
                document.getElementById('cancelEditRecurringBtn').classList.remove('hidden');
                document.getElementById('recurringName').focus();
            })
        );

        document.querySelectorAll('.delete-recurring').forEach(btn =>
            btn.addEventListener('click', async (e) => {
                if (confirm('¿Eliminar suscripción permanentemente?')) {
                    await deleteDoc(doc(db, dbCollections.recurring, e.currentTarget.dataset.id));
                    showDeleteToast();
                }
            })
        );
        const registered = await checkAndRegisterRecurring(uid, items, allUserTransactions);
        if (registered.length > 0) showInfoToast(`Auto-registrado: ${registered.join(', ')}`);
    });

    // Payrolls
    onSnapshot(query(collection(db, dbCollections.payrolls), where("userId", "==", uid), orderBy("date", "desc")), (snapshot) => {
        allUserPayrolls = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPayrollsTable();
        updatePayrollStats();
        renderPayrollsChart();
    });
};


// ─── SETTINGS ─────────────────────────────────────────────────────────────────
const renderSettings = (settings) => {
    userCategories = settings.categories || [];
    userAccounts = settings.accounts || [];
    userAccountingBooks = settings.accountingBooks || [];
    payrollsPassword = settings.payrollsPassword || "";

    const renderChips = (elementId, items, type) => {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.innerHTML = items.map(item => `
            <div class="flex items-center gap-1 bg-gray-100 text-gray-700 text-xs font-bold px-3 py-1.5 rounded-full">
                <span>${item}</span>
                <button class="delete-setting-btn text-gray-400 hover:text-red-500 ml-1 font-black leading-none" data-type="${type}" data-value="${item}">×</button>
            </div>`).join('');
        el.querySelectorAll('.delete-setting-btn').forEach(btn =>
            btn.addEventListener('click', e => deleteSetting(e.currentTarget.dataset.type, e.currentTarget.dataset.value))
        );
    };

    renderChips('categoryList', userCategories, 'categories');
    renderChips('accountList', userAccounts, 'accounts');
    renderChips('accountingBookList', userAccountingBooks, 'accountingBooks');

    const catsExp = userCategories.filter(c => !['Transferencia', 'Saldo Inicial'].includes(c));
    populateSelectOptions('category', catsExp);
    populateSelectOptions('account', userAccounts);
    populateSelectOptions('transferFrom', userAccounts);
    populateSelectOptions('transferTo', userAccounts);
    populateSelectOptions('accountingBook', userAccountingBooks);
    populateSelectOptions('transferAccountingBook', userAccountingBooks);
    populateSelectOptions('filterCategory', userCategories, true, 'Todas las categorías');
    populateSelectOptions('filterAccount', userAccounts, true, 'Todas las cuentas');
    populateSelectOptions('csvDestAccount', userAccounts);
    populateSelectOptions('recurringCategory', catsExp);
    populateSelectOptions('recurringAccount', userAccounts);
    populateSelectOptions('invAccount', userAccounts);

    // Datalist suggestions
    const datalist = document.getElementById('descriptionSuggestions');
    if (datalist && allUserTransactions.length) {
        const descriptions = [...new Set(allUserTransactions.map(t => t.description).filter(Boolean))].slice(0, 50);
        datalist.innerHTML = descriptions.map(d => `<option value="${d}">`).join('');
    }

    const apiKey = localStorage.getItem('geminiApiKey');
    const status = document.getElementById('apiKeyStatus');
    if (apiKey && status) { status.classList.remove('hidden'); document.getElementById('geminiApiKey').placeholder = '••••••••'; }
};

const deleteSetting = async (type, value) => {
    if (!confirm(`¿Eliminar "${value}"?`)) return;
    const ref = doc(db, dbCollections.userSettings, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const arr = (snap.data()[type] || []).filter(i => i !== value);
    await updateDoc(ref, { [type]: arr });
    showDeleteToast();
};

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
const renderDashboard = () => {
    renderIncomeExpenseChart(allUserTransactions);
    renderCategoryAnalysisChart(allUserTransactions, document.getElementById('categoryAnalysisType')?.value || 'expense', document.getElementById('categoryAnalysisStartDate').value, document.getElementById('categoryAnalysisEndDate').value);
    renderCashFlowChart(allUserTransactions);
    renderAccountsSummary();
    updateDashboardAnalytics();
    updateDashboardFuelMetrics(allUserTransactions);
    renderUpcomingPayments(allRecurringItems);
};

const updateDashboardFuelMetrics = (txs) => {
    const fuelTxs = txs.filter(t => t.category === 'Combustible' && !t.description.toLowerCase().includes('peaje')).sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
    if (fuelTxs.length < 2) return;

    const kmRegex = /(\d{1,3}(?:\.?\d{3})*|\d+)\s*km/i;
    const lRegex = /(\d+[.,]\d+|\d+)\s*(?:l|litros|litro)/i;

    const parseData = (t) => {
        const text = `${t.description} ${t.notes || ''}`.toLowerCase();
        const kmMatch = text.match(kmRegex);
        const lMatch = text.match(lRegex);
        return {
            km: kmMatch ? parseInt(kmMatch[1].replace(/\./g, '')) : null,
            liters: lMatch ? parseFloat(lMatch[1].replace(',', '.')) : null
        };
    };

    // 1. Media Histórica
    let totalLiters = 0, totalKm = 0, totalCost = 0;
    const processed = fuelTxs.map(t => ({ ...t, ...parseData(t) }));

    // Para la media, necesitamos la diferencia entre el primer y el último registro con KM
    const withKm = processed.filter(p => p.km !== null);
    if (withKm.length < 2) return;

    const firstWithKm = withKm[0];
    const lastWithKm = withKm[withKm.length - 1];
    totalKm = lastWithKm.km - firstWithKm.km;

    // Sumar litros de todos excepto el más antiguo (ya que pertenece al consumo previo)
    const recordsForSum = processed.filter(p => p.date?.seconds > firstWithKm.date?.seconds && p.date?.seconds <= lastWithKm.date?.seconds);
    totalLiters = recordsForSum.reduce((s, r) => s + (r.liters || 0), 0);
    totalCost = recordsForSum.reduce((s, r) => s + r.amount, 0);

    if (totalKm > 0 && totalLiters > 0) {
        const avgL100 = (totalLiters / totalKm) * 100;
        const avgE100 = (totalCost / totalKm) * 100;
        const avgPricePerLiter = totalCost / totalLiters;

        document.getElementById('dashFuelLitersHist').textContent = `${avgL100.toFixed(1)} L`;
        document.getElementById('dashFuelEurosHist').textContent = `${avgE100.toFixed(2)} €`;
        document.getElementById('dashFuelPriceHist').textContent = `${avgPricePerLiter.toFixed(3)} €`;

        // 2. Último Repostaje (comparativa directa)
        const reversed = [...processed].reverse();
        const latest = reversed.find(r => r.km !== null && r.liters !== null);
        const previous = reversed.find(r => r.km !== null && r.date?.seconds < latest.date?.seconds);

        if (latest && previous) {
            const lKm = latest.km - previous.km;
            const lAvg = (latest.liters / lKm) * 100;
            const eAvg = (latest.amount / lKm) * 100;
            const latestPricePerLiter = latest.amount / latest.liters;
            const diffL = ((lAvg - avgL100) / avgL100) * 100;
            const diffE = ((eAvg - avgE100) / avgE100) * 100;

            const renderDiff = (diff) => `<span class="text-[10px] ml-1 ${diff > 0 ? 'text-red-400' : 'text-emerald-400'}">(${diff > 0 ? '+' : ''}${diff.toFixed(1)}%)</span>`;

            document.getElementById('dashFuelLitersLatest').innerHTML = `${lAvg.toFixed(1)} L ${renderDiff(diffL)}`;
            document.getElementById('dashFuelEurosLatest').innerHTML = `${eAvg.toFixed(2)} € ${renderDiff(diffE)}`;
            document.getElementById('dashFuelPriceLatest').textContent = `${latestPricePerLiter.toFixed(3)} €`;
        }
    }
};

const updateDashboardAnalytics = () => {
    // Health Score
    const score = calcHealthScore(allUserTransactions);
    const { label, color } = getHealthLabel(score);
    const ring = document.getElementById('scoreRing');
    if (ring) { ring.style.setProperty('--score-pct', `${score}%`); ring.style.background = `conic-gradient(${color} ${score}%, #e5e7eb ${score}%)`; }
    const sv = document.getElementById('scoreValue'); if (sv) sv.textContent = score;
    const sl = document.getElementById('scoreLabel'); if (sl) { sl.textContent = label; sl.style.color = color; }

    // Prediction
    const pred = calcEndOfMonthPrediction(allUserTransactions);
    const ps = document.getElementById('predSavings');
    if (ps) { ps.textContent = `${pred.projectedSavings >= 0 ? '+' : ''}${Number(pred.projectedSavings).toFixed(0)}€`; ps.className = `text-xl font-black ${pred.projectedSavings >= 0 ? 'text-emerald-600' : 'text-red-500'}`; }
    const pd = document.getElementById('predDailyRate');
    if (pd) pd.textContent = `Ritmo: ${Number(pred.dailyRate).toFixed(0)}€/día · ${pred.daysLeft}d restantes`;

    // Month comparison
    const comp = calcMonthComparison(allUserTransactions);
    const cd = document.getElementById('compDelta');
    if (cd) { cd.textContent = `${comp.deltaExp >= 0 ? '+' : ''}${Number(comp.deltaExp).toFixed(0)}%`; cd.className = `text-xl font-black ${comp.deltaExp <= 0 ? 'text-emerald-600' : 'text-red-500'}`; }
    const ctc = document.getElementById('compTopChanges');
    if (ctc) {
        ctc.innerHTML = comp.topChanges.map(c => `<div class="text-[9px] ${c.delta > 0 ? 'text-red-400' : 'text-emerald-400'} font-bold">${c.cat}: ${c.delta > 0 ? '+' : ''}${Number(c.delta).toFixed(0)}%</div>`).join('');
    }

    // Alerts
    const alerts = detectAlerts(allUserTransactions);
    const ac = document.getElementById('alertsContainer');
    if (ac) {
        ac.innerHTML = alerts.map(a => `<div class="alert-${a.type} rounded-2xl px-4 py-3 text-sm font-medium flex items-start gap-2"><span>${a.icon}</span><span>${a.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</span></div>`).join('');
    }

    // Heatmap
    renderHeatmap(calcHeatmapData(allUserTransactions));
    // Tendencias
    renderTendenciasChart(calcTendencias(allUserTransactions, userCategories));

    // Repeat last expense
    const lastExpense = [...allUserTransactions].filter(t => t.type === 'expense').sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0))[0];
    if (lastExpense) {
        const rc = document.getElementById('repeatLastContainer');
        const label = document.getElementById('lastExpenseLabel');
        if (rc && label) {
            rc.classList.remove('hidden');
            label.textContent = `${lastExpense.description} · ${lastExpense.amount?.toFixed(2)}€`;
        }
    }

    // Daily tip (async, non-blocking)
    if (localStorage.getItem('geminiApiKey')) {
        getConsejoDelDia(allUserTransactions).then(tip => {
            if (!tip) return;
            const card = document.getElementById('aiTipCard');
            const text = document.getElementById('aiTipText');
            if (card && text) { text.textContent = tip; card.classList.remove('hidden'); }
        });
    }
};

const renderAccountsSummary = () => {
    const accounts = {};
    allUserTransactions.forEach(t => {
        if (!accounts[t.account]) accounts[t.account] = 0;
        t.type === 'income' ? accounts[t.account] += t.amount : accounts[t.account] -= t.amount;
    });
    let html = '', total = 0;
    for (const acc in accounts) {
        total += accounts[acc];
        html += `<div class="flex justify-between items-center py-1"><span class="text-sm font-medium">${acc}</span><span class="balance-value text-sm font-bold ${accounts[acc] >= 0 ? 'text-emerald-600' : 'text-red-500'}">${accounts[acc].toFixed(2)} €</span></div>`;
    }
    html += `<div class="flex justify-between items-center mt-3 pt-3 border-t border-gray-50"><span class="text-sm font-black">Saldo Total</span><span id="totalBalance" class="balance-value text-lg font-black" style="color:rgb(var(--accent))">${total.toFixed(2)} €</span></div>`;
    document.getElementById('accountsSummary').innerHTML = html || '<p class="text-xs text-gray-400">Sin datos aún</p>';
    toggleBalancesVisibility(document.getElementById('toggleBalances').checked);
};

// ─── TRANSACTIONS TABLE ───────────────────────────────────────────────────────
const renderTransactionsTable = (txs) => {
    const tbody = document.getElementById('transactionsTableBody');
    if (!tbody) return;
    if (!txs.length) { tbody.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-gray-300 text-sm">Sin transacciones para este filtro</td></tr>'; return; }
    tbody.innerHTML = txs.map(t => {
        const dateStr = t.date ? new Date(t.date.seconds * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–';
        const rowClass = compactMode ? 'compact-row' : '';
        return `<tr class="${rowClass} border-b border-gray-50 hover:bg-gray-50/50 transition">
            <td class="px-4 py-3 text-xs text-gray-500">${dateStr}</td>
            <td class="px-4 py-3 text-sm font-black ${t.type === 'income' ? 'text-emerald-600' : 'text-red-500'}">${t.type === 'income' ? '+' : '-'}${t.amount?.toFixed(2)}€</td>
            <td class="px-4 py-3 text-sm font-medium text-gray-800 max-w-xs truncate">${t.description || '–'} ${t.receiptImage ? '<span title="Tiene ticket">📎</span>' : ''} ${(t.tags || []).map(tag => `<span class="text-[9px] bg-indigo-50 text-indigo-500 px-1.5 rounded-full font-bold">${tag}</span>`).join('')}</td>
            <td class="px-4 py-3 hidden md:table-cell"><span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold">${t.category || '–'}</span></td>
            <td class="px-4 py-3 hidden md:table-cell text-xs text-gray-400">${t.account || '–'}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="edit-btn text-xs font-black text-indigo-400 hover:text-indigo-600 mr-2 transition" data-id="${t.id}">Editar</button>
                <button class="delete-btn text-xs font-black text-gray-300 hover:text-red-500 transition" data-id="${t.id}">✕</button>
            </td>
        </tr>`;
    }).join('');
    tbody.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', async e => { await deleteDocument(dbCollections.transactions, e.currentTarget.dataset.id); showDeleteToast(); }));
    tbody.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', e => editTransaction(e.currentTarget.dataset.id)));
};

const editTransaction = (id) => {
    const t = allUserTransactions.find(x => x.id === id);
    if (!t) return;
    document.getElementById('transactionHistory').classList.add('hidden');
    showTransactionForm();
    document.getElementById('incomeExpenseForm').classList.remove('hidden');
    document.getElementById('formTitle').textContent = 'Editar Transacción';
    document.getElementById('submitBtn').textContent = 'Guardar Cambios';
    document.getElementById('transactionId').value = id;
    document.getElementById('type').value = t.type;
    document.getElementById('description').value = t.description || '';
    document.getElementById('amount').value = t.amount;
    document.getElementById('category').value = t.category;
    document.getElementById('date').value = t.date ? new Date(t.date.seconds * 1000).toISOString().split('T')[0] : '';
    document.getElementById('account').value = t.account;
    document.getElementById('accountingBook').value = t.accountingBook;
    document.getElementById('notes').value = t.notes || '';
    document.getElementById('tags').value = (t.tags || []).join(', ');
};

const applyFiltersAndRender = () => {
    const s = document.getElementById('filterStartDate').value;
    const e = document.getElementById('filterEndDate').value;
    const cat = document.getElementById('filterCategory').value;
    const acc = document.getElementById('filterAccount').value;
    const concept = document.getElementById('filterConcept')?.value?.toLowerCase();

    let filtered = [...allUserTransactions];
    if (s) { const sd = new Date(s); sd.setHours(0, 0, 0, 0); filtered = filtered.filter(t => t.date?.toDate?.() >= sd); }
    if (e) { const ed = new Date(e); ed.setHours(23, 59, 59, 999); filtered = filtered.filter(t => t.date?.toDate?.() <= ed); }
    if (cat) filtered = filtered.filter(t => t.category === cat);
    if (acc) filtered = filtered.filter(t => t.account === acc);
    if (concept) {
        filtered = filtered.filter(t =>
            (t.description || '').toLowerCase().includes(concept) ||
            (t.notes || '').toLowerCase().includes(concept) ||
            (t.tags || []).some(tag => tag.toLowerCase().includes(concept))
        );
    }

    filtered.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
    renderTransactionsTable(filtered);

    const chartType = document.getElementById('historyCategoryType')?.value || 'expense';
    renderHistoryCategoryChart(filtered, chartType);
};

// ─── NAV HELPERS ─────────────────────────────────────────────────────────────
const resetTransactionForm = () => {
    document.getElementById('transactionForm')?.reset();
    const idField = document.getElementById('transactionId'); if (idField) idField.value = '';
    currentScannedImage = null;
    const rpc = document.getElementById('receiptPreviewContainer'); if (rpc) rpc.classList.add('hidden');
    const rp = document.getElementById('receiptPreview'); if (rp) rp.src = '';
};
const showTransactionMenu = () => { ['transactionMain', 'transactionHistory', 'transactionContent'].forEach(id => document.getElementById(id).classList.add('hidden')); document.getElementById('transactionMenu').classList.remove('hidden'); };
const showTransactionForm = () => { document.getElementById('transactionMenu').classList.add('hidden'); document.getElementById('transactionContent').classList.remove('hidden'); document.getElementById('incomeExpenseForm').classList.add('hidden'); document.getElementById('transferForm').classList.add('hidden'); };

// ─── AUTH STATE ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    if (user) {
        userId = user.uid;
        showMainApp(user);
        setupRealtimeListeners(userId);
        // Set current month range
        const t = new Date(), y = t.getFullYear(), m = t.getMonth();
        const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
        first.setMinutes(first.getMinutes() - first.getTimezoneOffset());
        last.setMinutes(last.getMinutes() - last.getTimezoneOffset());
        document.getElementById('categoryAnalysisStartDate').value = first.toISOString().split('T')[0];
        document.getElementById('categoryAnalysisEndDate').value = last.toISOString().split('T')[0];
    } else {
        userId = null; showAuthScreen();
    }
});

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
// Tabs
document.querySelectorAll('.tab-button').forEach(btn => btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === 'payrolls') {
        verifyPayrollAccess();
    } else {
        showTab(tab);
        if (tab === 'investments') renderInvestments();
    }
}));


// Transaction navigation
document.getElementById('registerTransactionBtn').addEventListener('click', showTransactionMenu);
document.getElementById('quickRegisterBtn')?.addEventListener('click', () => {
    showTab('transactions');
    showTransactionMenu();
});
document.getElementById('viewHistoryBtn').addEventListener('click', () => { document.getElementById('transactionMain').classList.add('hidden'); document.getElementById('transactionHistory').classList.remove('hidden'); applyFiltersAndRender(); });
document.getElementById('backFromTransactionBtn').addEventListener('click', () => { document.getElementById('transactionMenu').classList.add('hidden'); document.getElementById('transactionMain').classList.remove('hidden'); });
document.getElementById('backFromFormBtn').addEventListener('click', () => { document.getElementById('transactionContent').classList.add('hidden'); document.getElementById('transactionMenu').classList.remove('hidden'); resetTransactionForm(); });
document.getElementById('backFromHistoryBtn').addEventListener('click', () => { document.getElementById('transactionHistory').classList.add('hidden'); document.getElementById('transactionMain').classList.remove('hidden'); });

document.getElementById('addIncomeBtn').addEventListener('click', () => {
    showTransactionForm(); resetTransactionForm();
    document.getElementById('incomeExpenseForm').classList.remove('hidden');
    document.getElementById('formTitle').textContent = 'Registrar Ingreso';
    document.getElementById('submitBtn').textContent = 'Guardar Ingreso';
    document.getElementById('type').value = 'income';
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('date').value = d.toISOString().split('T')[0];
});
document.getElementById('addExpenseBtn').addEventListener('click', () => {
    showTransactionForm(); resetTransactionForm();
    document.getElementById('incomeExpenseForm').classList.remove('hidden');
    document.getElementById('formTitle').textContent = 'Registrar Gasto';
    document.getElementById('submitBtn').textContent = 'Guardar Gasto';
    document.getElementById('type').value = 'expense';
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('date').value = d.toISOString().split('T')[0];
});
document.getElementById('addTransferBtn').addEventListener('click', () => { showTransactionForm(); document.getElementById('transferForm').classList.remove('hidden'); });

// Auto-categorization disabled as per user request


// Transaction form submit
document.getElementById('transactionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitBtn');
    btn.textContent = 'Guardando...'; btn.disabled = true;
    try {
        const tagsRaw = document.getElementById('tags').value;
        const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
        const data = {
            type: document.getElementById('type').value,
            description: document.getElementById('description').value,
            amount: parseFloat(document.getElementById('amount').value),
            category: document.getElementById('category').value,
            date: new Date(document.getElementById('date').value),
            account: document.getElementById('account').value,
            accountingBook: document.getElementById('accountingBook').value,
            notes: document.getElementById('notes').value || '',
            tags
        };
        const txId = document.getElementById('transactionId').value;
        const category = document.getElementById('category').value;

        // Only save image if category is EXLABESA
        const imageToSave = category === 'EXLABESA' ? currentScannedImage : null;

        await saveTransaction(userId, txId, data, imageToSave);
        resetTransactionForm(); currentScannedImage = null;
        if (txId) {
            // If editing, go back to history
            document.getElementById('transactionContent').classList.add('hidden');
            document.getElementById('transactionHistory').classList.remove('hidden');
            applyFiltersAndRender();
        } else {
            // If new, just show toast and keep form open for more registrations
            showSaveToast('Transacción');
            // Keep on same screen with empty fields
            const type = document.getElementById('type').value;
            if (type === 'income') document.getElementById('addIncomeBtn').click();
            else document.getElementById('addExpenseBtn').click();
        }
    } catch (err) { showErrorToast('Error al guardar'); console.error(err); }
    finally { btn.disabled = false; btn.textContent = 'Guardar'; }
});

// Transfer form
document.getElementById('transferFormElem').addEventListener('submit', async (e) => {
    e.preventDefault();
    const from = document.getElementById('transferFrom').value;
    const to = document.getElementById('transferTo').value;
    const amount = parseFloat(document.getElementById('transferAmount').value);
    const date = new Date(document.getElementById('transferDate').value);
    const book = document.getElementById('transferAccountingBook').value;
    if (!from || !to || from === to) { showErrorToast('Selecciona dos cuentas distintas'); return; }
    const base = { description: `Traspaso ${from} → ${to}`, amount, category: 'Transferencia', date, accountingBook: book, userId, createdAt: serverTimestamp() };
    await addDoc(collection(db, dbCollections.transactions), { ...base, account: from, type: 'expense' });
    await addDoc(collection(db, dbCollections.transactions), { ...base, account: to, type: 'income' });
    e.target.reset();
    document.getElementById('transactionContent').classList.add('hidden');
    document.getElementById('transactionMain').classList.remove('hidden');
    showSaveToast('Traspaso');
});

// Repeat last expense
document.getElementById('repeatLastBtn').addEventListener('click', () => {
    const last = [...allUserTransactions].filter(t => t.type === 'expense').sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0))[0];
    if (!last) return;
    showTransactionMenu();
    document.getElementById('addExpenseBtn').click();
    setTimeout(() => {
        document.getElementById('description').value = last.description;
        document.getElementById('amount').value = last.amount;
        document.getElementById('category').value = last.category;
        document.getElementById('account').value = last.account;
    }, 50);
});

// Settings forms
document.getElementById('categoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = document.getElementById('newCategory').value.trim();
    if (v) { await addSetting(userId, 'categories', v); document.getElementById('newCategory').value = ''; showSaveToast('Categoría'); }
});
document.getElementById('accountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = document.getElementById('newAccount').value.trim();
    const b = document.getElementById('initialBalance').value;
    if (v) { await addSetting(userId, 'accounts', v, b); document.getElementById('newAccount').value = ''; document.getElementById('initialBalance').value = '0'; showSaveToast('Cuenta'); }
});
document.getElementById('accountingBookForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = document.getElementById('newAccountingBook').value.trim();
    if (v) { await addSetting(userId, 'accountingBooks', v); document.getElementById('newAccountingBook').value = ''; showSaveToast('Libro Contable'); }
});

// Filters & Export
document.getElementById('applyFiltersBtn').addEventListener('click', applyFiltersAndRender);
document.getElementById('clearFiltersBtn').addEventListener('click', () => { 
    document.getElementById('filterStartDate').value = ''; 
    document.getElementById('filterEndDate').value = ''; 
    document.getElementById('filterConcept').value = ''; 
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterAccount').value = '';
    applyFiltersAndRender(); 
});
document.getElementById('filterConcept')?.addEventListener('input', applyFiltersAndRender);
document.getElementById('historyCategoryType')?.addEventListener('change', applyFiltersAndRender);

document.getElementById('toggleCompactBtn').addEventListener('click', (e) => {
    compactMode = !compactMode;
    e.currentTarget.textContent = compactMode ? 'Normal' : 'Compact';
    applyFiltersAndRender();
});

document.getElementById('exportExcelBtn').addEventListener('click', () => {
    const headers = ['Fecha', 'Tipo', 'Descripción', 'Importe', 'Categoría', 'Cuenta', 'Notas', 'Tags'];
    let csv = "data:text/csv;charset=utf-8," + headers.join(',') + '\n';
    allUserTransactions.forEach(t => {
        const d = t.date ? new Date(t.date.seconds * 1000).toLocaleDateString('es-ES') : 'N/A';
        csv += [d, t.type === 'income' ? 'Ingreso' : 'Gasto', `"${(t.description || '').replace(/"/g, '""')}"`, t.amount?.toFixed(2), t.category || '', t.account || '', `"${(t.notes || '').replace(/"/g, '""')}"`, (t.tags || []).join('; ')].join(',') + '\n';
    });
    const link = document.createElement('a'); link.href = encodeURI(csv); link.download = 'transacciones.csv'; document.body.appendChild(link); link.click(); link.remove();
});

// Past balance
document.getElementById('calculatePastBalanceBtn').addEventListener('click', () => {
    const dateInput = document.getElementById('pastBalanceDate').value;
    if (!dateInput) return showErrorToast('Selecciona una fecha');
    const target = new Date(dateInput); target.setHours(23, 59, 59, 999);
    const accounts = {};
    allUserTransactions.filter(t => t.date?.toDate?.() <= target && t.category !== '').forEach(t => {
        if (!accounts[t.account]) accounts[t.account] = 0;
        t.type === 'income' ? accounts[t.account] += t.amount : accounts[t.account] -= t.amount;
    });
    let html = '', total = 0;
    for (const acc in accounts) { total += accounts[acc]; html += `<div class="flex justify-between items-center py-1"><span class="text-sm font-medium">${acc}</span><span class="balance-value text-sm font-bold ${accounts[acc] >= 0 ? 'text-emerald-600' : 'text-red-500'}">${accounts[acc].toFixed(2)} €</span></div>`; }
    html += `<div class="flex justify-between items-center mt-3 pt-3 border-t border-gray-50"><span class="text-sm font-black">Total ${target.toLocaleDateString('es-ES')}</span><span class="balance-value text-lg font-black" style="color:rgb(var(--accent))">${total.toFixed(2)} €</span></div>`;
    document.getElementById('accountsSummary').innerHTML = html;
    document.getElementById('calculatePastBalanceBtn').classList.add('hidden');
    document.getElementById('pastBalanceDate').classList.add('hidden');
    document.getElementById('resetBalanceBtn').classList.remove('hidden');
});
document.getElementById('resetBalanceBtn').addEventListener('click', () => {
    document.getElementById('calculatePastBalanceBtn').classList.remove('hidden');
    document.getElementById('pastBalanceDate').classList.remove('hidden');
    document.getElementById('resetBalanceBtn').classList.add('hidden');
    document.getElementById('pastBalanceDate').value = '';
    renderAccountsSummary();
});

// Category chart
document.getElementById('updateCategoryChartBtn').addEventListener('click', () => {
    renderCategoryAnalysisChart(allUserTransactions, document.getElementById('categoryAnalysisType')?.value || 'expense', document.getElementById('categoryAnalysisStartDate').value, document.getElementById('categoryAnalysisEndDate').value);
});

// Balances toggle
const toggleSwitch = document.getElementById('toggleBalances');
if (toggleSwitch) {
    toggleSwitch.checked = localStorage.getItem('pixelateBalances') === 'true';
    toggleSwitch.addEventListener('change', () => { localStorage.setItem('pixelateBalances', toggleSwitch.checked); toggleBalancesVisibility(toggleSwitch.checked); });
}

// AI SCANNER
document.getElementById('scanReceiptBtn').addEventListener('click', () => document.getElementById('receiptInput').click());
document.getElementById('receiptInput').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;

    const scanBtnText = document.getElementById('scanReceiptText');
    const originalText = scanBtnText.textContent;
    scanBtnText.textContent = 'Comprimiendo...';

    const reader = new FileReader();
    reader.onload = async (rx) => {
        try {
            // Optimized compression for faster transmission
            const compressed = await compressImage(rx.target.result, 1200, 0.8);
            currentScannedImage = compressed;
            document.getElementById('receiptPreview').src = compressed;
            document.getElementById('receiptPreviewContainer').classList.remove('hidden');

            scanBtnText.textContent = 'Analizando ticket...';

            const systemPrompt = "Eres un OCR financiero preciso. Extrae los datos del ticket en formato JSON.";
            const userPrompt = `Extrae: {"amount": number, "category": string, "date": "YYYY-MM-DD", "description": string}. Solo el JSON sin markdown.`;

            const result = await callGemini(systemPrompt, userPrompt, compressed);
            const cleanResult = result.replace(/```json|```/g, '').trim();
            const json = JSON.parse(cleanResult);

            if (json.amount) document.getElementById('amount').value = json.amount;
            if (json.description) document.getElementById('description').value = json.description;
            if (json.date) document.getElementById('date').value = json.date;
            if (json.category && userCategories.includes(json.category)) {
                document.getElementById('category').value = json.category;
            }

            showInfoToast('Ticket analizado correctamente');
        } catch (err) {
            console.error("OCR Error:", err);
            showErrorToast('Error al analizar ticket');
        } finally {
            scanBtnText.textContent = originalText;
        }
    };
    reader.readAsDataURL(file);
});
document.getElementById('removeReceiptBtn')?.addEventListener('click', () => { currentScannedImage = null; document.getElementById('receiptPreview').src = ''; document.getElementById('receiptPreviewContainer').classList.add('hidden'); document.getElementById('receiptInput').value = ''; });

// API KEY
document.getElementById('saveApiKeyBtn').addEventListener('click', () => {
    const key = document.getElementById('geminiApiKey').value;
    if (key) { localStorage.setItem('geminiApiKey', key); showSaveToast('API Key'); document.getElementById('apiKeyStatus').classList.remove('hidden'); }
});

// MODALS
document.getElementById('openExlabesaModalBtn').addEventListener('click', () => document.getElementById('exlabesaModal').classList.remove('hidden'));
document.getElementById('closeExlabesaModalBtn').addEventListener('click', () => document.getElementById('exlabesaModal').classList.add('hidden'));
document.getElementById('openFuelModalBtn').addEventListener('click', () => document.getElementById('fuelModal').classList.remove('hidden'));
document.getElementById('closeFuelModalBtn').addEventListener('click', () => document.getElementById('fuelModal').classList.add('hidden'));
document.getElementById('openCsvModalBtn').addEventListener('click', () => document.getElementById('csvModal').classList.remove('hidden'));
document.getElementById('closeCsvModalBtn').addEventListener('click', () => { document.getElementById('csvModal').classList.add('hidden'); pendingCsvTransactions = []; document.getElementById('csvPreview').classList.add('hidden'); document.getElementById('importCsvBtn').classList.add('hidden'); });

// CSV IMPORT
const csvZone = document.getElementById('csvDropZone');
const csvInput = document.getElementById('csvFileInput');
csvZone.addEventListener('click', () => csvInput.click());
csvZone.addEventListener('dragover', (e) => { e.preventDefault(); csvZone.classList.add('border-indigo-400'); });
csvZone.addEventListener('dragleave', () => csvZone.classList.remove('border-indigo-400'));
csvZone.addEventListener('drop', (e) => { e.preventDefault(); csvZone.classList.remove('border-indigo-400'); if (e.dataTransfer.files[0]) processCsv(e.dataTransfer.files[0]); });
csvInput.addEventListener('change', (e) => { if (e.target.files[0]) processCsv(e.target.files[0]); });

const processCsv = async (file) => {
    try {
        const { transactions, bank, total } = await parseCSVFile(file);
        pendingCsvTransactions = transactions;
        document.getElementById('csvBankDetected').textContent = `Banco detectado: ${bank}`;
        document.getElementById('csvCount').textContent = `${total} transacciones encontradas`;
        document.getElementById('csvPreviewTable').innerHTML = transactions.slice(0, 5).map(t =>
            `<div class="text-xs py-1 border-b border-gray-100 flex justify-between"><span class="truncate text-gray-700 max-w-[180px]">${t.description}</span><span class="${t.type === 'income' ? 'text-emerald-600' : 'text-red-500'} font-bold">${t.type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}€</span></div>`
        ).join('') + (total > 5 ? `<p class="text-[10px] text-gray-400 mt-1">...y ${total - 5} más</p>` : '');
        document.getElementById('csvPreview').classList.remove('hidden');
        document.getElementById('importCsvBtn').classList.remove('hidden');
        document.getElementById('importCsvBtn').style.display = '';
    } catch (err) { showErrorToast(`No se pudo leer el archivo: ${err.message}`); }
};

document.getElementById('importCsvBtn').addEventListener('click', async () => {
    if (!pendingCsvTransactions.length) return;
    const account = document.getElementById('csvDestAccount').value;
    const btn = document.getElementById('importCsvBtn');
    btn.textContent = 'Importando...'; btn.disabled = true;
    try {
        let count = 0;
        for (const t of pendingCsvTransactions) {
            await addDoc(collection(db, dbCollections.transactions), { ...t, account, userId, createdAt: serverTimestamp() });
            count++;
        }
        showSaveToast(`${count} transacciones importadas`);
        document.getElementById('csvModal').classList.add('hidden');
        pendingCsvTransactions = [];
    } catch (err) { showErrorToast('Error importando'); console.error(err); }
    finally { btn.disabled = false; btn.textContent = 'Importar'; }
});

// THEME Selector
document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const theme = e.currentTarget.dataset.theme;
        document.documentElement.dataset.theme = theme === 'indigo' ? '' : theme;
        localStorage.setItem('appTheme', theme);
        document.querySelectorAll('.theme-btn').forEach(b => b.style.outline = '');
        e.currentTarget.style.outline = '3px solid #fff';
        e.currentTarget.style.outlineOffset = '2px';
        showInfoToast(`Tema ${theme} aplicado`);
    });
});
const savedTheme = localStorage.getItem('appTheme');
if (savedTheme && savedTheme !== 'indigo') { document.documentElement.dataset.theme = savedTheme; document.querySelector(`[data-theme="${savedTheme}"]`)?.style && (document.querySelector(`[data-theme="${savedTheme}"]`).style.outline = '3px solid #fff'); }

// DARK MODE
const applyDarkMode = (force) => {
    const isDark = force !== undefined ? force : !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    document.getElementById('sunIcon').classList.toggle('hidden', !isDark);
    document.getElementById('moonIcon').classList.toggle('hidden', isDark);
};
document.getElementById('toggleDarkMode').addEventListener('click', () => applyDarkMode());
if (localStorage.getItem('theme') === 'dark') applyDarkMode(true);

// Voice recognition removed as per user request


// CHAT
const chatWidget = document.getElementById('chatWidget');
document.getElementById('openChatBtn').addEventListener('click', () => { chatWidget.classList.toggle('hidden-chat'); if (!chatWidget.classList.contains('hidden-chat') && !document.getElementById('chatMessages').childElementCount) { addBotMsg('¡Hola! Soy Oink, tu asesor financiero personal. Puedo analizar tus gastos, ingresos, presupuestos y ayudarte con cualquier pregunta sobre tus finanzas. ¿En qué te puedo ayudar?'); } });
document.getElementById('closeChatBtn').addEventListener('click', () => chatWidget.classList.add('hidden-chat'));
document.getElementById('clearChatBtn').addEventListener('click', () => { document.getElementById('chatMessages').innerHTML = ''; resetChatHistory(); addBotMsg('Conversación reiniciada. ¿En qué te ayudo?'); });

const addBotMsg = (text) => {
    const msgs = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'p-3 rounded-2xl text-sm bg-white border border-gray-100 text-gray-800 self-start max-w-[90%] shadow-sm chat-message animate-fade-in';
    div.innerHTML = (typeof marked !== 'undefined') ? marked.parse(text) : text;
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
};
const addUserMsg = (text) => {
    const msgs = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'p-3 rounded-2xl text-sm text-white self-end max-w-[90%] animate-fade-in'; div.style.background = 'rgb(var(--accent))';
    div.textContent = text; msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
};

document.getElementById('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const msg = input.value.trim(); if (!msg) return;
    input.value = '';
    addUserMsg(msg);
    document.getElementById('chatSendIcon').classList.add('hidden');
    document.getElementById('chatLoadingIcon').classList.remove('hidden');
    try {
        const context = buildFinancialContext(allUserTransactions);
        const reply = await callGeminiChat(msg, context, allUserTransactions);
        addBotMsg(reply);
    } catch (err) { addBotMsg(`Error: ${err.message}`); }
    finally { document.getElementById('chatSendIcon').classList.remove('hidden'); document.getElementById('chatLoadingIcon').classList.add('hidden'); }
});

// REPORTS
document.getElementById('generatePdfBtn').addEventListener('click', () => generateAiReport(allUserTransactions));

document.getElementById('generateExlabesaBtn').addEventListener('click', async () => {
    const start = document.getElementById('exlabesaStartDate').value;
    const end = document.getElementById('exlabesaEndDate').value;
    if (!start || !end) return showErrorToast('Selecciona fechas');
    document.getElementById('exlabesaModal').classList.add('hidden');
    const txIds = await generateExlabesaReport(allUserTransactions, start, end);
    if (txIds && txIds.length > 0) {
        setTimeout(async () => {
            if (confirm(`¿Quieres borrar las fotos de los ${txIds.length} tickets ya impresos de la base de datos?`)) {
                showLoadingOverlay();
                try {
                    for (const id of txIds) {
                        await updateDoc(doc(db, dbCollections.transactions, id), { receiptImage: null });
                    }
                    showToast('Tickets borrados correctamente', 'success');
                } catch (e) {
                    showErrorToast('Error al borrar tickets');
                } finally {
                    hideLoadingOverlay();
                }
            }
        }, 3000);
    }
});

document.getElementById('generateFuelBtn').addEventListener('click', () => {
    const start = document.getElementById('fuelStartDate').value;
    const end = document.getElementById('fuelEndDate').value;
    if (!start || !end) return showErrorToast('Selecciona fechas');
    document.getElementById('fuelModal').classList.add('hidden');
    generateFuelReport(allUserTransactions, start, end);
});


// Recurring form
document.getElementById('recurringForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('recurringId').value;
    const data = {
        name: document.getElementById('recurringName').value,
        amount: parseFloat(document.getElementById('recurringAmount').value),
        day: parseInt(document.getElementById('recurringDay').value),
        category: document.getElementById('recurringCategory').value || 'Facturas',
        account: document.getElementById('recurringAccount').value || ''
    };
    if (id) {
        await updateDoc(doc(db, dbCollections.recurring, id), data);
        showSaveToast('Suscripción actualizada');
    } else {
        await saveRecurring(userId, data);
        showSaveToast('Suscripción');
    }
    document.getElementById('cancelEditRecurringBtn').click();
});

document.getElementById('cancelEditRecurringBtn')?.addEventListener('click', () => {
    document.getElementById('recurringForm').reset();
    document.getElementById('recurringId').value = '';
    const formTitle = document.getElementById('recurringFormTitle');
    if (formTitle) formTitle.textContent = 'Añadir Suscripción';
    const submitBtn = document.getElementById('submitRecurringBtn');
    if (submitBtn) submitBtn.textContent = 'Añadir';
    document.getElementById('cancelEditRecurringBtn').classList.add('hidden');
});

// KEYBOARD SHORTCUTS
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'n' || e.key === 'N') { showTab('transactions'); showTransactionMenu(); }
    if (e.key === 'i' || e.key === 'I') { showTab('transactions'); showTransactionMenu(); setTimeout(() => document.getElementById('addIncomeBtn').click(), 50); }
    if (e.key === 'e' || e.key === 'E') { showTab('transactions'); showTransactionMenu(); setTimeout(() => document.getElementById('addExpenseBtn').click(), 50); }
    if (e.key === 't' || e.key === 'T') { showTab('transactions'); showTransactionMenu(); setTimeout(() => document.getElementById('addTransferBtn').click(), 50); }
    if (e.key === 'd' || e.key === 'D') showTab('dashboard');
    if (e.key === 'Escape') { document.getElementById('chatWidget').classList.add('hidden-chat'); document.querySelectorAll('[class*="Modal"]').forEach(m => m.classList.add('hidden')); }
});

// Delete all tickets btn
document.getElementById('deleteAllTicketsBtn')?.addEventListener('click', () => { showInfoToast('Función de purga próximamente'); });

// ─── PAYROLLS LOGIC ─────────────────────────────────────────────────────────

const handlePayrollDownload = (base64OrUrl, filename) => {
    if (!base64OrUrl) return;
    
    // Si es una URL normal (Firebase Storage), abrir directamente
    if (base64OrUrl.startsWith('http')) {
        window.open(base64OrUrl, '_blank');
        return;
    }

    // Si es Base64, convertir a Blob para mejor compatibilidad en iOS
    try {
        const parts = base64OrUrl.split(';base64,');
        const contentType = parts[0].split(':')[1] || 'application/pdf';
        const raw = window.atob(parts[1]);
        const rawLength = raw.length;
        const uInt8Array = new Uint8Array(rawLength);

        for (let i = 0; i < rawLength; ++i) {
            uInt8Array[i] = raw.charCodeAt(i);
        }

        const blob = new Blob([uInt8Array], { type: contentType });
        const blobUrl = URL.createObjectURL(blob);
        
        // En iOS PWA, abrir el Blob URL es la forma más fiable de activar
        // el visor de PDF nativo o el menú de compartir.
        const newWindow = window.open(blobUrl, '_blank');
        
        if (!newWindow) {
            // Fallback si el navegador bloquea el popup
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
        
        // Limpiar para evitar fugas de memoria
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch (e) {
        console.error("Error en descarga:", e);
        window.open(base64OrUrl, '_blank');
    }
};


const verifyPayrollAccess = () => {
    if (!payrollsPassword) {
        document.getElementById('payrollPassTitle').textContent = "Configurar Contraseña";
        document.getElementById('payrollPassDesc').textContent = "Establece una contraseña para proteger tus nóminas.";
        document.getElementById('payrollPasswordModal').classList.remove('hidden');
    } else {
        document.getElementById('payrollPassTitle').textContent = "Área Restringida";
        document.getElementById('payrollPassDesc').textContent = "Introduce tu contraseña para acceder al control de nóminas.";
        document.getElementById('payrollPasswordModal').classList.remove('hidden');
    }
    document.getElementById('payrollPasswordInput').focus();
};

document.getElementById('unlockPayrollsBtn').addEventListener('click', async () => {
    const passInput = document.getElementById('payrollPasswordInput').value;
    if (!payrollsPassword) {
        if (passInput.length < 4) return showErrorToast('Mínimo 4 caracteres');
        await updateDoc(doc(db, dbCollections.userSettings, userId), { payrollsPassword: passInput });
        payrollsPassword = passInput;
        showSaveToast('Contraseña establecida');
        document.getElementById('payrollPasswordModal').classList.add('hidden');
        showTab('payrolls');
    } else {
        if (passInput === payrollsPassword) {
            document.getElementById('payrollPasswordModal').classList.add('hidden');
            payrollTabUnlocked = true;
            showTab('payrolls');
            renderPayrollsTable();
            updatePayrollStats();
            renderPayrollsChart();
            document.getElementById('payrollPasswordInput').value = '';
        } else {
            showErrorToast('Contraseña incorrecta');
        }
    }
});

document.getElementById('cancelPayrollsBtn').addEventListener('click', () => {
    document.getElementById('payrollPasswordModal').classList.add('hidden');
    document.getElementById('payrollPasswordInput').value = '';
    if (!payrollTabUnlocked) showTab('dashboard');
});

document.getElementById('forgotPayrollPassBtn')?.addEventListener('click', async () => {
    if (confirm("Para restablecer la contraseña por seguridad, debes verificar tu identidad iniciando sesión con tu cuenta de Google. ¿Continuar?")) {
        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            if (result.user.uid === userId) {
                // Clear password in Firestore
                await updateDoc(doc(db, dbCollections.userSettings, userId), { payrollsPassword: null });
                payrollsPassword = null;

                // Unlock tab
                document.getElementById('payrollPasswordModal').classList.add('hidden');
                payrollTabUnlocked = true;
                showTab('payrolls');
                renderPayrollsTable();
                updatePayrollStats();
                renderPayrollsChart();

                showInfoToast("Identidad verificada. Se ha eliminado la contraseña.");
            } else {
                showErrorToast("La cuenta de Google no coincide.");
            }
        } catch (e) {
            console.error(e);
            showErrorToast("Error al verificar identidad.");
        }
    }
});

// Cambiar Contraseña Logic
document.getElementById('changePayrollPassBtn')?.addEventListener('click', () => {
    document.getElementById('changePayrollPasswordModal').classList.remove('hidden');
});

document.getElementById('closeChangePassModal').addEventListener('click', () => {
    document.getElementById('changePayrollPasswordModal').classList.add('hidden');
    document.getElementById('oldPayrollPassInput').value = '';
    document.getElementById('newPayrollPassInput').value = '';
});

document.getElementById('confirmChangePassBtn').addEventListener('click', async () => {
    const oldPass = document.getElementById('oldPayrollPassInput').value;
    const newPass = document.getElementById('newPayrollPassInput').value;
    if (oldPass !== payrollsPassword) return showErrorToast('Contraseña actual incorrecta');
    if (newPass.length < 4) return showErrorToast('Mínimo 4 caracteres');
    showLoadingOverlay();
    try {
        await updateDoc(doc(db, dbCollections.userSettings, userId), { payrollsPassword: newPass });
        payrollsPassword = newPass;
        showToast('Contraseña actualizada', 'success');
        document.getElementById('changePayrollPasswordModal').classList.add('hidden');
        document.getElementById('oldPayrollPassInput').value = '';
        document.getElementById('newPayrollPassInput').value = '';
    } catch (e) {
        showErrorToast('Error al actualizar');
    } finally {
        hideLoadingOverlay();
    }
});

const guessPayrollMonth = (dateStr, description) => {
    const desc = (description || "").toLowerCase();
    const monthsMap = {
        "enero": 0, "ene": 0,
        "febrero": 1, "feb": 1,
        "marzo": 2, "mar": 2,
        "abril": 3, "abr": 3,
        "mayo": 4, "may": 4,
        "junio": 5, "jun": 5,
        "julio": 6, "jul": 6,
        "agosto": 7, "ago": 7,
        "septiembre": 8, "sept": 8, "sep": 8,
        "octubre": 9, "oct": 9,
        "noviembre": 10, "nov": 10,
        "diciembre": 11, "dic": 11
    };

    let foundMonth = -1;
    for (const [key, val] of Object.entries(monthsMap)) {
        const regex = new RegExp(`\\b${key}\\b`, 'i');
        if (regex.test(desc)) {
            foundMonth = val;
            break;
        }
    }

    let yearMatch = desc.match(/20\d{2}/) || desc.match(/\b\d{2}\b/);
    let foundYear = null;
    if (yearMatch) {
        foundYear = parseInt(yearMatch[0]);
        if (foundYear < 100) foundYear += 2000;
    }

    const txDate = new Date(dateStr);
    let finalYear = txDate.getFullYear();
    let finalMonth = txDate.getMonth() + 1; // 1-12

    if (foundMonth !== -1) {
        finalMonth = foundMonth + 1;
        if (foundYear) finalYear = foundYear;
        else {
            if (finalMonth === 12 && txDate.getMonth() === 0) finalYear--;
            else if (finalMonth === 1 && txDate.getMonth() === 11) finalYear++;
        }
    } else {
        // Asumir mes anterior si se cobra del 1 al 15
        if (txDate.getDate() <= 15) {
            finalMonth--;
            if (finalMonth === 0) {
                finalMonth = 12;
                finalYear--;
            }
        }
    }
    return { year: finalYear, month: finalMonth };
};

const getUnifiedPayrolls = () => {
    const unified = {};

    allUserTransactions.forEach(t => {
        // Normalizar categoría para ignorar acentos y mayúsculas
        const catNormalized = (t.category || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const descNormalized = (t.description || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

        // El tipo interno es 'income', no 'Ingreso'
        const isNomina = (catNormalized === 'nomina' || descNormalized.includes('nomina')) && t.type === 'income';
        if (!isNomina) return;

        const date = t.date?.toDate ? t.date.toDate() : new Date(t.date);
        const guessedDate = guessPayrollMonth(date, t.description);

        // Usamos el ID de la transacción como clave principal para asegurar el vínculo
        const key = t.id;

        if (!unified[key]) {
            unified[key] = {
                year: guessedDate.year,
                month: guessedDate.month,
                txAmount: t.amount,
                txDescription: t.description,
                txId: t.id,
                hasTx: true
            };
        }
    });

    allUserPayrolls.forEach(p => {
        // Si la nómina tiene un txId asociado, lo usamos para unirla a la transacción
        // Si no (entrada manual), usamos el año_mes como clave
        const key = p.txId || `${p.year}_${p.month}`;
        if (!unified[key]) {
            unified[key] = { ...p, hasPayroll: true };
        } else {
            unified[key] = { ...unified[key], ...p, hasPayroll: true };
        }
    });

    return Object.values(unified).sort((a, b) => b.year - a.year || b.month - a.month);
};

const populatePayrollYearFilter = (entries) => {
    const select = document.getElementById('payrollYearFilter');
    if (!select) return;
    const current = select.value;
    const years = [...new Set(entries.map(e => e.year))].sort((a, b) => b - a);
    select.innerHTML = '<option value="all">Todos los años</option>' +
        years.map(y => `<option value="${y}">${y}</option>`).join('');
    select.value = current;
};

const renderPayrollsChart = () => {
    const ctx = document.getElementById('payrollChart')?.getContext('2d');
    if (!ctx || !payrollTabUnlocked) return;

    const year = document.getElementById('payrollYearFilter').value;
    const metric = document.getElementById('payrollChartMetric').value;

    let entries = getUnifiedPayrolls().sort((a, b) => a.year - b.year || a.month - b.month);
    if (year !== 'all') entries = entries.filter(e => e.year == year);

    if (payrollChartInstance) payrollChartInstance.destroy();

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const labels = entries.map(e => `${monthNames[e.month - 1]} ${e.year.toString().slice(-2)}`);
    const data = entries.map(e => {
        if (metric === 'dietasLoc') return (e.dietas || 0) + (e.locomocion || 0);
        if (metric === 'txAmount') return e.txAmount || 0;
        return e[metric] || 0;
    });

    payrollChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: document.getElementById('payrollChartMetric').options[document.getElementById('payrollChartMetric').selectedIndex].text,
                data: data,
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                borderColor: 'rgb(99, 102, 241)',
                borderWidth: 2,
                borderRadius: 8,
                barThickness: 20
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e293b', titleFont: { weight: 'bold' } } },
            scales: {
                y: { beginAtZero: true, grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10, weight: 'bold' } } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10, weight: 'bold' } } }
            }
        }
    });
};

const renderPayrollsTable = () => {
    const tbody = document.getElementById('payrollsTableBody');
    if (!tbody || !payrollTabUnlocked) return;

    const rawEntries = getUnifiedPayrolls();
    populatePayrollYearFilter(rawEntries);

    const year = document.getElementById('payrollYearFilter').value;
    const entries = year === 'all' ? rawEntries : rawEntries.filter(e => e.year == year);

    if (!entries.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-10 text-center text-gray-300">No hay datos para este periodo.</td></tr>`;
        document.getElementById('payrollsTableFoot').classList.add('hidden');
        return;
    }

    let totals = { tx: 0, bruto: 0, neto: 0, irpf: 0, ss: 0, dietasLoc: 0 };

    tbody.innerHTML = entries.map(p => {
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        const label = `${monthNames[p.month - 1]} ${p.year}`;
        const hasPDF = !!(p.pdfUrl || p.pdfBase64);
        const downloadUrl = p.pdfBase64 || p.pdfUrl;

        totals.tx += p.txAmount || 0;
        totals.bruto += p.bruto || 0;
        totals.neto += p.neto || 0;
        totals.irpf += p.irpf || 0;
        totals.ss += p.ss || 0;
        totals.dietasLoc += (p.dietas || 0) + (p.locomocion || 0);

        return `
            <tr class="border-b border-gray-50 hover:bg-gray-50/50 transition">
                <td class="p-4">
                    <div class="font-black text-gray-700">${label}</div>
                    <div class="text-[9px] text-gray-400 font-bold uppercase">${p.hasTx ? 'Detectado' : 'Manual'}</div>
                </td>
                <td class="p-4 font-black text-indigo-600">
                    ${p.txAmount ? p.txAmount.toFixed(2) + '€' : '–'}
                </td>
                <td class="p-4 font-bold text-gray-400">${p.bruto ? p.bruto.toFixed(2) + '€' : '–'}</td>
                <td class="p-4 font-black text-emerald-600">${p.neto ? p.neto.toFixed(2) + '€' : '–'}</td>
                <td class="p-4 font-bold text-gray-600">
                    ${p.irpf ? p.irpf.toFixed(2) + '€' : '–'}
                </td>
                <td class="p-4 text-gray-400">${p.ss ? p.ss.toFixed(2) + '€' : '–'}</td>
                <td class="p-4 text-gray-400">${p.hasPayroll ? ((p.dietas || 0) + (p.locomocion || 0)).toFixed(2) + '€' : '–'}</td>
                <td class="p-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                        ${hasPDF ? `<button class="payroll-download-btn download-payroll-btn" data-index="${entries.indexOf(p)}" title="Descargar PDF">📥</button>` : ''}
                        <button class="upload-to-row-btn text-[10px] bg-indigo-50 text-indigo-600 font-black py-1 px-3 rounded-lg hover:bg-indigo-100 transition" 
                                data-month="${p.year}-${String(p.month).padStart(2, '0')}"
                                data-txid="${p.txId || ''}">
                            ${hasPDF ? '🔄 Reemplazar' : '📄 Subir PDF'}
                        </button>
                    </div>
                </td>
                <td class="p-4 text-right">
                    ${hasPDF ? `<button class="delete-pdf-btn text-gray-300 hover:text-red-500 transition" data-id="${p.id}" title="Eliminar solo el PDF">📄✕</button>` : ''}
                </td>
            </tr>`;
    }).join('');

    document.getElementById('payrollsTableFoot').classList.remove('hidden');
    document.getElementById('payrollTotalTx').textContent = totals.tx > 0 ? totals.tx.toFixed(2) + '€' : '–';
    document.getElementById('payrollTotalBruto').textContent = totals.bruto > 0 ? totals.bruto.toFixed(2) + '€' : '–';
    document.getElementById('payrollTotalNeto').textContent = totals.neto > 0 ? totals.neto.toFixed(2) + '€' : '–';
    document.getElementById('payrollTotalIRPF').textContent = totals.irpf > 0 ? totals.irpf.toFixed(2) + '€' : '–';
    document.getElementById('payrollTotalSS').textContent = totals.ss > 0 ? totals.ss.toFixed(2) + '€' : '–';
    document.getElementById('payrollTotalDietas').textContent = totals.dietasLoc > 0 ? totals.dietasLoc.toFixed(2) + '€' : '–';

    tbody.querySelectorAll('.download-payroll-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const p = entries[e.currentTarget.dataset.index];
            const url = p.pdfBase64 || p.pdfUrl;
            handlePayrollDownload(url, `Nomina_${p.year}_${p.month}.pdf`);
        });
    });

    tbody.querySelectorAll('.delete-pdf-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (confirm('¿Eliminar el PDF asociado a esta nómina? (Los datos registrados se mantendrán)')) {
                await updateDoc(doc(db, dbCollections.payrolls, e.currentTarget.dataset.id), {
                    pdfBase64: null,
                    pdfUrl: null
                });
                showDeleteToast('PDF eliminado');
            }
        });
    });

    tbody.querySelectorAll('.upload-to-row-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const month = e.target.dataset.month;
            const txId = e.target.dataset.txid;
            document.getElementById('payrollFileInput').dataset.targetMonth = month;
            document.getElementById('payrollFileInput').dataset.targetTxId = txId || "";
            document.getElementById('payrollFileInput').click();
        });
    });
};

const updatePayrollStats = () => {
    if (!payrollTabUnlocked) return;
    const year = document.getElementById('payrollYearFilter').value;
    const rawEntries = getUnifiedPayrolls().filter(p => p.hasPayroll);
    const entries = year === 'all' ? rawEntries : rawEntries.filter(e => e.year == year);

    if (!entries.length) {
        document.getElementById('payrollStatsBruto').textContent = '–';
        document.getElementById('payrollStatsNeto').textContent = '–';
        document.getElementById('payrollStatsIRPF').textContent = '–';
        return;
    }
    const latest = entries[0];
    document.getElementById('payrollStatsBruto').textContent = `${(latest.bruto * 12).toLocaleString('es-ES')}€`;
    const avgNeto = entries.reduce((s, p) => s + p.neto, 0) / entries.length;
    document.getElementById('payrollStatsNeto').textContent = `${avgNeto.toFixed(2)}€`;
    const avgIRPFPercent = entries.reduce((s, p) => s + (p.irpf / p.bruto * 100), 0) / entries.length;
    document.getElementById('payrollStatsIRPF').textContent = `${avgIRPFPercent.toFixed(1)}%`;
};

document.getElementById('payrollYearFilter')?.addEventListener('change', () => {
    renderPayrollsTable();
    updatePayrollStats();
    renderPayrollsChart();
});

document.getElementById('payrollChartMetric')?.addEventListener('change', renderPayrollsChart);

document.getElementById('uploadPayrollBtn').addEventListener('click', () => {
    delete document.getElementById('payrollFileInput').dataset.targetMonth;
    delete document.getElementById('payrollFileInput').dataset.targetTxId;
    document.getElementById('payrollFileInput').click();
});

document.getElementById('payrollFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const targetMonth = e.target.dataset.targetMonth;
    if (!file) return;
    showLoadingOverlay();
    try {
        const reader = new FileReader();
        reader.onload = async (rx) => {
            const base64 = rx.target.result;
            currentPayrollPDF = base64;
            const data = await analizarNomina(base64);
            currentPayrollData = data;
            const dateStr = targetMonth || (data.fecha ? data.fecha.substring(0, 7) : new Date().toISOString().substring(0, 7));
            document.getElementById('confPayrollMonth').value = dateStr;
            document.getElementById('confPayrollBruto').value = data.bruto;
            document.getElementById('confPayrollNeto').value = data.neto;
            document.getElementById('confPayrollIRPF').value = data.irpf;
            document.getElementById('confPayrollSS').value = data.ss;
            document.getElementById('confPayrollDietas').value = data.dietas;
            document.getElementById('confPayrollLocomocion').value = data.locomocion;
            hideLoadingOverlay();
            document.getElementById('confirmPayrollModal').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    } catch (err) {
        hideLoadingOverlay();
        showErrorToast('Error al procesar el PDF');
    }
});

document.getElementById('cancelConfPayrollBtn').addEventListener('click', () => {
    document.getElementById('confirmPayrollModal').classList.add('hidden');
    currentPayrollPDF = null; currentPayrollData = null;
    document.getElementById('payrollFileInput').value = '';
});

document.getElementById('saveConfPayrollBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveConfPayrollBtn');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        const monthVal = document.getElementById('confPayrollMonth').value;
        const targetTxId = document.getElementById('payrollFileInput').dataset.targetTxId;
        const [year, month] = monthVal.split('-').map(Number);
        const finalData = {
            year, month,
            txId: targetTxId || null,
            bruto: parseFloat(document.getElementById('confPayrollBruto').value),
            neto: parseFloat(document.getElementById('confPayrollNeto').value),
            irpf: parseFloat(document.getElementById('confPayrollIRPF').value),
            ss: parseFloat(document.getElementById('confPayrollSS').value),
            dietas: parseFloat(document.getElementById('confPayrollDietas').value),
            locomocion: parseFloat(document.getElementById('confPayrollLocomocion').value),
            date: new Date(year, month - 1, 1)
        };
        await savePayroll(userId, finalData, currentPayrollPDF);
        showSaveToast('Nómina');
        document.getElementById('confirmPayrollModal').classList.add('hidden');
        currentPayrollPDF = null; currentPayrollData = null;
        document.getElementById('payrollFileInput').value = '';
        renderPayrollsChart(); // Refresh chart after save
    } catch (err) {
        showErrorToast('Error al guardar nómina');
    } finally {
        btn.disabled = false; btn.textContent = 'Guardar Nómina';
    }
});

// ─── INVESTMENTS ─────────────────────────────────────────────────────────────
const initInvFilters = () => {
    const yearSelect = document.getElementById('invFilterYear');
    if (!yearSelect || yearSelect.options.length > 0) return;

    const allOpt = document.createElement('option');
    allOpt.value = 'all'; allOpt.textContent = 'Todos los años';
    yearSelect.appendChild(allOpt);

    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 5; y--) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        yearSelect.appendChild(opt);
    }
    yearSelect.value = 'all'; // Default to show everything
};

const renderInvestments = () => {
    initInvFilters();

    const yearVal = document.getElementById('invFilterYear').value;
    const month = document.getElementById('invFilterMonth').value;
    const filterText = document.getElementById('invFilterConcept').value.toLowerCase();

    let investments = allUserTransactions.filter(t =>
        t.category && t.category === 'Inversiones'
    );

    // Apply Year/Month filter
    investments = investments.filter(t => {
        const d = t.date?.seconds ? new Date(t.date.seconds * 1000) : (t.date instanceof Date ? t.date : null);
        if (!d && yearVal === 'all' && month === 'all') return true; // Show dateless if no date filters
        if (!d) return false;

        const matchesYear = yearVal === 'all' || d.getFullYear() === parseInt(yearVal);
        const matchesMonth = month === 'all' || d.getMonth() === parseInt(month);
        return matchesYear && matchesMonth;
    });

    const filtered = investments.filter(t =>
        (t.description || '').toLowerCase().includes(filterText) ||
        (t.ticker || '').toLowerCase().includes(filterText) ||
        (t.opId || '').toLowerCase().includes(filterText)
    ).sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));

    renderInvestmentHistory(filtered);
    renderClosedOperations(investments);
    updateInvestmentSummary(investments);
};

const renderInvestmentHistory = (txs) => {
    const tbody = document.getElementById('invHistoryTableBody');
    if (!tbody) return;

    if (!txs.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-10 text-center text-gray-300 text-sm">Sin operaciones para este filtro</td></tr>';
        return;
    }

    tbody.innerHTML = txs.map(t => {
        const dateStr = t.date ? new Date(t.date.seconds * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–';
        return `
            <tr class="border-b border-gray-50 hover:bg-gray-50/50 transition">
                <td class="p-4 text-xs text-gray-500">${dateStr}</td>
                <td class="p-4">
                    <span class="text-[9px] font-black uppercase px-2 py-1 rounded-md ${t.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
                        ${t.type === 'income' ? 'Venta' : 'Compra'}
                    </span>
                </td>
                <td class="p-4 font-black ${t.type === 'income' ? 'text-emerald-600' : 'text-red-500'}">
                    ${t.type === 'income' ? '+' : '-'}${t.amount.toFixed(2)}€
                </td>
                <td class="p-4">
                    <div class="font-bold text-gray-800">${t.ticker || '–'}</div>
                    <div class="text-[10px] text-gray-400 font-black uppercase tracking-widest">${t.opId || 'NO-ID'}</div>
                </td>
                <td class="p-4 font-medium text-gray-600">${t.shares || '–'}</td>
                <td class="p-4 text-[10px] text-gray-400 font-bold">${t.account || '–'}</td>
                <td class="p-4 text-right flex justify-end gap-2">
                    <button class="edit-inv-btn text-xs font-black text-indigo-400 hover:text-indigo-600 transition" data-id="${t.id}">Editar</button>
                    <button class="delete-inv-btn text-xs font-black text-gray-300 hover:text-red-500 transition" data-id="${t.id}">✕</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.edit-inv-btn').forEach(btn => btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const t = allUserTransactions.find(tx => tx.id === id);
        if (!t) return;

        document.getElementById('invId').value = t.id;
        document.getElementById('invOpId').value = t.opId || '';
        document.getElementById('invTicker').value = t.ticker || '';
        document.getElementById('invDescription').value = t.description || '';
        document.getElementById('invShares').value = t.shares || '';
        document.getElementById('invAmount').value = t.amount || '';
        document.getElementById('invType').value = t.type || 'expense';
        document.getElementById('invAccount').value = t.account || '';
        document.getElementById('invDate').value = t.date?.seconds ? new Date(t.date.seconds * 1000).toISOString().split('T')[0] : '';

        document.getElementById('investmentForm').querySelector('button[type="submit"]').textContent = 'Actualizar';
        document.getElementById('cancelInvEditBtn').classList.remove('hidden');
        document.getElementById('invOpId').focus();
        updateInvPriceHint();
    }));

    tbody.querySelectorAll('.delete-inv-btn').forEach(btn => btn.addEventListener('click', async (e) => {
        if (confirm('¿Eliminar esta operación de inversión?')) {
            await deleteDoc(doc(db, dbCollections.transactions, e.currentTarget.dataset.id));
            showDeleteToast();
        }
    }));
};

const renderClosedOperations = (allInv) => {
    const tbody = document.getElementById('invClosedTableBody');
    if (!tbody) return;

    // Agrupar por Op ID
    const groups = {};
    allInv.forEach(t => {
        if (!t.opId) return;
        if (!groups[t.opId]) groups[t.opId] = { buys: [], sells: [], ticker: t.ticker, description: t.description };
        if (t.type === 'expense') groups[t.opId].buys.push(t);
        else groups[t.opId].sells.push(t);
    });

    const closed = Object.entries(groups).filter(([id, g]) => g.buys.length > 0 && g.sells.length > 0);

    if (closed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-10 text-center text-gray-300">No hay operaciones cerradas.</td></tr>';
        return;
    }

    tbody.innerHTML = closed.map(([opId, g]) => {
        const totalBuy = g.buys.reduce((s, t) => s + t.amount, 0);
        const totalSell = g.sells.reduce((s, t) => s + t.amount, 0);
        const totalSharesBuy = g.buys.reduce((s, t) => s + (t.shares || 0), 0);
        const totalSharesSell = g.sells.reduce((s, t) => s + (t.shares || 0), 0);

        const avgBuyPrice = totalBuy / totalSharesBuy;
        const avgSellPrice = totalSell / totalSharesSell;

        const result = totalSell - totalBuy;
        const roi = (result / totalBuy) * 100;

        const firstBuyDate = new Date(Math.min(...g.buys.map(t => t.date?.seconds * 1000 || 0))).toLocaleDateString();
        const lastSellDate = new Date(Math.max(...g.sells.map(t => t.date?.seconds * 1000 || 0))).toLocaleDateString();

        return `
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
                <td class="p-4">
                    <div class="font-black text-gray-700">${g.description}</div>
                    <div class="text-[10px] font-bold text-indigo-500 uppercase">${g.ticker} (Op: ${opId})</div>
                </td>
                <td class="p-4 text-xs font-medium text-gray-500">
                    <div>C: ${firstBuyDate}</div>
                    <div>V: ${lastSellDate}</div>
                </td>
                <td class="p-4 text-gray-600 font-medium">${avgBuyPrice.toFixed(3)}€</td>
                <td class="p-4 text-gray-600 font-medium">${avgSellPrice.toFixed(3)}€</td>
                <td class="p-4 font-black ${result >= 0 ? 'text-emerald-600' : 'text-red-500'}">
                    ${result >= 0 ? '+' : ''}${result.toFixed(2)}€
                </td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded-md text-[10px] font-black ${roi >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
                        ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%
                    </span>
                </td>
            </tr>
        `;
    }).join('');
};

const updateInvestmentSummary = (investments) => {
    // Solo operaciones cerradas para el resultado total
    const groups = {};
    investments.forEach(t => {
        if (!t.opId) return;
        if (!groups[t.opId]) groups[t.opId] = { buys: [], sells: [] };
        if (t.type === 'expense') groups[t.opId].buys.push(t);
        else groups[t.opId].sells.push(t);
    });

    let totalResult = 0;
    let totalRoiSum = 0;
    let closedCount = 0;

    Object.values(groups).forEach(g => {
        if (g.buys.length > 0 && g.sells.length > 0) {
            const buy = g.buys.reduce((s, t) => s + t.amount, 0);
            const sell = g.sells.reduce((s, t) => s + t.amount, 0);
            const res = sell - buy;
            totalResult += res;
            totalRoiSum += (res / buy) * 100;
            closedCount++;
        }
    });

    const resEl = document.getElementById('invTotalResult');
    if (resEl) {
        resEl.textContent = `${totalResult.toFixed(2)}€`;
        resEl.className = `text-2xl font-black ${totalResult >= 0 ? 'text-emerald-600' : 'text-red-500'}`;
    }

    const roiEl = document.getElementById('invAvgROI');
    if (roiEl) roiEl.textContent = closedCount > 0 ? `${(totalRoiSum / closedCount).toFixed(1)}%` : '–';

    const countEl = document.getElementById('invClosedCount');
    if (countEl) countEl.textContent = closedCount;
};

// Form calculations
const updateInvPriceHint = () => {
    const shares = parseFloat(document.getElementById('invShares').value);
    const amount = parseFloat(document.getElementById('invAmount').value);
    const hint = document.getElementById('invPricePerShare');
    if (!hint) return;
    if (shares > 0 && amount > 0) {
        hint.textContent = `Precio/Acción: ${(amount / shares).toFixed(4)} €`;
        hint.classList.add('text-indigo-600');
    } else {
        hint.textContent = 'Precio/Acción: – €';
        hint.classList.remove('text-indigo-600');
    }
};

document.getElementById('invShares')?.addEventListener('input', updateInvPriceHint);
document.getElementById('invAmount')?.addEventListener('input', updateInvPriceHint);

// Ticker to Concept Suggestion
document.getElementById('invTicker')?.addEventListener('blur', (e) => {
    const ticker = e.target.value.toUpperCase().trim();
    if (!ticker) return;
    const existing = allUserTransactions.find(t => t.category === 'Inversión' && t.ticker === ticker);
    if (existing && !document.getElementById('invDescription').value) {
        document.getElementById('invDescription').value = existing.description;
    }
});

// Investment Form Submit
document.getElementById('investmentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('invType').value;
    const opId = document.getElementById('invOpId').value.trim();

    // Validación de trazabilidad para ventas
    if (type === 'income') {
        const hasBuy = allUserTransactions.some(t => t.category === 'Inversión' && t.opId === opId && t.type === 'expense');
        if (!hasBuy) {
            showErrorToast('Error: No hay una operación de compra con este Nº ID');
            return;
        }
    }

    const data = {
        opId,
        ticker: document.getElementById('invTicker').value.toUpperCase().trim(),
        description: document.getElementById('invDescription').value.trim(),
        shares: parseFloat(document.getElementById('invShares').value),
        amount: parseFloat(document.getElementById('invAmount').value),
        type,
        date: new Date(document.getElementById('invDate').value),
        category: 'Inversiones',
        account: document.getElementById('invAccount').value,
        accountingBook: userAccountingBooks[0] || 'Principal',
        userId,
        createdAt: serverTimestamp()
    };

    try {
        const invId = document.getElementById('invId').value;
        if (invId) {
            await updateDoc(doc(db, dbCollections.transactions, invId), data);
            showSaveToast('Operación actualizada');
        } else {
            await addDoc(collection(db, dbCollections.transactions), data);
            showSaveToast('Operación registrada');
        }

        e.target.reset();
        document.getElementById('invId').value = '';
        document.getElementById('submitInvBtn').textContent = 'Registrar';
        document.getElementById('cancelInvEditBtn').classList.add('hidden');
        updateInvPriceHint();
        renderInvestments();
    } catch (err) {
        showErrorToast('Error al guardar');
    }
});

document.getElementById('cancelInvEditBtn')?.addEventListener('click', () => {
    document.getElementById('investmentForm').reset();
    document.getElementById('invId').value = '';
    document.getElementById('submitInvBtn').textContent = 'Registrar';
    document.getElementById('cancelInvEditBtn').classList.add('hidden');
    updateInvPriceHint();
});

document.getElementById('invFilterConcept')?.addEventListener('input', renderInvestments);
document.getElementById('invFilterYear')?.addEventListener('change', renderInvestments);
document.getElementById('invFilterMonth')?.addEventListener('change', renderInvestments);



