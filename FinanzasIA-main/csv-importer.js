/**
 * csv-importer.js — Importador de extractos bancarios españoles
 * Soporta: CaixaBank, Santander, BBVA, ING, Sabadell
 */

// Mapa de palabras clave → categoría
const KEYWORD_CATEGORIES = {
    'MERCADONA': 'Comida', 'LIDL': 'Comida', 'CARREFOUR': 'Comida', 'ALCAMPO': 'Comida',
    'CONSUM': 'Comida', 'ALDI': 'Comida', 'DIA ': 'Comida', 'SUPERMERCADO': 'Comida',
    'REPSOL': 'Combustible', 'CEPSA': 'Combustible', 'BP ': 'Combustible', 'GALP': 'Combustible', 
    'SHELL': 'Combustible', 'CAMPSA': 'Combustible', 'GASOLINERA': 'Combustible',
    'NETFLIX': 'Ocio', 'SPOTIFY': 'Ocio', 'HBO': 'Ocio', 'DISNEY': 'Ocio', 'AMAZON PRIME': 'Ocio',
    'CINE': 'Ocio', 'STEAM': 'Ocio', 'PLAYSTATION': 'Ocio', 'APPLE TV': 'Ocio',
    'FARMACIA': 'Salud', 'CLINICA': 'Salud', 'MEDICO': 'Salud', 'HOSPITAL': 'Salud', 
    'DENTISTA': 'Salud', 'OPTICA': 'Salud',
    'ZARA': 'Ropa', 'MANGO': 'Ropa', 'H&M': 'Ropa', 'PULL&BEAR': 'Ropa', 'BERSHKA': 'Ropa',
    'IKEA': 'Otros Gastos', 'EL CORTE INGLES': 'Otros Gastos', 'AMAZON': 'Otros Gastos',
    'RENFE': 'Transporte', 'EMT': 'Transporte', 'CABIFY': 'Transporte', 'UBER': 'Transporte',
    'BUS': 'Transporte', 'METRO': 'Transporte', 'TAXI': 'Transporte',
    'ENDESA': 'Facturas', 'NATURGY': 'Facturas', 'IBERDROLA': 'Facturas', 'MOVISTAR': 'Facturas',
    'ORANGE': 'Facturas', 'VODAFONE': 'Facturas', 'MASMOVIL': 'Facturas',
    'NOMINA': 'Salario', 'NÓMINA': 'Salario', 'SALARIO': 'Salario',
    'TRANSFERENCIA RECIBIDA': 'Otros Ingresos', 'DEVOLUCION': 'Otros Ingresos',
};

const guessCategory = (description) => {
    const upper = (description || '').toUpperCase();
    for (const [keyword, category] of Object.entries(KEYWORD_CATEGORIES)) {
        if (upper.includes(keyword)) return category;
    }
    return 'Otros Gastos';
};

const parseAmount = (str) => {
    if (!str) return 0;
    const cleaned = str.trim().replace(/\./g, '').replace(',', '.').replace(/[€$\s]/g, '');
    return parseFloat(cleaned) || 0;
};

const parseDate = (str) => {
    if (!str) return null;
    const s = str.trim();
    // DD/MM/YYYY or DD-MM-YYYY
    const m1 = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (m1) return new Date(parseInt(m1[3]), parseInt(m1[2]) - 1, parseInt(m1[1]));
    // YYYY-MM-DD
    const m2 = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
    if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]));
    return null;
};

// Detect bank format and column mapping
const detectFormat = (headers) => {
    const h = headers.map(x => (x || '').toLowerCase().trim());
    
    // CaixaBank: Fecha, Concepto, Importe, Saldo
    if (h.includes('concepto') && h.includes('importe')) {
        const dateIdx = h.findIndex(x => x.includes('fecha'));
        const descIdx = h.findIndex(x => x.includes('concepto'));
        const amountIdx = h.findIndex(x => x.includes('importe'));
        return { bank: 'CaixaBank', dateIdx, descIdx, amountIdx, splitBySign: true };
    }
    // Santander: Fecha Valor, Concepto, Cargo, Abono
    if (h.includes('cargo') || h.includes('abono')) {
        const dateIdx = h.findIndex(x => x.includes('fecha'));
        const descIdx = h.findIndex(x => x.includes('concepto'));
        const expenseIdx = h.findIndex(x => x.includes('cargo'));
        const incomeIdx = h.findIndex(x => x.includes('abono'));
        return { bank: 'Santander', dateIdx, descIdx, expenseIdx, incomeIdx, splitBySign: false };
    }
    // BBVA: Fecha, Descripción, Importe
    if (h.includes('descripción') || h.includes('descripcion') || h.includes('description')) {
        const dateIdx = h.findIndex(x => x.includes('fecha'));
        const descIdx = h.findIndex(x => x.includes('descri'));
        const amountIdx = h.findIndex(x => x.includes('importe') || x.includes('amount'));
        return { bank: 'BBVA/ING', dateIdx, descIdx, amountIdx, splitBySign: true };
    }
    // Generic: try first 3 columns
    return { bank: 'Genérico', dateIdx: 0, descIdx: 1, amountIdx: 2, splitBySign: true };
};

export const parseCSVFile = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                // Detect separator
                const firstLine = text.split('\n')[0];
                const sep = firstLine.includes(';') ? ';' : ',';
                
                const rows = text.split('\n').map(r => r.split(sep).map(c => c.replace(/^"|"$/g, '').trim()));
                if (rows.length < 2) { reject(new Error('CSV vacío')); return; }

                const headers = rows[0];
                const fmt = detectFormat(headers);
                const transactions = [];

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.length < 2 || !row[fmt.dateIdx]) continue;

                    const date = parseDate(row[fmt.dateIdx]);
                    if (!date) continue;

                    const description = row[fmt.descIdx] || '';
                    let amount = 0, type = 'expense';

                    if (fmt.splitBySign) {
                        amount = parseAmount(row[fmt.amountIdx]);
                        if (amount > 0) { type = 'income'; }
                        else { type = 'expense'; amount = Math.abs(amount); }
                    } else {
                        const expAmount = parseAmount(row[fmt.expenseIdx]);
                        const incAmount = parseAmount(row[fmt.incomeIdx]);
                        if (incAmount > 0) { type = 'income'; amount = incAmount; }
                        else { type = 'expense'; amount = expAmount; }
                    }

                    if (amount === 0) continue;

                    transactions.push({
                        date, description, amount, type,
                        category: guessCategory(description),
                        account: '', accountingBook: 'Principal',
                        source: fmt.bank
                    });
                }

                resolve({ transactions, bank: fmt.bank, total: transactions.length });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Error leyendo el archivo'));
        reader.readAsText(file, 'UTF-8');
    });
};

export { guessCategory };
