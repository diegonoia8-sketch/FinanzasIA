import { callGemini } from "./api.js";
import { showLoadingOverlay, hideLoadingOverlay } from "./ui.js";

// ============================================================================
// PLUGIN CHART.JS PARA ETIQUETAS VERTICALES
// ============================================================================
export const verticalWhiteLabelsPlugin = {
    id: 'verticalWhiteLabels',
    afterDraw: (chart) => {
        const { ctx, data } = chart;
        ctx.save();
        chart.getDatasetMeta(0).data.forEach((datapoint, index) => {
            const { x, y } = datapoint.tooltipPosition();
            const label = data.labels[index];
            const value = data.datasets[0].data[index];
            if (value > 0) {
                ctx.translate(x, y);
                ctx.rotate(-Math.PI / 2);
                ctx.fillStyle = datapoint.options.backgroundColor === '#4f46e5' || datapoint.options.backgroundColor === '#ef4444' ? 'white' : 'black';
                ctx.font = 'bold 10px Inter';
                ctx.fillText(label.split(' (')[0], 5, 0);
                ctx.restore();
            }
        });
    }
};

// ============================================================================
// UTILIDADES PARA GENERACIÓN DE PDFs
// ============================================================================

// Función para esperar a que el contenido esté listo
export const waitForRender = (callback, delay = 300) => {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setTimeout(callback, delay);
        });
    });
};

// Capturar gráfico como imagen base64
export const captureChart = (chartId) => {
    const canvas = document.getElementById(chartId);
    if (!canvas) return null;
    return canvas.toDataURL('image/png');
};

// Preparar vista de impresión
export const preparePrintView = (containerId) => {
    const container = document.getElementById(containerId);
    container.classList.remove('hidden');
    container.classList.add('print-visible');
    void container.offsetHeight;
    return container;
};

// Limpiar vista de impresión
export const cleanupPrintView = () => {
    ['pdfContainer', 'exlabesaPdfContainer', 'fuelPdfContainer'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.classList.remove('print-visible');
            el.innerHTML = '';
        }
    });
};

// Formatear moneda
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR'
    }).format(amount);
};

