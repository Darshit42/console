/**
 * AttestationDrillDown Component Tests
 */
import { describe, it, expect } from 'vitest'
import * as mod from '../AttestationDrillDown'

describe('AttestationDrillDown', () => {
  it('exports AttestationDrillDown component', () => {
    expect(mod.AttestationDrillDown).toBeDefined()
    expect(typeof mod.AttestationDrillDown).toBe('function')
  })
})
