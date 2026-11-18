import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyDIz4B3UQDjLYwMdSx0Bc5v5rYiDxT2hnQ",
  authDomain: "kebabposjp-1fec3.firebaseapp.com",
  projectId: "kebabposjp-1fec3",
  storageBucket: "kebabposjp-1fec3.firebasestorage.app",
  messagingSenderId: "361689391550",
  appId: "1:361689391550:web:bafec0708a2e91a4dbd9ef",
  databaseURL: "https://kebabposjp-1fec3-default-rtdb.asia-southeast1.firebasedatabase.app",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
