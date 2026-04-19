import { collection, addDoc, doc, updateDoc, deleteDoc, setDoc, getDoc, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { db, storage, dbCollections } from "./config.js";

export const saveTransaction = async (userId, transactionId, data, base64Image = null) => {
    try {
        const docData = { ...data, userId, updatedAt: serverTimestamp() };
        let docRefId = transactionId;

        // Guardar la transacción primero para no bloquear la UI
        if (transactionId) {
            await updateDoc(doc(db, dbCollections.transactions, transactionId), docData);
        } else {
            docData.createdAt = serverTimestamp();
            const docRef = await addDoc(collection(db, dbCollections.transactions), docData);
            docRefId = docRef.id;
        }

        // Subir la imagen de forma asíncrona en segundo plano
        if (base64Image) {
            (async () => {
                try {
                    const storageRef = ref(storage, `receipts/${userId}/${Date.now()}.jpg`);
                    await uploadString(storageRef, base64Image, 'data_url');
                    const receiptImage = await getDownloadURL(storageRef);
                    await updateDoc(doc(db, dbCollections.transactions, docRefId), { receiptImage });
                } catch (err) {
                    console.error("Error al subir el ticket en segundo plano:", err);
                }
            })();
        }

        return { status: transactionId ? "updated" : "created", id: docRefId };
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

export const saveBudget = async (userId, data) => {
    const budgetRef = doc(db, dbCollections.budgets, `${userId}_${data.category}`);
    await setDoc(budgetRef, { ...data, userId, updatedAt: serverTimestamp() });
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
