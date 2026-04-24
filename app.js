import { auth, db, dbCollections } from "./config.js";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, getRedirectResult } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, onSnapshot, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showTab, populateSelectOptions, toggleBalancesVisibility, showLoadingOverlay, hideLoadingOverlay } from "./ui.js";
import { saveTransaction, deleteDocument, addSetting, saveBudget, saveRecurring } from "./db.js";
import { renderIncomeExpenseChart, renderCategoryAnalysisChart, renderCashFlowChart, renderTendenciasChart, renderHeatmap, renderHistoryCategoryChart } from "./charts.js";
import { callGemini, callGeminiChat, resetChatHistory, categorizarConcepto, getConsejoDelDia, buildFinancialContext, compressImage } from "./api.js";
import { generateAiReport, generateExlabesaReport, generateFuelReport } from "./reports.js";
import { showToast, showSaveToast, showDeleteToast, showErrorToast, showInfoToast } from "./toast.js";
import { setupBudgetsListener, renderBudgetList, setupRecurringListener, renderRecurringList, renderUpcomingPayments, checkAndRegisterRecurring } from "./features.js";
import { calcHealthScore, getHealthLabel, calcEndOfMonthPrediction, calcMonthComparison, detectAlerts, calcHeatmapData, calcTendencias } from "./analytics.js";
import { parseCSVFile, guessCategory } from "./csv-importer.js";

// ─── STATE ───────────────────────────────────────────────────────────────────
let userId = null;
let allUserTransactions = [];
let allRecurringItems = [];
let allBudgets = [];
let userCategories = [];
let userAccounts = [];
let userAccountingBooks = [];
let currentScannedImage = null;
let budgetsUnsubscribe = null;
let recurringUnsubscribe = null;
let compactMode = false;
let pendingCsvTransactions = [];

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
getRedirectResult(auth).catch(() => {});

