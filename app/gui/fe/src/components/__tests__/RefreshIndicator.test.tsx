import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import RefreshIndicator from '../RefreshIndicator'

describe('RefreshIndicator', () => {
  it('renders nothing when visible is false', () => {
    const { container } = render(<RefreshIndicator visible={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the bar when visible is true', () => {
    render(<RefreshIndicator visible={true} />)
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
  })

  it('has correct aria-label for screen readers', () => {
    render(<RefreshIndicator visible={true} />)
    expect(screen.getByLabelText('Refreshing data')).toBeInTheDocument()
  })

  it('contains the animated bar element', () => {
    render(<RefreshIndicator visible={true} />)
    const status = screen.getByRole('status')
    const bar = status.firstElementChild
    expect(bar).not.toBeNull()
    expect(bar!.classList.contains('animate-refresh-bar')).toBe(true)
  })
})
