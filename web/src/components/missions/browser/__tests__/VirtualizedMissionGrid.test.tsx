import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VirtualizedMissionGrid } from '../VirtualizedMissionGrid'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn((options: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({
      index,
      key: `row-${index}`,
      start: index * 100,
    })),
    getTotalSize: () => options.count * 100,
    measureElement: vi.fn(),
  })),
}))

describe('VirtualizedMissionGrid', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1200,
    })
  })

  it('renders one row per item in list mode', () => {
    const items = ['one', 'two', 'three']

    render(
      <VirtualizedMissionGrid
        items={items}
        viewMode="list"
        renderItem={(item, index) => (
          <div data-testid="mission-item">{`${index}:${item}`}</div>
        )}
      />,
    )

    const renderedItems = screen.getAllByTestId('mission-item')
    expect(renderedItems).toHaveLength(3)
    expect(renderedItems[0]).toHaveTextContent('0:one')
    expect(renderedItems[1]).toHaveTextContent('1:two')
    expect(renderedItems[2]).toHaveTextContent('2:three')
  })

  it('chunks items by responsive column count in grid mode', () => {
    const items = ['one', 'two', 'three', 'four', 'five']

    render(
      <VirtualizedMissionGrid
        items={items}
        viewMode="grid"
        maxColumns={4}
        renderItem={(item, index) => (
          <div data-testid="mission-item">{`${index}:${item}`}</div>
        )}
      />,
    )

    const renderedItems = screen.getAllByTestId('mission-item')
    expect(renderedItems).toHaveLength(5)
    expect(renderedItems[0]).toHaveTextContent('0:one')
    expect(renderedItems[1]).toHaveTextContent('1:two')
    expect(renderedItems[2]).toHaveTextContent('2:three')
    expect(renderedItems[3]).toHaveTextContent('3:four')
    expect(renderedItems[4]).toHaveTextContent('4:five')
  })
})
