/**
 * ServiceDrillDown Component Tests
 */
import { describe, it, expect } from 'vitest'
import * as mod from '../ServiceDrillDown'

describe('ServiceDrillDown', () => {
  it('exports ServiceDrillDown component', () => {
    expect(mod.default).toBeDefined()
    expect(typeof mod.default).toBe('function')
  })
})