// Formatear fecha
const formatDate = (date) => {
    return new Intl.DateTimeFormat('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(date);
};

// Calcular color de fondo basado en valor
const getColorClass = (value, threshold, isGoodWhenHigh = true) => {
    if (isGoodWhenHigh) {
        return value >= threshold ? 'positive' : 'negative';
    }
    return value <= threshold ? 'positive' : 'negative';
};

// ============================================================================
// CÁLCULOS DE MÉTRICAS DE COMBUSTIBLE
// ============================================================================

export const calculateFuelMetrics = (transactions, startDate, endDate, category = 'Combustible') => {
    // 1. Filtrar transacciones DE COMBUSTIBLE totales (ordenadas por fecha)
    const allFuelTxs = transactions
        .filter(t => t.category === category)
        .sort((a, b) => a.date.toDate() - b.date.toDate());

    if (allFuelTxs.length < 2) {
        return { error: 'Se necesitan al menos 2 registros de combustible para calcular métricas' };
    }

    // 2. Definir fechas de inicio y fin como objetos Date
    const sDate = new Date(startDate); sDate.setHours(0, 0, 0, 0);
    const eDate = new Date(endDate); eDate.setHours(23, 59, 59, 999);

    // 3. Extraer registros con datos parseados (KM y LITROS) de TODO EL HISTORIAL
    const allRecords = allFuelTxs.map(t => {
        const desc = t.description.toLowerCase();
        const kmMatch = desc.match(/(\d{1,3}(?:\.?\d{3})*|\d+)\s*km/i);
        const lMatch = desc.match(/(\d+[.,]\d+|\d+)\s*(?:l|litros|litro)/i);
        return {
            date: t.date.toDate(),
            amount: t.amount,
            km: kmMatch ? parseInt(kmMatch[1].replace(/\./g, '')) : null,
            liters: lMatch ? parseFloat(lMatch[1].replace(',', '.')) : null,
            description: t.description
        };
    });

    // 4. Filtrar registros del periodo seleccionado
    const periodRecords = allRecords.filter(r => r.date >= sDate && r.date <= eDate);
    
    if (periodRecords.length < 2) {
        return { error: 'Se necesitan al menos 2 reparos en el periodo seleccionado para calcular consumos' };
    }

    // FUNCIÓN AUXILIAR PARA MÉTRICAS
    const calc = (records) => {
        if (records.length < 2) return null;
        const first = records[0], last = records[records.length - 1];
        
        let kmTraveled = 0;
        if (last.km && first.km) kmTraveled = last.km - first.km;

        // Sumar litros/euros de todos menos el último (el que marca el fin de los km del periodo)
        const lSum = records.slice(0, -1).reduce((s, r) => s + (r.liters || 0), 0);
        const eSum = records.slice(0, -1).reduce((s, r) => s + r.amount, 0);

        return {
            kmTraveled,
            lSum,
            eSum,
            litersPer100km: kmTraveled > 0 ? (lSum / kmTraveled) * 100 : null,
            eurosPer100km: kmTraveled > 0 ? (eSum / kmTraveled) * 100 : null,
            avgPricePerLiter: lSum > 0 ? eSum / lSum : null,
            costPerKm: kmTraveled > 0 ? eSum / kmTraveled : null,
            period: { start: first.date, end: last.date }
        };
    };

    const metrics = calc(periodRecords);
    const historical = calc(allRecords);

    return { metrics, historical, records: periodRecords };
};

// ============================================================================
// TEMPLATES HTML PARA PDFs
// ============================================================================

const getPDFStyles = () => `
<style>
    @page { margin: 1.5cm; size: A4; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: #1f2937;
        background: #fff;
        line-height: 1.5;
        font-size: 11pt;
    }
    .header {
        background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
        color: white;
        padding: 2rem;
        margin: -1.5cm -1.5cm 1.5rem -1.5cm;
        width: calc(100% + 3cm);
    }
    .header h1 { font-size: 1.8rem; font-weight: 800; margin-bottom: 0.3rem; }
    .header .subtitle { opacity: 0.9; font-size: 0.95rem; }
    .header .date { opacity: 0.8; font-size: 0.85rem; margin-top: 0.5rem; }

    .metrics-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
        margin: 1.5rem 0;
    }
    .metric-card {
        background: #f8fafc;
        border-radius: 12px;
        padding: 1.2rem;
        text-align: center;
        border-left: 4px solid #4f46e5;
    }
    .metric-card.positive { border-left-color: #10b981; }
    .metric-card.negative { border-left-color: #ef4444; }
    .metric-card.warning { border-left-color: #f59e0b; }
    .metric-label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6b7280;
        margin-bottom: 0.3rem;
        font-weight: 600;
    }
    .metric-value {
        font-size: 1.5rem;
        font-weight: 800;
        color: #1f2937;
    }
    .metric-value.positive { color: #10b981; }
    .metric-value.negative { color: #ef4444; }
    .metric-value.warning { color: #f59e0b; }
    .metric-comparison {
        font-size: 0.75rem;
        margin-top: 0.3rem;
    }
    .metric-comparison.better { color: #10b981; }
    .metric-comparison.worse { color: #ef4444; }

    .section { margin: 1.5rem 0; }
    .section-title {
        font-size: 1.1rem;
        font-weight: 700;
        color: #1f2937;
        margin-bottom: 0.8rem;
        padding-bottom: 0.4rem;
        border-bottom: 2px solid #e5e7eb;
    }

    .chart-container {
        background: #f8fafc;
        border-radius: 12px;
        padding: 1rem;
        margin: 1rem 0;
        text-align: center;
    }
    .chart-container img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        margin: 1rem 0;
        font-size: 0.9rem;
    }
    th {
        background: #f1f5f9;
        font-weight: 600;
        text-align: left;
        padding: 0.7rem;
        color: #475569;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
    }
    td {
        padding: 0.7rem;
        border-bottom: 1px solid #e2e8f0;
    }
    tr:hover { background: #f8fafc; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }

    .expense { color: #ef4444; }
    .income { color: #10b981; }

    .summary-box {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 10px;
        padding: 1rem;
        margin: 1rem 0;
    }
    .summary-box.warning {
        background: #fffbeb;
        border-color: #fcd34d;
    }
    .summary-box.info {
        background: #eff6ff;
        border-color: #bfdbfe;
    }

    .two-columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
        margin: 1rem 0;
    }

    .highlight-text {
        font-size: 1.1rem;
        font-weight: 600;
    }

    .footer {
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid #e2e8f0;
        font-size: 0.8rem;
        color: #9ca3af;
        text-align: center;
    }

    .badge {
        display: inline-block;
        padding: 0.2rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 600;
    }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-amber { background: #fef3c7; color: #92400e; }

    @media print {
        .no-break { page-break-inside: avoid; }
        .page-break { page-break-before: always; }
    }
</style>
`;

// ============================================================================
// GENERADOR DE REPORTE DE 30 DÍAS
// ============================================================================

export const generateAiReport = async (transactions) => {
    showLoadingOverlay();

    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        const last30Txs = transactions.filter(t => t.date.toDate() >= thirtyDaysAgo);

        // Calcular métricas
        const income = last30Txs.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
        const expenses = last30Txs.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const balance = income - expenses;

        // Agrupar por categoría
        const byCategory = {};
        last30Txs.filter(t => t.amount < 0).forEach(t => {
            const cat = t.category || 'Sin categoría';
            byCategory[cat] = (byCategory[cat] || 0) + Math.abs(t.amount);
        });

        const sortedCategories = Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // Capturar gráficos
        const incomeExpenseChart = captureChart('incomeExpenseChart');
        const categoryChart = captureChart('categoryAnalysisChart');

        // Generar HTML
        const htmlContent = `
${getPDFStyles()}
<div class="header">
    <h1>Resumen Financiero</h1>
    <div class="subtitle">Últimos 30 días</div>
    <div class="date">${formatDate(thirtyDaysAgo)} - ${formatDate(now)}</div>
</div>

<div class="metrics-grid">
    <div class="metric-card">
        <div class="metric-label">Ingresos</div>
        <div class="metric-value income">${formatCurrency(income)}</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Gastos</div>
        <div class="metric-value expense">${formatCurrency(expenses)}</div>
    </div>
    <div class="metric-card ${balance >= 0 ? 'positive' : 'negative'}">
        <div class="metric-label">Balance</div>
        <div class="metric-value ${balance >= 0 ? 'positive' : 'negative'}">${formatCurrency(balance)}</div>
    </div>
</div>

<div class="two-columns">
    <div class="section no-break">
        <div class="section-title">Distribución Ingresos/Gastos</div>
        ${incomeExpenseChart ? `<div class="chart-container"><img src="${incomeExpenseChart}" alt="Gráfico de ingresos y gastos"></div>` : '<p class="text-center">Gráfico no disponible</p>'}
    </div>
    <div class="section no-break">
        <div class="section-title">Gastos por Categoría</div>
        ${categoryChart ? `<div class="chart-container"><img src="${categoryChart}" alt="Gráfico por categoría"></div>` : '<p class="text-center">Gráfico no disponible</p>'}
    </div>
</div>

<div class="section">
    <div class="section-title">Top Categorías de Gasto</div>
    <table>
        <thead>
            <tr>
                <th>Categoría</th>
                <th class="text-right">Importe</th>
                <th class="text-right">% del Total</th>
            </tr>
        </thead>
        <tbody>
            ${sortedCategories.map(([cat, amount]) => `
                <tr>
                    <td>${cat}</td>
                    <td class="text-right expense">${formatCurrency(amount)}</td>
                    <td class="text-right">${((amount / expenses) * 100).toFixed(1)}%</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</div>

<div class="section">
    <div class="section-title">Últimas Transacciones</div>
    <table>
        <thead>
            <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Categoría</th>
                <th class="text-right">Importe</th>
            </tr>
        </thead>
        <tbody>
            ${last30Txs.slice(-10).reverse().map(t => `
                <tr>
                    <td>${formatDate(t.date.toDate())}</td>
                    <td>${t.description}</td>
                    <td><span class="badge badge-blue">${t.category}</span></td>
                    <td class="text-right ${t.amount >= 0 ? 'income' : 'expense'}">${formatCurrency(t.amount)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</div>

<div class="footer">
    Generado el ${formatDate(new Date())} por Finanzas IA
</div>
`;

        const container = document.getElementById('pdfContainer');
        container.innerHTML = htmlContent;
        preparePrintView('pdfContainer');

        waitForRender(() => {
            window.print();
            setTimeout(cleanupPrintView, 800);
        }, 1200);

    } catch (err) {
        alert("Error al generar reporte: " + err.message);
        console.error(err);
    } finally {
        hideLoadingOverlay();
    }
};

// ============================================================================
// GENERADOR DE REPORTE EXLABESA
// ============================================================================

export const generateExlabesaReport = async (transactions, startDate, endDate) => {
    showLoadingOverlay();

    try {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);

        const txs = transactions.filter(t => {
            const d = t.date?.toDate?.();
            return d && d >= s && d <= e && t.category === 'EXLABESA';
        }).sort((a, b) => a.date.toDate() - b.date.toDate());

        const total = txs.reduce((sum, t) => sum + Math.abs(t.amount), 0);

        // Generar HTML
        const htmlContent = `
${getPDFStyles()}
<div class="header" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%);">
    <h1>Informe de Dietas EXLABESA</h1>
    <div class="subtitle">Gastos de empresa</div>
    <div class="date">${formatDate(s)} - ${formatDate(e)}</div>
</div>

<div class="metrics-grid">
    <div class="metric-card">
        <div class="metric-label">Total Transacciones</div>
        <div class="metric-value">${txs.length}</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Importe Total</div>
        <div class="metric-value expense">${formatCurrency(total)}</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Media por Transacción</div>
        <div class="metric-value">${txs.length > 0 ? formatCurrency(total / txs.length) : formatCurrency(0)}</div>
    </div>
</div>

${txs.some(t => t.receiptImage) ? `
<div class="section no-break page-break">
    <div class="section-title">Anexo: Justificantes de tickets</div>
    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1cm;">
        ${txs.filter(t => t.receiptImage).map(t => `
            <div style="border: 1px solid #eee; padding: 10px; border-radius: 10px;">
                <p style="font-size: 8pt; margin-bottom: 5px; font-weight: bold;">${formatDate(t.date.toDate())} - ${t.description}</p>
                <img src="${t.receiptImage}" style="width: 100%; height: auto; max-height: 10cm; object-fit: contain; border-radius: 5px;">
            </div>
        `).join('')}
    </div>
</div>
` : ''}

<div class="summary-box info">
    <div class="highlight-text">Resumen del período</div>
    <p>Este informe detalla todos los gastos de empresa (categoría EXLABESA) registrados entre el ${formatDate(s)} y el ${formatDate(e)}.</p>
</div>

<div class="section">
    <div class="section-title">Detalle de Gastos</div>
    <table>
        <thead>
            <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th class="text-right">Importe</th>
            </tr>
        </thead>
        <tbody>
            ${txs.map(t => `
                <tr>
                    <td>${formatDate(t.date.toDate())}</td>
                    <td>${t.description}</td>
                    <td class="text-right expense">${formatCurrency(Math.abs(t.amount))}</td>
                </tr>
            `).join('')}
            <tr style="background: #f1f5f9; font-weight: 700;">
                <td colspan="2" class="text-right">TOTAL</td>
                <td class="text-right expense">${formatCurrency(total)}</td>
            </tr>
        </tbody>
    </table>
</div>

<div class="footer">
    Documento generado el ${formatDate(new Date())} - EXLABESA
</div>
`;

        const container = document.getElementById('exlabesaPdfContainer');
        container.innerHTML = htmlContent;
        preparePrintView('exlabesaPdfContainer');

        const txsWithImages = txs.filter(t => t.receiptImage).map(t => t.id);

        waitForRender(() => {
            window.print();
            setTimeout(cleanupPrintView, 800);
        }, 1200);

        return txsWithImages;

    } catch (err) {
        alert("Error al generar reporte: " + err.message);
        console.error(err);
        return [];
    } finally {
        hideLoadingOverlay();
    }
};

// ============================================================================
// GENERADOR DE REPORTE DE COMBUSTIBLE
// ============================================================================

export const generateFuelReport = async (transactions, startDate, endDate) => {
    showLoadingOverlay();

    try {
        // Calcular métricas DE TODO EL HISTORIAL pasando fechas del periodo
        const result = calculateFuelMetrics(transactions, startDate, endDate);

        if (result.error) {
            alert(result.error);
            hideLoadingOverlay();
            return;
        }

        const { metrics, historical, records } = result;

        // Comparaciones con histórico
        const litersComparison = historical.litersPer100km && metrics.litersPer100km
            ? ((metrics.litersPer100km - historical.litersPer100km) / historical.litersPer100km * 100).toFixed(1)
            : null;
        const eurosComparison = historical.eurosPer100km && metrics.eurosPer100km
            ? ((metrics.eurosPer100km - historical.eurosPer100km) / historical.eurosPer100km * 100).toFixed(1)
            : null;
        const priceComparison = historical.avgPricePerLiter && metrics.avgPricePerLiter
            ? ((metrics.avgPricePerLiter - historical.avgPricePerLiter) / historical.avgPricePerLiter * 100).toFixed(1)
            : null;

        // Generar HTML
        const htmlContent = `
${getPDFStyles()}
<div class="header" style="background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%);">
    <h1>Informe de Combustible</h1>
    <div class="subtitle">Análisis de consumo y gastos</div>
    <div class="date">${formatDate(metrics.period.start)} - ${formatDate(metrics.period.end)}</div>
</div>

<div class="metrics-grid">
    <div class="metric-card">
        <div class="metric-label">Km Recorridos (en periodo)</div>
        <div class="metric-value">${metrics.kmTraveled.toLocaleString('es-ES')} km</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Consumido (en periodo)</div>
        <div class="metric-value">${metrics.lSum.toFixed(2)} L</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Importe Total (en periodo)</div>
        <div class="metric-value">${formatCurrency(metrics.eSum)}</div>
    </div>
</div>

<div class="section">
    <div class="section-title">Métricas de Consumo</div>
    <div class="metrics-grid">
        <div class="metric-card ${litersComparison && parseFloat(litersComparison) > 0 ? 'negative' : 'positive'}">
            <div class="metric-label">Consumo (L/100km)</div>
            <div class="metric-value">${metrics.litersPer100km ? metrics.litersPer100km.toFixed(2) : 'N/A'}</div>
            ${litersComparison ? `<div class="metric-comparison ${parseFloat(litersComparison) > 0 ? 'worse' : 'better'}">${parseFloat(litersComparison) > 0 ? '↑' : '↓'} ${Math.abs(litersComparison)}% vs histórico</div>` : ''}
        </div>
        <div class="metric-card ${eurosComparison && parseFloat(eurosComparison) > 0 ? 'negative' : 'positive'}">
            <div class="metric-label">Coste (€/100km)</div>
            <div class="metric-value">${metrics.eurosPer100km ? formatCurrency(metrics.eurosPer100km) : 'N/A'}</div>
            ${eurosComparison ? `<div class="metric-comparison ${parseFloat(eurosComparison) > 0 ? 'worse' : 'better'}">${parseFloat(eurosComparison) > 0 ? '↑' : '↓'} ${Math.abs(eurosComparison)}% vs histórico</div>` : ''}
        </div>
        <div class="metric-card ${priceComparison && parseFloat(priceComparison) > 0 ? 'negative' : 'positive'}">
            <div class="metric-label">Precio Medio/L</div>
            <div class="metric-value">${metrics.avgPricePerLiter ? formatCurrency(metrics.avgPricePerLiter) : 'N/A'}</div>
            ${priceComparison ? `<div class="metric-comparison ${parseFloat(priceComparison) > 0 ? 'worse' : 'better'}">${parseFloat(priceComparison) > 0 ? '↑' : '↓'} ${Math.abs(priceComparison)}% vs histórico</div>` : ''}
        </div>
        <div class="metric-card">
            <div class="metric-label">Coste por Km</div>
            <div class="metric-value">${metrics.costPerKm ? formatCurrency(metrics.costPerKm) : 'N/A'}</div>
        </div>
    </div>
</div>

<div class="summary-box ${litersComparison && parseFloat(litersComparison) > 10 ? 'warning' : 'info'}">
    <div class="highlight-text">Comparación con Histórico</div>
    <p>Consumo histórico medio: <strong>${historical.litersPer100km ? historical.litersPer100km.toFixed(2) : 'N/A'} L/100km</strong></p>
    <p>Coste histórico medio: <strong>${historical.eurosPer100km ? formatCurrency(historical.eurosPer100km) : 'N/A'}/100km</strong></p>
    ${litersComparison && parseFloat(litersComparison) > 10 ? '<p style="color: #92400e; margin-top: 0.5rem;">⚠️ El consumo de este período es significativamente mayor que la media histórica.</p>' : ''}
</div>

<div class="section">
    <div class="section-title">Registro de Repostajes</div>
    <table>
        <thead>
            <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th class="text-right">Km</th>
                <th class="text-right">Litros</th>
                <th class="text-right">Importe</th>
            </tr>
        </thead>
        <tbody>
            ${records.map(r => `
                <tr>
                    <td>${formatDate(r.date)}</td>
                    <td>${r.description}</td>
                    <td class="text-right">${r.km ? r.km.toLocaleString('es-ES') : '-'}</td>
                    <td class="text-right">${r.liters ? r.liters.toFixed(2) : '-'}</td>
                    <td class="text-right expense">${formatCurrency(r.amount)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</div>

<div class="footer">
    Informe generado el ${formatDate(new Date())} - Finanzas IA
</div>
`;

        const container = document.getElementById('fuelPdfContainer');
        container.innerHTML = htmlContent;
        preparePrintView('fuelPdfContainer');

        waitForRender(() => {
            window.print();
            setTimeout(cleanupPrintView, 800);
        }, 1200);

    } catch (err) {
        alert("Error al generar reporte: " + err.message);
        console.error(err);
    } finally {
        hideLoadingOverlay();
    }
};
