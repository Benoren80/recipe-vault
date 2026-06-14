// src/lib/db.js
// Collections:
//   rv_recipes    — recipes + cumulative ratings
//   rv_categories — category list
//   rv_menus      — generated menus with occasion details + per-recipe post-occasion ratings

import {
  collection, doc, getDoc, getDocs,
  setDoc, addDoc, updateDoc, deleteDoc
} from 'firebase/firestore';
import { db } from './firebase';

export const COL = {
  RECIPES: 'rv_recipes',
  CATEGORIES: 'rv_categories',
  MENUS: 'rv_menus',
};

export async function fsGetAll(col) {
  const snap = await getDocs(collection(db, col));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fsSet(col, id, data) {
  await setDoc(doc(db, col, id), data, { merge: true });
}

export async function fsAdd(col, data) {
  const ref = await addDoc(collection(db, col), data);
  return ref.id;
}

export async function fsUpdate(col, id, data) {
  await updateDoc(doc(db, col, id), data);
}

export async function fsDelete(col, id) {
  await deleteDoc(doc(db, col, id));
}
