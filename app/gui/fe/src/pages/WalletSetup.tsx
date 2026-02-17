import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MeshWallet } from '@meshsdk/core'
import { useWalletContext } from '../contexts/WalletContext'
import { copyToClipboard } from '../utils/clipboard'
import MnemonicInput, { validateMnemonicWords } from '../components/MnemonicInput'

type Mode = 'choose' | 'create' | 'import'
type CreateStep = 'generate' | 'verify' | 'password'
type ImportStep = 'enter' | 'password'

export default function WalletSetup() {
  const { createWallet } = useWalletContext()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('choose')
  const [mnemonic, setMnemonic] = useState<string[]>([])
  const [createStep, setCreateStep] = useState<CreateStep>('generate')
  const [importStep, setImportStep] = useState<ImportStep>('enter')
  const [importWords, setImportWords] = useState<string[]>(Array(24).fill(''))
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  // Verification state
  const [verifyIndices, setVerifyIndices] = useState<number[]>([])
  const [verifyInputs, setVerifyInputs] = useState<string[]>(['', '', ''])

  // Generate mnemonic when entering create mode
  useEffect(() => {
    if (mode === 'create' && mnemonic.length === 0) {
      const words = MeshWallet.brew(false, 256) as string[]
      setMnemonic(words)
      // Pick 3 random indices for verification
      const indices: number[] = []
      while (indices.length < 3) {
        const i = Math.floor(Math.random() * 24)
        if (!indices.includes(i)) indices.push(i)
      }
      setVerifyIndices(indices.sort((a, b) => a - b))
    }
  }, [mode, mnemonic.length])

  const importValid = useMemo(() => validateMnemonicWords(importWords), [importWords])

  const filledImportCount = useMemo(
    () => importWords.filter((w) => w.trim().length > 0).length,
    [importWords]
  )

  const verificationPassed = useMemo(() => {
    return verifyIndices.every(
      (idx, i) =>
        verifyInputs[i].trim().toLowerCase() === mnemonic[idx]?.toLowerCase()
    )
  }, [verifyIndices, verifyInputs, mnemonic])

  const passwordValid =
    password.length >= 8 && password === confirmPassword

  const handleCopyMnemonic = useCallback(() => {
    copyToClipboard(mnemonic.join(' '))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [mnemonic])

  const handleImportWordChange = useCallback((index: number, value: string) => {
    setImportWords((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }, [])

  const handleImportTab = useCallback((index: number) => {
    // Focus next import input
    const nextInput = document.querySelector<HTMLInputElement>(
      `[data-import-index="${index + 1}"]`
    )
    nextInput?.focus()
  }, [])

  const handleVerifyWordChange = useCallback((verifyPos: number, value: string) => {
    setVerifyInputs((prev) => {
      const next = [...prev]
      next[verifyPos] = value
      return next
    })
  }, [])

  const handleVerifyTab = useCallback((verifyPos: number) => {
    const nextInput = document.querySelector<HTMLInputElement>(
      `[data-verify-index="${verifyPos + 1}"]`
    )
    nextInput?.focus()
  }, [])

  // Handle paste of full mnemonic into first import field
  const handleImportPaste = useCallback((e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').trim()
    const words = pasted.split(/\s+/).filter((w) => w.length > 0)
    if (words.length >= 2) {
      e.preventDefault()
      const padded = Array(24).fill('').map((_, i) => (words[i] || '').toLowerCase())
      setImportWords(padded)
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    const words = mode === 'create' ? mnemonic : importWords
    if (words.length !== 24 || words.some((w) => !w.trim())) {
      setError('All 24 words are required')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await createWallet(words, password)
      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create wallet')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    mode,
    mnemonic,
    importWords,
    password,
    confirmPassword,
    createWallet,
    navigate,
  ])

  // Mode selection screen
  if (mode === 'choose') {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-8"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div className="w-full max-w-lg">
          <div className="text-center mb-12">
            <h1
              className="text-4xl font-bold mb-3"
              style={{ color: 'var(--text-primary)' }}
            >
              Veiled Desktop
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Encrypted data marketplace on Cardano
            </p>
          </div>

          <div className="space-y-4">
            <button
              onClick={() => setMode('create')}
              className="w-full p-6 rounded-xl text-left transition-colors cursor-pointer"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'var(--bg-card-hover)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'var(--bg-card)')
              }
            >
              <div
                className="text-lg font-semibold mb-1"
                style={{ color: 'var(--text-primary)' }}
              >
                Create New Wallet
              </div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Generate a new 24-word recovery phrase
              </div>
            </button>

            <button
              onClick={() => setMode('import')}
              className="w-full p-6 rounded-xl text-left transition-colors cursor-pointer"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'var(--bg-card-hover)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'var(--bg-card)')
              }
            >
              <div
                className="text-lg font-semibold mb-1"
                style={{ color: 'var(--text-primary)' }}
              >
                Import Existing Wallet
              </div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Restore from a 24-word recovery phrase
              </div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Create wallet flow
  if (mode === 'create') {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-8"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="flex items-center mb-8">
            <button
              onClick={() => {
                if (createStep === 'generate') {
                  setMode('choose')
                  setMnemonic([])
                } else if (createStep === 'verify') {
                  setCreateStep('generate')
                } else {
                  setCreateStep('verify')
                }
              }}
              className="mr-4 px-3 py-1 rounded-lg text-sm cursor-pointer"
              style={{
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Back
            </button>
            <h2
              className="text-xl font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {createStep === 'generate'
                ? 'Recovery Phrase'
                : createStep === 'verify'
                  ? 'Verify Phrase'
                  : 'Set Password'}
            </h2>
            <div className="ml-auto text-sm" style={{ color: 'var(--text-muted)' }}>
              Step {createStep === 'generate' ? 1 : createStep === 'verify' ? 2 : 3}{' '}
              of 3
            </div>
          </div>

          {/* Step: Generate */}
          {createStep === 'generate' && (
            <div
              className="p-6 rounded-xl"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                className="p-4 rounded-lg mb-6 text-sm"
                style={{
                  background: 'var(--warning-muted)',
                  color: 'var(--warning)',
                  border: '1px solid var(--warning)',
                }}
              >
                Write down these 24 words in order. This is the only way to
                recover your wallet. Never share them with anyone.
              </div>

              <div className="grid grid-cols-4 gap-3 mb-6">
                {mnemonic.map((word, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span
                      className="text-xs w-5 text-right"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="font-mono"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {word}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleCopyMnemonic}
                  className="px-4 py-2 rounded-lg text-sm cursor-pointer"
                  style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {copied ? 'Copied!' : 'Copy to Clipboard'}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setCreateStep('verify')}
                  className="px-6 py-2 rounded-lg text-sm font-medium cursor-pointer"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                  }}
                >
                  I wrote it down
                </button>
              </div>
            </div>
          )}

          {/* Step: Verify */}
          {createStep === 'verify' && (
            <div
              className="p-6 rounded-xl"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
                Verify your recovery phrase by entering the following words.
                Start typing and select the matching word.
              </p>

              <div className="space-y-4 mb-6">
                {verifyIndices.map((idx, i) => (
                  <div key={idx} data-verify-index={i}>
                    <MnemonicInput
                      index={idx}
                      value={verifyInputs[i]}
                      onChange={(_, val) => handleVerifyWordChange(i, val)}
                      onTab={() => handleVerifyTab(i)}
                      autoFocus={i === 0}
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={() => setCreateStep('password')}
                disabled={!verificationPassed}
                className="w-full px-6 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: verificationPassed
                    ? 'var(--accent)'
                    : 'var(--bg-elevated)',
                  color: '#fff',
                }}
              >
                Continue
              </button>
            </div>
          )}

          {/* Step: Password */}
          {createStep === 'password' && (
            <PasswordForm
              password={password}
              confirmPassword={confirmPassword}
              showPassword={showPassword}
              error={error}
              isSubmitting={isSubmitting}
              passwordValid={passwordValid}
              onPasswordChange={setPassword}
              onConfirmChange={setConfirmPassword}
              onToggleShow={() => setShowPassword(!showPassword)}
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    )
  }

  // Import wallet flow
  return (
    <div
      className="min-h-screen flex items-center justify-center p-8"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center mb-8">
          <button
            onClick={() => {
              if (importStep === 'enter') {
                setMode('choose')
                setImportWords(Array(24).fill(''))
              } else {
                setImportStep('enter')
              }
            }}
            className="mr-4 px-3 py-1 rounded-lg text-sm cursor-pointer"
            style={{
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            Back
          </button>
          <h2
            className="text-xl font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {importStep === 'enter' ? 'Enter Recovery Phrase' : 'Set Password'}
          </h2>
          <div className="ml-auto text-sm" style={{ color: 'var(--text-muted)' }}>
            Step {importStep === 'enter' ? 1 : 2} of 2
          </div>
        </div>

        {/* Step: Enter mnemonic */}
        {importStep === 'enter' && (
          <div
            className="p-6 rounded-xl"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Enter your 24-word recovery phrase. Start typing each word and
              select from the suggestions. You can also paste all 24 words at once.
            </p>

            <div className="grid grid-cols-4 gap-2 mb-4" onPaste={handleImportPaste}>
              {importWords.map((word, i) => (
                <div key={i} data-import-index={i}>
                  <MnemonicInput
                    index={i}
                    value={word}
                    onChange={handleImportWordChange}
                    onTab={handleImportTab}
                    autoFocus={i === 0}
                  />
                </div>
              ))}
            </div>

            <div
              className="mb-4 text-sm"
              style={{
                color: importValid
                  ? 'var(--success)'
                  : filledImportCount > 0
                    ? 'var(--text-muted)'
                    : 'transparent',
              }}
            >
              {filledImportCount} / 24 words
            </div>

            <button
              onClick={() => {
                setMnemonic(importWords)
                setImportStep('password')
              }}
              disabled={!importValid}
              className="w-full px-6 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: importValid ? 'var(--accent)' : 'var(--bg-elevated)',
                color: '#fff',
              }}
            >
              Continue
            </button>
          </div>
        )}

        {/* Step: Password */}
        {importStep === 'password' && (
          <PasswordForm
            password={password}
            confirmPassword={confirmPassword}
            showPassword={showPassword}
            error={error}
            isSubmitting={isSubmitting}
            passwordValid={passwordValid}
            onPasswordChange={setPassword}
            onConfirmChange={setConfirmPassword}
            onToggleShow={() => setShowPassword(!showPassword)}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  )
}

/** Shared password form used by both create and import flows */
function PasswordForm({
  password,
  confirmPassword,
  showPassword,
  error,
  isSubmitting,
  passwordValid,
  onPasswordChange,
  onConfirmChange,
  onToggleShow,
  onSubmit,
}: {
  password: string
  confirmPassword: string
  showPassword: boolean
  error: string | null
  isSubmitting: boolean
  passwordValid: boolean
  onPasswordChange: (v: string) => void
  onConfirmChange: (v: string) => void
  onToggleShow: () => void
  onSubmit: () => void
}) {
  return (
    <div
      className="p-6 rounded-xl"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Set a spending password to encrypt your recovery phrase. You will need
        this password each time you open the app.
      </p>

      <div className="space-y-4 mb-6">
        <div>
          <label
            className="block text-sm mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Password (min 8 characters)
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              className="w-full px-4 py-2 rounded-lg text-sm pr-16"
              style={{
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                outline: 'none',
              }}
              placeholder="Enter password"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={onToggleShow}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div>
          <label
            className="block text-sm mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Confirm Password
          </label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => onConfirmChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && passwordValid) onSubmit()
            }}
            className="w-full px-4 py-2 rounded-lg text-sm"
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: `1px solid ${
                confirmPassword && password !== confirmPassword
                  ? 'var(--error)'
                  : 'var(--border-subtle)'
              }`,
              outline: 'none',
            }}
            placeholder="Confirm password"
            autoComplete="new-password"
          />
        </div>
      </div>

      {error && (
        <div
          className="mb-4 p-3 rounded-lg text-sm"
          style={{
            background: 'var(--error-muted)',
            color: 'var(--error)',
            border: '1px solid var(--error)',
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={!passwordValid || isSubmitting}
        className="w-full px-6 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: passwordValid && !isSubmitting
            ? 'var(--accent)'
            : 'var(--bg-elevated)',
          color: '#fff',
        }}
      >
        {isSubmitting ? 'Creating Wallet...' : 'Create Wallet'}
      </button>
    </div>
  )
}
