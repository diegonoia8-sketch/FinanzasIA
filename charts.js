/**
 * charts.js — Visualización de datos con Chart.js
 * Incluye: Income/Expense, Categorías, Cash Flow, Tendencias, Heatmap
 */

import { effectiveAmount } from './analytics.js';


let incomeExpenseChart, categoryAnalysisChart, cashFlowChart, tendenciasChart, historyCategoryChart;

const centerTextPlugin = {
    id: 'centerText',
    beforeDraw: (chart) => {
        if (chart.config.type !== 'doughnut') return;
        const { ctx, data } = chart;
        ctx.save();
        
        const meta = chart.getDatasetMeta(0);
        if (meta.data.length === 0) { ctx.restore(); return; }
        
        let total = 0;
        let income = 0;
        let expense = 0;
        
        data.datasets[0].data.forEach((val, i) => {
            if (chart.getDataVisibility(i)) {
                total += val;
                if (data.labels[i] === 'Ingresos') income = val;
                if (data.labels[i] === 'Gastos') expense = val;
            }
        });
        
        if (total === 0 && income === 0 && expense === 0) { ctx.restore(); return; }
        
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const centerX = meta.data[0].x;
        const centerY = meta.data[0].y;
        
        if (chart.canvas.id === 'incomeExpenseChart') {
            ctx.fillStyle = '#4f46e5';
            ctx.fillText(`Ingresos: ${income.toFixed(2)} €`, centerX, centerY - 8);
            ctx.fillStyle = '#ef4444';
            ctx.fillText(`Gastos: ${expense.toFixed(2)} €`, centerX, centerY + 8);
        } else {
            ctx.fillStyle = '#64748b';
            ctx.fillText(total.toFixed(2) + ' €', centerX, centerY);
        }
        ctx.restore();
    }
};

export const renderIncomeExpenseChart = (transactions) => {
    const ctx = document.getElementById('incomeExpenseChart');
    if (!ctx) return;
    const now = new Date();
    const month = now.getMonth(), year = now.getFullYear();
    const txs = transactions.filter(t => {
        const d = t.date?.toDate?.();
        return d && d.getMonth() === month && d.getFullYear() === year && t.category !== 'No Contabilizados';
    });
    const income = txs.filter(t => t.type === 'income' && !['Transferencia','Saldo Inicial','Inversiones'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter(t => t.type === 'expense' && !['Transferencia','Inversiones'].includes(t.category)).reduce((s, t) => s + effectiveAmount(t), 0);

    if (incomeExpenseChart) incomeExpenseChart.destroy();
    incomeExpenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Ingresos', 'Gastos'],
            datasets: [{ data: [income, expense], backgroundColor: ['#4f46e5', '#ef4444'], borderWidth: 0, hoverOffset: 6 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '72%',
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16, font: { size: 11 } } },
                tooltip: { callbacks: { label: (i) => ` ${i.label}: ${i.raw.toFixed(2)} €` } }
            }
        },
        plugins: [centerTextPlugin]
    });
};

export const renderCategoryAnalysisChart = (transactions, type = 'expense', startDate, endDate) => {
    const ctx = document.getElementById('categoryAnalysisChart');
    if (!ctx) return;
    let filtered = transactions.filter(t => t.type === type && !['Transferencia','Saldo Inicial','No Contabilizados'].includes(t.category));
    if (startDate) { const s = new Date(startDate); s.setHours(0,0,0,0); filtered = filtered.filter(t => t.date?.toDate?.() >= s); }
    if (endDate) { const e = new Date(endDate); e.setHours(23,59,59,999); filtered = filtered.filter(t => t.date?.toDate?.() <= e); }
    const categories = filtered.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + (type === 'expense' ? effectiveAmount(t) : t.amount); return acc; }, {});

    if (categoryAnalysisChart) categoryAnalysisChart.destroy();
    if (Object.keys(categories).length === 0) {
        if (categoryAnalysisChart) categoryAnalysisChart.destroy();
        return;
    }
    categoryAnalysisChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(categories),
            datasets: [{
                data: Object.values(categories),
                backgroundColor: ['#4f46e5','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1'],
                borderWidth: 0, hoverOffset: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: {
                legend: { position: 'right', labels: { usePointStyle: true, padding: 12, font: { size: 10 } } },
                tooltip: { callbacks: { label: (i) => ` ${i.label}: ${i.raw.toFixed(2)} €` } }
            }
        },
        plugins: [centerTextPlugin]
    });
};

