import { useState, useEffect, useCallback, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MeshWallet } from '@meshsdk/core'
import '../i18n'
import { useWalletContext } from '../contexts/WalletContext'
import { copyToClipboard } from '../utils/clipboard'
import MnemonicInput, { validateMnemonicWords } from '../components/MnemonicInput'
import { usePasswordStrength } from '../hooks/usePasswordStrength'
import type { PasswordStrength } from '../hooks/usePasswordStrength'
import PasswordStrengthIndicator from '../components/PasswordStrengthIndicator'
import LoadingSpinner from '../components/LoadingSpinner'
import { useToast, ToastContainer } from '../components/Toast'

type Mode = 'choose' | 'create' | 'import'
type CreateStep = 'generate' | 'verify' | 'password'
type ImportStep = 'enter' | 'password'

interface StepInfo {
  label: string
}

function StepIndicator({ steps, currentIndex }: { steps: StepInfo[]; currentIndex: number }) {
  return (
    <div className="flex items-center justify-center mb-[var(--space-xl)]">
      {steps.map((step, i) => {
        const isComplete = i < currentIndex
        const isActive = i === currentIndex
        return (
          <div key={i} className="flex items-center">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors"
                style={{
                  background: isComplete
                    ? 'var(--success)'
                    : isActive
                      ? 'var(--accent)'
                      : 'var(--bg-secondary)',
                  color: isComplete || isActive ? '#fff' : 'var(--text-muted)',
                  border: isComplete || isActive ? 'none' : '1px solid var(--border-subtle)',
                }}
              >
                {isComplete ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className="text-xs mt-1.5 whitespace-nowrap"
                style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                {step.label}
              </span>
            </div>
            {/* Connector line */}
            {i < steps.length - 1 && (
              <div
                className="h-0.5 mx-[var(--space-3)] mb-5"
                style={{
                  width: '3rem',
                  background: i < currentIndex ? 'var(--success)' : 'var(--border-subtle)',
                  transition: 'background var(--transition-base)',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function WalletSetup() {
  const { createWallet } = useWalletContext()
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useTranslation('wallet')

  const createSteps: StepInfo[] = useMemo(() => [
    { label: t('setup.steps.backup') },
    { label: t('setup.steps.verify') },
    { label: t('setup.steps.password') },
  ], [t])

  const importSteps: StepInfo[] = useMemo(() => [
    { label: t('setup.steps.recoveryPhrase') },
    { label: t('setup.steps.password') },
  ], [t])

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

  const strength = usePasswordStrength(password)

  const passwordValid =
    strength.allMet && password === confirmPassword

  const handleCopyMnemonic = useCallback(async () => {
    const success = await copyToClipboard(mnemonic.join(' '))
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.warning(t('setup.errors.copyFailedTitle'), t('setup.errors.copyFailedBody'))
    }
  }, [mnemonic, toast, t])

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

  // Bulk paste via button (reads clipboard directly)
  const handleBulkPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      const words = text.trim().split(/\s+/).filter((w) => w.length > 0)
      if (words.length >= 2) {
        const padded = Array(24).fill('').map((_, i) => (words[i] || '').toLowerCase())
        setImportWords(padded)
      }
    } catch {
      toast.warning(t('setup.errors.clipboardUnavailableTitle'), t('setup.errors.clipboardUnavailableBody'))
    }
  }, [toast, t])

  const handleSubmit = useCallback(async () => {
    const words = mode === 'create' ? mnemonic : importWords
    if (words.length !== 24 || words.some((w) => !w.trim())) {
      setError(t('setup.errors.allWordsRequired'))
      return
    }
    if (!strength.allMet) {
      setError(t('setup.errors.passwordRequirements'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('setup.errors.passwordMismatch'))
      return
    }

    // Force synchronous render so the button disables before the expensive IPC call
    flushSync(() => {
      setIsSubmitting(true)
      setError(null)
    })
    // Wait for the browser to paint the disabled state
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    try {
      await createWallet(words, password)
      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : t('setup.errors.createFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }, [
    mode,
    mnemonic,
    importWords,
    password,
    confirmPassword,
    strength,
    createWallet,
    navigate,
    t,
  ])

  // Mode selection screen
  if (mode === 'choose') {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-[var(--space-xl)]"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div className="w-full max-w-lg">
          <div className="text-center mb-[var(--space-12)]">
            <h1
              className="text-4xl font-bold mb-[var(--space-3)]"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('appName')}
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              {t('setup.tagline')}
            </p>
          </div>

          <div className="space-y-[var(--space-md)]">
            <button
              onClick={() => setMode('create')}
              className="w-full p-[var(--space-lg)] rounded-xl text-left transition-colors duration-[var(--transition-fast)] cursor-pointer bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]"
            >
              <div
                className="text-lg font-semibold mb-[var(--space-1)]"
                style={{ color: 'var(--text-primary)' }}
              >
                {t('setup.chooseCreateTitle')}
              </div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('setup.chooseCreateSubtitle')}
              </div>
            </button>

            <button
              onClick={() => setMode('import')}
              className="w-full p-[var(--space-lg)] rounded-xl text-left transition-colors duration-[var(--transition-fast)] cursor-pointer bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:bg-[var(--bg-card-hover)]"
            >
              <div
                className="text-lg font-semibold mb-[var(--space-1)]"
                style={{ color: 'var(--text-primary)' }}
              >
                {t('setup.chooseImportTitle')}
              </div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('setup.chooseImportSubtitle')}
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
        className="min-h-screen flex items-center justify-center p-[var(--space-xl)]"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="flex items-center mb-[var(--space-md)]">
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
              className="mr-[var(--space-md)] px-[var(--space-3)] py-[var(--space-1)] rounded-lg text-sm cursor-pointer"
              style={{
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {t('setup.back')}
            </button>
            <h2
              className="text-xl font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {createStep === 'generate'
                ? t('setup.create.recoveryPhraseTitle')
                : createStep === 'verify'
                  ? t('setup.create.verifyTitle')
                  : t('setup.create.passwordTitle')}
            </h2>
          </div>

          {/* Step Progress */}
          <StepIndicator
            steps={createSteps}
            currentIndex={createStep === 'generate' ? 0 : createStep === 'verify' ? 1 : 2}
          />

          {/* Step: Generate */}
          {createStep === 'generate' && (
            <div
              className="p-[var(--space-lg)] rounded-xl"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                className="p-[var(--space-md)] rounded-lg mb-[var(--space-lg)] text-sm"
                style={{
                  background: 'var(--warning-muted)',
                  color: 'var(--warning)',
                  border: '1px solid var(--warning)',
                }}
              >
                {t('setup.create.warning')}
              </div>

              <div className="grid grid-cols-4 gap-[var(--space-3)] mb-[var(--space-lg)]">
                {mnemonic.map((word, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-lg text-sm"
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

              <div className="flex gap-[var(--space-3)]">
                <button
                  onClick={handleCopyMnemonic}
                  className="px-[var(--space-md)] py-[var(--space-2)] rounded-[var(--radius-md)] text-sm btn-base btn-tertiary"
                >
                  {copied ? t('setup.create.copied') : t('setup.create.copyToClipboard')}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setCreateStep('verify')}
                  className="px-[var(--space-lg)] py-[var(--space-2)] rounded-[var(--radius-md)] text-sm font-medium btn-base btn-primary"
                >
                  {t('setup.create.wroteItDown')}
                </button>
              </div>
            </div>
          )}

          {/* Step: Verify */}
          {createStep === 'verify' && (
            <div
              className="p-[var(--space-lg)] rounded-xl"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <p className="mb-[var(--space-lg)] text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('setup.create.verifyInstructions')}
              </p>

              <div className="space-y-[var(--space-md)] mb-[var(--space-lg)]">
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
                className="w-full px-[var(--space-lg)] py-[var(--space-2)] rounded-[var(--radius-md)] text-sm font-medium btn-base btn-primary"
              >
                {t('setup.create.continue')}
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
              strength={strength}
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
    <main
      id="main-content"
      className="min-h-screen flex items-center justify-center p-[var(--space-xl)]"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center mb-[var(--space-md)]">
          <button
            onClick={() => {
              if (importStep === 'enter') {
                setMode('choose')
                setImportWords(Array(24).fill(''))
              } else {
                setImportStep('enter')
              }
            }}
            className="mr-[var(--space-md)] px-[var(--space-3)] py-[var(--space-1)] rounded-[var(--radius-md)] text-sm btn-base btn-tertiary"
          >
            {t('setup.back')}
          </button>
          <h2
            className="text-xl font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {importStep === 'enter' ? t('setup.import.enterTitle') : t('setup.import.passwordTitle')}
          </h2>
        </div>

        {/* Step Progress */}
        <StepIndicator
          steps={importSteps}
          currentIndex={importStep === 'enter' ? 0 : 1}
        />

        {/* Step: Enter mnemonic */}
        {importStep === 'enter' && (
          <div
            className="p-[var(--space-lg)] rounded-xl"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div className="flex items-center justify-between mb-[var(--space-md)]">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('setup.import.instructions')}
              </p>
              <button
                type="button"
                onClick={handleBulkPaste}
                className="ml-[var(--space-md)] px-[var(--space-3)] py-1.5 rounded-[var(--radius-md)] text-xs whitespace-nowrap btn-base btn-secondary"
              >
                {t('setup.import.pasteAll')}
              </button>
            </div>

            <div className="grid grid-cols-4 gap-[var(--space-2)] mb-[var(--space-md)]" onPaste={handleImportPaste}>
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
              className="mb-[var(--space-md)] text-sm"
              style={{
                color: importValid
                  ? 'var(--success)'
                  : filledImportCount > 0
                    ? 'var(--text-muted)'
                    : 'transparent',
              }}
            >
              {t('setup.import.wordCount', { count: filledImportCount })}
            </div>

            <button
              onClick={() => {
                setMnemonic(importWords)
                setImportStep('password')
              }}
              disabled={!importValid}
              className="w-full px-[var(--space-lg)] py-[var(--space-2)] rounded-[var(--radius-md)] text-sm font-medium btn-base btn-primary"
            >
              {t('setup.import.continue')}
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
            strength={strength}
            onPasswordChange={setPassword}
            onConfirmChange={setConfirmPassword}
            onToggleShow={() => setShowPassword(!showPassword)}
            onSubmit={handleSubmit}
          />
        )}
      </div>
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} queuedCount={toast.queuedCount} onDismissAll={toast.dismissAll} />
    </main>
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
  strength,
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
  strength: PasswordStrength
  onPasswordChange: (v: string) => void
  onConfirmChange: (v: string) => void
  onToggleShow: () => void
  onSubmit: () => void
}) {
  const { t } = useTranslation('wallet')
  const [capsLockOn, setCapsLockOn] = useState(false)

  return (
    <div
      className="p-[var(--space-lg)] rounded-xl"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <p className="mb-[var(--space-lg)] text-sm" style={{ color: 'var(--text-secondary)' }}>
        {t('setup.password.description')}
      </p>

      <div className="space-y-[var(--space-md)] mb-[var(--space-lg)]">
        <div>
          <label
            className="block text-sm mb-[var(--space-1)]"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('setup.password.label')}
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              onKeyDown={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
              className="w-full px-[var(--space-md)] py-[var(--space-2)] rounded-lg text-sm pr-16"
              style={{
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                outline: 'none',
              }}
              placeholder={t('setup.password.placeholder')}
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
            />
            <button
              type="button"
              onClick={onToggleShow}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-[var(--space-2)] py-[var(--space-1)] text-xs rounded cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              {showPassword ? t('setup.password.hide') : t('setup.password.show')}
            </button>
          </div>
          <PasswordStrengthIndicator strength={strength} password={password} />
          {capsLockOn && (
            <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
              {t('setup.password.capsLockOn')}
            </p>
          )}
        </div>

        <div>
          <label
            className="block text-sm mb-[var(--space-1)]"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('setup.password.confirmLabel')}
          </label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => onConfirmChange(e.target.value)}
            onKeyDown={(e) => {
              setCapsLockOn(e.getModifierState('CapsLock'))
              if (e.key === 'Enter' && passwordValid) onSubmit()
            }}
            className="w-full px-[var(--space-md)] py-[var(--space-2)] rounded-lg text-sm"
            aria-invalid={!!(confirmPassword && password !== confirmPassword)}
            aria-describedby={error ? 'setup-password-error' : undefined}
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
            placeholder={t('setup.password.confirmPlaceholder')}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
          />
        </div>
      </div>

      {error && (
        <div
          id="setup-password-error"
          role="alert"
          className="mb-[var(--space-md)] p-[var(--space-3)] rounded-lg text-sm"
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
        className="w-full px-[var(--space-lg)] py-[var(--space-2)] rounded-[var(--radius-md)] text-sm font-medium flex items-center justify-center gap-2 btn-base btn-primary"
        style={{ transition: 'none' }}
      >
        {isSubmitting && <LoadingSpinner size="sm" className="text-white" />}
        {isSubmitting ? t('setup.password.creating') : t('setup.password.submit')}
      </button>
    </div>
  )
}
