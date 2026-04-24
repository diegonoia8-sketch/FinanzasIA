/**
 * analytics.js — Motor de análisis financiero
 * Health Score, Predicciones, Comparativas, Alertas
 */

// --- HEALTH SCORE (0-100) ---
export const calcHealthScore = (transactions, budgets = []) => {
    const now = new Date();
    const month = now.getMonth(), year = now.getFullYear();
    const txMonth = transactions.filter(t => {
        const d = t.date?.toDate?.();
        return d && d.getMonth() === month && d.getFullYear() === year;
    });
    const income = txMonth.filter(t => t.type === 'income' && !['Transferencia','Saldo Inicial'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const expense = txMonth.filter(t => t.type === 'expense' && !['Transferencia'].includes(t.category)).reduce((s, t) => s + t.amount, 0);

    // Savings rate (0-40 pts)
    const savingsRate = income > 0 ? Math.max(0, (income - expense) / income) : 0;
    const savingsScore = Math.min(40, savingsRate * 133); // 30% savings = 40pts

    // Budget compliance (0-30 pts)
    let budgetScore = budgets.length === 0 ? 20 : 0;
    if (budgets.length > 0) {
        const ok = budgets.filter(b => b.spent <= b.amount).length;
        budgetScore = (ok / budgets.length) * 30;
    }

    // Tracking consistency (0-30 pts): having entries is good
    const trackingScore = Math.min(30, txMonth.length * 1.5);

    return Math.round(Math.min(100, savingsScore + budgetScore + trackingScore));
};

export const getHealthLabel = (score) => {
    if (score >= 80) return { label: 'Excelente', color: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
    if (score >= 60) return { label: 'Buena', color: '#f59e0b', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' };
    if (score >= 40) return { label: 'Regular', color: '#f97316', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' };
    return { label: 'Crítica', color: '#ef4444', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' };
};

// --- FIN DE MES PREDICCIÓN ---
export const calcEndOfMonthPrediction = (transactions) => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - dayOfMonth;

    const txMonth = transactions.filter(t => {
        const d = t.date?.toDate?.();
        return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const income = txMonth.filter(t => t.type === 'income' && !['Transferencia','Saldo Inicial'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const expense = txMonth.filter(t => t.type === 'expense' && !['Transferencia'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const dailyRate = dayOfMonth > 0 ? expense / dayOfMonth : 0;
    const projectedExpense = expense + (dailyRate * daysLeft);
    const projectedSavings = income - projectedExpense;

    return { income, expense, projectedExpense, projectedSavings, daysLeft, dailyRate, daysInMonth };
};

// --- COMPARATIVA MES ANTERIOR ---
export const calcMonthComparison = (transactions) => {
    const now = new Date();
    const cM = now.getMonth(), cY = now.getFullYear();
    const pM = cM === 0 ? 11 : cM - 1;
    const pY = cM === 0 ? cY - 1 : cY;

    const filterMonth = (m, y) => transactions.filter(t => {
        const d = t.date?.toDate?.();
        return d && d.getMonth() === m && d.getFullYear() === y;
    });

    const sumExpense = (txs) => txs.filter(t => t.type === 'expense' && !['Transferencia'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const sumIncome = (txs) => txs.filter(t => t.type === 'income' && !['Transferencia','Saldo Inicial'].includes(t.category)).reduce((s, t) => s + t.amount, 0);

    const cTxs = filterMonth(cM, cY);
    const pTxs = filterMonth(pM, pY);
    const cExp = sumExpense(cTxs), pExp = sumExpense(pTxs);
    const cInc = sumIncome(cTxs), pInc = sumIncome(pTxs);
    const deltaExp = pExp > 0 ? ((cExp - pExp) / pExp) * 100 : 0;
    const deltaInc = pInc > 0 ? ((cInc - pInc) / pInc) * 100 : 0;

    // Top 3 categorías con más cambio
    const catMap = {};
    const processTxs = (txs, field) => txs.filter(t => t.type === 'expense').forEach(t => {
        if (!catMap[t.category]) catMap[t.category] = { current: 0, prev: 0 };
        catMap[t.category][field] += t.amount;
    });
    processTxs(cTxs, 'current');
    processTxs(pTxs, 'prev');

    const topChanges = Object.entries(catMap)
        .filter(([, v]) => v.prev > 0 || v.current > 0)
        .map(([cat, v]) => ({ cat, delta: v.prev > 0 ? ((v.current - v.prev) / v.prev) * 100 : 100, current: v.current, prev: v.prev }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3);

    return { cExp, pExp, cInc, pInc, deltaExp, deltaInc, topChanges };
};

// --- ALERTAS INTELIGENTES ---
export const detectAlerts = (transactions, budgets = []) => {
    const alerts = [];
    const now = new Date();
    const cM = now.getMonth(), cY = now.getFullYear();
    const pM = cM === 0 ? 11 : cM - 1;
    const pY = cM === 0 ? cY - 1 : cY;

    // Budget alerts
    budgets.forEach(b => {
        const pct = b.amount > 0 ? (b.spent / b.amount) * 100 : 0;
        if (pct >= 100) {
            alerts.push({ type: 'danger', icon: '🚨', text: `Superaste el presupuesto de **${b.category}**: ${b.spent.toFixed(0)}€ / ${b.amount}€` });
        } else if (pct >= 80) {
            alerts.push({ type: 'warning', icon: '⚠️', text: `Llevas el ${pct.toFixed(0)}% del presupuesto de **${b.category}** (${b.spent.toFixed(0)}€ / ${b.amount}€)` });
        }
    });

    // Spending spike detection
    const getMonthExpByCat = (m, y) => {
        const res = {};
        transactions.filter(t => {
            const d = t.date?.toDate?.();
            return d && d.getMonth() === m && d.getFullYear() === y && t.type === 'expense' && !['Transferencia','Saldo Inicial'].includes(t.category);
        }).forEach(t => { res[t.category] = (res[t.category] || 0) + t.amount; });
        return res;
    };

    const cCats = getMonthExpByCat(cM, cY);
    const pCats = getMonthExpByCat(pM, pY);
    Object.entries(cCats).forEach(([cat, amount]) => {
        if (pCats[cat] && pCats[cat] > 10) {
            const increase = ((amount - pCats[cat]) / pCats[cat]) * 100;
            if (increase > 40) {
                alerts.push({ type: 'info', icon: '📈', text: `**${cat}** subió un ${increase.toFixed(0)}% respecto al mes pasado (${pCats[cat].toFixed(0)}€ → ${amount.toFixed(0)}€)` });
            }
        }
    });

    return alerts;
};

// --- DATOS PARA HEATMAP (últimos 90 días) ---
export const calcHeatmapData = (transactions) => {
    const data = {};
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 89);

    transactions.filter(t => {
        const d = t.date?.toDate?.();
        return d && d >= start && t.type === 'expense' && !['Transferencia'].includes(t.category);
    }).forEach(t => {
        const d = t.date.toDate();
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        data[key] = (data[key] || 0) + t.amount;
    });

    return data;
};

// --- DATOS TENDENCIAS POR CATEGORÍA (últimos 6 meses) ---
export const calcTendencias = (transactions, categories) => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ month: d.getMonth(), year: d.getFullYear(), label: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getMonth()] });
    }

    const colors = ['#4f46e5','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
    const topCats = [...new Set(
        transactions.filter(t => t.type === 'expense' && !['Transferencia','Saldo Inicial', 'No Contabilizados'].includes(t.category))
            .sort((a, b) => b.amount - a.amount)
            .map(t => t.category)
    )].slice(0, 5);

    const datasets = topCats.map((cat, i) => ({
        label: cat,
        data: months.map(m => {
            const txs = transactions.filter(t => {
                const d = t.date?.toDate?.();
                return d && d.getMonth() === m.month && d.getFullYear() === m.year && t.category === cat && t.type === 'expense' && t.category !== 'No Contabilizados';
            });
            return txs.reduce((s, t) => s + t.amount, 0);
        }),
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length] + '20',
        tension: 0.4, fill: true, pointRadius: 4, pointHoverRadius: 6
    }));

    return { labels: months.map(m => m.label), datasets };
};
