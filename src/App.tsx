import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Mic, MicOff, MessageSquare, Info, Phone, MapPin, GraduationCap, BookOpen, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AudioHandler } from './utils/audio';
import { SYSTEM_INSTRUCTION, MODEL_NAME, GET_MEDIA_CONTENT_TOOL } from './constants';

interface MediaItem {
  type: 'image' | 'video';
  url: string;
  title: string;
}

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle');
  const [transcript, setTranscript] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mediaContent, setMediaContent] = useState<MediaItem | null>(null);
  
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
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      audioHandlerRef.current = new AudioHandler((base64Data) => {
        if (sessionRef.current) {
          sessionRef.current.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }
      });
      // في ملف App.tsx تأكد من هذا التنسيق
const tools = [
  {
    functionDeclarations: [GET_MEDIA_CONTENT_TOOL],
  },
];


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
          tools: [{ urlContext: {} }, { functionDeclarations: [GET_MEDIA_CONTENT_TOOL] }] as any,
        },
        callbacks: {
          onopen: () => {
            setStatus('active');
            setIsActive(true);
            audioHandlerRef.current?.startCapture();
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
            // ابحث عن هذا الجزء داخل دالة onmessage
const toolCalls = message.toolCall?.functionCalls;

if (toolCalls && toolCalls.length > 0) {
  toolCalls.forEach((call: any) => {
    if (call.name === "get_media_content") {
      const query = (call.args as any).query;
console.log("جاري الجلب عبر Vercel Proxy لـ:", query);

// داخل handleToolCall في ملف App.tsx
fetch(`/api/proxy?q=${encodeURIComponent(query)}`)
  .then((response) => response.json())
  .then((data) => {
    if (data && data.url) {
      setMediaContent({
        type: data.type,
        url: data.url,
        title: data.title
      });
      // إرسال الرد لـ Gemini ليؤكد العملية صوتياً
      sessionRef.current?.sendToolResponse({
        functionResponses: [{
          name: "get_media_content",
          id: call.id,
          response: { result: "تم عرض الصورة بنجاح." }
        }]
      });
    }
  })
  .catch((error) => console.error("Proxy Error:", error));



            
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
          }
          onerror: (error) => {
            console.error("Live API Error:", error);
            setStatus('error');
            setErrorMessage("حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.");
            stopSession();
          },
          onclose: () => {
            setStatus('idle');
            stopSession();
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (error) {
      console.error("Failed to start session:", error);
      setStatus('error');
      setErrorMessage("تعذر بدء الجلسة. تأكد من إعدادات الميكروفون والمفتاح البرمجي.");
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

  const toggleSession = () => {
    if (isActive) {
      stopSession();
    } else {
      startSession();
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
            <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <Globe size={20} className="text-white/60" />
            </button>
          </div>
        </header>

        {/* Hero / Visualizer Section */}
        <div className={`${isActive && transcript.length > 0 ? 'h-32' : 'flex-1'} flex flex-col items-center justify-center text-center transition-all duration-500`}>
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

      {/* Footer Info */}
      <footer className="absolute bottom-6 left-0 right-0 text-center pointer-events-none">
        <p className="text-[10px] text-white/20 uppercase tracking-[0.3em]">
          Powered by Gemini 2.5 Live API • Kafrelsheikh University
        </p>
      </footer>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl transition-all group active:scale-95"
    >
      <span className="text-orange-500 group-hover:scale-110 transition-transform">{icon}</span>
      <span className="text-xs font-medium text-white/60 group-hover:text-white transition-colors">{label}</span>
    </button>
  );
}
