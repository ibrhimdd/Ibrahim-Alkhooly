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
  orderBy,
  getDocFromCache,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Test Connection as per guidelines
async function testConnection() {
  try {
    // Try to get a non-existent doc from server to verify connection
    await getDocFromServer(doc(db, '_connection_test_', 'ping'));
    console.log("Firestore connection verified.");
  } catch (error: any) {
    if (error?.message?.includes('offline')) {
      console.error("Firestore appears to be offline. Check configuration.");
    } else {
      console.warn("Firestore connection test finished (likely doc not found, which is fine):", error.message);
    }
  }
}
testConnection();

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
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[\u064B-\u065F]/g, "") // Remove harakat (diacritics)
    .replace(/[^\w\s\u0621-\u064A]/g, " ") // Replace punctuation with space
    .replace(/\s+/g, " ") // Collapse spaces
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

// Function to fetch media by query key (Hybrid: Semantic + Keyword)
export async function getMediaByQuery(searchQuery: string, queryVector?: number[]) {
  const path = 'media';
  try {
    const allDocs = await getCachedDocs(path);
    const normalizedQuery = normalizeArabic(searchQuery);
    const searchTerms = normalizedQuery.split(/\s+/).filter(t => t.length > 1);

    const scoredResults = allDocs.map(doc => {
      let keywordScore = 0;
      let semanticScore = 0;

      // 1. Calculate Keyword Score
      const normalizedQueryKey = normalizeArabic(doc.queryKey || "");
      const normalizedTitle = normalizeArabic(doc.title || "");
      
      if (normalizedQueryKey === normalizedQuery) keywordScore += 500;
      else if (normalizedQueryKey.includes(normalizedQuery)) keywordScore += 200;
      
      searchTerms.forEach(term => {
        if (normalizedQueryKey.includes(term)) keywordScore += 50;
        if (normalizedTitle.includes(term)) keywordScore += 30;
      });

      // 2. Calculate Semantic Score (if vector provided)
      if (queryVector && doc.embedding && Array.isArray(doc.embedding)) {
        semanticScore = cosineSimilarity(queryVector, doc.embedding);
      }

      // Hybrid combination: Normalize semantic score to a weight comparable to keywords
      // A high semantic score (0.8+) should be very strong, but perfect keyword match (500+) wins.
      const finalScore = keywordScore + (semanticScore * 300);

      return { doc, finalScore, keywordScore, semanticScore };
    });

    // Filter results: must have ANY match (low threshold)
    const filteredResults = scoredResults.filter(res => 
      res.finalScore >= 10 || res.semanticScore > 0.3
    );

    if (filteredResults.length === 0) return null;

    filteredResults.sort((a, b) => b.finalScore - a.finalScore);
    
    // Return the top result(s)
    return filteredResults.slice(0, 1).map(r => r.doc);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return null;
  }
}

// Helper for semantic search (Cosine Similarity)
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
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

/**
 * Migration Function: Backfills missing embeddings for existing documents.
 * @param generateEmbedding Callback to generate vector using Gemini API
 * @param onProgress Callback for UI feedback
 */
