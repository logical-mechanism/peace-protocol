import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Select from '../Select'

const options = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
]

describe('Select', () => {
  it('renders the selected label on the trigger', () => {
    render(<Select value="en" options={options} onChange={() => {}} />)
    expect(screen.getByRole('button')).toHaveTextContent('English')
  })

  it('falls back to the placeholder when no option matches the value', () => {
    render(<Select value="" options={options} onChange={() => {}} placeholder="Pick one" />)
    expect(screen.getByRole('button')).toHaveTextContent('Pick one')
  })

  it('opens the listbox on click and surfaces every option', () => {
    render(<Select value="en" options={options} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('calls onChange and closes when an option is picked', () => {
    const onChange = vi.fn()
    render(<Select value="en" options={options} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('option', { name: 'Français' }))
    expect(onChange).toHaveBeenCalledWith('fr')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows a search field when options exceed the threshold', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }))
    render(<Select value="v0" options={many} onChange={() => {}} searchThreshold={6} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('filters options by the search query (case-insensitive)', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ value: `v${i}`, label: i === 3 ? 'Unique' : `Option ${i}` }))
    render(<Select value="v0" options={many} onChange={() => {}} searchThreshold={6} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'uniq' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('Unique')
  })

  it('disables interaction when disabled', () => {
    const onChange = vi.fn()
    render(<Select value="en" options={options} onChange={onChange} disabled />)
    const trigger = screen.getByRole('button')
    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