export const renderHistoryCategoryChart = (transactions, type = 'expense') => {
    const ctx = document.getElementById('historyCategoryChart');
    if (!ctx) return;
    const filtered = transactions.filter(t => t.type === type && !['Transferencia','Saldo Inicial','No Contabilizados'].includes(t.category));
    const categories = filtered.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + (type === 'expense' ? effectiveAmount(t) : t.amount); return acc; }, {});

    if (historyCategoryChart) historyCategoryChart.destroy();
    if (Object.keys(categories).length === 0) {
        if (historyCategoryChart) historyCategoryChart.destroy();
        return;
    }
    historyCategoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(categories),
            datasets: [{
                data: Object.values(categories),
                backgroundColor: ['#4f46e5','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1'],
                borderWidth: 0, hoverOffset: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: {
                legend: { position: 'right', labels: { usePointStyle: true, padding: 12, font: { size: 10 } } },
                tooltip: { callbacks: { label: (i) => ` ${i.label}: ${i.raw.toFixed(2)} €` } }
            }
        },
        plugins: [centerTextPlugin]
    });
};

export const renderCashFlowChart = (transactions) => {
    const ctx = document.getElementById('cashFlowChart');
    if (!ctx) return;
    const labelsFull = ["Enero","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const labelsShort = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const today = new Date();
    const monthlyData = {};
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        monthlyData[`${d.getFullYear()}-${d.getMonth()}`] = { income: 0, expense: 0, label: labelsShort[d.getMonth()] };
    }
    const sixAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    transactions.filter(t => t.date?.toDate?.() >= sixAgo && t.category !== 'No Contabilizados').forEach(t => {
        const d = t.date.toDate();
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (monthlyData[key]) {
            if (t.type === 'income' && !['Transferencia','Saldo Inicial','Inversiones'].includes(t.category)) monthlyData[key].income += t.amount;
            else if (t.type === 'expense' && !['Transferencia','Inversiones'].includes(t.category)) monthlyData[key].expense += effectiveAmount(t);
        }
    });
    const sortedKeys = Object.keys(monthlyData).sort();
    const savings = sortedKeys.map(k => monthlyData[k].income - monthlyData[k].expense);
    const colors = savings.map(s => s >= 0 ? 'rgba(79, 70, 229, 0.8)' : 'rgba(239, 68, 68, 0.8)');

    if (cashFlowChart) cashFlowChart.destroy();
    cashFlowChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedKeys.map(k => monthlyData[k].label),
            datasets: [{ label: 'Ahorro', data: savings, backgroundColor: colors, borderRadius: 8, borderSkipped: false }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` Ahorro: ${c.raw.toFixed(2)} €` } } },
            scales: { y: { ticks: { callback: (v) => `${v}€` }, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } }
        }
    });
};

export const renderTendenciasChart = (tendenciasData) => {
    const ctx = document.getElementById('tendenciasChart');
    if (!ctx || !tendenciasData) return;
    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();
    if (!tendenciasData.datasets || tendenciasData.datasets.length === 0) return;
    new Chart(ctx, {
        type: 'line',
        data: tendenciasData,
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, padding: 12, font: { size: 10 } } },
                tooltip: { callbacks: { label: (i) => ` ${i.dataset.label}: ${i.raw.toFixed(2)} €` } }
            },
            scales: {
                y: { ticks: { callback: (v) => `${v}€` }, grid: { color: 'rgba(0,0,0,0.04)' } },
                x: { grid: { display: false } }
            }
        }
    });
};

