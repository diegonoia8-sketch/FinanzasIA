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

        // Sumar litros/euros de todos excepto el más antiguo (ya que su repostaje pertenece al consumo de kilómetros previos)
        const lSum = records.slice(1).reduce((s, r) => s + (r.liters || 0), 0);
        const eSum = records.slice(1).reduce((s, r) => s + r.amount, 0);

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
    @page { margin: 1cm; size: A4; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: #1f2937;
        background: #fff;
        line-height: 1.4;
        font-size: 10pt;
        width: 100%;
    }
    .header {
        background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
        color: white;
        padding: 1.5rem 2rem;
        margin-bottom: 1.5rem;
        border-radius: 0 0 20px 20px;
    }
    .header h1 { font-size: 1.6rem; font-weight: 800; margin-bottom: 0.2rem; }
    .header .subtitle { opacity: 0.9; font-size: 0.85rem; }
    .header .date { opacity: 0.8; font-size: 0.75rem; margin-top: 0.4rem; }

    .metrics-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.8rem;
        margin: 1rem 0;
    }
    .metric-card {
        background: #f8fafc;
        border-radius: 12px;
        padding: 1rem;
        text-align: center;
        border: 1px solid #e2e8f0;
        border-top: 4px solid #4f46e5;
    }
    .metric-card.positive { border-top-color: #10b981; }
    .metric-card.negative { border-top-color: #ef4444; }
    .metric-card.warning { border-top-color: #f59e0b; }
    .metric-label {
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #64748b;
        margin-bottom: 0.2rem;
        font-weight: 700;
    }
    .metric-value {
        font-size: 1.3rem;
        font-weight: 800;
        color: #0f172a;
    }
    .metric-comparison {
        font-size: 0.7rem;
        margin-top: 0.2rem;
        font-weight: 600;
    }
    .metric-comparison.better { color: #059669; }
    .metric-comparison.worse { color: #dc2626; }

    .section { margin: 1.5rem 0; page-break-inside: avoid; }
    .section-title {
        font-size: 1rem;
        font-weight: 800;
        color: #1e293b;
        margin-bottom: 0.8rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .section-title::after {
        content: "";
        flex: 1;
        height: 1px;
        background: #e2e8f0;
    }

    .chart-container {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 1rem;
        margin: 0.5rem 0;
        text-align: center;
    }
    .chart-container img {
        max-width: 100%;
        height: auto;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        margin: 0.5rem 0;
    }
    th {
        background: #f8fafc;
        font-weight: 700;
        text-align: left;
        padding: 0.6rem;
        color: #475569;
        font-size: 0.7rem;
        text-transform: uppercase;
        border-bottom: 2px solid #e2e8f0;
    }
    td {
        padding: 0.6rem;
        border-bottom: 1px solid #f1f5f9;
        font-size: 0.85rem;
    }
    .comparison-table th { background: #f1f5f9; color: #1e293b; }
    .comparison-table td { font-weight: 500; font-size: 0.9rem; }
    
    .row-highlight { background: #fffbeb; font-weight: 700; }

    .footer {
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid #e2e8f0;
        font-size: 0.7rem;
        color: #94a3b8;
        text-align: center;
    }
    
    .badge {
        padding: 0.15rem 0.5rem;
        border-radius: 6px;
        font-size: 0.7rem;
        font-weight: 700;
    }
    .badge-amber { background: #fef3c7; color: #92400e; }
</style>
`;

// Generar una imagen de gráfico comparativo simple (Canvas)
const generateComparisonChart = (label, periodVal, historicalVal, color = '#f59e0b') => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    
    const max = Math.max(periodVal, historicalVal) * 1.2;
    const wP = (periodVal / max) * 300;
    const wH = (historicalVal / max) * 300;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 400, 100);

    // Periodo
    ctx.fillStyle = color;
    ctx.fillRect(80, 20, wP, 25);
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 12px Inter';
    ctx.fillText('Periodo', 10, 38);
    ctx.fillText(periodVal.toFixed(2), 85 + wP, 38);

    // Histórico
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(80, 55, wH, 25);
    ctx.fillStyle = '#64748b';
    ctx.fillText('Histórico', 10, 73);
    ctx.fillText(historicalVal.toFixed(2), 85 + wH, 73);

    return canvas.toDataURL();
};

// ============================================================================
// GENERADOR DE REPORTE DE 30 DÍAS
// ============================================================================

export const generateAiReport = async (transactions) => {
    showLoadingOverlay();

    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        const last30Txs = transactions.filter(t => t.date.toDate() >= thirtyDaysAgo);

        const income = last30Txs.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
        const expenses = last30Txs.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const balance = income - expenses;

        const byCategory = {};
        last30Txs.filter(t => t.amount < 0).forEach(t => {
            const cat = t.category || 'Sin categoría';
            byCategory[cat] = (byCategory[cat] || 0) + Math.abs(t.amount);
        });

        const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const incomeExpenseChart = captureChart('incomeExpenseChart');
        const categoryChart = captureChart('categoryAnalysisChart');

        const htmlContent = `
${getPDFStyles()}
<div class="header">
    <h1>Resumen Financiero</h1>
    <div class="subtitle">Análisis de rendimiento de los últimos 30 días</div>
    <div class="date">${formatDate(thirtyDaysAgo)} - ${formatDate(now)}</div>
</div>

<div class="metrics-grid">
    <div class="metric-card">
        <div class="metric-label">Ingresos</div>
        <div class="metric-value" style="color:#10b981">${formatCurrency(income)}</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Gastos</div>
        <div class="metric-value" style="color:#ef4444">${formatCurrency(expenses)}</div>
    </div>
    <div class="metric-card ${balance >= 0 ? 'positive' : 'negative'}">
        <div class="metric-label">Balance</div>
        <div class="metric-value">${formatCurrency(balance)}</div>
    </div>
</div>

<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0;">
    <div class="chart-container">
        <p style="font-size: 8px; font-weight: bold; margin-bottom: 5px; color:#64748b; text-align: left;">FLUJO DE CAJA</p>
        ${incomeExpenseChart ? `<img src="${incomeExpenseChart}">` : 'N/A'}
    </div>
    <div class="chart-container">
        <p style="font-size: 8px; font-weight: bold; margin-bottom: 5px; color:#64748b; text-align: left;">GASTOS POR CATEGORÍA</p>
        ${categoryChart ? `<img src="${categoryChart}">` : 'N/A'}
    </div>
</div>

<div class="section">
    <div class="section-title">Top Categorías de Gasto</div>
    <table>
        <thead>
            <tr>
                <th>Categoría</th>
                <th class="text-right">Importe</th>
                <th class="text-right">%</th>
            </tr>
        </thead>
        <tbody>
            ${sortedCategories.map(([cat, amount]) => `
                <tr>
                    <td>${cat}</td>
                    <td class="text-right" style="color:#ef4444; font-weight:bold">${formatCurrency(amount)}</td>
                    <td class="text-right">${((amount / expenses) * 100).toFixed(1)}%</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</div>

<div class="section">
    <div class="section-title">Últimos Movimientos</div>
    <table>
        <thead>
            <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th class="text-right">Importe</th>
            </tr>
        </thead>
        <tbody>
            ${last30Txs.slice(-8).reverse().map(t => `
                <tr>
                    <td>${formatDate(t.date.toDate())}</td>
                    <td>${t.description} <small style="display:block; color:#94a3b8; font-size:0.75em">${t.category}</small></td>
                    <td class="text-right" style="font-weight:700; color:${t.amount >= 0 ? '#10b981' : '#ef4444'}">${formatCurrency(t.amount)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</div>

<div class="footer">
    Informe generado por Finanzas IA el ${formatDate(new Date())}
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
        const s = new Date(startDate); s.setHours(0, 0, 0, 0);
        const e = new Date(endDate); e.setHours(23, 59, 59, 999);

        const txs = transactions.filter(t => {
            const d = t.date?.toDate?.();
            return d && d >= s && d <= e && t.category === 'EXLABESA';
        }).sort((a, b) => a.date.toDate() - b.date.toDate());

        const total = txs.reduce((sum, t) => sum + Math.abs(t.amount), 0);

        const htmlContent = `
${getPDFStyles()}
<div class="header" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%);">
    <h1>Informe Dietas EXLABESA</h1>
    <div class="subtitle">Liquidación de gastos profesionales</div>
    <div class="date">${formatDate(s)} - ${formatDate(e)}</div>
</div>

<div class="metrics-grid">
    <div class="metric-card positive">
        <div class="metric-label">Total Registros</div>
        <div class="metric-value">${txs.length}</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Importe a Liquidar</div>
        <div class="metric-value" style="color:#ef4444">${formatCurrency(total)}</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Gasto Medio</div>
        <div class="metric-value">${txs.length > 0 ? formatCurrency(total / txs.length) : '0,00€'}</div>
    </div>
</div>

<div class="section">
    <div class="section-title">Detalle de Justificantes</div>
    <table>
        <thead>
            <tr>
                <th>Fecha</th>
                <th>Concepto / Proveedor</th>
                <th class="text-right">Importe</th>
            </tr>
        </thead>
        <tbody>
            ${txs.map(t => `
                <tr>
                    <td>${formatDate(t.date.toDate())}</td>
                    <td>${t.description}</td>
                    <td class="text-right" style="font-weight:700">${formatCurrency(Math.abs(t.amount))}</td>
                </tr>
            `).join('')}
            <tr style="background: #f8fafc; font-weight: 800; font-size:1.1em">
                <td colspan="2" class="text-right">TOTAL LIQUIDACIÓN</td>
                <td class="text-right" style="color:#ef4444">${formatCurrency(total)}</td>
            </tr>
        </tbody>
    </table>
</div>

${txs.some(t => t.receiptImage) ? `
<div class="section" style="page-break-before: always;">
    <div class="section-title">Anexo: Fotos de Tickets</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5cm; margin-top: 1rem;">
        ${txs.filter(t => t.receiptImage).map(t => `
            <div style="border: 1px solid #e2e8f0; padding: 10px; border-radius: 12px; text-align: center;">
                <p style="font-size: 7pt; margin-bottom: 5px; font-weight: 700; color:#64748b;">${formatDate(t.date.toDate())} - ${t.description.substring(0,25)}</p>
                <img src="${t.receiptImage}" style="max-width: 100%; max-height: 8cm; object-fit: contain; border-radius: 8px;">
            </div>
        `).join('')}
    </div>
</div>
` : ''}

<div class="footer">
    Documento oficial generado el ${formatDate(new Date())} por Finanzas IA
</div>
`;

        const container = document.getElementById('exlabesaPdfContainer');
        container.innerHTML = htmlContent;
        preparePrintView('exlabesaPdfContainer');

        waitForRender(() => {
            window.print();
            setTimeout(cleanupPrintView, 800);
        }, 1200);

        return txs.filter(t => t.receiptImage).map(t => t.id);

    } catch (err) {
        alert("Error: " + err.message);
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
        const result = calculateFuelMetrics(transactions, startDate, endDate);
        if (result.error) { alert(result.error); hideLoadingOverlay(); return; }

        const { metrics, historical, records } = result;

        const lDiff = historical.litersPer100km ? ((metrics.litersPer100km - historical.litersPer100km) / historical.litersPer100km * 100).toFixed(1) : 0;
        const eDiff = historical.eurosPer100km ? ((metrics.eurosPer100km - historical.eurosPer100km) / historical.eurosPer100km * 100).toFixed(1) : 0;

        const chartL = generateComparisonChart('L/100km', metrics.litersPer100km, historical.litersPer100km, '#d97706');
        const chartE = generateComparisonChart('€/100km', metrics.eurosPer100km, historical.eurosPer100km, '#b45309');

        const htmlContent = `
${getPDFStyles()}
<div class="header" style="background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%);">
    <h1>Informe de Combustible</h1>
    <div class="subtitle">Análisis avanzado de eficiencia y gastos</div>
    <div class="date">${formatDate(metrics.period.start)} - ${formatDate(metrics.period.end)}</div>
</div>

<div class="metrics-grid">
    <div class="metric-card">
        <div class="metric-label">Recorrido</div>
        <div class="metric-value">${metrics.kmTraveled.toLocaleString('es-ES')} km</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Litros totales</div>
        <div class="metric-value">${metrics.lSum.toFixed(1)} L</div>
    </div>
    <div class="metric-card">
        <div class="metric-label">Gasto total</div>
        <div class="metric-value">${formatCurrency(metrics.eSum)}</div>
    </div>
</div>

<div class="section">
    <div class="section-title">Comparativa de Eficiencia</div>
    <div class="metrics-grid">
        <div class="metric-card ${parseFloat(lDiff) > 0 ? 'negative' : 'positive'}">
            <div class="metric-label">Consumo Medio</div>
            <div class="metric-value">${metrics.litersPer100km?.toFixed(2)} <small style="font-size:0.6em">L/100</small></div>
            <div class="metric-comparison ${parseFloat(lDiff) > 0 ? 'worse' : 'better'}">${lDiff > 0 ? '↑' : '↓'} ${Math.abs(lDiff)}% vs histórico</div>
        </div>
        <div class="metric-card ${parseFloat(eDiff) > 0 ? 'negative' : 'positive'}">
            <div class="metric-label">Coste Medio</div>
            <div class="metric-value">${metrics.eurosPer100km?.toFixed(2)} <small style="font-size:0.6em">€/100</small></div>
            <div class="metric-comparison ${parseFloat(eDiff) > 0 ? 'worse' : 'better'}">${eDiff > 0 ? '↑' : '↓'} ${Math.abs(eDiff)}% vs histórico</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Precio Medio/L</div>
            <div class="metric-value">${metrics.avgPricePerLiter?.toFixed(3)} <small style="font-size:0.6em">€/L</small></div>
        </div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.5rem;">
        <div class="chart-container"><p style="font-size: 8px; font-weight: bold; margin-bottom: 5px; color:#64748b; text-align: left;">VISUAL: CONSUMO L/100KM</p><img src="${chartL}"></div>
        <div class="chart-container"><p style="font-size: 8px; font-weight: bold; margin-bottom: 5px; color:#64748b; text-align: left;">VISUAL: COSTE €/100KM</p><img src="${chartE}"></div>
    </div>
</div>

<div class="section">
    <div class="section-title">Tabla Comparativa Detallada</div>
    <table class="comparison-table">
        <thead>
            <tr>
                <th>Métrica</th>
                <th class="text-right">Este Periodo</th>
                <th class="text-right">Histórico Total</th>
                <th class="text-right">Diferencia</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>Consumo (L/100km)</td>
                <td class="text-right">${metrics.litersPer100km?.toFixed(2)} L</td>
                <td class="text-right">${historical.litersPer100km?.toFixed(2)} L</td>
                <td class="text-right ${parseFloat(lDiff) > 0 ? 'expense' : 'income'}">${lDiff > 0 ? '+' : ''}${lDiff}%</td>
            </tr>
            <tr>
                <td>Coste (€/100km)</td>
                <td class="text-right">${metrics.eurosPer100km?.toFixed(2)} €</td>
                <td class="text-right">${historical.eurosPer100km?.toFixed(2)} €</td>
                <td class="text-right ${parseFloat(eDiff) > 0 ? 'expense' : 'income'}">${eDiff > 0 ? '+' : ''}${eDiff}%</td>
            </tr>
            <tr>
                <td>Precio Combustible (€/L)</td>
                <td class="text-right">${metrics.avgPricePerLiter?.toFixed(3)} €</td>
                <td class="text-right">${historical.avgPricePerLiter?.toFixed(3)} €</td>
                <td class="text-right">${metrics.avgPricePerLiter && historical.avgPricePerLiter ? ((metrics.avgPricePerLiter - historical.avgPricePerLiter)/historical.avgPricePerLiter*100).toFixed(1) : 0}%</td>
            </tr>
            <tr class="row-highlight">
                <td>Coste Real por KM</td>
                <td class="text-right">${metrics.costPerKm?.toFixed(3)} €</td>
                <td class="text-right">${historical.costPerKm?.toFixed(3)} €</td>
                <td class="text-right">-</td>
            </tr>
        </tbody>
    </table>
</div>

<div class="section">
    <div class="section-title">Listado de Repostajes</div>
    <table>
        <thead>
            <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th class="text-right">Cuentakm</th>
                <th class="text-right">Litros</th>
                <th class="text-right">Importe</th>
            </tr>
        </thead>
        <tbody>
            ${records.map(r => `
                <tr>
                    <td>${formatDate(r.date)}</td>
                    <td><span class="badge badge-amber">⛽</span> ${r.description}</td>
                    <td class="text-right">${r.km ? r.km.toLocaleString('es-ES') : '-'}</td>
                    <td class="text-right">${r.liters ? r.liters.toFixed(2) : '-'}</td>
                    <td class="text-right" style="font-weight:700">${formatCurrency(r.amount)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
</div>

<div class="footer">
    Reporte de Inteligencia Financiera generado el ${formatDate(new Date())}
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
