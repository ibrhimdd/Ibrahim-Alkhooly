/**
 * Utility for handling PCM audio capture and playback for Gemini Live API.
 */

export class AudioHandler {
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  
  private activeSources: AudioBufferSourceNode[] = [];
  
  // For playback
  private nextStartTime: number = 0;
  private outputSampleRate: number = 24000; // Gemini output sample rate
  private inputSampleRate: number = 16000; // Gemini input sample rate

  constructor(private onAudioData: (base64Data: string) => void) {}

  async startCapture() {
    this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: this.inputSampleRate,
    });

    if (this.inputContext.state === 'suspended') {
      await this.inputContext.resume();
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const error = new Error("متصفحك لا يدعم الوصول إلى الميكروفون أو أنك في بيئة غير آمنة (HTTP).");
      console.error("Audio capture not supported:", error);
      throw error;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Check if we were stopped while waiting for the stream
      if (!this.inputContext) {
        this.stream.getTracks().forEach(track => track.stop());
        return;
      }

      this.source = this.inputContext.createMediaStreamSource(this.stream);
      this.processor = this.inputContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
        }
        
        const base64Data = btoa(
          String.fromCharCode(...new Uint8Array(pcmData.buffer))
        );
        this.onAudioData(base64Data);
      };

      this.source.connect(this.processor);
      this.processor.connect(this.inputContext.destination);
    } catch (error) {
      console.error("Error starting audio capture:", error);
      this.stopCapture();
      throw error;
    }
  }

  stopCapture() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.processor?.disconnect();
    this.processor = null;
    this.source?.disconnect();
    this.source = null;
    this.inputContext?.close();
    this.inputContext = null;
  }

  playChunk(base64Data: string) {
    if (!this.outputContext) {
      this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.outputSampleRate,
      });
      this.nextStartTime = this.outputContext.currentTime;
    }

    if (this.outputContext.state === 'suspended') {
      this.outputContext.resume();
    }

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const pcmData = new Int16Array(bytes.buffer);
    const floatData = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      floatData[i] = pcmData[i] / 0x7fff;
    }

    const buffer = this.outputContext.createBuffer(1, floatData.length, this.outputSampleRate);
    buffer.getChannelData(0).set(floatData);

    const source = this.outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputContext.destination);

    const startTime = Math.max(this.outputContext.currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;
    
    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter(s => s !== source);
    };
  }

  clearPlayback() {
    this.activeSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Source might have already stopped
      }
    });
    this.activeSources = [];
    this.nextStartTime = this.outputContext?.currentTime || 0;
  }

  close() {
    this.stopCapture();
    this.outputContext?.close();
    this.outputContext = null;
  }
}
