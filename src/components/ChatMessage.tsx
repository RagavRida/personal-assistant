'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Bot, Check, Key, RefreshCw, ShieldAlert, Sparkles, User, X } from 'lucide-react';
import { Message } from '../lib/conversation';

interface ChatMessageProps {
  message: Message;
  onConfirm?: (confirmAction: string, choice: boolean) => void;
  onToggleTask?: (taskId: string) => void;
  onRetry?: (text: string) => void;
  key?: string;
}

export default function ChatMessage({ message, onConfirm, onToggleTask, onRetry }: ChatMessageProps) {
  const isUser = message.sender === 'user';
  const [timestampStr, setTimestampStr] = useState('');

  useEffect(() => {
    setTimestampStr(message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }, [message.timestamp]);

  // Render thinking indicator with elegant pulsing/bouncing dots
  const renderThinking = () => (
    <div className="flex items-center space-x-1.5 py-2 px-1 text-gray-400">
      <span className="text-xs font-medium font-sans text-gray-500 mr-1 flex items-center">
        <Sparkles className="w-3.5 h-3.5 text-indigo-500 mr-1 animate-pulse" />
        Synthesizing thoughts
      </span>
      <span className="flex space-x-1">
        <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </span>
    </div>
  );

  // Render tool action indicator
  const renderToolAction = () => {
    if (!message.toolActionText) return null;
    return (
      <div className="flex items-center space-x-2 bg-indigo-50/70 border border-indigo-100 text-indigo-700 px-3.5 py-2 rounded-lg text-xs font-sans font-medium max-w-max mb-2 animate-pulse">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span>
        </span>
        <span>{message.toolActionText}</span>
      </div>
    );
  };

  // Render Confirmation block (destructive workflow)
  const renderConfirmBlock = () => {
    if (message.status !== 'confirm' || !message.confirmAction) return null;

    return (
      <div className="mt-3.5 p-3.5 bg-rose-50/50 border border-rose-100 rounded-xl max-w-sm">
        <div className="flex items-center space-x-2 text-rose-800 text-xs font-semibold mb-3">
          <ShieldAlert className="w-4 h-4 text-rose-600" />
          <span>Interactive Confirmation Requested</span>
        </div>
        <div className="flex space-x-2.5">
          <button
            onClick={() => onConfirm?.(message.confirmAction!, true)}
            className="flex-1 inline-flex items-center justify-center space-x-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-rose-500"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Yes, Proceed</span>
          </button>
          <button
            onClick={() => onConfirm?.(message.confirmAction!, false)}
            className="flex-1 inline-flex items-center justify-center space-x-1.5 px-3 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-xs font-semibold shadow-xs transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-gray-300"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancel</span>
          </button>
        </div>
      </div>
    );
  };

  // Render Tasks List block
  const renderTasksList = () => {
    if (!message.tasks || message.tasks.length === 0) return null;

    return (
      <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-1">
          Google Tasks Agenda
        </span>
        <div className="grid gap-2">
          {message.tasks.map((task) => {
            const categoryColors = {
              urgent: 'bg-rose-50 text-rose-700 border-rose-100',
              work: 'bg-indigo-50 text-indigo-700 border-indigo-100',
              personal: 'bg-slate-50 text-slate-700 border-slate-100',
            };

            return (
              <div
                key={task.id}
                className={`flex items-center justify-between p-3 rounded-xl border bg-white shadow-2xs hover:shadow-xs transition-all duration-200 ${
                  task.completed ? 'opacity-65 border-gray-150' : 'border-gray-100'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => onToggleTask?.(task.id)}
                    className={`flex items-center justify-center w-5 h-5 rounded-md border transition-all ${
                      task.completed
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-gray-300 hover:border-indigo-400 bg-white'
                    }`}
                  >
                    {task.completed && <Check className="w-3.5 h-3.5" />}
                  </button>
                  <span
                    className={`text-xs font-sans font-medium text-gray-800 ${
                      task.completed ? 'line-through text-gray-400' : ''
                    }`}
                  >
                    {task.title}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${
                      categoryColors[task.category]
                    }`}
                  >
                    {task.category}
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono">
                    {task.due}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderActionBlock = () => {
    if (isUser) return null;

    if (message.action === 'reauth') {
      return (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href="/api/auth/google"
            className="inline-flex items-center space-x-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            <Key className="h-3.5 w-3.5" />
            <span>Reconnect Google Account</span>
          </a>
        </div>
      );
    }

    if (message.action === 'retry' && message.retryText) {
      return (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onRetry?.(message.retryText!)}
            className="inline-flex items-center space-x-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 shadow-xs transition-colors hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:ring-offset-2"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <motion.div
      id={`chat-message-${message.id}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-5`}
    >
      <div className={`flex max-w-[85%] sm:max-w-[75%] gap-3.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        
        {/* Avatar badge */}
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center font-semibold text-sm transition-all shadow-2xs ${
            isUser
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-100'
              : message.status === 'error'
              ? 'bg-rose-100 text-rose-700 ring-2 ring-rose-50'
              : 'bg-white text-gray-700 border border-gray-150 ring-2 ring-gray-50'
          }`}
        >
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4.5 h-4.5" />}
        </div>

        {/* Message body container */}
        <div className="flex flex-col space-y-1">
          {/* Header (sender identity + time) */}
          <div className={`flex items-center space-x-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <span className="text-xs font-semibold text-gray-700">
              {isUser ? 'You' : 'Workspace AI'}
            </span>
            <span className="text-[10px] text-gray-400 font-mono">
              {timestampStr}
            </span>
          </div>

          {/* Balloon content */}
          <div
            className={`p-4 rounded-2xl shadow-2xs relative overflow-hidden transition-all duration-200 border ${
              isUser
                ? 'bg-indigo-600 text-white border-indigo-700 rounded-tr-xs'
                : message.status === 'error'
                ? 'bg-rose-50/80 text-rose-900 border-rose-200 rounded-tl-xs'
                : 'bg-white text-gray-800 border-gray-100 rounded-tl-xs'
            }`}
          >
            {/* Display tool state badge if present */}
            {!isUser && renderToolAction()}

            {/* Error badge prefix */}
            {message.status === 'error' && (
              <div className="flex items-center space-x-1.5 text-rose-800 font-semibold text-xs mb-2">
                <AlertCircle className="w-4.5 h-4.5 text-rose-600" />
                <span>API Synchronization Fault</span>
              </div>
            )}

            {/* Main message text */}
            {message.status === 'thinking' ? (
              renderThinking()
            ) : (
              <p className="text-sm font-sans leading-relaxed whitespace-pre-wrap select-text">
                {message.text}
              </p>
            )}

            {/* Custom Structured Task Checklists */}
            {!isUser && renderTasksList()}

            {/* Confirmation inline dialog overlay */}
            {!isUser && renderConfirmBlock()}

            {!isUser && renderActionBlock()}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
