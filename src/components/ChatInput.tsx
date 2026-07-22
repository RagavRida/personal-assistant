'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CornerDownLeft, Mic, MicOff, Send, Sparkles } from 'lucide-react';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  isDisabled: boolean;
  disabledReason?: string;
}

type MicState = 'idle' | 'listening';
type VoiceNoticeTone = 'info' | 'error';

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: BrowserSpeechRecognitionResult;
  };
}

interface BrowserSpeechRecognitionErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type SpeechRecognitionWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

export default function ChatInput({ onSendMessage, isDisabled, disabledReason }: ChatInputProps) {
  const [text, setText] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const [transcript, setTranscript] = useState('');
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [voiceNoticeTone, setVoiceNoticeTone] = useState<VoiceNoticeTone>('info');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const latestTranscriptRef = useRef('');
  const shouldCommitOnEndRef = useRef(true);

  useEffect(() => {
    const supported = Boolean(getSpeechRecognitionConstructor());
    setVoiceSupported(supported);

    if (!supported) {
      setVoiceNotice("Voice input isn't supported in this browser, try Chrome.");
      setVoiceNoticeTone('error');
    }

    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const handleSend = () => {
    if (text.trim() && !isDisabled && micState === 'idle') {
      onSendMessage(text.trim());
      setText('');
      setVoiceNotice(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startListening = () => {
    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();

    if (!SpeechRecognitionConstructor) {
      setVoiceSupported(false);
      setVoiceNotice("Voice input isn't supported in this browser, try Chrome.");
      setVoiceNoticeTone('error');
      return;
    }

    setVoiceSupported(true);
    setVoiceNotice(null);
    setTranscript('');
    latestTranscriptRef.current = '';
    shouldCommitOnEndRef.current = true;

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const transcriptPart = result[0]?.transcript ?? '';

        if (result.isFinal) {
          finalTranscript += transcriptPart;
        } else {
          interimTranscript += transcriptPart;
        }
      }

      const visibleTranscript = finalTranscript || interimTranscript;

      if (visibleTranscript.trim()) {
        latestTranscriptRef.current = visibleTranscript.trim();
        setTranscript(visibleTranscript.trim());
      }

      if (finalTranscript.trim()) {
        setText(finalTranscript.trim());
        setVoiceNotice('Voice captured. Review or edit the text, then send it.');
        setVoiceNoticeTone('info');
        setMicState('idle');
        recognition.stop();
      }
    };

    recognition.onerror = (event) => {
      shouldCommitOnEndRef.current = false;
      setMicState('idle');
      setTranscript('');
      latestTranscriptRef.current = '';
      setVoiceNotice(formatSpeechError(event.error));
      setVoiceNoticeTone('error');
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      if (shouldCommitOnEndRef.current && latestTranscriptRef.current.trim()) {
        setText(latestTranscriptRef.current.trim());
        setVoiceNotice('Voice captured. Review or edit the text, then send it.');
        setVoiceNoticeTone('info');
      }

      setMicState('idle');
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      setMicState('listening');
    } catch {
      recognitionRef.current = null;
      setMicState('idle');
      setVoiceNotice('Voice input could not start. Please try again.');
      setVoiceNoticeTone('error');
    }
  };

  const stopListening = () => {
    shouldCommitOnEndRef.current = true;
    recognitionRef.current?.stop();
    setMicState('idle');
  };

  const cancelListening = () => {
    shouldCommitOnEndRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    latestTranscriptRef.current = '';
    setTranscript('');
    setMicState('idle');
  };

  const handleMicClick = () => {
    if (isDisabled) return;

    if (micState === 'listening') {
      stopListening();
    } else {
      startListening();
    }
  };

  const micDisabled = isDisabled || voiceSupported === false;

  return (
    <div className="border-t border-gray-100 bg-white p-5 space-y-3.5 relative">
      {micState === 'listening' && (
        <div className="absolute left-6 right-6 bottom-full mb-3 bg-indigo-900/95 backdrop-blur-md rounded-2xl p-4 shadow-xl border border-indigo-700/50 flex flex-col space-y-2 animate-slide-up">
          <div className="flex items-center justify-between text-indigo-200 text-xs font-semibold">
            <span className="flex items-center space-x-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              <span className="text-rose-300 font-mono tracking-wider animate-pulse uppercase">
                LIVE TRANSCRIBING...
              </span>
            </span>
            <button
              onClick={cancelListening}
              className="text-indigo-300 hover:text-white hover:bg-white/10 px-2 py-0.5 rounded text-[10px]"
            >
              Cancel
            </button>
          </div>
          <p className="text-sm font-medium text-white italic min-h-[1.5rem]">
            {transcript || 'Say something...'}
          </p>
          <p className="text-[10px] text-indigo-300 font-sans">
            Click the mic again to stop. The final transcript will stay in the input for review.
          </p>
        </div>
      )}

      {(voiceNotice || disabledReason) && (
        <div
          className={`mx-auto flex max-w-4xl items-center space-x-2 rounded-lg border px-3 py-2 text-xs ${
            voiceNotice && voiceNoticeTone === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-indigo-100 bg-indigo-50 text-indigo-700'
          }`}
        >
          {voiceNotice && voiceNoticeTone === 'error' && <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />}
          <span>{voiceNotice ?? disabledReason}</span>
        </div>
      )}

      <div className="flex items-end space-x-3.5 max-w-4xl mx-auto">
        <button
          id="speech-mic-button"
          onClick={handleMicClick}
          disabled={micDisabled}
          title={voiceSupported === false ? "Voice input isn't supported in this browser" : micState === 'listening' ? 'Stop listening' : 'Start voice transcription'}
          className={`flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed ${
            micState === 'listening'
              ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse ring-4 ring-rose-100 focus:ring-rose-400'
              : 'bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-indigo-600 border border-gray-150 focus:ring-indigo-300 disabled:bg-gray-100 disabled:text-gray-300'
          }`}
        >
          {micState === 'listening' ? (
            <MicOff className="w-5 h-5" />
          ) : (
            <Mic className="w-5 h-5" />
          )}
        </button>

        <div className="flex-1 relative flex items-center bg-gray-50 hover:bg-gray-100/75 border border-gray-150 rounded-xl transition-all duration-200 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 pr-3">
          <textarea
            id="chat-textarea-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isDisabled || micState !== 'idle'}
            placeholder={
              isDisabled
                ? disabledReason ?? 'Assistant is crafting responses...'
                : 'Message your assistant (e.g. Schedule team lunch)...'
            }
            rows={1}
            className="w-full bg-transparent outline-none border-none py-3 pl-4 pr-1.5 text-sm font-sans text-gray-800 placeholder-gray-400 resize-none max-h-32 min-h-[44px]"
            style={{ height: 'auto' }}
          />
          <div className="flex-shrink-0 text-[10px] text-gray-400 font-mono px-1 flex items-center space-x-1 border border-gray-200 bg-white rounded-md h-5">
            <span>Enter</span>
            <CornerDownLeft className="w-2.5 h-2.5" />
          </div>
        </div>

        <button
          id="chat-submit-button"
          onClick={handleSend}
          disabled={isDisabled || !text.trim() || micState !== 'idle'}
          className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-100 text-white disabled:text-gray-400 font-sans shadow-xs hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <Send className="w-4.5 h-4.5" />
        </button>
      </div>

      <div className="max-w-4xl mx-auto flex items-center justify-between text-[11px] text-gray-400 font-sans px-1">
        <span className="flex items-center space-x-1.5">
          <Sparkles className="w-3 h-3 text-indigo-400" />
          <span>OpenAI tool routing active • Calendar and Tasks run server-side</span>
        </span>
        <span>Deletes require confirmation</span>
      </div>
    </div>
  );
}

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') {
    return null;
  }

  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function formatSpeechError(error: string) {
  const messages: Record<string, string> = {
    'no-speech': 'I did not catch any speech. Try again when you are ready.',
    network: 'Voice input hit a network issue. Please try again.',
    'not-allowed': 'Microphone permission was blocked. Allow mic access and try again.',
    'service-not-allowed': 'Voice input is blocked by this browser or site settings.',
    aborted: 'Voice input was cancelled.',
  };

  return messages[error] ?? 'Voice input stopped unexpectedly. Please try again.';
}
