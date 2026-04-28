/**
 * PVCDrillDown Component Tests
 */
import { describe, it, expect } from 'vitest'
import * as mod from '../PVCDrillDown'

describe('PVCDrillDown', () => {
  it('exports PVCDrillDown component', () => {
    expect(mod.PVCDrillDown).toBeDefined()
    expect(typeof mod.PVCDrillDown).toBe('function')
  })
})