// ─── FIRESTORE LISTENERS ──────────────────────────────────────────────────────
const setupRealtimeListeners = (uid) => {
    // Transactions
    onSnapshot(query(collection(db, dbCollections.transactions), where("userId", "==", uid)), (snapshot) => {
        allUserTransactions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderDashboard();
        if (!document.getElementById('transactionHistory').classList.contains('hidden')) applyFiltersAndRender();
        if (budgetsUnsubscribe) budgetsUnsubscribe();
        budgetsUnsubscribe = setupBudgetsListener(uid, allUserTransactions, (budgets) => {
            allBudgets = budgets;
            renderBudgetList(budgets);
            updateDashboardAnalytics();
        });
    });

    // Settings
    onSnapshot(doc(db, dbCollections.userSettings, uid), (snap) => {
        if (snap.exists()) {
            renderSettings(snap.data());
        } else {
            setDoc(snap.ref, {
                categories: ["Salario","Inversiones","Regalo","Otros Ingresos","Alquiler","Comida","Transporte","Combustible","Ocio","Facturas","Salud","Educación","Ropa","Otros Gastos","Transferencia","Saldo Inicial","No Contabilizados","EXLABESA"],
                accounts: ["Efectivo","Cuenta Bancaria","Tarjeta de Crédito"],
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
        populateSelectOptions('recurringCategory', userCategories.filter(c => !['Transferencia','Saldo Inicial'].includes(c)));
        populateSelectOptions('recurringAccount', userAccounts);
        // Listeners para activar/desactivar y eliminar
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

        document.querySelectorAll('.delete-recurring').forEach(btn =>
            btn.addEventListener('click', async (e) => {
                if (confirm('¿Eliminar suscripción permanentemente?')) {
                    await deleteDoc(doc(db, dbCollections.recurring, e.currentTarget.dataset.id));
                    showDeleteToast();
                }
            })
        );
        // Auto-register today's subscriptions
        const registered = await checkAndRegisterRecurring(uid, items, allUserTransactions);
        if (registered.length > 0) showInfoToast(`Auto-registrado: ${registered.join(', ')}`);
    });
};

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
const renderSettings = (settings) => {
    userCategories = settings.categories || [];
    userAccounts = settings.accounts || [];
    userAccountingBooks = settings.accountingBooks || [];

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

    const catsExp = userCategories.filter(c => !['Transferencia','Saldo Inicial'].includes(c));
    populateSelectOptions('category', catsExp);
    populateSelectOptions('budgetCategory', catsExp);
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
    const fuelTxs = txs.filter(t => t.category === 'Combustible' && !t.description.toLowerCase().includes('peaje')).sort((a,b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
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
        
        document.getElementById('dashFuelLiters').textContent = `${avgL100.toFixed(1)}L`;
        document.getElementById('dashFuelEuros').textContent = `${avgE100.toFixed(2)}€`;
        document.getElementById('dashFuelPriceHist').textContent = `Media: ${avgPricePerLiter.toFixed(3)} €/L`;
        
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
            document.getElementById('dashFuelLitersComp').innerHTML = `Último: ${lAvg.toFixed(1)}L <span class="${diffL > 0 ? 'text-red-400' : 'text-emerald-400'}">(${diffL > 0 ? '+' : ''}${diffL.toFixed(1)}%)</span>`;
            document.getElementById('dashFuelEurosComp').innerHTML = `Último: ${eAvg.toFixed(2)}€ <span class="${diffE > 0 ? 'text-red-400' : 'text-emerald-400'}">(${diffE > 0 ? '+' : ''}${diffE.toFixed(1)}%)</span>`;
            document.getElementById('dashFuelPriceLatest').textContent = `Último: ${latestPricePerLiter.toFixed(3)} €/L`;
        }
    }
};

const updateDashboardAnalytics = () => {
    // Health Score
    const score = calcHealthScore(allUserTransactions, allBudgets);
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
    const alerts = detectAlerts(allUserTransactions, allBudgets);
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
        getConsejoDelDia(allUserTransactions, allBudgets).then(tip => {
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
            <td class="px-4 py-3 text-sm font-medium text-gray-800 max-w-xs truncate">${t.description || '–'} ${t.receiptImage ? '<span title="Tiene ticket">📎</span>' : ''} ${(t.tags||[]).map(tag => `<span class="text-[9px] bg-indigo-50 text-indigo-500 px-1.5 rounded-full font-bold">${tag}</span>`).join('')}</td>
            <td class="px-4 py-3 hidden md:table-cell"><span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold">${t.category||'–'}</span></td>
            <td class="px-4 py-3 hidden md:table-cell text-xs text-gray-400">${t.account||'–'}</td>
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
    if (s) { const sd = new Date(s); sd.setHours(0,0,0,0); filtered = filtered.filter(t => t.date?.toDate?.() >= sd); }
    if (e) { const ed = new Date(e); ed.setHours(23,59,59,999); filtered = filtered.filter(t => t.date?.toDate?.() <= ed); }
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
const showTransactionMenu = () => { ['transactionMain','transactionHistory','transactionContent'].forEach(id => document.getElementById(id).classList.add('hidden')); document.getElementById('transactionMenu').classList.remove('hidden'); };
const showTransactionForm = () => { document.getElementById('transactionMenu').classList.add('hidden'); document.getElementById('transactionContent').classList.remove('hidden'); document.getElementById('incomeExpenseForm').classList.add('hidden'); document.getElementById('transferForm').classList.add('hidden'); };

// ─── AUTH STATE ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
    if (user) {
        userId = user.uid;
        showMainApp(user);
        setupRealtimeListeners(userId);
        // Set current month range
        const t = new Date(), y = t.getFullYear(), m = t.getMonth();
        const first = new Date(y, m, 1), last = new Date(y, m+1, 0);
        first.setMinutes(first.getMinutes()-first.getTimezoneOffset());
        last.setMinutes(last.getMinutes()-last.getTimezoneOffset());
        document.getElementById('categoryAnalysisStartDate').value = first.toISOString().split('T')[0];
        document.getElementById('categoryAnalysisEndDate').value = last.toISOString().split('T')[0];
    } else {
        userId = null; showAuthScreen();
    }
});

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
// Tabs
document.querySelectorAll('.tab-button').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

// Transaction navigation
document.getElementById('registerTransactionBtn').addEventListener('click', showTransactionMenu);
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
    const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
    document.getElementById('date').value = d.toISOString().split('T')[0];
});
document.getElementById('addExpenseBtn').addEventListener('click', () => {
    showTransactionForm(); resetTransactionForm();
    document.getElementById('incomeExpenseForm').classList.remove('hidden');
    document.getElementById('formTitle').textContent = 'Registrar Gasto';
    document.getElementById('submitBtn').textContent = 'Guardar Gasto';
    document.getElementById('type').value = 'expense';
    const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
    document.getElementById('date').value = d.toISOString().split('T')[0];
});
document.getElementById('addTransferBtn').addEventListener('click', () => { showTransactionForm(); document.getElementById('transferForm').classList.remove('hidden'); });

// Auto-categorization while typing
document.getElementById('description').addEventListener('input', async (e) => {
    const val = e.target.value;
    if (val.length < 3) { document.getElementById('autoCategorizationHint').classList.add('hidden'); return; }
    const suggested = await categorizarConcepto(val, userCategories);
    const hint = document.getElementById('autoCategorizationHint');
    if (suggested) {
        hint.textContent = `💡 Categoría sugerida: ${suggested}`;
        hint.classList.remove('hidden');
        document.getElementById('category').value = suggested;
    } else { hint.classList.add('hidden'); }
});

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
        await saveTransaction(userId, txId, data, currentScannedImage);
        resetTransactionForm(); currentScannedImage = null;
        document.getElementById('transactionContent').classList.add('hidden');
        document.getElementById('transactionMain').classList.remove('hidden');
        showSaveToast('Transacción');
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
document.getElementById('clearFiltersBtn').addEventListener('click', () => { document.getElementById('filterStartDate').value = ''; document.getElementById('filterEndDate').value = ''; document.getElementById('filterConcept').value = ''; applyFiltersAndRender(); });
document.getElementById('filterConcept')?.addEventListener('input', applyFiltersAndRender);
document.getElementById('historyCategoryType')?.addEventListener('change', applyFiltersAndRender);

document.getElementById('toggleCompactBtn').addEventListener('click', (e) => {
    compactMode = !compactMode;
    e.currentTarget.textContent = compactMode ? 'Normal' : 'Compact';
    applyFiltersAndRender();
});

document.getElementById('exportExcelBtn').addEventListener('click', () => {
    const headers = ['Fecha','Tipo','Descripción','Importe','Categoría','Cuenta','Notas','Tags'];
    let csv = "data:text/csv;charset=utf-8," + headers.join(',') + '\n';
    allUserTransactions.forEach(t => {
        const d = t.date ? new Date(t.date.seconds * 1000).toLocaleDateString('es-ES') : 'N/A';
        csv += [d, t.type === 'income' ? 'Ingreso' : 'Gasto', `"${(t.description||'').replace(/"/g,'""')}"`, t.amount?.toFixed(2), t.category||'', t.account||'', `"${(t.notes||'').replace(/"/g,'""')}"`, (t.tags||[]).join('; ')].join(',') + '\n';
    });
    const link = document.createElement('a'); link.href = encodeURI(csv); link.download = 'transacciones.csv'; document.body.appendChild(link); link.click(); link.remove();
});

// Past balance
document.getElementById('calculatePastBalanceBtn').addEventListener('click', () => {
    const dateInput = document.getElementById('pastBalanceDate').value;
    if (!dateInput) return showErrorToast('Selecciona una fecha');
    const target = new Date(dateInput); target.setHours(23,59,59,999);
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
    document.getElementById('scanReceiptText').textContent = 'Analizando...';
    const reader = new FileReader();
    reader.onload = async (rx) => {
        const compressed = await compressImage(rx.target.result);
        currentScannedImage = compressed;
        document.getElementById('receiptPreview').src = compressed;
        document.getElementById('receiptPreviewContainer').classList.remove('hidden');
        try {
            const prompt = `Analiza este ticket y extrae: {"amount": number, "category": string, "date": "YYYY-MM-DD", "description": string}. Solo el JSON.`;
            const result = await callGemini("Eres un OCR financiero preciso.", prompt, compressed);
            const json = JSON.parse(result.replace(/```json|```/g, '').trim());
            if (json.amount) document.getElementById('amount').value = json.amount;
            if (json.description) document.getElementById('description').value = json.description;
            if (json.date) document.getElementById('date').value = json.date;
            if (json.category && userCategories.includes(json.category)) document.getElementById('category').value = json.category;
            showInfoToast('Ticket escaneado');
        } catch (err) { console.error("OCR Error:", err); }
        document.getElementById('scanReceiptText').textContent = 'Escanear';
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
        ).join('') + (total > 5 ? `<p class="text-[10px] text-gray-400 mt-1">...y ${total-5} más</p>` : '');
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

// VOICE (Chrome/Safari)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const voiceBtn = document.getElementById('voiceBtn');
    voiceBtn.classList.remove('hidden');
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES'; recognition.interimResults = false;
    let listening = false;
    voiceBtn.addEventListener('click', () => {
        if (listening) { recognition.stop(); listening = false; voiceBtn.classList.remove('voice-btn-active'); return; }
        recognition.start(); listening = true; voiceBtn.classList.add('voice-btn-active');
        showInfoToast('Escuchando... Di "gasté 30 euros en comida"');
    });
    recognition.onresult = async (e) => {
        const transcript = e.results[0][0].transcript;
        listening = false; voiceBtn.classList.remove('voice-btn-active');
        showInfoToast(`Procesando: "${transcript}"`);
        try {
            const result = await callGemini("Eres un parser financiero. Extrae JSON de la frase del usuario.", `Frase: "${transcript}". Devuelve: {"amount": number, "description": string, "category": string, "type": "expense|income"}`, null);
            const json = JSON.parse(result.replace(/```json|```/g, '').trim());
            showTransactionMenu();
            if (json.type === 'income') document.getElementById('addIncomeBtn').click();
            else document.getElementById('addExpenseBtn').click();
            setTimeout(() => {
                if (json.amount) document.getElementById('amount').value = json.amount;
                if (json.description) document.getElementById('description').value = json.description;
                if (json.category && userCategories.includes(json.category)) document.getElementById('category').value = json.category;
                const d = new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
                document.getElementById('date').value = d.toISOString().split('T')[0];
            }, 100);
        } catch (err) { showErrorToast('No entendí la frase'); }
    };
    recognition.onerror = () => { listening = false; voiceBtn.classList.remove('voice-btn-active'); };
}

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
        const context = buildFinancialContext(allUserTransactions, allBudgets);
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

// Budget form
document.getElementById('budgetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveBudget(userId, { category: document.getElementById('budgetCategory').value, amount: parseFloat(document.getElementById('budgetAmount').value) });
    e.target.reset(); showSaveToast('Presupuesto');
});

// Recurring form
document.getElementById('recurringForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveRecurring(userId, {
        name: document.getElementById('recurringName').value,
        amount: parseFloat(document.getElementById('recurringAmount').value),
        day: parseInt(document.getElementById('recurringDay').value),
        category: document.getElementById('recurringCategory').value || 'Facturas',
        account: document.getElementById('recurringAccount').value || ''
    });
    e.target.reset(); showSaveToast('Suscripción');
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
