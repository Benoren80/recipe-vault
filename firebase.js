// src/lib/firebase.js
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBGN-hQHU1UFaHKjvB2lqWdfYfcQtjVxrk",
  authDomain: "oren-family.firebaseapp.com",
  projectId: "oren-family",
  storageBucket: "oren-family.firebasestorage.app",
  messagingSenderId: "435567429388",
  appId: "1:435567429388:web:0a3e30622b31fbc6476b29"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
