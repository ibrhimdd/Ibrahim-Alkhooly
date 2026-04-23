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
  deleteDoc,
  orderBy
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
  databaseId: string;
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
    path,
    databaseId: firebaseConfig.firestoreDatabaseId
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Arabic normalization helper
function normalizeArabic(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F]/g, "") // Remove harakat (diacritics)
    .replace(/[^\w\s\u0621-\u064A]/g, "") // Remove punctuation
    .trim();
}

// --- In-memory Database Cache for performance ---
const dbCache: Record<string, { data: any[], timestamp: number }> = {};
const CACHE_TTL = 300000; // 5 minutes

async function getCachedDocs(path: string) {
  const now = Date.now();
  if (dbCache[path] && (now - dbCache[path].timestamp) < CACHE_TTL) {
    return dbCache[path].data;
  }
  
  const snapshot = await getDocs(collection(db, path));
  const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  dbCache[path] = { data, timestamp: now };
  return data;
}

function invalidateCache(path: string) {
  delete dbCache[path];
}
// --------------------------------------------------

// Function to fetch media by query key
export async function getMediaByQuery(searchQuery: string) {
  const path = 'media';
  try {
    const normalizedQuery = normalizeArabic(searchQuery);
    const searchTerms = normalizedQuery.split(/\s+/).filter(t => t.length > 1);
    
    if (searchTerms.length === 0) return null;

    // Use cached docs for speed
    const allDocs = await getCachedDocs(path);
    
    // Server-side filter hint: if any term is completely missing from keywords, it might be a weak match
    // For now we still score all to ensure "fuzzy" works well, but we use the memory cache.
    const scoredMatches = allDocs.map(doc => {
      let score = 0;
      const normalizedQueryKey = normalizeArabic(doc.queryKey || "");
      const normalizedTitle = normalizeArabic(doc.title || "");
      const normalizedDesc = normalizeArabic(doc.description || "");
      
      // Bonus for exact match or substring match of the whole query
      if (normalizedQueryKey === normalizedQuery) score += 200;
      else if (normalizedQueryKey.includes(normalizedQuery)) score += 100;
      
      if (normalizedTitle === normalizedQuery) score += 150;
      else if (normalizedTitle.includes(normalizedQuery)) score += 80;
      
      // Individual term matching
      let termsMatched = 0;
      searchTerms.forEach(term => {
        let termFound = false;
        if (normalizedQueryKey.includes(term)) {
          score += 40;
          termFound = true;
        }
        if (normalizedTitle.includes(term)) {
          score += 30;
          termFound = true;
        }
        if (normalizedDesc.includes(term)) {
          score += 10;
          termFound = true;
        }
        if (termFound) termsMatched++;
      });

      // Bonus for matching multiple terms
      if (termsMatched > 1) {
        score += (termsMatched / searchTerms.length) * 50;
      }
      
      return { doc, score };
    }).filter(m => m.score >= 30); // Higher score required but easier to reach with normalization and term weights

    if (scoredMatches.length > 0) {
      scoredMatches.sort((a, b) => b.score - a.score);
      return scoredMatches.slice(0, 1).map(m => m.doc); // Return top 1 most relevant
    }
    
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return null;
  }
}

// Keyword generator for faster search
function generateKeywords(text: string): string[] {
  if (!text) return [];
  const normalized = normalizeArabic(text);
  const words = normalized.split(/\s+/).filter(w => w.length >= 2);
  const keywords = new Set<string>();
  
  words.forEach(word => {
    keywords.add(word);
    // Add prefixes for partial matching (e.g., "احمد" -> "اح", "احم", "احمد")
    for (let i = 2; i <= word.length; i++) {
      keywords.add(word.substring(0, i));
    }
  });
  
  return Array.from(keywords);
}

