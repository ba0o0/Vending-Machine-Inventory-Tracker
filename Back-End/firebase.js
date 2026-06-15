import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
// Your web app's Firebase configuration

// For Firebase JS SDK v7.20.0 and later, measurementId is optional

const firebaseConfig = {

  apiKey: "AIzaSyCTlhDBzh0LG7jMjpdM8okND2W-uV8HUa4",

  authDomain: "vendingmachineinventory447.firebaseapp.com",

  projectId: "vendingmachineinventory447",

  storageBucket: "vendingmachineinventory447.firebasestorage.app",

  messagingSenderId: "965352398812",

  appId: "1:965352398812:web:c896353ec416e69b20b919",

  measurementId: "G-82TJBEQ395"

};


const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

