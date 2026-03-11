import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Mic, MicOff, MessageSquare, Info, Phone, MapPin, GraduationCap, BookOpen, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AudioHandler } from './utils/audio';
import { SYSTEM_INSTRUCTION, MODEL_NAME, GET_MEDIA_CONTENT_TOOL, GET_COLLEGE_INFO_TOOL } from './constants';
import { getMediaByQuery, addMedia, addCollegeInfo, auth, getCollegeInfoByCategory, getAllMedia, getAllCollegeInfo, updateMedia, deleteMedia, updateCollegeInfo, deleteCollegeInfo } from './firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';

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
  const [adminTab, setAdminTab] = useState<'media' | 'info'>('media');
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

  const startSession = async () => {
    try {
      setErrorMessage(null);
      setStatus('connecting');
      console.log("Starting session...");

      // Initialize AudioHandler
      audioHandlerRef.current = new AudioHandler((base64Data) => {
        if (sessionRef.current) {
          sessionRef.current.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
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
              setIsSearching(true);
              for (const call of toolCalls) {
                if (call.name === "get_media_content") {
                  const queryStr = (call.args as any).query;
                  console.log("Tool Call: get_media_content for", queryStr);
                  
                  // Fetch from Firestore
                  getMediaByQuery(queryStr).then((data) => {
                    let resultMsg = "لم يتم العثور على وسائط لهذا البحث في قاعدة البيانات.";
                    if (data) {
                      setMediaContent({
                        type: data.type as 'image' | 'video',
                        url: data.url,
                        title: data.title
                      });
                      resultMsg = `تم العثور على ${data.type === 'image' ? 'صورة' : 'فيديو'} بعنوان "${data.title}" وعرضه للمستخدم بنجاح.`;
                    }
                    
                    // Send response back to model
                    sessionRef.current?.sendToolResponse({
                      functionResponses: [{
                        name: "get_media_content",
                        id: call.id,
                        response: { result: resultMsg }
                      }]
                    });
                    setIsSearching(false);
                  });
                } else if (call.name === "get_college_info") {
                  const category = (call.args as any).category;
                  console.log("Tool Call: get_college_info for", category);

                  getCollegeInfoByCategory(category).then((data) => {
                    let resultMsg = "لم يتم العثور على معلومات نصية لهذه الفئة في قاعدة البيانات.";
                    if (data) {
                      resultMsg = `المعلومات الأكيدة من قاعدة البيانات لـ ${category} هي: ${data.content}`;
                    }

                    sessionRef.current?.sendToolResponse({
                      functionResponses: [{
                        name: "get_college_info",
                        id: call.id,
                        response: { result: resultMsg }
                      }]
                    });
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
              if (window.aistudio) {
                window.aistudio.openSelectKey();
              }
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
    <div className="min-h-screen bg-[#0a0502] text-white font-sans selection:bg-orange-500/30 overflow-hidden relative" dir="rtl">
      {/* Atmospheric Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] bg-orange-900/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] bg-amber-900/10 rounded-full blur-[120px]" />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-6 pt-12 pb-24 h-screen flex flex-col">
        {/* Header */}
        <header className="flex justify-between items-center mb-12">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-600/20">
              <GraduationCap className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">كلية التربية النوعية</h1>
              <p className="text-xs text-orange-500/80 font-medium uppercase tracking-widest">جامعة كفر الشيخ</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleAdminAuth}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-medium text-white/60 transition-all"
            >
              تحديث المساعد
            </button>
            <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <Globe size={20} className="text-white/60" />
            </button>
          </div>
        </header>

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
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-6"
              >
                <h2 className="text-5xl md:text-7xl font-light tracking-tighter leading-tight">
                  أهلاً بك في <br />
                  <span className="text-orange-500 italic">المساعد الذكي</span>
                </h2>
                <p className="text-white/40 max-w-md mx-auto text-lg font-light leading-relaxed">
                  تحدث معي مباشرة للحصول على معلومات حول الأقسام، شؤون الطلاب، والدراسات العليا بكلية التربية النوعية.
                </p>
                {errorMessage && (
                  <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-red-400 text-sm bg-red-400/10 px-4 py-2 rounded-lg inline-block"
                  >
                    {errorMessage}
                  </motion.p>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="active"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative"
              >
                {/* Visualizer Orb - Smaller when transcript is present */}
                <div className={`relative ${isActive && transcript.length > 0 ? 'w-32 h-32' : 'w-64 h-64 md:w-80 md:h-80'} transition-all duration-500 flex items-center justify-center`}>
                  <motion.div
                    animate={{
                      scale: isSpeaking ? [1, 1.15, 1] : [1, 1.05, 1],
                      opacity: isSpeaking ? [0.4, 0.7, 0.4] : [0.2, 0.4, 0.2],
                    }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="absolute inset-0 bg-orange-600 rounded-full blur-2xl"
                  />
                  <div className="relative z-10 w-full h-full border border-white/10 rounded-full flex items-center justify-center backdrop-blur-sm bg-white/5">
                    <div className="flex gap-1 items-end h-1/2">
                      {[...Array(isActive && transcript.length > 0 ? 6 : 12)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{
                            height: isActive ? (isSpeaking ? [10, 40, 10] : [5, 15, 5]) : 5
                          }}
                          transition={{
                            duration: 0.4,
                            repeat: Infinity,
                            delay: i * 0.05
                          }}
                          className="w-1.5 bg-gradient-to-t from-orange-600 to-orange-400 rounded-full"
                        />
                      ))}
                    </div>
                  </div>
                </div>
                
                {/* Status Label - Only show when no transcript or if speaking */}
                {(!transcript.length || isSpeaking) && (
                  <div className="mt-4">
                    <p className="text-orange-500 text-xs font-mono tracking-widest uppercase animate-pulse">
                      {isSpeaking ? "المساعد يتحدث..." : "أنا أسمعك الآن..."}
                    </p>
                  </div>
                )}
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
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar" style={{ maxHeight: '40vh' }}>
          <AnimatePresence initial={false}>
            {transcript.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm shadow-sm backdrop-blur-md border ${
                  item.role === 'user' 
                    ? 'bg-orange-600/20 border-orange-600/30 text-orange-50' 
                    : 'bg-white/5 border-white/10 text-white/80'
                }`}>
                  <p className="leading-relaxed">{item.text}</p>
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
      </main>

      {/* Password Modal */}
      <AnimatePresence>
        {showPasswordModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-[#151619] border border-white/10 p-8 rounded-3xl shadow-2xl w-full max-w-sm text-center space-y-6"
            >
              <div className="w-16 h-16 bg-orange-600/20 rounded-2xl flex items-center justify-center mx-auto">
                <Info className="text-orange-500" size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">منطقة المسؤولين</h3>
                <p className="text-sm text-white/40">من فضلك أدخل كلمة السر للمتابعة</p>
              </div>
              <input 
                type="password"
                autoFocus
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && verifyPassword()}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center text-lg tracking-[0.5em] focus:border-orange-600 outline-none transition-colors"
              />
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowPasswordModal(false)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-medium transition-colors"
                >
                  إلغاء
                </button>
                <button 
                  onClick={verifyPassword}
                  className="flex-1 py-3 bg-orange-600 hover:bg-orange-700 rounded-xl text-sm font-medium transition-colors"
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
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-[#151619] border border-white/10 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-bottom border-white/5 flex justify-between items-center bg-white/5">
                <h3 className="text-xl font-semibold">تحديث بيانات المساعد</h3>
                <button 
                  onClick={() => setShowAdmin(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <MicOff size={20} />
                </button>
              </div>

              <div className="flex border-b border-white/5">
                <button 
                  onClick={() => setAdminTab('media')}
                  className={`flex-1 py-4 text-sm font-medium transition-colors ${adminTab === 'media' ? 'bg-orange-600/20 text-orange-500 border-b-2 border-orange-600' : 'text-white/40 hover:text-white/60'}`}
                >
                  الوسائط
                </button>
                <button 
                  onClick={() => setAdminTab('info')}
                  className={`flex-1 py-4 text-sm font-medium transition-colors ${adminTab === 'info' ? 'bg-orange-600/20 text-orange-500 border-b-2 border-orange-600' : 'text-white/40 hover:text-white/60'}`}
                >
                  المعلومات
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
                ) : (
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
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all group"
    >
      <div className="text-orange-500 group-hover:scale-110 transition-transform">{icon}</div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 group-hover:text-white/80 transition-colors">{label}</span>
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
        <div key={item.id} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex justify-between items-center gap-4">
          <div className="flex items-center gap-4 overflow-hidden">
            <div className="w-12 h-12 rounded-lg bg-white/10 flex-shrink-0 flex items-center justify-center overflow-hidden">
              {item.type === 'image' ? <img src={item.url} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="text-[10px]">VIDEO</div>}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium truncate">{item.title}</p>
              <p className="text-[10px] text-white/40 truncate">{item.queryKey}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => onEdit(item)}
              className="p-2 hover:bg-white/10 text-white/60 rounded-lg transition-colors text-xs"
            >
              تعديل
            </button>
            <button 
              onClick={() => handleDelete(item.id)}
              disabled={deletingId === item.id}
              className="p-2 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors text-xs disabled:opacity-50"
            >
              {deletingId === item.id ? "..." : "حذف"}
            </button>
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-center text-white/20 py-8 italic">لا توجد وسائط مضافة بعد.</p>}
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
        <div key={item.id} className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-3">
          <div className="flex justify-between items-start gap-4">
            <h5 className="text-orange-500 font-bold text-sm">{item.category}</h5>
            <div className="flex gap-3">
              <button 
                onClick={() => onEdit(item)}
                className="text-[10px] text-white/40 hover:text-white hover:underline"
              >
                تعديل
              </button>
              <button 
                onClick={() => handleDelete(item.id)}
                disabled={deletingId === item.id}
                className="text-[10px] text-red-500 hover:underline disabled:opacity-50"
              >
                {deletingId === item.id ? "جاري الحذف..." : "حذف"}
              </button>
            </div>
          </div>
          <p className="text-xs text-white/60 leading-relaxed line-clamp-3">{item.content}</p>
        </div>
      ))}
      {items.length === 0 && <p className="text-center text-white/20 py-8 italic">لا توجد معلومات مضافة بعد.</p>}
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs text-white/40 uppercase tracking-wider">الكلمة المفتاحية (Query Key)</label>
        <input 
          required
          value={formData.queryKey}
          onChange={e => setFormData({...formData, queryKey: e.target.value})}
          placeholder="مثلاً: تكنولوجيا التعليم"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-colors"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs text-white/40 uppercase tracking-wider">النوع</label>
          <select 
            value={formData.type}
            onChange={e => setFormData({...formData, type: e.target.value as 'image' | 'video'})}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-colors"
          >
            <option value="image">صورة</option>
            <option value="video">فيديو</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-white/40 uppercase tracking-wider">العنوان</label>
          <input 
            required
            value={formData.title}
            onChange={e => setFormData({...formData, title: e.target.value})}
            placeholder="عنوان توضيحي"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-colors"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-white/40 uppercase tracking-wider">رابط الوسائط (URL)</label>
        <input 
          required
          type="url"
          value={formData.url}
          onChange={e => setFormData({...formData, url: e.target.value})}
          placeholder="https://..."
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-colors"
        />
      </div>
      <div className="flex gap-3">
        {editingItem && (
          <button 
            type="button"
            onClick={onCancel}
            className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl transition-all"
          >
            إلغاء التعديل
          </button>
        )}
        <button 
          type="submit"
          disabled={loading}
          className="flex-[2] py-4 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-orange-600/20 disabled:opacity-50"
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs text-white/40 uppercase tracking-wider">الفئة (Category)</label>
        <input 
          required
          value={formData.category}
          onChange={e => setFormData({...formData, category: e.target.value})}
          placeholder="مثلاً: شؤون الطلاب"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-colors"
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs text-white/40 uppercase tracking-wider">المحتوى النصي</label>
        <textarea 
          required
          rows={6}
          value={formData.content}
          onChange={e => setFormData({...formData, content: e.target.value})}
          placeholder="اكتب المعلومات هنا..."
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-orange-600 outline-none transition-colors resize-none"
        />
      </div>
      <div className="flex gap-3">
        {editingItem && (
          <button 
            type="button"
            onClick={onCancel}
            className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl transition-all"
          >
            إلغاء التعديل
          </button>
        )}
        <button 
          type="submit"
          disabled={loading}
          className="flex-[2] py-4 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-orange-600/20 disabled:opacity-50"
        >
          {loading ? "جاري الحفظ..." : (editingItem ? "تحديث المعلومات" : "حفظ البيانات")}
        </button>
      </div>
    </form>
  );
}

