import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  onAuthSuccess: () => void
}

function LoginPage({ onAuthSuccess }: Props) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [connStatus, setConnStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [connDetail, setConnDetail] = useState('')

  // Check Supabase connectivity on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
        // In production, use the proxy path to avoid ISP/firewall blocks on supabase.co
        const isProduction = window.location.hostname.includes('vercel.app')
        const healthUrl = isProduction
          ? `${window.location.origin}/supabase/auth/v1/health`
          : `${(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/auth/v1/health`
        if (!anonKey) {
          setConnStatus('error')
          setConnDetail('Supabase not configured. Contact your administrator.')
          return
        }
        // Simple health check — just try to reach the auth endpoint
        const res = await fetch(healthUrl, {
          method: 'GET',
          headers: { 'apikey': anonKey },
        })
        if (res.ok) {
          setConnStatus('ok')
        } else {
          setConnStatus('error')
          setConnDetail(`Database responded with status ${res.status}. It may be paused or misconfigured.`)
        }
      } catch (err) {
        setConnStatus('error')
        setConnDetail(`Cannot reach database server. Please check your internet connection and try again.`)
      }
    }
    checkConnection()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Retry up to 2 times for network errors
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (isSignUp) {
          const { error } = await supabase.auth.signUp({ email, password })
          if (error) throw error
          setError('Check your email for a confirmation link!')
          return
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email, password })
          if (error) throw error
          onAuthSuccess()
          return
        }
      } catch (err: unknown) {
        lastError = err
        const isNetworkError = err instanceof Error &&
          (err.message === 'Failed to fetch' || err.message.includes('NetworkError') || err.message.includes('fetch'))
        if (isNetworkError && attempt < 2) {
          // Wait a moment and retry
          await new Promise(r => setTimeout(r, 1500))
          continue
        }
        break
      }
    }

    // Show error after all retries
    if (lastError instanceof Error) {
      if (lastError.message === 'Failed to fetch' || lastError.message.includes('NetworkError') || lastError.message.includes('fetch')) {
        setError('Unable to connect to the authentication server. This can happen if: (1) Your internet connection is unstable, (2) The database is temporarily unavailable. Please wait a moment and try again.')
      } else if (lastError.message === 'Invalid login credentials') {
        setError('Incorrect email or password. Please try again, or sign up if you don\'t have an account yet.')
      } else {
        setError(lastError.message)
      }
    } else {
      setError('An unexpected error occurred. Please try again.')
    }

    setLoading(false)
    return
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="With The Tide"
            className="w-24 h-24 mx-auto mb-4 object-contain"
          />
          <h1 className="text-2xl font-bold text-gray-900">With The Tide</h1>
          <p className="text-gray-500 mt-1">Order Tracking & Management</p>
        </div>

        {/* Connection Warning */}
        {connStatus === 'error' && (
          <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            <p className="font-medium mb-1">Connection Issue</p>
            <p>{connDetail}</p>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">
            {isSignUp ? 'Create Account' : 'Welcome Back'}
          </h2>

          {error && (
            <div
              className={`mb-4 p-3 rounded-lg text-sm ${
                error.includes('Check your email')
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Min 6 characters"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading || connStatus === 'error'}
              className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Please wait...' : connStatus === 'checking' ? 'Connecting...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          {connStatus === 'error' && (
            <button
              onClick={() => window.location.reload()}
              className="w-full mt-3 py-2 text-blue-600 text-sm hover:underline"
            >
              Retry connection
            </button>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError('')
              }}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              {isSignUp
                ? 'Already have an account? Sign in'
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
