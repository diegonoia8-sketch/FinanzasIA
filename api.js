/**
 * api.js — Gemini AI Integration
 * OCR, categorización automática, consejo diario, chat con memoria
 */

let chatHistory = []; // Session memory for chat

export async function callGemini(systemPrompt, userPrompt, base64Image = null) {
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) throw new Error("Falta la API Key de Gemini. Configúrala en Ajustes.");

    const parts = [{ text: `${systemPrompt}\n\nUser: ${userPrompt}` }];
    if (base64Image) {
        const mimeType = base64Image.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg';
        const data = base64Image.split(',')[1];
        parts.push({ inline_data: { mime_type: mimeType, data } });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || "Error al conectar con la IA");
    }
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

// Chat with session memory
export async function callGeminiChat(userMessage, financialContext = '') {
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) throw new Error("Falta la API Key de Gemini.");

    // Add user message to history
    chatHistory.push({ role: 'user', parts: [{ text: userMessage }] });

    // Keep last 10 exchanges for context
    const trimmedHistory = chatHistory.slice(-20);

    const systemInstruction = `Eres un asesor financiero personal experto y cercano. Tienes acceso a los datos financieros del usuario:
${financialContext}
Responde en español, de forma concisa y útil. Si el usuario pregunta por datos específicos, extrae la información del contexto proporcionado. 
Si no tienes la información necesaria, dilo claramente.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: trimmedHistory
        })
    });

    if (!response.ok) {
        const err = await response.json();
        const errMsg = err.error?.message || "Error de IA";
        chatHistory.pop(); // Remove failed message
        throw new Error(errMsg);
    }
    const data = await response.json();
    const reply = data.candidates[0].content.parts[0].text;

    // Add assistant response to history
    chatHistory.push({ role: 'model', parts: [{ text: reply }] });

    return reply;
}

export const resetChatHistory = () => { chatHistory = []; };

// Auto-categorize based on description
export async function categorizarConcepto(description, categories) {
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey || !description || description.length < 3) return null;

    // First try local keyword matching (faster, no API call)
    const KEYWORDS = {
        'mercadona': 'Comida', 'lidl': 'Comida', 'carrefour': 'Comida', 'alcampo': 'Comida',
        'repsol': 'Combustible', 'cepsa': 'Combustible', 'bp ': 'Combustible', 'galp': 'Combustible',
        'netflix': 'Ocio', 'spotify': 'Ocio', 'amazon': 'Ocio', 'cine': 'Ocio',
        'farmacia': 'Salud', 'clinica': 'Salud', 'hospital': 'Salud', 'medico': 'Salud',
        'zara': 'Ropa', 'mango': 'Ropa', 'h&m': 'Ropa',
        'renfe': 'Transporte', 'metro': 'Transporte', 'taxi': 'Transporte', 'uber': 'Transporte',
        'endesa': 'Facturas', 'iberdrola': 'Facturas', 'movistar': 'Facturas', 'orange': 'Facturas',
        'salario': 'Salario', 'nómina': 'Salario', 'nomina': 'Salario',
    };
    const lower = description.toLowerCase();
    for (const [kw, cat] of Object.entries(KEYWORDS)) {
        if (lower.includes(kw) && categories.includes(cat)) return cat;
    }

    return null; // Don't call API for every keystroke
}

// Daily financial tip based on real data
export async function getConsejoDelDia(transactions, budgets = []) {
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) return null;

    // Check if we already got a tip today
    const today = new Date().toDateString();
    const cached = localStorage.getItem('dailyTip');
    if (cached) {
        try {
            const { date, tip } = JSON.parse(cached);
            if (date === today) return tip;
        } catch (e) { /* ignore */ }
    }

    const now = new Date();
    const month = now.getMonth(), year = now.getFullYear();
    const txMonth = transactions.filter(t => {
        const d = t.date?.toDate?.();
        return d && d.getMonth() === month && d.getFullYear() === year && t.type === 'expense';
    });
    const catSummary = txMonth.reduce((acc, t) => {
        acc[t.category] = (acc[t.category] || 0) + t.amount;
        return acc;
    }, {});
    const topCat = Object.entries(catSummary).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const budgetsOver = budgets.filter(b => b.spent > b.amount * 0.8).map(b => b.category);

    try {
        const prompt = `Basándote en estos datos del usuario este mes:
