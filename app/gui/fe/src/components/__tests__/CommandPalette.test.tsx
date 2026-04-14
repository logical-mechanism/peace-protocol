import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import CommandPalette from '../CommandPalette'
import { ModalProvider } from '../../contexts/ModalContext'

function renderPalette(overrides: {
  isOpen?: boolean
  onClose?: () => void
  onExecute?: (id: string) => void
} = {}) {
  const props = {
    isOpen: overrides.isOpen ?? true,
    onClose: overrides.onClose ?? vi.fn(),
    onExecute: overrides.onExecute ?? vi.fn(),
  }
  return {
    ...render(
      <ModalProvider>
        <CommandPalette {...props} />
      </ModalProvider>,
    ),
    props,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ModalProvider>
        <CommandPalette isOpen={false} onClose={vi.fn()} onExecute={vi.fn()} />
      </ModalProvider>,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders search input and all categories when open', () => {
    renderPalette()
    expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()
    expect(screen.getByText('Navigation')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('filters commands as user types', () => {
    renderPalette()
    const input = screen.getByPlaceholderText('Type a command...')
    fireEvent.change(input, { target: { value: 'marketplace' } })
    expect(screen.getByText('Go to Marketplace')).toBeInTheDocument()
    expect(screen.queryByText('Toggle Theme')).toBeNull()
  })

  it('shows empty state when no commands match', () => {
    renderPalette()
    const input = screen.getByPlaceholderText('Type a command...')
    fireEvent.change(input, { target: { value: 'zzznomatch' } })
    expect(screen.getByText('No matching commands')).toBeInTheDocument()
  })

  it('executes command on Enter', () => {
    const onExecute = vi.fn()
    const onClose = vi.fn()
    renderPalette({ onExecute, onClose })
    const input = screen.getByPlaceholderText('Type a command...')
    fireEvent.change(input, { target: { value: 'marketplace' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onExecute).toHaveBeenCalledWith('tab-marketplace')
    expect(onClose).toHaveBeenCalled()
  })

  it('executes command on click', () => {
    const onExecute = vi.fn()
    const onClose = vi.fn()
    renderPalette({ onExecute, onClose })
    fireEvent.click(screen.getByText('Go to Marketplace'))
    expect(onExecute).toHaveBeenCalledWith('tab-marketplace')
    expect(onClose).toHaveBeenCalled()
  })

  it('arrow keys navigate selection', () => {
    renderPalette()
    const input = screen.getByPlaceholderText('Type a command...')
    // Filter to known small set
    fireEvent.change(input, { target: { value: 'go to' } })
    // First item selected by default
    const firstBtn = screen.getByText('Go to Marketplace').closest('button')
    expect(firstBtn?.className).toContain('accent-muted')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const secondBtn = screen.getByText('Go to My Sales').closest('button')
    expect(secondBtn?.className).toContain('accent-muted')

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(firstBtn?.className).toContain('accent-muted')
  })

  it('closes when backdrop is clicked', () => {
    const onClose = vi.fn()
    renderPalette({ onClose })
    const backdrop = document.querySelector('[aria-hidden="true"]')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop!)
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape key triggers close via modal stack', () => {
    const onClose = vi.fn()
    renderPalette({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shortcut hints render for commands that have them', () => {
    renderPalette()
    expect(screen.getByText('Ctrl+1')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+R')).toBeInTheDocument()
  })

  it('Enter with no matches does nothing', () => {
    const onExecute = vi.fn()
    const onClose = vi.fn()
    renderPalette({ onExecute, onClose })
    const input = screen.getByPlaceholderText('Type a command...')
    fireEvent.change(input, { target: { value: 'zzznomatch' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onExecute).not.toHaveBeenCalled()
  })
})
