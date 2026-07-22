'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, Key, LogOut, AlertCircle, CheckCircle2 } from 'lucide-react';

interface StatusBarProps {
  lastSynced: Date;
  onSync: () => void;
  isSyncing: boolean;
  onConnectionChange?: (state: { connected: boolean; checking: boolean }) => void;
}

export default function StatusBar({
  lastSynced,
  onSync,
  isSyncing,
  onConnectionChange,
}: StatusBarProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authMessageTone, setAuthMessageTone] = useState<'success' | 'error'>('success');

  const refreshStatus = useCallback(async () => {
    setIsCheckingStatus(true);

    try {
      const response = await fetch('/api/auth/google/status', { cache: 'no-store' });
      const data = await response.json();

      setIsConnected(Boolean(data.connected));
      setConnectedEmail(typeof data.email === 'string' ? data.email : null);

      if (data.error) {
        setAuthMessage(data.error);
        setAuthMessageTone('error');
      }
    } catch {
      setIsConnected(false);
      setConnectedEmail(null);
      setAuthMessage('Unable to read Google connection status.');
      setAuthMessageTone('error');
    } finally {
      setIsCheckingStatus(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    onConnectionChange?.({
      connected: isConnected,
      checking: isCheckingStatus,
    });
  }, [isConnected, isCheckingStatus, onConnectionChange]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get('google_auth');
    const error = params.get('google_auth_error');

    if (success === 'success') {
      setAuthMessage('Google account connected. Calendar and Tasks tokens are stored securely.');
      setAuthMessageTone('success');
    } else if (error) {
      setAuthMessage(formatAuthError(error));
      setAuthMessageTone('error');
    }

    if (success || error) {
      params.delete('google_auth');
      params.delete('google_auth_error');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, []);

  const handleConnect = () => {
    window.location.assign('/api/auth/google');
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);

    try {
      await fetch('/api/auth/google/logout', { method: 'POST' });
      setIsConnected(false);
      setConnectedEmail(null);
      onConnectionChange?.({ connected: false, checking: false });
      setAuthMessage('Google account disconnected.');
      setAuthMessageTone('success');
    } catch {
      setAuthMessage('Unable to disconnect Google account. Please try again.');
      setAuthMessageTone('error');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const statusLabel = isCheckingStatus
    ? 'Checking'
    : isConnected
      ? 'Connected'
      : 'Disconnected';

  return (
    <div
      id="status-bar-container"
      className="bg-white border-b border-gray-100 px-6 py-3 flex flex-wrap items-center justify-between gap-4 shadow-xs"
    >
      {/* Google Integration Badge */}
      <div className="flex items-center space-x-3">
        <div
          className={`relative flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-300 ${
            isConnected
              ? 'bg-emerald-50 text-emerald-600 ring-2 ring-emerald-100'
              : 'bg-amber-50 text-amber-600 ring-2 ring-amber-100'
          }`}
        >
          {isConnected ? (
            <Cloud className="w-5 h-5 animate-pulse" />
          ) : (
            <CloudOff className="w-5 h-5" />
          )}
          <span
            className={`absolute top-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white ${
              isConnected ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
        </div>

        <div>
          <div className="flex items-center space-x-2">
            <span className="font-sans font-medium text-sm text-gray-800">
              Google Workspace Link
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium tracking-wide ${
                isConnected
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : isCheckingStatus
                    ? 'bg-slate-50 text-slate-600 border border-slate-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="text-xs text-gray-500 font-sans mt-0.5">
            {isCheckingStatus
              ? 'Checking the Google session...'
              : isConnected
              ? `${connectedEmail ? `${connectedEmail} • ` : ''}Calendar & Tasks authorized • Auto-synced at ${lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
              : 'Sign in to unlock live Calendar events and automatic Task updates'}
          </p>
          {authMessage && (
            <div
              className={`mt-2 inline-flex items-center space-x-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
                authMessageTone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              {authMessageTone === 'success' ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5" />
              )}
              <span>{authMessage}</span>
            </div>
          )}
        </div>
      </div>

      {/* Connection Actions */}
      <div className="flex items-center gap-3 ml-auto">
        {isConnected && (
          <button
            id="sync-now-button"
            onClick={onSync}
            disabled={isSyncing}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-sans font-medium text-xs transition-colors duration-150 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-indigo-500' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        )}

        <button
          id="connect-google-account-btn"
          onClick={isConnected ? handleDisconnect : handleConnect}
          disabled={isCheckingStatus || isDisconnecting}
          className={`inline-flex items-center space-x-2 px-4 py-1.5 rounded-lg font-sans font-medium text-xs transition-all duration-150 shadow-xs focus:ring-2 focus:ring-offset-2 ${
            isConnected
              ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 focus:ring-rose-200'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-300 disabled:bg-gray-300'
          }`}
        >
          {isConnected ? (
            <>
              {isDisconnecting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogOut className="w-3.5 h-3.5" />
              )}
              <span>{isDisconnecting ? 'Disconnecting...' : 'Disconnect'}</span>
            </>
          ) : (
            <>
              <Key className="w-3.5 h-3.5" />
              <span>Connect Google Account</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function formatAuthError(error: string) {
  const messages: Record<string, string> = {
    access_denied: 'Google sign-in was cancelled.',
    missing_code: 'Google did not return an OAuth code. Please try connecting again.',
    missing_access_token: 'Google did not return an access token. Please reconnect.',
    token_exchange_failed: 'Google token exchange failed. Please reconnect and try again.',
    auth_configuration_error: 'Google OAuth is not configured yet. Add the required values to .env.local.',
    database_configuration_error: 'Database storage is not configured yet. Add the Supabase values to .env.local.',
    database_unavailable: 'Database storage is unavailable. Check Supabase and try again.',
  };

  return messages[error] ?? `Google sign-in failed: ${error}`;
}