// Function to add media
export async function addMedia(data: { queryKey: string, type: 'image' | 'video', url: string, title: string, description?: string }) {
  const path = 'media';
  try {
    const keywords = [
      ...generateKeywords(data.queryKey),
      ...generateKeywords(data.title),
      ...(data.description ? generateKeywords(data.description) : [])
    ];
    
    await addDoc(collection(db, path), {
      ...data,
      keywords: Array.from(new Set(keywords)).slice(0, 500), // Firestore limits
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
    const keywords = [
      ...generateKeywords(data.category),
      ...generateKeywords(data.content.substring(0, 1000)) // Limit indexing to first 1000 chars
    ];

    await addDoc(collection(db, path), {
      ...data,
      keywords: Array.from(new Set(keywords)).slice(0, 500),
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
    invalidateCache(path);
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
    const normalizedQuery = normalizeArabic(searchQuery);
    const searchTerms = normalizedQuery.split(/\s+/).filter(t => t.length > 1);
    
    if (searchTerms.length === 0) return [];

    // Use cached docs for speed
    const allDocs = await getCachedDocs(path);
    
    // Score matches
    const categoryScores: Record<string, number> = {};
    
    allDocs.forEach(doc => {
      let score = 0;
      const normalizedCat = normalizeArabic(doc.category || "");
      const normalizedCont = normalizeArabic(doc.content || "");
      const normalizedQuery = normalizeArabic(searchQuery);
      
      if (normalizedCat === normalizedQuery) score += 200;
      else if (normalizedCat.includes(normalizedQuery)) score += 100;
      else if (normalizedQuery.includes(normalizedCat)) score += 80;
      
      let termsMatched = 0;
      searchTerms.forEach(term => {
        let foundForTerm = false;
        if (normalizedCat.includes(term)) {
          score += 50;
          foundForTerm = true;
        }
        if (normalizedCont.includes(term)) {
          score += 15;
          foundForTerm = true;
        }
        if (foundForTerm) termsMatched++;
      });

      if (termsMatched > 1) {
        score += (termsMatched / searchTerms.length) * 50;
      }
      
      if (score > 0) {
        categoryScores[doc.category] = Math.max(categoryScores[doc.category] || 0, score);
      }
    });

    const sortedCategories = Object.entries(categoryScores)
      .sort(([, a], [, b]) => b - a)
      .filter(([, score]) => score >= 30) // Threshold for relevance
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

// Admin functions to list all items (now using cache for speed)
export async function getAllMedia() {
  const path = 'media';
  try {
    return await getCachedDocs(path);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export async function getAllCollegeInfo() {
  const path = 'college_info';
  try {
    return await getCachedDocs(path);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

// Question Cache Functions
export async function getCachedQuestion(question: string) {
  const path = 'questions_cache';
  try {
    const normalizedTarget = normalizeArabic(question);
    
    // Fetch all for client-side fuzzy matching to handle variations (Arabic letters, extra spaces, etc.)
    const snapshot = await getDocs(collection(db, path));
    const allCached = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
    
    const matched = allCached.find(c => normalizeArabic(c.question) === normalizedTarget);
    
    if (matched) {
      const docRef = doc(db, path, matched.id);
      await updateDoc(docRef, {
        count: (matched.count || 0) + 1,
        lastAsked: serverTimestamp()
      });
      return matched;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return null;
  }
}

export async function addCachedQuestion(question: string, answer: string) {
  const path = 'questions_cache';
  try {
    const normalizedTarget = normalizeArabic(question);
    
    // Check if it already exists (normalized)
    const snapshot = await getDocs(collection(db, path));
    const exists = snapshot.docs.some(doc => normalizeArabic(doc.data().question) === normalizedTarget);
    
    if (!exists) {
      await addDoc(collection(db, path), {
        question: question.trim(),
        answer: answer.trim(),
        timestamp: serverTimestamp(),
        count: 1,
        lastAsked: serverTimestamp()
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getAllCachedQuestions() {
  const path = 'questions_cache';
  try {
    const snapshot = await getDocs(query(collection(db, path), orderBy('timestamp', 'desc')));
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export async function deleteCachedQuestion(id: string) {
  const path = 'questions_cache';
  try {
    await deleteDoc(doc(db, path, id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateMedia(id: string, data: any) {
  const path = 'media';
  try {
    const updatedData = { ...data };
    if (data.queryKey || data.title || data.description) {
      const keywords = [
        ...generateKeywords(data.queryKey || ""),
        ...generateKeywords(data.title || ""),
        ...(data.description ? generateKeywords(data.description) : [])
      ];
      updatedData.keywords = Array.from(new Set(keywords)).slice(0, 500);
    }
    await updateDoc(doc(db, path, id), updatedData);
    invalidateCache(path);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMedia(id: string) {
  const path = 'media';
  try {
    await deleteDoc(doc(db, path, id));
    invalidateCache(path);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateCollegeInfo(id: string, data: any) {
  const path = 'college_info';
  try {
    const updatedData = { ...data };
    if (data.category || data.content) {
      const keywords = [
        ...generateKeywords(data.category || ""),
        ...generateKeywords((data.content || "").substring(0, 1000))
      ];
      updatedData.keywords = Array.from(new Set(keywords)).slice(0, 500);
    }
    await updateDoc(doc(db, path, id), updatedData);
    invalidateCache(path);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCollegeInfo(id: string) {
  const path = 'college_info';
  try {
    await deleteDoc(doc(db, path, id));
    invalidateCache(path);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
