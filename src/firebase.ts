import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  query, 
  where, 
  getDocs, 
  limit, 
  addDoc, 
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Helper for Firestore error handling as per guidelines
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Function to fetch media by query key
export async function getMediaByQuery(searchQuery: string) {
  const path = 'media';
  try {
    const q = query(
      collection(db, path),
      where('queryKey', '>=', searchQuery),
      where('queryKey', '<=', searchQuery + '\uf8ff'),
      limit(1)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      return snapshot.docs[0].data();
    }
    
    // Fallback: fetch all and filter client-side
    const allSnapshot = await getDocs(collection(db, path));
    const found = allSnapshot.docs.find(doc => {
      const data = doc.data();
      return data.queryKey.toLowerCase().includes(searchQuery.toLowerCase()) ||
             data.title.toLowerCase().includes(searchQuery.toLowerCase());
    });
    return found ? found.data() : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return null;
  }
}

// Function to add media
export async function addMedia(data: { queryKey: string, type: 'image' | 'video', url: string, title: string, description?: string }) {
  const path = 'media';
  try {
    await addDoc(collection(db, path), {
      ...data,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// Function to add college info
export async function addCollegeInfo(data: { category: string, content: string, [key: string]: any }) {
  const path = 'college_info';
  try {
    await addDoc(collection(db, path), {
      ...data,
      lastUpdated: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// Function to delete college info by category
export async function deleteCollegeInfoByCategory(category: string) {
  const path = 'college_info';
  try {
    const q = query(
      collection(db, path),
      where('category', '==', category)
    );
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, path, d.id)));
    await Promise.all(deletePromises);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Function to fetch college info by category
export async function getCollegeInfoByCategory(category: string) {
  const path = 'college_info';
  try {
    // Try exact match first (prefix search)
    const q = query(
      collection(db, path),
      where('category', '>=', category),
      where('category', '<=', category + '\uf8ff')
    );
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      // Group by category to find the best match
      const grouped: Record<string, any[]> = {};
      snapshot.docs.forEach(d => {
        const data = d.data();
        if (!grouped[data.category]) grouped[data.category] = [];
        grouped[data.category].push(data);
      });

      // Pick the category that matches best (shortest name or exact match)
      const bestCategory = Object.keys(grouped).sort((a, b) => a.length - b.length)[0];
      const docs = grouped[bestCategory];
      
      // Sort by chunkIndex to maintain order
      docs.sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
      return {
        category: bestCategory,
        content: docs.map(d => d.content).join('\n')
      };
    }

    // Fallback: fetch all and filter client-side
    const allSnapshot = await getDocs(collection(db, path));
    const matches = allSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() as any }))
      .filter(data => 
        data.category.toLowerCase().includes(category.toLowerCase()) ||
        data.content.toLowerCase().includes(category.toLowerCase())
      );

    if (matches.length > 0) {
      // Group by category and sort by chunkIndex
      const grouped: Record<string, any[]> = {};
      matches.forEach(curr => {
        if (!grouped[curr.category]) grouped[curr.category] = [];
        grouped[curr.category].push(curr);
        return grouped;
      });
      
      // Pick the best matching category (first one for now)
      const bestCategory = Object.keys(grouped)[0];
      const docs = grouped[bestCategory];
      docs.sort((a: any, b: any) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
      
      return {
        category: bestCategory,
        content: docs.map((d: any) => d.content).join('\n')
      };
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return null;
  }
}

// Admin functions to list all items
export async function getAllMedia() {
  const path = 'media';
  try {
    const snapshot = await getDocs(collection(db, path));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export async function getAllCollegeInfo() {
  const path = 'college_info';
  try {
    const snapshot = await getDocs(collection(db, path));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export async function updateMedia(id: string, data: any) {
  const path = `media/${id}`;
  try {
    await updateDoc(doc(db, 'media', id), data);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMedia(id: string) {
  const path = `media/${id}`;
  try {
    await deleteDoc(doc(db, 'media', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateCollegeInfo(id: string, data: any) {
  const path = `college_info/${id}`;
  try {
    await updateDoc(doc(db, 'college_info', id), data);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCollegeInfo(id: string) {
  const path = `college_info/${id}`;
  try {
    await deleteDoc(doc(db, 'college_info', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
