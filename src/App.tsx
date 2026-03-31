import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { 
  Mic, 
  MicOff, 
  MessageSquare, 
  Info, 
  Phone, 
  MapPin, 
  GraduationCap, 
  BookOpen, 
  Globe,
  FileText,
  Upload,
  File,
  Sparkles,
  Newspaper,
  Users,
  RefreshCcw,
  Home
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AudioHandler } from './utils/audio';
import { SYSTEM_INSTRUCTION, MODEL_NAME, GET_MEDIA_CONTENT_TOOL, GET_COLLEGE_INFO_TOOL } from './constants';
import { getMediaByQuery, addMedia, addCollegeInfo, auth, getCollegeInfoByCategory, getAllMedia, getAllCollegeInfo, updateMedia, deleteMedia, updateCollegeInfo, deleteCollegeInfo, deleteCollegeInfoByCategory } from './firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface MediaItem {
  type: 'image' | 'video';
  url: string;
  title: string;
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle');
  const [transcript, setTranscript] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mediaContent, setMediaContent] = useState<MediaItem | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminTab, setAdminTab] = useState<'media' | 'info' | 'files'>('media');
  const [refreshKey, setRefreshKey] = useState(0);
  
  const [editingMedia, setEditingMedia] = useState<any>(null);
  const [editingInfo, setEditingInfo] = useState<any>(null);
  
  const [isSearching, setIsSearching] = useState(false);
  
  const audioHandlerRef = useRef<AudioHandler | null>(null);
  const sessionRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript]);

  useEffect(() => {
    // Test Firestore connection on mount
    const testConn = async () => {
      try {
        const media = await getAllMedia();
        console.log("Firestore connection test: Found", media.length, "media items.");
        const info = await getAllCollegeInfo();
        console.log("Firestore connection test: Found", info.length, "info items.");
      } catch (error) {
        console.error("Firestore connection test failed:", error);
      }
    };
    testConn();
  }, []);

  const clearTranscript = () => {
    setTranscript([]);
    setMediaContent(null);
    if (isActive) {
      stopSession();
    }
  };

  const startSession = async () => {
    try {
      setErrorMessage(null);
      setStatus('connecting');
      console.log("Starting session...");

      // Initialize AudioHandler
      audioHandlerRef.current = new AudioHandler((base64Data) => {
        if (sessionRef.current) {
          sessionRef.current.sendRealtimeInput({
            audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }
      });
      
      console.log("Requesting microphone access...");
      await audioHandlerRef.current.startCapture();
      console.log("Microphone access granted.");

      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("API Key is missing. Please check your environment settings.");
      }

      const ai = new GoogleGenAI({ apiKey });
      console.log("Connecting to Live API with model:", MODEL_NAME);
      
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ googleSearch: {} }, { functionDeclarations: [GET_MEDIA_CONTENT_TOOL, GET_COLLEGE_INFO_TOOL] }] as any,
        },
        callbacks: {
          onopen: () => {
            console.log("Live API connection opened.");
            setStatus('active');
            setIsActive(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              setIsSpeaking(true);
              audioHandlerRef.current?.playChunk(base64Audio);
            }

            // Handle interruption
            if (message.serverContent?.interrupted) {
              audioHandlerRef.current?.clearPlayback();
              setIsSpeaking(false);
            }

            // Handle turn complete
            if (message.serverContent?.turnComplete) {
              setIsSpeaking(false);
            }

            // Handle tool calls
            const toolCalls = message.toolCall?.functionCalls;
            if (toolCalls) {
              console.log("Received Tool Calls:", toolCalls);
              setIsSearching(true);
              for (const call of toolCalls) {
                if (call.name === "get_media_content") {
                  const queryStr = (call.args as any).query;
                  console.log("Executing Tool: get_media_content for", queryStr);
                  
                  // Fetch from Firestore
                  getMediaByQuery(queryStr).then(async (data) => {
                    let resultMsg = "لم يتم العثور على وسائط لهذا البحث في قاعدة البيانات.";
                    if (data) {
                      setMediaContent({
                        type: data.type as 'image' | 'video',
                        url: data.url,
                        title: data.title
                      });
                      resultMsg = `تم العثور على ${data.type === 'image' ? 'صورة' : 'فيديو'} بعنوان "${data.title}" وعرضه للمستخدم بنجاح.`;
                    }
                    console.log("Tool Result (Media):", resultMsg);
                    
                    // Send response back to model
                    const session = await sessionPromise;
                    session.sendToolResponse({
                      functionResponses: [{
                        name: "get_media_content",
                        id: call.id,
                        response: { result: resultMsg }
                      }]
                    });
                    setIsSearching(false);
                  }).catch(err => {
                    console.error("Error in get_media_content tool:", err);
                    setIsSearching(false);
                  });
                } else if (call.name === "get_college_info") {
                  const category = (call.args as any).category;
                  console.log("Executing Tool: get_college_info for", category);

                  getCollegeInfoByCategory(category).then(async (data) => {
                    let resultMsg = "لم يتم العثور على معلومات نصية لهذه الفئة في قاعدة البيانات.";
                    if (data) {
                      resultMsg = `المعلومات الأكيدة من قاعدة البيانات لـ ${category} هي: ${data.content}`;
                    }
                    console.log("Tool Result (Info):", resultMsg);

                    const session = await sessionPromise;
                    session.sendToolResponse({
                      functionResponses: [{
                        name: "get_college_info",
                        id: call.id,
                        response: { result: resultMsg }
                      }]
                    });
                    setIsSearching(false);
                  }).catch(err => {
                    console.error("Error in get_college_info tool:", err);
                    setIsSearching(false);
                  });
                }
              }
            }

            // Handle model transcription
            const modelParts = message.serverContent?.modelTurn?.parts;
            if (modelParts) {
              const modelText = modelParts.map(p => p.text).filter(Boolean).join(' ');
              if (modelText.trim()) {
                setTranscript(prev => {
                  // If last message was model, we might be getting more parts of the same turn
                  // But usually Live API sends chunks. Let's just append for now but keep more history.
                  return [...prev.slice(-10), { role: 'model', text: modelText }];
                });
              }
            }

            // Handle user transcription
            const userText = message.serverContent?.inputTranscription?.text;
            if (userText) {
              setTranscript(prev => {
                // Avoid duplicate user transcripts
                if (prev.length > 0 && prev[prev.length - 1].role === 'user' && prev[prev.length - 1].text === userText) {
                  return prev;
                }
                return [...prev.slice(-10), { role: 'user', text: userText }];
              });
            }
          },
          onerror: (error: any) => {
            console.error("Live API Error:", error);
            setStatus('error');
            
            if (error?.message?.includes('Network error') || error?.message?.includes('Requested entity was not found')) {
              setErrorMessage("حدث خطأ في الشبكة أو المفتاح البرمجي. يرجى إعادة اختيار المفتاح البرمجي والتأكد من اتصالك.");
            } else if (error?.message?.includes('service is currently unavailable')) {
              setErrorMessage("الخدمة غير متوفرة حالياً. يرجى المحاولة مرة أخرى بعد قليل.");
            } else {
              setErrorMessage("حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.");
            }
            stopSession();
          },
          onclose: () => {
            setStatus('idle');
            stopSession();
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (error: any) {
      console.error("Failed to start session:", error);
      setStatus('error');
      if (error?.name === 'NotAllowedError' || error?.message?.includes('Permission denied')) {
        setErrorMessage("يرجى السماح بالوصول إلى الميكروفون من إعدادات المتصفح للمتابعة.");
      } else {
        setErrorMessage("تعذر بدء الجلسة. تأكد من إعدادات الميكروفون والمفتاح البرمجي.");
      }
      stopSession();
    }
  };

  const stopSession = () => {
    audioHandlerRef.current?.close();
    sessionRef.current?.close();
    sessionRef.current = null;
    setIsActive(false);
    setStatus('idle');
    setIsSpeaking(false);
  };

  const toggleSession = async () => {
    if (isActive) {
      stopSession();
    } else {
      await startSession();
    }
  };

  const handleQuickAction = (query: string) => {
    if (isActive && sessionRef.current) {
      sessionRef.current.sendRealtimeInput({
        text: query
      });
    } else if (!isActive) {
      // Start session then send query
      startSession().then(() => {
        // Wait a bit for session to be active
        setTimeout(() => {
          if (sessionRef.current) {
            sessionRef.current.sendRealtimeInput({ text: query });
          }
        }, 2000);
      });
    }
  };

  const handleAdminAuth = () => {
    setShowPasswordModal(true);
  };

  const verifyPassword = () => {
    if (passwordInput === "509077") {
      setShowPasswordModal(false);
      setPasswordInput('');
      // Also ensure user is logged in for Firebase rules (isAdmin check)
      if (!auth.currentUser) {
        const provider = new GoogleAuthProvider();
        signInWithPopup(auth, provider).then(() => {
          setIsAdminAuthenticated(true);
          setShowAdmin(true);
        }).catch(err => {
          console.error("Auth failed:", err);
          alert("يجب تسجيل الدخول بحساب المسؤول أولاً.");
        });
      } else {
        setIsAdminAuthenticated(true);
        setShowAdmin(true);
      }
    } else {
      alert("كلمة السر خاطئة!");
      setPasswordInput('');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0502] text-white font-sans selection:bg-orange-500/30 relative overflow-y-auto" dir="rtl">
      {/* Atmospheric Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] bg-orange-900/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] bg-amber-900/10 rounded-full blur-[120px]" />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-6 pt-12 pb-24 min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex justify-between items-center mb-12 glass-panel p-4 rounded-3xl">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-700 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-600/30 orange-glow">
              <GraduationCap className="text-white" size={28} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-glow">كلية التربية النوعية</h1>
              <p className="text-[10px] text-orange-500 font-bold uppercase tracking-[0.2em]">جامعة كفر الشيخ</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleAdminAuth}
              className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-xs font-semibold text-white/70 transition-all hover:scale-105 active:scale-95"
            >
              تحديث المساعد
            </button>
            <button className="p-2.5 hover:bg-white/5 rounded-2xl transition-all border border-transparent hover:border-white/10">
              <Globe size={20} className="text-white/60" />
            </button>
          </div>
        </header>

        {/* Quick Navigation Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-8 no-scrollbar scroll-smooth">
          <NavIcon 
            icon={<Home size={20} />} 
            label="الرئيسية" 
            onClick={clearTranscript}
          />
          <NavIcon 
            icon={<BookOpen size={20} />} 
            label="الأقسام" 
            onClick={() => handleQuickAction("كلمني عن الأقسام العلمية في الكلية")}
          />
          <NavIcon 
            icon={<GraduationCap size={20} />} 
            label="شؤون الطلاب" 
            onClick={() => handleQuickAction("إيه هي خدمات شؤون الطلاب؟")}
          />
          <NavIcon 
            icon={<Info size={20} />} 
            label="الدراسات العليا" 
            onClick={() => handleQuickAction("عايز أعرف عن الدراسات العليا")}
          />
          <NavIcon 
            icon={<Phone size={20} />} 
            label="اتصل بنا" 
            onClick={() => handleQuickAction("إزاي أقدر أتواصل مع الكلية؟")}
          />
          <NavIcon 
            icon={<Newspaper size={20} />} 
            label="الأخبار" 
            onClick={() => handleQuickAction("إيه آخر أخبار الكلية؟")}
          />
          <NavIcon 
            icon={<Users size={20} />} 
            label="عن الكلية" 
            onClick={() => handleQuickAction("كلمني عن تاريخ الكلية ورؤيتها")}
          />
        </div>

        {/* Hero / Visualizer Section */}
        <div className={`${isActive && transcript.length > 0 ? 'h-32' : 'flex-1'} flex flex-col items-center justify-center text-center transition-all duration-500`}>
          {/* Status & Search Indicator */}
          <div className="w-full max-w-xs flex items-center justify-between mb-6 px-4">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-white/20'}`} />
              <span className="text-[9px] uppercase tracking-widest font-bold text-white/30">
                {status === 'active' ? 'متصل' : 'غير متصل'}
              </span>
            </div>
            {isSearching && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 px-3 py-1 bg-orange-500/10 border border-orange-500/20 rounded-full"
              >
                <div className="w-2 h-2 border border-orange-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[9px] text-orange-500 font-bold uppercase tracking-widest">جاري البحث في قاعدة البيانات...</span>
              </motion.div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {!isActive ? (
              <motion.div
                key="welcome"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                className="space-y-8"
              >
                <div className="space-y-2">
                  <h2 className="text-6xl md:text-8xl font-black tracking-tighter leading-none text-glow">
                    أهلاً بك في <br />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-600 italic">المساعد الذكي</span>
                  </h2>
                </div>
                <p className="text-white/50 max-w-lg mx-auto text-xl font-medium leading-relaxed font-cairo">
                  تحدث معي مباشرة للحصول على معلومات حول الأقسام، شؤون الطلاب، والدراسات العليا بكلية التربية النوعية.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="active"
                initial={{ opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                className="relative"
              >
                {/* Visualizer Orb - Smaller when transcript is present */}
                <div className={`relative ${isActive && transcript.length > 0 ? 'w-40 h-40' : 'w-72 h-72 md:w-96 md:h-96'} transition-all duration-700 flex items-center justify-center`}>
                  <motion.div
                    animate={{
                      scale: isSpeaking ? [1, 1.2, 1] : [1, 1.05, 1],
                      opacity: isSpeaking ? [0.4, 0.8, 0.4] : [0.2, 0.5, 0.2],
                    }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 bg-gradient-to-br from-orange-500 to-orange-800 rounded-full blur-3xl orange-glow"
                  />
                  <div className="relative z-10 w-full h-full border border-white/10 rounded-full flex items-center justify-center glass-panel overflow-hidden">
                    {/* Animated particles inside orb */}
                    <div className="absolute inset-0 opacity-30 pointer-events-none">
                       {[...Array(5)].map((_, i) => (
                         <motion.div
                           key={i}
                           animate={{
                             x: [0, Math.random() * 100 - 50, 0],
                             y: [0, Math.random() * 100 - 50, 0],
                             scale: [1, 1.5, 1],
                           }}
                           transition={{ duration: 5 + i, repeat: Infinity }}
                           className="absolute w-20 h-20 bg-orange-500/20 rounded-full blur-xl"
                           style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
                         />
                       ))}
                    </div>
                    
                    <div className="flex gap-2 items-end h-1/2 relative z-20">
                      {[...Array(isActive && transcript.length > 0 ? 8 : 16)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{
                            height: isActive ? (isSpeaking ? [15, 60, 15] : [8, 25, 8]) : 8
                          }}
                          transition={{
                            duration: 0.5,
                            repeat: Infinity,
                            delay: i * 0.04,
                            ease: "easeInOut"
                          }}
                          className="w-2 bg-gradient-to-t from-orange-600 to-orange-300 rounded-full shadow-[0_0_10px_rgba(249,115,22,0.5)]"
                        />
                      ))}
                    </div>
                  </div>
                </div>
                
                {/* Status Label */}
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-8"
                >
                  <p className="text-orange-500 text-xs font-bold tracking-[0.3em] uppercase animate-pulse font-cairo">
                    {isSpeaking ? "المساعد يتحدث..." : "أنا أسمعك الآن..."}
                  </p>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Media Content Display */}
        <AnimatePresence>
          {mediaContent && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="mb-6 relative group"
            >
              <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
                {mediaContent.type === 'image' ? (
                  <img 
                    src={mediaContent.url} 
                    alt={mediaContent.title} 
                    className="w-full h-48 md:h-64 object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <video 
                    src={mediaContent.url} 
                    controls 
                    autoPlay
                    className="w-full h-48 md:h-64 object-cover"
                  />
                )}
                <div className="p-4 bg-gradient-to-t from-black/80 to-transparent absolute bottom-0 left-0 right-0">
                  <p className="text-sm font-medium text-white">{mediaContent.title}</p>
                </div>
                <button 
                  onClick={() => setMediaContent(null)}
                  className="absolute top-4 left-4 p-2 bg-black/50 hover:bg-black/80 rounded-full transition-colors"
                >
                  <MessageSquare size={16} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transcript Area */}
        <div className="flex-1 px-4 py-6 space-y-6 custom-scrollbar">
          <AnimatePresence initial={false}>
            {transcript.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20, scale: 0.9, filter: 'blur(5px)' }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] px-6 py-4 rounded-[2rem] text-base shadow-xl backdrop-blur-2xl border transition-all hover:scale-[1.02] ${
                  item.role === 'user' 
                    ? 'bg-orange-600/30 border-orange-500/40 text-orange-50 rounded-tr-none orange-glow' 
                    : 'bg-white/10 border-white/20 text-white/90 rounded-tl-none'
                }`}>
                  <p className="leading-relaxed font-cairo font-medium">{item.text}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={transcriptEndRef} />
        </div>

        {/* Controls */}
        <div className="mt-auto flex flex-col items-center gap-8">
          <button
            onClick={toggleSession}
            disabled={status === 'connecting'}
            className={`group relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 ${
              isActive 
                ? 'bg-white text-black scale-110 shadow-[0_0_50px_rgba(255,255,255,0.3)]' 
                : 'bg-orange-600 text-white hover:scale-105 shadow-[0_0_30px_rgba(234,88,12,0.3)]'
            } disabled:opacity-50`}
          >
            {status === 'connecting' ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="w-8 h-8 border-2 border-current border-t-transparent rounded-full"
              />
            ) : isActive ? (
              <MicOff size={32} />
            ) : (
              <Mic size={32} />
            )}
            
            {/* Pulsing ring when active */}
            {isActive && (
              <motion.div
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute inset-0 rounded-full border-2 border-white"
              />
            )}
          </button>

          <div className="w-full space-y-4">
            <div className="flex items-center gap-3 px-2">
              <Sparkles size={14} className="text-orange-500" />
              <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest font-cairo">اقتراحات سريعة</span>
              <div className="flex-1 h-px bg-white/5" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
              <QuickAction 
                icon={<BookOpen size={18} />} 
                label="الأقسام" 
                onClick={() => handleQuickAction("كلمني عن الأقسام العلمية في الكلية")}
              />
              <QuickAction 
                icon={<GraduationCap size={18} />} 
                label="شؤون الطلاب" 
                onClick={() => handleQuickAction("إيه هي خدمات شؤون الطلاب؟")}
              />
              <QuickAction 
                icon={<Info size={18} />} 
                label="الدراسات العليا" 
                onClick={() => handleQuickAction("عايز أعرف عن الدراسات العليا")}
              />
              <QuickAction 
                icon={<Phone size={18} />} 
                label="اتصل بنا" 
                onClick={() => handleQuickAction("إزاي أقدر أتواصل مع الكلية؟")}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Password Modal */}
      <AnimatePresence>
        {showPasswordModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/90 backdrop-blur-2xl"
          >
            <motion.div
              initial={{ scale: 0.9, y: 30, filter: 'blur(10px)' }}
              animate={{ scale: 1, y: 0, filter: 'blur(0px)' }}
              className="bg-[#151619]/80 border border-white/10 p-10 rounded-[3rem] shadow-2xl w-full max-w-sm text-center space-y-8 glass-panel orange-glow"
            >
              <div className="w-20 h-20 bg-orange-600/20 rounded-[2rem] flex items-center justify-center mx-auto border border-orange-500/30">
                <Info className="text-orange-500" size={40} />
              </div>
              <div className="space-y-3">
                <h3 className="text-2xl font-black text-glow">منطقة المسؤولين</h3>
                <p className="text-sm text-white/40 font-medium font-cairo">من فضلك أدخل كلمة السر للمتابعة</p>
              </div>
              <input 
                type="password"
                autoFocus
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && verifyPassword()}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-center text-2xl tracking-[0.5em] focus:border-orange-600 outline-none transition-all focus:bg-white/10"
              />
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowPasswordModal(false)}
                  className="flex-1 py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-sm font-bold transition-all border border-white/5"
                >
                  إلغاء
                </button>
                <button 
                  onClick={verifyPassword}
                  className="flex-1 py-4 bg-orange-600 hover:bg-orange-700 rounded-2xl text-sm font-bold transition-all shadow-lg shadow-orange-600/20"
                >
                  دخول
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Panel Modal */}
      <AnimatePresence>
        {showAdmin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.9, y: 30, filter: 'blur(10px)' }}
              animate={{ scale: 1, y: 0, filter: 'blur(0px)' }}
              className="bg-[#151619]/90 border border-white/10 w-full max-w-3xl rounded-[3rem] overflow-hidden shadow-2xl flex flex-col max-h-[90vh] glass-panel"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/5">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-orange-600 rounded-2xl flex items-center justify-center">
                    <GraduationCap size={20} />
                  </div>
                  <h3 className="text-2xl font-black text-glow">تحديث بيانات المساعد</h3>
                </div>
                <button 
                  onClick={() => setShowAdmin(false)}
                  className="p-3 hover:bg-white/10 rounded-2xl transition-all border border-white/5"
                >
                  <MicOff size={20} />
                </button>
              </div>

              <div className="flex p-2 bg-white/5 mx-8 mt-6 rounded-2xl border border-white/5">
                <button 
                  onClick={() => setAdminTab('media')}
                  className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all font-cairo ${adminTab === 'media' ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20' : 'text-white/40 hover:text-white/60'}`}
                >
                  الوسائط
                </button>
                <button 
                  onClick={() => setAdminTab('info')}
                  className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all font-cairo ${adminTab === 'info' ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20' : 'text-white/40 hover:text-white/60'}`}
                >
                  المعلومات
                </button>
                <button 
                  onClick={() => setAdminTab('files')}
                  className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all font-cairo ${adminTab === 'files' ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20' : 'text-white/40 hover:text-white/60'}`}
                >
                  الملفات
                </button>
              </div>

              <div className="p-8 overflow-y-auto custom-scrollbar flex-1">
                {adminTab === 'media' ? (
                  <div className="space-y-12">
                    <section>
                      <h4 className="text-sm font-bold text-white/20 uppercase tracking-widest mb-6">
                        {editingMedia ? "تعديل الوسائط" : "إضافة وسائط جديدة"}
                      </h4>
                      <MediaForm 
                        editingItem={editingMedia} 
                        onCancel={() => setEditingMedia(null)}
                        onComplete={() => {
                          setRefreshKey(prev => prev + 1);
                          setEditingMedia(null);
                        }} 
                      />
                    </section>
                    <section>
                      <div className="flex justify-between items-center mb-6">
                        <h4 className="text-sm font-bold text-white/20 uppercase tracking-widest">قائمة الوسائط الحالية</h4>
                        <button onClick={() => setRefreshKey(prev => prev + 1)} className="text-[10px] text-orange-500 hover:underline">تحديث القائمة</button>
                      </div>
                      <MediaList refreshKey={refreshKey} onEdit={setEditingMedia} />
                    </section>
                  </div>
                ) : adminTab === 'info' ? (
                  <div className="space-y-12">
                    <section>
                      <h4 className="text-sm font-bold text-white/20 uppercase tracking-widest mb-6">
                        {editingInfo ? "تعديل المعلومات" : "إضافة معلومات جديدة"}
                      </h4>
                      <InfoForm 
                        editingItem={editingInfo}
                        onCancel={() => setEditingInfo(null)}
                        onComplete={() => {
                          setRefreshKey(prev => prev + 1);
                          setEditingInfo(null);
                        }} 
                      />
                    </section>
                    <section>
                      <div className="flex justify-between items-center mb-6">
                        <h4 className="text-sm font-bold text-white/20 uppercase tracking-widest">قائمة المعلومات الحالية</h4>
                        <button onClick={() => setRefreshKey(prev => prev + 1)} className="text-[10px] text-orange-500 hover:underline">تحديث القائمة</button>
                      </div>
                      <InfoList refreshKey={refreshKey} onEdit={setEditingInfo} />
                    </section>
                  </div>
                ) : (
                  <div className="space-y-12">
                    <section>
                      <h4 className="text-sm font-bold text-white/20 uppercase tracking-widest mb-6">معالجة الملفات الذكية (PDF/Word)</h4>
                      <FileProcessor onComplete={() => setRefreshKey(prev => prev + 1)} />
                    </section>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavIcon({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-3 min-w-[90px] hover:bg-white/5 rounded-2xl transition-all group border border-transparent hover:border-white/10"
    >
      <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-white/40 group-hover:bg-orange-500/20 group-hover:text-orange-500 transition-all duration-300">
        {icon}
      </div>
      <span className="text-[10px] font-bold text-white/30 group-hover:text-white/80 transition-colors font-cairo text-center whitespace-nowrap">{label}</span>
    </button>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center gap-3 p-5 glass-panel rounded-[2rem] transition-all group hover:bg-white/10 hover:scale-105 active:scale-95 hover:border-orange-500/50"
    >
      <div className="text-orange-500 group-hover:scale-125 transition-transform duration-300 group-hover:text-orange-400">{icon}</div>
      <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/40 group-hover:text-white/80 transition-colors font-cairo">{label}</span>
    </button>
  );
}

function MediaList({ refreshKey, onEdit }: { refreshKey: number, onEdit: (item: any) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    getAllMedia().then(setItems);
  }, [refreshKey]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteMedia(id);
      setItems(items.filter(i => i.id !== id));
    } catch (error) {
      console.error(error);
      alert("فشل الحذف. تأكد من الصلاحيات.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {items.map(item => (
        <div key={item.id} className="p-5 bg-white/5 border border-white/10 rounded-[2rem] flex justify-between items-center gap-4 hover:bg-white/10 transition-all group">
          <div className="flex items-center gap-4 overflow-hidden">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex-shrink-0 flex items-center justify-center overflow-hidden border border-white/10 group-hover:border-orange-500/30 transition-all">
              {item.type === 'image' ? <img src={item.url} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="text-[10px] font-bold text-orange-500">VIDEO</div>}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate text-white/90">{item.title}</p>
              <p className="text-[10px] text-orange-500 font-bold truncate uppercase tracking-widest">{item.queryKey}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => onEdit(item)}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-xl transition-all text-xs font-bold font-cairo"
            >
              تعديل
            </button>
            <button 
              onClick={() => handleDelete(item.id)}
              disabled={deletingId === item.id}
              className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl transition-all text-xs font-bold font-cairo disabled:opacity-50"
            >
              {deletingId === item.id ? "..." : "حذف"}
            </button>
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-center text-white/20 py-12 italic font-cairo">لا توجد وسائط مضافة بعد.</p>}
    </div>
  );
}

function InfoList({ refreshKey, onEdit }: { refreshKey: number, onEdit: (item: any) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    getAllCollegeInfo().then(setItems);
  }, [refreshKey]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteCollegeInfo(id);
      setItems(items.filter(i => i.id !== id));
    } catch (error) {
      console.error(error);
      alert("فشل الحذف.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {items.map(item => (
        <div key={item.id} className="p-5 bg-white/5 border border-white/10 rounded-[2rem] flex flex-col gap-3 hover:bg-white/10 transition-all group">
          <div className="flex justify-between items-center gap-4">
            <h5 className="text-orange-500 font-bold text-sm uppercase tracking-widest font-cairo">{item.category}</h5>
            <div className="flex gap-2">
              <button 
                onClick={() => onEdit(item)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-xl transition-all text-xs font-bold font-cairo"
              >
                تعديل
              </button>
              <button 
                onClick={() => handleDelete(item.id)}
                disabled={deletingId === item.id}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl transition-all text-xs font-bold font-cairo disabled:opacity-50"
              >
                {deletingId === item.id ? "..." : "حذف"}
              </button>
            </div>
          </div>
          <p className="text-xs text-white/60 leading-relaxed line-clamp-3 font-cairo">{item.content}</p>
        </div>
      ))}
      {items.length === 0 && <p className="text-center text-white/20 py-12 italic font-cairo">لا توجد معلومات مضافة بعد.</p>}
    </div>
  );
}

function FileProcessor({ onComplete }: { onComplete: () => void }) {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    
    for (const file of files) {
      try {
        setProgress(`جاري معالجة: ${file.name}...`);
        let text = '';

        if (file.type === 'application/pdf') {
          text = await extractTextFromPDF(file);
        } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          text = await extractTextFromDocx(file);
        } else if (file.type === 'text/plain') {
          text = await file.text();
        }

        if (text.trim()) {
          const category = file.name.split('.')[0];
          
          // Delete existing chunks for this category to avoid duplicates
          await deleteCollegeInfoByCategory(category);
          
          const CHUNK_SIZE = 50000; // 50k characters per doc is safe and manageable
          const chunks: string[] = [];
          for (let i = 0; i < text.length; i += CHUNK_SIZE) {
            chunks.push(text.slice(i, i + CHUNK_SIZE));
          }

          for (let i = 0; i < chunks.length; i++) {
            await addCollegeInfo({
              category: category,
              content: chunks[i],
              chunkIndex: i,
              totalChunks: chunks.length
            });
          }
          setProgress(`تم حفظ: ${file.name} بنجاح (${chunks.length} أجزاء)!`);
        }
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        setProgress(`خطأ في معالجة: ${file.name}`);
      }
    }

    setProcessing(false);
    setProgress('اكتملت جميع العمليات!');
    setFiles([]);
    onComplete();
  };

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    return fullText;
  };

  const extractTextFromDocx = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  return (
    <div className="p-8 bg-white/5 rounded-[2rem] border border-white/10 space-y-6">
      <div className="flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-[2rem] p-12 hover:border-orange-500/50 transition-all bg-white/5 group relative overflow-hidden">
        <Upload className="text-orange-500 mb-4 group-hover:scale-110 transition-transform" size={48} />
        <p className="text-sm font-bold text-white/60 mb-2 font-cairo">اسحب الملفات هنا أو اضغط للاختيار</p>
        <p className="text-[10px] text-white/20 uppercase tracking-widest">PDF, DOCX, TXT</p>
        <input 
          type="file" 
          multiple 
          accept=".pdf,.docx,.txt"
          onChange={handleFileChange}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-3">
          <h5 className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-cairo">الملفات المختارة ({files.length})</h5>
          <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                <FileText size={16} className="text-orange-500" />
                <span className="text-xs text-white/80 truncate flex-1">{f.name}</span>
                <span className="text-[10px] text-white/20">{(f.size / 1024).toFixed(1)} KB</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {progress && (
        <div className="p-4 bg-orange-600/10 border border-orange-500/20 rounded-2xl">
          <p className="text-xs text-orange-500 font-bold text-center font-cairo">{progress}</p>
        </div>
      )}

      <button 
        onClick={processFiles}
        disabled={processing || files.length === 0}
        className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-orange-600/20 disabled:opacity-50 font-cairo flex items-center justify-center gap-3"
      >
        {processing ? (
          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : <Sparkles size={18} />}
        {processing ? "جاري المعالجة..." : "بدء المعالجة الذكية"}
      </button>
    </div>
  );
}

function MediaForm({ onComplete, editingItem, onCancel }: { onComplete: () => void, editingItem?: any, onCancel?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    queryKey: '',
    type: 'image' as 'image' | 'video',
    url: '',
    title: '',
    description: ''
  });

  useEffect(() => {
    if (editingItem) {
      setFormData({
        queryKey: editingItem.queryKey || '',
        type: editingItem.type || 'image',
        url: editingItem.url || '',
        title: editingItem.title || '',
        description: editingItem.description || ''
      });
    } else {
      setFormData({
        queryKey: '',
        type: 'image',
        url: '',
        title: '',
        description: ''
      });
    }
  }, [editingItem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingItem) {
        await updateMedia(editingItem.id, formData);
        alert("تم تحديث البيانات بنجاح!");
      } else {
        await addMedia(formData);
        alert("تمت إضافة الوسائط بنجاح!");
      }
      onComplete();
    } catch (error) {
      console.error(error);
      alert("فشل في حفظ البيانات.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 p-8 bg-white/5 rounded-[2rem] border border-white/10">
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-cairo">الكلمة المفتاحية (Query Key)</label>
        <input 
          required
          value={formData.queryKey}
          onChange={e => setFormData({...formData, queryKey: e.target.value})}
          placeholder="مثلاً: تكنولوجيا التعليم"
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-all"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-cairo">النوع</label>
          <select 
            value={formData.type}
            onChange={e => setFormData({...formData, type: e.target.value as 'image' | 'video'})}
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-all appearance-none"
          >
            <option value="image" className="bg-[#151619]">صورة</option>
            <option value="video" className="bg-[#151619]">فيديو</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-cairo">العنوان</label>
          <input 
            required
            value={formData.title}
            onChange={e => setFormData({...formData, title: e.target.value})}
            placeholder="عنوان توضيحي"
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-all"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-cairo">رابط الوسائط (URL)</label>
        <input 
          required
          type="url"
          value={formData.url}
          onChange={e => setFormData({...formData, url: e.target.value})}
          placeholder="https://..."
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-all"
        />
      </div>
      <div className="flex gap-4 pt-4">
        {editingItem && (
          <button 
            type="button"
            onClick={onCancel}
            className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl transition-all border border-white/5 font-cairo"
          >
            إلغاء التعديل
          </button>
        )}
        <button 
          type="submit"
          disabled={loading}
          className="flex-[2] py-4 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-orange-600/20 disabled:opacity-50 font-cairo"
        >
          {loading ? "جاري الحفظ..." : (editingItem ? "تحديث البيانات" : "حفظ البيانات")}
        </button>
      </div>
    </form>
  );
}

function InfoForm({ onComplete, editingItem, onCancel }: { onComplete: () => void, editingItem?: any, onCancel?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    category: '',
    content: ''
  });

  useEffect(() => {
    if (editingItem) {
      setFormData({
        category: editingItem.category || '',
        content: editingItem.content || ''
      });
    } else {
      setFormData({
        category: '',
        content: ''
      });
    }
  }, [editingItem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingItem) {
        await updateCollegeInfo(editingItem.id, formData);
        alert("تم تحديث المعلومات بنجاح!");
      } else {
        await addCollegeInfo(formData);
        alert("تمت إضافة المعلومات بنجاح!");
      }
      onComplete();
    } catch (error) {
      console.error(error);
      alert("فشل في حفظ البيانات.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 p-8 bg-white/5 rounded-[2rem] border border-white/10">
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-cairo">الفئة (Category)</label>
        <input 
          required
          value={formData.category}
          onChange={e => setFormData({...formData, category: e.target.value})}
          placeholder="مثلاً: شؤون الطلاب"
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-all"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest font-cairo">المحتوى النصي</label>
        <textarea 
          required
          rows={6}
          value={formData.content}
          onChange={e => setFormData({...formData, content: e.target.value})}
          placeholder="اكتب المعلومات هنا..."
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-all resize-none"
        />
      </div>
      <div className="flex gap-4 pt-4">
        {editingItem && (
          <button 
            type="button"
            onClick={onCancel}
            className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl transition-all border border-white/5 font-cairo"
          >
            إلغاء التعديل
          </button>
        )}
        <button 
          type="submit"
          disabled={loading}
          className="flex-[2] py-4 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-orange-600/20 disabled:opacity-50 font-cairo"
        >
          {loading ? "جاري الحفظ..." : (editingItem ? "تحديث المعلومات" : "حفظ البيانات")}
        </button>
      </div>
    </form>
  );
}

