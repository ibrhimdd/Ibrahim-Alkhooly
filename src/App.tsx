import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Mic, MicOff, MessageSquare, Info, Phone, MapPin, GraduationCap, BookOpen, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AudioHandler } from './utils/audio';
import { SYSTEM_INSTRUCTION, MODEL_NAME } from './constants';

export default function App() {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle');
  const [transcript, setTranscript] = useState<string[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const audioHandlerRef = useRef<AudioHandler | null>(null);
  const sessionRef = useRef<any>(null);

  const startSession = async () => {
    try {
      setStatus('connecting');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      audioHandlerRef.current = new AudioHandler((base64Data) => {
        if (sessionRef.current) {
          sessionRef.current.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }
      });

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

            // Handle transcriptions
            const userTranscript = message.serverContent?.modelTurn?.parts?.[0]?.text;
            if (userTranscript) {
              setTranscript(prev => [...prev.slice(-4), `أنت: ${userTranscript}`]);
            }
          },
          onerror: (error) => {
            console.error("Live API Error:", error);
            setStatus('error');
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

  return (
    <div className="min-h-screen bg-[#0a0502] text-white font-sans selection:bg-orange-500/30 overflow-hidden relative">
      {/* Atmospheric Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-orange-900/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-amber-900/10 rounded-full blur-[120px]" />
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

        {/* Hero Section */}
        <div className="flex-1 flex flex-col items-center justify-center text-center">
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
              </motion.div>
            ) : (
              <motion.div
                key="active"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative"
              >
                {/* Visualizer Orb */}
                <div className="relative w-64 h-64 md:w-80 md:h-80 flex items-center justify-center">
                  <motion.div
                    animate={{
                      scale: isSpeaking ? [1, 1.1, 1] : [1, 1.05, 1],
                      opacity: isSpeaking ? [0.3, 0.6, 0.3] : [0.2, 0.4, 0.2],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute inset-0 bg-orange-600 rounded-full blur-3xl"
                  />
                  <div className="relative z-10 w-full h-full border border-white/10 rounded-full flex items-center justify-center backdrop-blur-sm bg-white/5">
                    <div className="flex gap-1 items-end h-12">
                      {[...Array(8)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{
                            height: isActive ? (isSpeaking ? [10, 40, 10] : [10, 20, 10]) : 10
                          }}
                          transition={{
                            duration: 0.5,
                            repeat: Infinity,
                            delay: i * 0.1
                          }}
                          className="w-1.5 bg-orange-500 rounded-full"
                        />
                      ))}
                    </div>
                  </div>
                </div>
                
                {/* Status Label */}
                <div className="mt-8">
                  <p className="text-orange-500 text-sm font-mono tracking-widest uppercase">
                    {isSpeaking ? "المساعد يتحدث..." : "أنا أسمعك الآن..."}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Transcript Overlay */}
        {isActive && transcript.length > 0 && (
          <div className="absolute bottom-32 left-0 right-0 px-6 pointer-events-none">
            <div className="max-w-md mx-auto space-y-2">
              {transcript.map((text, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white/5 backdrop-blur-md border border-white/10 px-4 py-2 rounded-2xl text-sm text-white/60 inline-block"
                >
                  {text}
                </motion.div>
              ))}
            </div>
          </div>
        )}

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
            {isActive ? <MicOff size={32} /> : <Mic size={32} />}
            
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
            <QuickAction icon={<BookOpen size={18} />} label="الأقسام" />
            <QuickAction icon={<GraduationCap size={18} />} label="شؤون الطلاب" />
            <QuickAction icon={<Info size={18} />} label="الدراسات العليا" />
            <QuickAction icon={<Phone size={18} />} label="اتصل بنا" />
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

function QuickAction({ icon, label }: { icon: React.ReactNode, label: string }) {
  return (
    <button className="flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl transition-all group">
      <span className="text-orange-500 group-hover:scale-110 transition-transform">{icon}</span>
      <span className="text-xs font-medium text-white/60 group-hover:text-white transition-colors">{label}</span>
    </button>
  );
}
