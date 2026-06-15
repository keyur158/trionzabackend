import admin from 'firebase-admin';
import fs from 'fs';
import { env } from './env';

let firebaseApp: admin.app.App | null = null;

export function getFirebaseApp(): admin.app.App {
  if (!firebaseApp) {
    const serviceAccountPath = env.FIREBASE_SERVICE_ACCOUNT;
    if (!fs.existsSync(serviceAccountPath)) {
      console.warn(`Firebase service account not found at ${serviceAccountPath}. Push notifications disabled.`);
      if (admin.apps.length > 0) {
        return admin.app();
      }
      firebaseApp = admin.initializeApp();
      return firebaseApp;
    }
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return firebaseApp;
}