- Top gastos: ${JSON.stringify(topCat)}
- Presupuestos en riesgo: ${JSON.stringify(budgetsOver)}
Da UN consejo financiero práctico y personalizado en máximo 2 frases. Sé específico con sus datos, positivo pero directo. Sin emojis al inicio.`;

        const tip = await callGemini("Eres un asesor financiero experto y conciso.", prompt);
        const cleanTip = tip.trim();
        localStorage.setItem('dailyTip', JSON.stringify({ date: today, tip: cleanTip }));
        return cleanTip;
    } catch (e) {
        return null;
    }
}

// Build financial context string for chat
export const buildFinancialContext = (transactions, budgets = []) => {
    const now = new Date();
    const month = now.getMonth(), year = now.getFullYear();
    
    // 1. Current month stats
    const txMonth = transactions.filter(t => {
        const d = t.date?.toDate?.();
        return d && d.getMonth() === month && d.getFullYear() === year;
    });
    const income = txMonth.filter(t => t.type === 'income' && !['Transferencia','Saldo Inicial'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
    const expense = txMonth.filter(t => t.type === 'expense' && !['Transferencia'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
    
    // 2. Account balances
    const accounts = {};
    transactions.forEach(t => {
        if (!accounts[t.account]) accounts[t.account] = 0;
        t.type === 'income' ? accounts[t.account] += t.amount : accounts[t.account] -= t.amount;
    });

    // 3. Monthly Averages (Historical)
    const monthsData = {};
    transactions.forEach(t => {
        const d = t.date?.toDate?.();
        if (!d) return;
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!monthsData[key]) monthsData[key] = { income: 0, expense: 0 };
        if (t.type === 'income' && !['Transferencia','Saldo Inicial'].includes(t.category)) monthsData[key].income += t.amount;
        if (t.type === 'expense' && !['Transferencia'].includes(t.category)) monthsData[key].expense += t.amount;
    });
    const numMonths = Object.keys(monthsData).length || 1;
    const avgIncome = Object.values(monthsData).reduce((s, m) => s + m.income, 0) / numMonths;
    const avgExpense = Object.values(monthsData).reduce((s, m) => s + m.expense, 0) / numMonths;

    // 4. Compact CSV for all transactions (Date, Type, Cat, Amount, Desc)
    // We sort by date descending and take up to 300 latest to stay within context limits if very large
    const sortedTxs = [...transactions].sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0)).slice(0, 500);
    const csvHeaders = "Fecha,Tipo,Cat,Imp,Concepto";
    const csvRows = sortedTxs.map(t => {
        const d = t.date?.toDate?.() ? t.date.toDate().toISOString().split('T')[0] : 'N/A';
        const type = t.type === 'income' ? 'I' : 'G';
        const desc = (t.description || '').substring(0, 15).replace(/,/g, '');
        return `${d},${type},${t.category || ''},${t.amount.toFixed(0)},${desc}`;
    }).join('\n');

    return `
=== ESTADO ACTUAL ===
MES ACTUAL: Ingresos: ${income.toFixed(2)}€, Gastos: ${expense.toFixed(2)}€, Ahorro: ${(income - expense).toFixed(2)}€
MEDIAS HISTÓRICAS: Ingresos/mes: ${avgIncome.toFixed(2)}€, Gastos/mes: ${avgExpense.toFixed(2)}€
SALDOS: ${JSON.stringify(accounts)}
METAS: ${JSON.stringify(budgets.map(b => ({ cat: b.category, gastado: b.spent, limite: b.amount })))}

=== HISTORIAL COMPLETO (CSV) ===
${csvHeaders}
${csvRows}
`;
};

export const compressImage = (base64Str, maxWidth = 1000, quality = 0.7) => {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width, height = img.height;
            if (width > maxWidth) { height = Math.round(height * maxWidth / width); width = maxWidth; }
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
    });
};
