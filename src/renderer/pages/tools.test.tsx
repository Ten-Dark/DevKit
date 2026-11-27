// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ToolsPage, { tools } from './tools'

afterEach(() => {
  cleanup()
})

describe('Tools catalog', () => {
  it('contains exactly the two implemented tools', () => {
    expect(tools).toHaveLength(2)
    expect(tools.map((tool) => tool.id)).toEqual([
      'project-to-markdown',
      'xmind-to-markdown',
    ])
  })

  it('does not include unsupported tools or Settings', () => {
    const ids = tools.map((tool) => tool.id)

    expect(ids).not.toContain('open-directory')
    expect(ids).not.toContain('read-file')
    expect(ids).not.toContain('write-file')
    expect(ids).not.toContain('clipboard')
    expect(ids).not.toContain('terminal')
    expect(ids).not.toContain('settings')
    expect(ids).not.toContain('/tools/xmind-to-markdown')
  })

  it('renders the supplied favorite state and adds a tool to favorites', () => {
    const onToggleFavorite = vi.fn()
    render(<ToolsPage favorites={[]} onToggleFavorite={onToggleFavorite} />)

    expect(screen.getByRole('button', { name: 'Add Project to Markdown to favorites' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add Project to Markdown to favorites' }))
    expect(onToggleFavorite).toHaveBeenCalledWith('project-to-markdown')
  })

  it('removes an existing favorite using the shared callback', () => {
    const onToggleFavorite = vi.fn()
    render(
      <ToolsPage
        favorites={['xmind-to-markdown']}
        onToggleFavorite={onToggleFavorite}
      />,
    )

    expect(screen.getByRole('button', { name: 'Remove XMind to Markdown from favorites' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove XMind to Markdown from favorites' }))
    expect(onToggleFavorite).toHaveBeenCalledWith('xmind-to-markdown')
  })

  it('sends the corresponding destination when each tool card is selected', () => {
    const onSelect = vi.fn()
    render(
      <ToolsPage
        onSelect={onSelect}
        favorites={[]}
        onToggleFavorite={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Project to Markdown' }))
    expect(onSelect).toHaveBeenLastCalledWith('project-to-markdown')

    fireEvent.click(screen.getByRole('button', { name: 'Open XMind to Markdown' }))
    expect(onSelect).toHaveBeenLastCalledWith('xmind-to-markdown')
    expect(onSelect).toHaveBeenCalledTimes(2)
  })
})
