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
    const searchTerms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    
    // Fetch all docs to perform fuzzy search client-side
    const allSnapshot = await getDocs(collection(db, path));
    const allDocs = allSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
    
    // Score matches
    const scoredMatches = allDocs.map(doc => {
      let score = 0;
      const queryKey = (doc.queryKey || "").toLowerCase();
      const title = (doc.title || "").toLowerCase();
      const desc = (doc.description || "").toLowerCase();
      const queryLower = searchQuery.toLowerCase();
      
      if (queryKey === queryLower) score += 100;
      else if (queryKey.includes(queryLower)) score += 50;
      
      if (title === queryLower) score += 80;
      else if (title.includes(queryLower)) score += 40;
      
      searchTerms.forEach(term => {
        if (queryKey.includes(term)) score += 20;
        if (title.includes(term)) score += 15;
        if (desc.includes(term)) score += 5;
      });
      
      return { doc, score };
    }).filter(m => m.score > 15);

    if (scoredMatches.length > 0) {
      scoredMatches.sort((a, b) => b.score - a.score);
      return scoredMatches.slice(0, 3).map(m => m.doc);
    }
    
    return null;
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
    const q = query(
      collection(db, path),
      where('category', '==', category)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    
    const docs = snapshot.docs.map(d => d.data());
    // Sort by chunkIndex if it exists
    docs.sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
    
    return {
      category,
      content: docs.map(d => d.content).join('\n')
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return null;
  }
}

// Function to fetch college info by query
export async function getCollegeInfoByQuery(searchQuery: string) {
  const path = 'college_info';
  try {
    const searchTerms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    
    // Fetch all docs to perform fuzzy search client-side (Firestore doesn't support full-text search)
    const allSnapshot = await getDocs(collection(db, path));
    const allDocs = allSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
    
    // Score matches
    const categoryScores: Record<string, number> = {};
    
    allDocs.forEach(doc => {
      let score = 0;
      const cat = (doc.category || "").toLowerCase();
      const cont = (doc.content || "").toLowerCase();
      const queryLower = searchQuery.toLowerCase();
      
      if (cat === queryLower) score += 100;
      else if (cat.includes(queryLower)) score += 50;
      
      searchTerms.forEach(term => {
        if (cat.includes(term)) score += 30;
        if (cont.includes(term)) score += 10;
      });
      
      if (score > 0) {
        categoryScores[doc.category] = Math.max(categoryScores[doc.category] || 0, score);
      }
    });

    const sortedCategories = Object.entries(categoryScores)
      .sort(([, a], [, b]) => b - a)
      .filter(([, score]) => score > 15) // Threshold for relevance
      .slice(0, 3); // Top 3 matching categories

    if (sortedCategories.length > 0) {
      const results = sortedCategories.map(([category]) => {
        const categoryDocs = allDocs.filter(d => d.category === category);
        categoryDocs.sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
        return {
          category,
          content: categoryDocs.map(d => d.content).join('\n')
        };
      });

      return results;
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
