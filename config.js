import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyA2k5hvtCzAxClwmgxuiyiIzSa4UugZLas",
    authDomain: "finance-control-35102.firebaseapp.com",
    projectId: "finance-control-35102",
    storageBucket: "finance-control-35102.firebasestorage.app",
    messagingSenderId: "863606044392",
    appId: "1:863606044392:web:9da74f5606f988b53b3b5d",
    measurementId: "G-582WDX4234"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app); // Pre-activado para la migración
export const dbCollections = { 
    transactions: "transactions", 
    userSettings: "userSettings",
    budgets: "budgets",
    recurring: "recurring"
};