let currentCalendarDate = new Date();

export const renderHeatmap = (heatmapData) => {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;

    const label = document.getElementById('calMonthLabel');
    const prevBtn = document.getElementById('calPrevBtn');
    const nextBtn = document.getElementById('calNextBtn');

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    if (label) {
        const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        label.textContent = `${monthNames[month]} ${year}`;
    }

    // Set up navigation listeners once if not already set
    if (prevBtn && !prevBtn.dataset.listener) {
        prevBtn.dataset.listener = 'true';
        prevBtn.addEventListener('click', () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
            renderHeatmap(heatmapData);
        });
    }
    if (nextBtn && !nextBtn.dataset.listener) {
        nextBtn.dataset.listener = 'true';
        nextBtn.addEventListener('click', () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
            renderHeatmap(heatmapData);
        });
    }

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Dom, 1 = Lun...
    const adjustedFirstDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1; // 0 = Lun, 6 = Dom
    const totalDays = new Date(year, month + 1, 0).getDate();

    // Get max value in this specific month for color scaling
    let maxExpense = 1;
    for (let day = 1; day <= totalDays; day++) {
        const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const val = heatmapData[key] || 0;
        if (val > maxExpense) maxExpense = val;
    }

    const getColor = (value) => {
        if (value === 0) return 'bg-gray-100 dark:bg-slate-800/40 text-gray-400';
        const ratio = value / maxExpense;
        if (ratio < 0.2) return 'bg-indigo-100 text-indigo-900';
        if (ratio < 0.4) return 'bg-indigo-200 text-indigo-900';
        if (ratio < 0.6) return 'bg-indigo-400 text-white';
        if (ratio < 0.8) return 'bg-indigo-600 text-white';
        return 'bg-indigo-800 text-white';
    };

    const daysHtml = [];
    // Empty cells before first day
    for (let i = 0; i < adjustedFirstDay; i++) {
        daysHtml.push(`<div class="aspect-ratio rounded-lg bg-transparent"></div>`);
    }

    const todayStr = new Date().toDateString();

    // Days grid
    for (let day = 1; day <= totalDays; day++) {
        const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const value = heatmapData[key] || 0;
        const dObj = new Date(year, month, day);
        const isToday = dObj.toDateString() === todayStr;

        daysHtml.push(`
            <div class="cal-day ${getColor(value)} ${isToday ? 'today' : ''} border border-gray-200/40 relative group cursor-pointer">
                <span class="cal-day-num">${day}</span>
                ${value > 0 ? `<span class="cal-day-amt">${value.toFixed(0)}€</span>` : ''}
                <div class="hidden group-hover:block absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900 text-white text-[9px] px-2 py-1 rounded whitespace-nowrap shadow-md">
                    ${dObj.toLocaleDateString('es-ES')}: ${value.toFixed(2)}€
                </div>
            </div>
        `);
    }

    container.innerHTML = `
        <div class="grid grid-cols-7 gap-1.5 mb-2">
            ${["L", "M", "M", "J", "V", "S", "D"].map(h => `<div class="text-center text-[10px] font-black text-gray-400 py-1">${h}</div>`).join('')}
            ${daysHtml.join('')}
        </div>
        <div class="flex items-center gap-2 mt-3 justify-end">
            <span class="text-[9px] text-gray-400">Menos</span>
            <div class="w-3 h-3 rounded bg-gray-100 dark:bg-slate-800/40"></div>
            <div class="w-3 h-3 rounded bg-indigo-200"></div>
            <div class="w-3 h-3 rounded bg-indigo-400"></div>
            <div class="w-3 h-3 rounded bg-indigo-600"></div>
            <div class="w-3 h-3 rounded bg-indigo-800"></div>
            <span class="text-[9px] text-gray-400">Más</span>
        </div>
    `;
};
