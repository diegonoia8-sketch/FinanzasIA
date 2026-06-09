import { collection, addDoc, doc, updateDoc, deleteDoc, setDoc, getDoc, getDocs, query, where, onSnapshot, serverTimestamp, orderBy, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { db, storage, dbCollections } from "./config.js";

const uploadImageInBackground = async (userId, docId, base64Image) => {
    try {
        const storageRef = ref(storage, `receipts/${userId}/${Date.now()}.jpg`);
        await uploadString(storageRef, base64Image, 'data_url');
        const receiptImage = await getDownloadURL(storageRef);
        await updateDoc(doc(db, dbCollections.transactions, docId), { receiptImage, updatedAt: serverTimestamp() });
        console.log(`[Background Upload] Imagen subida y asociada a la transacción ${docId}`);
    } catch (e) {
        console.error(`[Background Upload] Error al subir imagen para transacción ${docId}:`, e);
    }
};

export const saveTransaction = async (userId, transactionId, data, base64Image = null) => {
    try {
        const docData = { ...data, userId, updatedAt: serverTimestamp() };
        let docRef;

        if (transactionId) {
            docRef = doc(db, dbCollections.transactions, transactionId);
            await updateDoc(docRef, docData);
        } else {
            docData.createdAt = serverTimestamp();
            docRef = await addDoc(collection(db, dbCollections.transactions), docData);
        }

        if (base64Image) {
            const docId = transactionId || docRef.id;
            uploadImageInBackground(userId, docId, base64Image).catch(err => {
                console.error("Error al iniciar subida en segundo plano:", err);
            });
        }

        return { status: transactionId ? "updated" : "created" };
    } catch (e) {
        console.error("Error saving transaction:", e);
        throw e;
    }
};

export const deleteDocument = async (collectionName, docId) => {
    if (confirm("¿Estás seguro de que quieres eliminar este registro?")) {
        try {
            await deleteDoc(doc(db, collectionName, docId));
            return true;
        } catch (e) {
            console.error("Error deleting document:", e);
            return false;
        }
    }
};

export const addSetting = async (userId, settingType, value, initialBalance = null) => {
    const settingsRef = doc(db, dbCollections.userSettings, userId);
    const settingsDoc = await getDoc(settingsRef);
    let settingsData = settingsDoc.exists() ? settingsDoc.data() : { categories: [], accounts: [], accountingBooks: [] };

    if (!settingsData[settingType]) settingsData[settingType] = [];
    
    if (!settingsData[settingType].includes(value)) {
        settingsData[settingType].push(value);
        await setDoc(settingsRef, { [settingType]: settingsData[settingType] }, { merge: true });
        
        if (settingType === 'accounts' && initialBalance > 0) {
            await addDoc(collection(db, dbCollections.transactions), {
                type: 'income', description: 'Saldo inicial', amount: parseFloat(initialBalance), category: 'Saldo Inicial', date: new Date(), account: value, accountingBook: 'Principal', userId, createdAt: serverTimestamp()
            });
        }
        return true;
    }
    return false;
};


export const saveRecurring = async (userId, data) => {
    await addDoc(collection(db, dbCollections.recurring), { 
        ...data, 
        userId, 
        active: true, 
        createdAt: serverTimestamp(),
        lastActivatedAt: serverTimestamp() 
    });
};

export const savePayroll = async (userId, payrollData, pdfBase64 = null) => {
    try {
        const docData = { ...payrollData, userId, updatedAt: serverTimestamp() };
        
        if (pdfBase64) {
            // Guardamos directamente el Base64 en Firestore para evitar costes de Storage
            docData.pdfBase64 = pdfBase64;
        }

        const payrollId = `${userId}_${payrollData.year}_${payrollData.month}`;
        await setDoc(doc(db, dbCollections.payrolls, payrollId), docData, { merge: true });
        return { status: "saved", id: payrollId };
    } catch (e) {
        console.error("Error saving payroll:", e);
        throw e;
    }
};

export const updatePayrollIRPF = async (payrollId, newIRPF) => {
    try {
        await updateDoc(doc(db, dbCollections.payrolls, payrollId), { irpf: parseFloat(newIRPF), updatedAt: serverTimestamp() });
        return true;
    } catch (e) {
        console.error("Error updating IRPF:", e);
        return false;
    }
};

// ─── SUBTRANSACTIONS ──────────────────────────────────────────────────────────

export const addSubTransaction = async (parentTxId, subTx) => {
    try {
        const ref = doc(db, dbCollections.transactions, parentTxId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Transaction not found");
        const data = snap.data();
        const newSub = {
            id: crypto.randomUUID(),
            description: subTx.description || '',
            amount: parseFloat(subTx.amount) || 0,
            date: subTx.date || '',
            notes: subTx.notes || ''
        };
        const subTransactions = [...(data.subTransactions || []), newSub];
        const netAmount = Math.max(0, data.amount - subTransactions.reduce((s, st) => s + st.amount, 0));
        await updateDoc(ref, { subTransactions, netAmount, updatedAt: serverTimestamp() });
        return newSub;
    } catch (e) {
        console.error("Error adding sub-transaction:", e);
        throw e;
    }
};

export const removeSubTransaction = async (parentTxId, subTxId) => {
    try {
        const ref = doc(db, dbCollections.transactions, parentTxId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Transaction not found");
        const data = snap.data();
        const subTransactions = (data.subTransactions || []).filter(st => st.id !== subTxId);
        const netAmount = Math.max(0, data.amount - subTransactions.reduce((s, st) => s + st.amount, 0));
        await updateDoc(ref, { subTransactions, netAmount, updatedAt: serverTimestamp() });
    } catch (e) {
        console.error("Error removing sub-transaction:", e);
        throw e;
    }
};