export async function migrateDataToEmbeddings(
  generateEmbedding: (text: string) => Promise<number[] | null>,
  onProgress: (status: string) => void,
  force: boolean = false
) {
  const collectionsToMigrate = ['college_info', 'media'];
  let totalMigrated = 0;

  for (const colName of collectionsToMigrate) {
    onProgress(`جاري جلب البيانات من ${colName}...`);
    try {
      const q = query(collection(db, colName));
      const snapshot = await getDocs(q);
      const docs = snapshot.docs;
      onProgress(`تم العثور على ${docs.length} مستند في ${colName}. بدء الفحص...`);
      
      let count = 0;
      let skipped = 0;
      for (const d of docs) {
        const data = d.data();
        console.log(`Checking doc ${d.id} in ${colName}. Embedding exists:`, !!data.embedding);
        
        // Skip if embedding already exists and not in force mode
        if (!force && data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
          skipped++;
          continue;
        }

        // Extract text based on collection type
        let textToEmbed = "";
        if (colName === 'college_info') {
          textToEmbed = `${data.category || ""}: ${data.content || ""}`;
        } else if (colName === 'media') {
          textToEmbed = `${data.queryKey || ""} ${data.title || ""} ${data.description || ""}`;
        }

        if (textToEmbed.trim()) {
          onProgress(`توليد embedding للمستند: ${d.id} (${colName})...`);
          const embedding = await generateEmbedding(textToEmbed);
          
          if (embedding) {
            await updateDoc(doc(db, colName, d.id), { embedding });
            count++;
            totalMigrated++;
            
            // Artificial delay to prevent rate limiting (Gemini API 429s)
            await new Promise(r => setTimeout(r, 500)); 
          }
        } else {
          skipped++;
        }
      }
      onProgress(`تم تحديث ${count} مستند في ${colName}. (تم تخطي ${skipped} مستندات موجودة بالفعل أو فارغة)`);
    } catch (error) {
      console.error(`Migration error in ${colName}:`, error);
      onProgress(`خطأ في ${colName}: تم تخطي الكوليكشن.`);
    }
  }

  invalidateCache('college_info');
  invalidateCache('media');
  onProgress(`اكتملت الهجرة بنجاح! إجمالي المستندات المحدثة: ${totalMigrated}`);
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

// Function to fetch college info by query (Hybrid: Semantic + Keyword)
export async function getCollegeInfoByQuery(searchQuery: string, queryVector?: number[]) {
  const path = 'college_info';
  try {
    const allDocs = await getCachedDocs(path);
    const normalizedQuery = normalizeArabic(searchQuery);
    const searchTerms = normalizedQuery.split(/\s+/).filter(t => t.length > 1);

    const categoryScores: Record<string, { totalScore: number, maxSemantic: number, maxKeyword: number, docCount: number }> = {};
    
    allDocs.forEach(doc => {
      let docKeywordScore = 0;
      let docSemanticScore = 0;

      const normalizedCat = normalizeArabic(doc.category || "");
      const normalizedCont = normalizeArabic(doc.content || "");
      
      // Keyword matching
      if (normalizedCat === normalizedQuery) docKeywordScore += 500;
      else if (normalizedCat.includes(normalizedQuery)) docKeywordScore += 200;
      
      let termsMatched = 0;
      searchTerms.forEach(term => {
        let found = false;
        if (normalizedCat.includes(term)) {
          docKeywordScore += 60;
          found = true;
        }
        if (normalizedCont.includes(term)) {
          docKeywordScore += 20;
          found = true;
        }
        if (found) termsMatched++;
      });

      // Semantic matching
      if (queryVector && doc.embedding && Array.isArray(doc.embedding)) {
        docSemanticScore = cosineSimilarity(queryVector, doc.embedding);
      }

      const finalDocScore = docKeywordScore + (docSemanticScore * 400);

      if (finalDocScore > 10 || docSemanticScore > 0.3) {
        const cat = doc.category;
        if (!categoryScores[cat]) {
          categoryScores[cat] = { totalScore: 0, maxSemantic: 0, maxKeyword: 0, docCount: 0 };
        }
        categoryScores[cat].totalScore = Math.max(categoryScores[cat].totalScore, finalDocScore);
        categoryScores[cat].maxSemantic = Math.max(categoryScores[cat].maxSemantic, docSemanticScore);
        categoryScores[cat].maxKeyword = Math.max(categoryScores[cat].maxKeyword, docKeywordScore);
        categoryScores[cat].docCount++;
      }
    });

    const sortedCategories = Object.entries(categoryScores)
      .sort(([, a], [, b]) => b.totalScore - a.totalScore)
      .slice(0, 3);

    if (sortedCategories.length > 0) {
      return sortedCategories.map(([category]) => {
        const categoryDocs = allDocs.filter(d => d.category === category);
        categoryDocs.sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
        return {
          category,
          content: categoryDocs.map(d => d.content).join('\n')
        };
      });
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
