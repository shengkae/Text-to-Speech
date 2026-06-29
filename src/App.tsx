/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { Upload, Play, Download, Loader2, Volume2, Trash2, Square, Key } from 'lucide-react';
import { pcmToWavBlob, pcmToMp3Blob } from './lib/audio';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const getAi = (customKey?: string) => {
  const key = customKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("No API key provided. Please enter your Gemini API key.");
  }
  return new GoogleGenAI({ apiKey: key });
};

const VOICES = [
  { id: 'Kore', desc: 'Professional & Calm' },
  { id: 'Charon', desc: 'Deep & Authoritative' },
  { id: 'Puck', desc: 'Upbeat & Energetic' },
  { id: 'Fenrir', desc: 'Strong & Resonant' },
  { id: 'Zephyr', desc: 'Breezy & Natural' }
];

export default function App() {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('Kore');
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [sampleUrls, setSampleUrls] = useState<Record<string, string>>({});
  const [generatingSample, setGeneratingSample] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [audioData, setAudioData] = useState<string | string[] | null>(null);
  const [isConvertingMp3, setIsConvertingMp3] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApiInput, setShowApiInput] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const mainAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    sampleAudioRef.current = new Audio();
    return () => {
      if (sampleAudioRef.current) {
        sampleAudioRef.current.pause();
        sampleAudioRef.current.src = '';
      }
    };
  }, []);

  useEffect(() => {
    if (mainAudioRef.current) {
      mainAudioRef.current.playbackRate = playbackSpeed;
    }
  }, [audioUrl, playbackSpeed]);

  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const speed = parseFloat(e.target.value);
    setPlaybackSpeed(speed);
    if (mainAudioRef.current) {
      mainAudioRef.current.playbackRate = speed;
    }
  };

  const handleDownloadMp3 = async () => {
    if (!audioData) return;
    setIsConvertingMp3(true);
    try {
      // Allow React to process the loading state before synchronous heavy conversion
      await new Promise(resolve => setTimeout(resolve, 50));
      const mp3Blob = pcmToMp3Blob(audioData, 24000);
      const url = URL.createObjectURL(mp3Blob);
      
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `speech-${voice.toLowerCase()}-${new Date().getTime()}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error converting to MP3:", err);
      setError("Failed to convert audio to MP3 format.");
    } finally {
      setIsConvertingMp3(false);
    }
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setApiKey(val);
    localStorage.setItem('gemini_api_key', val);
  };

  const stopAudio = () => {
    if (mainAudioRef.current) {
      mainAudioRef.current.pause();
      mainAudioRef.current.currentTime = 0;
    }
    if (sampleAudioRef.current) {
      sampleAudioRef.current.pause();
      sampleAudioRef.current.currentTime = 0;
    }
  };

  const handlePreview = async () => {
    if (!text.trim()) return;
    if (!/[a-zA-Z0-9]/.test(text)) {
      setError("Please enter some text containing letters or numbers.");
      return;
    }
    
    setIsPreviewing(true);
    setError(null);
    
    try {
      const ai = getAi(apiKey);
      // Take up to the first 150 characters for preview, ensuring we don't cut off in the middle of a word if possible
      let previewText = text;
      if (text.length > 150) {
        const lastSpace = text.lastIndexOf(' ', 150);
        previewText = text.substring(0, lastSpace > 0 ? lastSpace : 150);
      }
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: previewText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const wavBlob = pcmToWavBlob(base64Audio, 24000);
        const url = URL.createObjectURL(wavBlob);
        
        if (sampleAudioRef.current) {
          sampleAudioRef.current.src = url;
          sampleAudioRef.current.playbackRate = playbackSpeed;
          sampleAudioRef.current.play();
        }
      } else {
        setError("No audio data received for preview. The model may have refused the prompt.");
      }
    } catch (err: any) {
      console.error(err);
      const errorMessage = err.message || String(err) || "";
      if (errorMessage.includes("429")) {
        setError("You have exceeded your API quota limit. Please check your plan or try again later.");
      } else if (errorMessage.includes("non-audio response")) {
        setError("The model refused to generate audio for this preview. It might contain unsupported content or trigger safety filters.");
      } else {
        setError(errorMessage || "An error occurred while generating preview.");
      }
    } finally {
      setIsPreviewing(false);
    }
  };

  const playSample = async (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation();
    
    if (sampleUrls[voiceId]) {
      if (sampleAudioRef.current) {
        sampleAudioRef.current.src = sampleUrls[voiceId];
        sampleAudioRef.current.play();
      }
      return;
    }

    setGeneratingSample(voiceId);
    try {
      const ai = getAi(apiKey);
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: `Hi, I am ${voiceId}. This is what my voice sounds like.` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceId },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const wavBlob = pcmToWavBlob(base64Audio, 24000);
        const url = URL.createObjectURL(wavBlob);
        setSampleUrls(prev => ({ ...prev, [voiceId]: url }));
        
        if (sampleAudioRef.current) {
          sampleAudioRef.current.src = url;
          sampleAudioRef.current.play();
        }
      }
    } catch (err: any) {
      console.error("Failed to generate sample:", err);
      const errorMessage = err.message || String(err) || "";
      if (errorMessage.includes("429")) {
        setError("You have exceeded your API quota limit. Please check your plan or try again later.");
      }
    } finally {
      setGeneratingSample(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setText(content);
    };
    reader.onerror = () => {
      setError("Failed to read the file.");
    };
    reader.readAsText(file);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) {
      setError("Please enter some text or upload a document.");
      return;
    }
    if (!/[a-zA-Z0-9]/.test(text)) {
      setError("Please enter some text containing letters or numbers.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setAudioUrl(null);
    setAudioData(null);

    try {
      // Split text into chunks to prevent the model's voice volume from degrading over time.
      // We aim for chunks of up to ~400 characters, trying to split on natural boundaries.
      const chunks: string[] = [];
      let remainingText = text.trim();
      
      while (remainingText.length > 0) {
        if (remainingText.length <= 400) {
          chunks.push(remainingText);
          break;
        }
        
        // Try to find a good split point (paragraph, then sentence, then word)
        let splitIndex = remainingText.lastIndexOf('\n', 400);
        if (splitIndex === -1 || splitIndex < 100) {
           splitIndex = remainingText.lastIndexOf('. ', 400);
           if (splitIndex !== -1) splitIndex += 1; // Include the period
        }
        if (splitIndex === -1 || splitIndex < 100) {
           splitIndex = remainingText.lastIndexOf('? ', 400);
           if (splitIndex !== -1) splitIndex += 1;
        }
        if (splitIndex === -1 || splitIndex < 100) {
           splitIndex = remainingText.lastIndexOf(' ', 400);
        }
        if (splitIndex === -1 || splitIndex === 0) {
           splitIndex = 400; // Hard split if no boundary found
        }
        
        chunks.push(remainingText.substring(0, splitIndex).trim());
        remainingText = remainingText.substring(splitIndex).trim();
      }
      
      // Process chunks sequentially to maintain ordering and reduce rate-limit issues
      const base64AudioChunks: string[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Skip chunks that don't contain any alphanumeric characters to prevent 400/500 errors
        if (!chunk || !/[a-zA-Z0-9]/.test(chunk)) continue;
        
        // Add a delay between chunks to respect rate limits (target 15 RPM -> 4000ms delay)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
        
        let retries = 3;
        let success = false;
        let lastError: any = null;

        while (retries > 0 && !success) {
          try {
            const ai = getAi(apiKey);
            const response = await ai.models.generateContent({
              model: "gemini-3.1-flash-tts-preview",
              contents: [{ parts: [{ text: chunk }] }],
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: voice },
                  },
                },
              },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              base64AudioChunks.push(base64Audio);
              success = true;
            } else {
              throw new Error("No audio data received from the model for a chunk.");
            }
          } catch (err: any) {
            lastError = err;
            if (err.message && err.message.includes("429")) {
                throw new Error("API_QUOTA_EXCEEDED"); // Break out of retry loop for quota limit
            }
            retries--;
            if (retries > 0) {
              // Wait 5 seconds before retrying if not quota error, e.g. timeouts or 500s
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          }
        }

        if (!success) {
          throw lastError || new Error("Failed to generate audio for a chunk after multiple retries.");
        }
      }

      if (base64AudioChunks.length > 0) {
        setAudioData(base64AudioChunks);
        const wavBlob = pcmToWavBlob(base64AudioChunks, 24000);
        const url = URL.createObjectURL(wavBlob);
        setAudioUrl(url);
      } else {
        setError("No audio data generated.");
      }
    } catch (err: any) {
      console.error(err);
      const errorMessage = err.message || String(err) || "";
      if (errorMessage.includes("API_QUOTA_EXCEEDED") || errorMessage.includes("429")) {
        setError("You have exceeded your API quota limit. The free preview tier limits total daily usage. Please try a shorter text or check back later.");
      } else if (errorMessage.includes("non-audio response")) {
        setError("The model refused to generate audio for this text. It might contain unsupported content, be too short, or trigger safety filters.");
      } else {
        setError(errorMessage || "An error occurred while generating speech.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-[#1f2937] font-sans selection:bg-indigo-100 p-6 flex flex-col">
      <div className="max-w-[1024px] w-full mx-auto flex-1 flex flex-col">
        
        <header className="flex justify-between items-center mb-6">
          <div className="font-[800] text-2xl tracking-tight text-[#6366f1] uppercase">
            SONIQ.AI
          </div>
          <div className="flex gap-3 items-center relative">
            <button
              onClick={() => setShowApiInput(!showApiInput)}
              className="text-[12px] font-medium text-[#6b7280] hover:text-[#1f2937] transition-colors border border-gray-200 rounded px-2.5 py-1.5 flex items-center gap-1.5 bg-white shadow-sm"
              title="Configure API Key"
            >
              <Key className="w-3.5 h-3.5" />
              API Key
            </button>
            {showApiInput && (
              <div className="absolute top-full right-0 mt-2 p-3 bg-white border border-gray-200 rounded-lg shadow-lg w-64 z-50">
                <label className="block text-xs font-semibold text-gray-700 mb-2">Gemini API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={handleApiKeyChange}
                  placeholder="AIza..."
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-[#6366f1]"
                />
                <div className="text-[10px] text-gray-500 mt-2 leading-tight">
                  Your key is stored locally in your browser. Get one from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">Google AI Studio</a>.
                </div>
              </div>
            )}
            <span className="text-[13px] font-medium text-[#6b7280] hidden sm:inline">Text to Speech</span>
            <div className="w-8 h-8 bg-[#ddd] rounded-full flex items-center justify-center">
              <Volume2 className="w-4 h-4 text-gray-500" />
            </div>
          </div>
        </header>

        <main className="grid grid-cols-12 gap-4 flex-1 auto-rows-min">
          {/* TEXT INPUT SECTION */}
          <div className="col-span-12 lg:col-span-8 bg-white border border-[#e5e7eb] rounded-2xl p-6 flex flex-col min-h-[400px]">
            <h2 className="text-[14px] uppercase tracking-[0.05em] text-[#6b7280] mb-4 flex justify-between items-center font-semibold">
              INPUT TEXT
              {text && (
                <button 
                  onClick={() => setText('')}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  title="Clear text"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </h2>
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#e5e7eb] rounded-xl p-5 text-center mb-4 text-[#6b7280] text-[14px] bg-[#f3f4f6] cursor-pointer hover:bg-gray-200 transition-colors flex flex-col items-center justify-center gap-2"
            >
              <Upload className="w-5 h-5 text-gray-400" />
              <span>Drop DOCX or TXT files here or <strong>browse files</strong></span>
            </div>
            <input 
              type="file" 
              accept=".txt" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleFileUpload} 
            />
            
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter or paste your text content here... Soniq AI will transform your writing into natural, high-fidelity speech within seconds."
              className="flex-1 border-none outline-none resize-none font-sans text-[16px] leading-[1.6] text-[#1f2937] bg-transparent"
            />
            
            <div className="mt-4 text-[12px] text-[#6b7280]">
              Word count: {text.trim() ? text.trim().split(/\s+/).length : 0} words
            </div>
          </div>

          {/* VOICE SELECTION SECTION */}
          <div className="col-span-12 lg:col-span-4 bg-white border border-[#e5e7eb] rounded-2xl p-6 flex flex-col">
            <h2 className="text-[14px] uppercase tracking-[0.05em] text-[#6b7280] mb-4 font-semibold">
              SELECT VOICE
            </h2>
            <div className="grid gap-2.5">
              {VOICES.map(v => (
                <div 
                  key={v.id}
                  onClick={() => setVoice(v.id)}
                  className={`flex items-center justify-between p-[10px] px-[14px] border rounded-[10px] cursor-pointer transition-colors ${
                    voice === v.id 
                      ? 'bg-[#eef2ff] border-[#6366f1]' 
                      : 'border-[#e5e7eb] hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center">
                    <div className={`w-8 h-8 rounded-full mr-3 flex items-center justify-center ${voice === v.id ? 'bg-[#6366f1] text-white' : 'bg-[#cbd5e1] text-gray-500'}`}>
                      <Volume2 className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-[14px] text-[#1f2937]">{v.id}</div>
                      <div className="text-[11px] text-[#6b7280]">{v.desc}</div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => playSample(e, v.id)}
                    disabled={generatingSample === v.id}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${
                      voice === v.id ? 'hover:bg-indigo-200 text-[#6366f1]' : 'hover:bg-gray-200 text-gray-500'
                    }`}
                    title={`Play sample of ${v.id}`}
                  >
                    {generatingSample === v.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ERROR SECTION */}
          {error && (
            <div className="col-span-12 p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>{error}</div>
            </div>
          )}

          {/* PLAYER BAR SECTION */}
          <div className="col-span-12 bg-white border border-[#e5e7eb] rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-5 flex-1 w-full">
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !text.trim()}
                className="w-12 h-12 shrink-0 rounded-full bg-[#6366f1] border-none flex items-center justify-center cursor-pointer hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Generate Speech"
              >
                {isGenerating ? (
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                ) : (
                  <Play className="w-6 h-6 text-white fill-white ml-1" />
                )}
              </button>
              
              <div className="flex flex-col flex-1 gap-2 w-full">
                <div className="flex justify-between items-center text-[12px] font-semibold text-[#1f2937]">
                  <span>{audioUrl ? `Generated: ${voice}` : isGenerating ? 'Generating...' : 'Ready to generate'}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[#6b7280]">Speed:</span>
                    <select 
                      value={playbackSpeed}
                      onChange={handleSpeedChange}
                      className="bg-gray-50 border border-[#e5e7eb] rounded-[6px] px-2 py-1 text-[#1f2937] outline-none cursor-pointer hover:border-[#6366f1] transition-colors"
                    >
                      <option value={0.5}>0.5x</option>
                      <option value={0.75}>0.75x</option>
                      <option value={1}>1x</option>
                      <option value={1.25}>1.25x</option>
                      <option value={1.5}>1.5x</option>
                      <option value={2}>2x</option>
                    </select>
                  </div>
                </div>
                {audioUrl ? (
                  <audio ref={mainAudioRef} controls src={audioUrl} className="w-full h-8" />
                ) : (
                  <div className="h-1.5 bg-[#f3f4f6] rounded-[3px] relative w-full overflow-hidden mt-3">
                    {isGenerating && (
                      <div className="absolute top-0 left-0 h-full bg-[#6366f1] rounded-[3px] animate-[pulse_1.5s_ease-in-out_infinite] w-full"></div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex flex-wrap gap-3 w-full sm:w-auto mt-4 sm:mt-0 justify-end">
              <button 
                onClick={handlePreview}
                disabled={isPreviewing || isGenerating || !text.trim()}
                className="flex-1 sm:flex-none bg-transparent border border-[#e5e7eb] text-[#1f2937] px-4 py-3 rounded-[10px] font-semibold flex items-center justify-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Preview first 150 characters"
              >
                {isPreviewing ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Play className="w-[18px] h-[18px]" />}
                Preview
              </button>
              
              <button 
                onClick={stopAudio}
                className="flex-1 sm:flex-none bg-transparent border border-[#e5e7eb] text-[#1f2937] px-4 py-3 rounded-[10px] font-semibold flex items-center justify-center gap-2 cursor-pointer hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                title="Stop all audio"
              >
                <Square className="w-[18px] h-[18px] fill-current" />
                Stop
              </button>

              <button 
                onClick={handleGenerate}
                disabled={isGenerating || !text.trim()}
                className="flex-1 sm:flex-none bg-transparent border border-[#e5e7eb] text-[#1f2937] px-6 py-3 rounded-[10px] font-semibold flex items-center justify-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate
              </button>
              <div className="flex gap-2 flex-1 sm:flex-none w-full sm:w-auto">
                <a 
                  href={audioUrl || '#'} 
                  download={audioUrl ? `speech-${voice.toLowerCase()}-${new Date().getTime()}.wav` : undefined}
                  className={`flex-1 sm:flex-none bg-[#1f2937] text-white px-4 py-3 rounded-[10px] font-semibold flex items-center justify-center gap-2 transition-colors ${!audioUrl ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-900 cursor-pointer'}`}
                  onClick={(e) => !audioUrl && e.preventDefault()}
                >
                  <Download className="w-[18px] h-[18px]" />
                  WAV
                </a>
                <button 
                  onClick={handleDownloadMp3}
                  disabled={!audioData || isConvertingMp3}
                  className={`flex-1 sm:flex-none bg-[#1f2937] text-white px-4 py-3 rounded-[10px] font-semibold flex items-center justify-center gap-2 transition-colors ${(!audioData || isConvertingMp3) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-900 cursor-pointer'}`}
                >
                  {isConvertingMp3 ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Download className="w-[18px] h-[18px]" />}
                  MP3
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
