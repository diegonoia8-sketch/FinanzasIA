/**
 * features.js — Módulos de Presupuestos, Recurrentes y Automatizaciones
 */
import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, dbCollections } from "./config.js";

export const setupBudgetsListener = (userId, transactions, callback) => {
    return onSnapshot(query(collection(db, dbCollections.budgets), where("userId", "==", userId)), (snapshot) => {
        const budgets = snapshot.docs.map(doc => doc.data());
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const budgetStatus = budgets.map(b => {
            const spent = transactions
                .filter(t => t.category === b.category && t.type === 'expense' &&
                    t.date?.toDate?.().getMonth() === currentMonth &&
                    t.date?.toDate?.().getFullYear() === currentYear)
                .reduce((sum, t) => sum + t.amount, 0);
            return { ...b, spent };
        });
        callback(budgetStatus);
    });
};

export const renderBudgetList = (budgets) => {
    const list = document.getElementById('budgetList');
    if (!list) return;
    if (budgets.length === 0) {
        list.innerHTML = '<div class="p-10 text-center text-gray-300 border-2 border-dashed rounded-2xl">No has definido metas mensuales aún.</div>';
        return;
    }
    list.innerHTML = budgets.map(b => {
        const percent = b.amount > 0 ? Math.min((b.spent / b.amount) * 100, 100) : 0;
        const color = percent > 100 ? 'bg-red-500' : percent > 80 ? 'bg-amber-500' : 'bg-emerald-500';
        const textColor = percent > 100 ? 'text-red-500' : percent > 80 ? 'text-amber-600' : 'text-gray-500';
        return `
            <div class="space-y-2 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div class="flex justify-between text-sm font-bold">
                    <span class="text-gray-800">${b.category}</span>
                    <span class="${textColor}">${b.spent.toFixed(2)}€ <span class="font-normal text-gray-400">/ ${b.amount}€</span></span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                    <div class="${color} h-2 rounded-full transition-all duration-700" style="width: ${percent}%"></div>
                </div>
                <p class="text-[10px] text-gray-400">${percent.toFixed(0)}% consumido — Quedan ${Math.max(0, b.amount - b.spent).toFixed(2)}€</p>
            </div>
        `;
    }).join('');
};

export const setupRecurringListener = (userId, callback) => {
    return onSnapshot(query(collection(db, dbCollections.recurring), where("userId", "==", userId)), (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(items);
    });
};

export const renderRecurringList = (items) => {
    const tbody = document.getElementById('recurringTableBody');
    if (!tbody) return;
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="py-10 text-center text-gray-300 text-sm">No tienes suscripciones registradas.</td></tr>';
        return;
    }
    tbody.innerHTML = items.map(item => {
        const today = new Date().getDate();
        const daysUntil = item.day >= today ? item.day - today : (31 - today + item.day);
        const urgency = daysUntil <= 3 ? 'text-red-500 font-bold' : daysUntil <= 7 ? 'text-amber-500 font-semibold' : 'text-gray-400';
        return `<tr class="text-sm border-b border-gray-50 last:border-0">
            <td class="py-4 font-medium text-gray-800">${item.name}</td>
            <td class="py-4 font-bold text-indigo-600">${item.amount?.toFixed(2)}€</td>
            <td class="py-4 ${urgency}">Día ${item.day} <span class="text-xs font-normal">(en ${daysUntil}d)</span></td>
            <td class="py-4"><span class="bg-gray-100 px-2 py-1 rounded-full text-[10px] font-bold uppercase text-gray-500">${item.category || 'Varios'}</span></td>
            <td class="py-4 text-right">
                <button class="delete-recurring text-red-300 hover:text-red-500 transition" data-id="${item.id}">×</button>
            </td>
        </tr>`;
    }).join('');
};

// Render upcoming payments card in dashboard
export const renderUpcomingPayments = (items) => {
    const container = document.getElementById('upcomingPaymentsContainer');
    if (!container) return;
    const today = new Date().getDate();
    const upcoming = items
        .map(it => ({ ...it, daysUntil: it.day >= today ? it.day - today : 31 - today + it.day }))
        .filter(it => it.daysUntil <= 14)
        .sort((a, b) => a.daysUntil - b.daysUntil)
        .slice(0, 5);

    if (upcoming.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-300 text-center py-4">Sin pagos próximos</p>';
        return;
    }
    container.innerHTML = upcoming.map(it => `
        <div class="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
            <div>
                <p class="text-sm font-medium text-gray-800">${it.name}</p>
                <p class="text-[10px] font-black uppercase ${it.daysUntil <= 3 ? 'text-red-400' : 'text-gray-400'}">${it.daysUntil === 0 ? 'HOY' : `En ${it.daysUntil} días`}</p>
            </div>
            <span class="text-sm font-bold text-indigo-600">${it.amount?.toFixed(2)}€</span>
        </div>
    `).join('');
};

// Auto-register recurring transactions
export const checkAndRegisterRecurring = async (userId, recurringItems, transactions) => {
    const today = new Date();
    const todayDay = today.getDate();
    const month = today.getMonth();
    const year = today.getFullYear();
    const registered = [];

    for (const item of recurringItems) {
        if (item.day !== todayDay) continue;

        // Check if already registered this month
        const alreadyDone = transactions.some(t => {
            const d = t.date?.toDate?.();
            return d && d.getMonth() === month && d.getFullYear() === year &&
                t.description?.includes(item.name) && t.category === (item.category || 'Facturas');
        });

        if (!alreadyDone) {
            await addDoc(collection(db, dbCollections.transactions), {
                type: 'expense',
                description: `🔄 ${item.name} (automático)`,
                amount: item.amount,
                category: item.category || 'Facturas',
                account: item.account || '',
                accountingBook: 'Principal',
                date: new Date(),
                userId,
                createdAt: serverTimestamp(),
                isRecurring: true
            });
            registered.push(item.name);
        }
    }
    return registered;
};

// Check budget alerts at 80%
export const getBudgetAlerts = (budgets) => {
    return budgets.filter(b => b.amount > 0).map(b => {
        const pct = (b.spent / b.amount) * 100;
        if (pct >= 100) return { b, level: 'over', pct };
        if (pct >= 80) return { b, level: 'warning', pct };
        return null;
    }).filter(Boolean);
};
