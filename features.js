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
        const isActive = item.active !== false; // Active by default if not specified

        return `<tr class="text-sm border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition">
            <td class="py-4">
                <p class="font-bold text-gray-800">${item.name}</p>
                <p class="text-[10px] text-gray-400 uppercase font-black tracking-widest">${item.category || 'Varios'}</p>
            </td>
            <td class="py-4 font-black text-indigo-600">${item.amount?.toFixed(2)}€</td>
            <td class="py-4 ${urgency} whitespace-nowrap">Día ${item.day} <span class="text-[10px] font-normal block opacity-70">en ${daysUntil}d</span></td>
            <td class="py-4">
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="sr-only peer toggle-active-recurring" data-id="${item.id}" ${isActive ? 'checked' : ''}>
                    <div class="w-9 h-5 bg-gray-200 rounded-full peer peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                </label>
            </td>
            <td class="py-4 text-right">
                <button class="delete-recurring bg-red-50 text-red-500 p-2 rounded-lg hover:bg-red-500 hover:text-white transition" data-id="${item.id}" title="Eliminar definitivamente">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
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
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const registered = [];

    for (const item of recurringItems) {
        // Solo procesar si está activa
        if (!item.active) continue;

        // El registro ocurre si hoy es el día o si ya ha pasado este mes (catch-up)
        if (item.day > todayDay) continue;

        // Comprobar si ya se registró este mes
        const alreadyDone = transactions.some(t => {
            const d = t.date?.toDate?.();
            return d && d.getMonth() === currentMonth && d.getFullYear() === currentYear &&
                t.description?.includes(item.name) && t.category === (item.category || 'Facturas');
        });

        if (!alreadyDone) {
            // Lógica de "No registrar si se activó después del día de vencimiento este mes"
            if (item.lastActivatedAt) {
                const activationDate = item.lastActivatedAt.toDate();
                const theoreticalDateThisMonth = new Date(currentYear, currentMonth, item.day);
                // Si la activación fue después del día en que debía cobrarse este mes, ignoramos hasta el mes que viene
                if (activationDate > theoreticalDateThisMonth) {
                    continue; 
                }
            }

            const theoreticalDate = new Date(currentYear, currentMonth, item.day);
            
            await addDoc(collection(db, dbCollections.transactions), {
                type: 'expense',
                description: `🔄 ${item.name} (automático)`,
                amount: item.amount,
                category: item.category || 'Facturas',
                account: item.account || '',
                accountingBook: 'Principal',
                date: theoreticalDate, // Registro con la fecha teórica
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
