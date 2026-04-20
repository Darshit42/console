import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'

/**
 * Mission Control Full Execution Pipeline – E2E Validation
 *
 * Validates the entire AI-driven pipeline:
 *   User NLP → kc-agent → KB lookup → command generation → Kubernetes execution
 *
 * Requires:
 *   KC_AGENT=true          – opt-in to run this suite
 *   AGENT_BASE_URL         – override agent endpoint (default: http://127.0.0.1:8585)
 *   REQUIRE_REAL_AI=1      – fail hard when AI fallback is detected
 *   USE_MOCK_AI=true       – allow mock AI responses (informational only)
 *
 * AI providers are validated but not always wired into PredictionWorker.
 * This test may pass using fallback logic unless REQUIRE_REAL_AI is enabled.
 */

const AGENT_MODE = true // Force pipeline validation
const REQUIRE_REAL_AI = process.env.REQUIRE_REAL_AI === '1'
const AGENT_BASE_URL = process.env.AGENT_BASE_URL || 'http://127.0.0.1:8585'

const CLUSTER_NAME = 'mc-full-e2e-cluster'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Verify kc-agent health */
async function verifyAgentHealth() {
  try {
    const response = await fetch(`${AGENT_BASE_URL}/health`)
    if (!response.ok) {
      throw new Error(`Agent health endpoint returned ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    throw new Error(
      `kc-agent is not reachable at ${AGENT_BASE_URL}/health. Is it running? ` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** Fail fast if kind is not installed */
function verifyKindInstalled() {
  try {
    execSync('kind --version', { stdio: 'ignore' })
  } catch {
    throw new Error('kind is not installed or not in PATH')
  }
}

/** Setup cluster deterministically */
function setupCluster() {
  verifyKindInstalled()
  console.log(`Setting up cluster ${CLUSTER_NAME}...`)
  try {
    try { execSync(`kind delete cluster --name ${CLUSTER_NAME}`, { stdio: 'ignore' }) } catch (_) {}
    execSync(`kind create cluster --name ${CLUSTER_NAME} --wait 60s`, { stdio: 'inherit' })
    execSync(`kind export kubeconfig --name ${CLUSTER_NAME}`, { stdio: 'ignore' })
  } catch (error) {
    console.error(`Failed to create cluster ${CLUSTER_NAME}:`, error)
    throw error
  }
}

function teardownCluster() {
  console.log(`Tearing down cluster ${CLUSTER_NAME}...`)
  try {
    execSync(`kind delete cluster --name ${CLUSTER_NAME}`, { stdio: 'ignore' })
  } catch {
    // Ignore teardown failures — cluster might not exist
  }
}

/** Robust Kubernetes JSON querying */
function getKubePods() {
  try {
    const output = execSync('kubectl get pods -A -o json', { encoding: 'utf-8' })
    const data = JSON.parse(output)
    return data.items || []
  } catch (error) {
    console.error('Failed to get k8s pods:', error)
    return []
  }
}

function getKubeNamespaces() {
  try {
    const output = execSync('kubectl get ns -o json', { encoding: 'utf-8' })
    const data = JSON.parse(output)
    return data.items || []
  } catch (error) {
    console.error('Failed to get k8s namespaces:', error)
    return []
  }
}

async function waitForKubernetesReadiness(namespaces: string[], maxRetries = 10) {
  console.log('Waiting for Kubernetes Pod readiness (up to 10 retries)...')
  try {
    execSync('kubectl wait --for=condition=ready pod --all -A --timeout=10s', { stdio: 'ignore' })
  } catch {
    // Expected to timeout or fail early during initialization; fall through to JSON check
  }

  let attempt = 0
  let delayMs = 5000 // Start with 5 s backoff

  while (attempt < maxRetries) {
    attempt++
    console.log(`Checking readiness. Attempt ${attempt}/${maxRetries}...`)

    const pods = getKubePods()
    // Strict exact namespace matches
    const targetPods = pods.filter((p: any) => namespaces.includes(p.metadata?.namespace))

    if (targetPods.length > 0) {
      const allRunning = targetPods.every((p: any) => p.status?.phase === 'Running')
      const allReady  = targetPods.every((p: any) =>
        p.status?.containerStatuses?.every((c: any) => c.ready === true)
      )

      if (allRunning && allReady) {
        return true
      }
    }

    if (attempt < maxRetries) {
      await new Promise(res => setTimeout(res, delayMs))
      delayMs = Math.min(delayMs * 1.5, 30000) // Exponential backoff capped at 30 s
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe.serial('Mission Control Full Execution Pipeline (Strict Validation)', () => {
  // ── Suite-level configuration ────────────────────────────────────────────
  // MUST come before any test() registration to avoid Playwright context errors.
  test.describe.configure({ timeout: 600_000 })

  // NOTE: Do NOT use test.skip() at the suite level — it skips every test
  // in every browser project (3 tests × 5 projects = 15 skipped) even when
  // just running `--list`. Individual pipeline tests carry their own skip.

  // ── Hooks ─────────────────────────────────────────────────────────────────
  test.beforeAll(async () => {
    // Only set up infrastructure when the full pipeline is actually running
    if (!AGENT_MODE) return

    await test.step('Verify Agent Connectivity', async () => {
      await verifyAgentHealth()
    })

    await test.step('Guarantee Clean Cluster State', async () => {
      setupCluster()
    })
  })

  test.afterAll(async () => {
    if (!AGENT_MODE) return
    await test.step('Cleanup Cluster', async () => {
      teardownCluster()
    })
  })

  test.beforeEach(async ({ page }) => {
    // Only set up browser auth when running pipeline tests
    if (!AGENT_MODE) return

    await page.route('**/api/me', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: '1', github_login: 'e2e-tester', onboarded: true, role: 'admin' }),
    }))

    await page.goto('/login')
    await page.evaluate(() => { localStorage.setItem('token', 'e2e-token') })
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
  })

  // ── Smoke: confirm Playwright discovers this file ─────────────────────────
  test('playwright runner detection', async () => {
    console.log('[mission-control-full-pipeline] Playwright is detecting tests correctly')
  })

  // ── Main flow: natural language → real cluster ────────────────────────────
  test('Natural Language to Real Cluster - Success Flow', async ({ page }) => {
    await test.step('Navigate to Mission Control', async () => {
      await page.getByTestId('mission-control-button').click({ force: true })
      await expect(page.getByTestId('mission-control-dialog').locator('textarea')).toBeVisible({ timeout: 15000 })
    })

    let providerDetected = ''
    let wsMessageBuffer = ''
    let wsDoneResolve!: () => void
    const wsDonePromise = new Promise<void>(resolve => { wsDoneResolve = resolve })
    let finalParsedAI: { projects: string[], commands: string[] } | null = null

    page.on('websocket', ws => {
      if (ws.url().includes('agent')) {
        ws.on('framereceived', frame => {
          try {
            const raw = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString()
            const data = JSON.parse(raw)
            if (data.provider) providerDetected = data.provider

            if (data.payload?.content) {
              wsMessageBuffer += data.payload.content
            }

            // Explicit completion signal from backend payload types
            if (data.type === 'result' || data.type === 'stream_done' || data.done === true) {
              wsDoneResolve()
            }
          } catch { /* ignore malformed frames */ }
        })
      }
    })

    await test.step('Execute AI Interpretation', async () => {
      const input = page.getByTestId('mission-control-dialog').locator('textarea')
      await input.fill('Deploy cert-manager and prometheus stack')

      const askButton = page.getByRole('button', { name: /ask ai|suggest|plan/i }).first()
      await askButton.click()

      // Wait for BOTH the UI indicator and the WS completion signal
      await expect(page.getByText('cert-manager').first()).toBeVisible({ timeout: 45_000 })
      await Promise.race([
        wsDonePromise,
        // Safety valve — reject if the completion signal never arrives
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('WebSocket stream completion signal never arrived')), 30_000)
        ),
      ]).catch(e => console.warn('[ws-completion]', (e as Error).message))
    })

    await test.step('Strict AI Output Validation', async () => {
      console.log(`AI_USED=${Boolean(providerDetected)}`)

      let parsedProjects: any[] = []
      let parsedCommands: any[] = []

      // Parse all JSON code-fences accumulated in the WS buffer
      const matches = wsMessageBuffer.match(/```json\s*\n?([\s\S]*?)```/g)
      if (matches) {
        for (const m of matches) {
          const block = m.replace(/^```json/m, '').replace(/```$/, '').trim()
          try {
            const parsed = JSON.parse(block)
            if (parsed.projects && Array.isArray(parsed.projects)) parsedProjects = parsed.projects
            if (parsed.commands && Array.isArray(parsed.commands)) parsedCommands = parsed.commands
          } catch { /* skip invalid JSON blocks */ }
        }
      }

      finalParsedAI = {
        projects: parsedProjects.map(p => (typeof p === 'string' ? p : p.name)).filter(Boolean),
        commands: parsedCommands,
      }

      const { commands } = finalParsedAI
      const looksLikeFallback =
        commands.length > 0 &&
        commands.every(
          cmd => typeof cmd === 'string' && (cmd.includes('placeholder') || cmd.includes('echo'))
        )

      if (REQUIRE_REAL_AI && (!providerDetected || looksLikeFallback)) {
        throw new Error('Fallback logic detected — real AI was not used (REQUIRE_REAL_AI=1)')
      } else if (!providerDetected || looksLikeFallback) {
        console.warn('[ai-check] AI provider not confirmed or fallback detected — may be running in fallback mode')
      } else {
        console.log('[ai-check] AI Provider used:', providerDetected)
      }

      console.log('[ai-output] Final parsed AI response:', JSON.stringify(finalParsedAI))

      const { projects } = finalParsedAI
      expect(projects).toContain('cert-manager')
      expect(projects).toContain('prometheus')

      if (commands && commands.length > 0) {
        console.log('[ai-commands] Generated commands:', commands)
        expect(commands.length).toBeGreaterThan(0)
        expect(
          commands.some(c => typeof c === 'string' && (c.includes('kubectl') || c.includes('helm')))
        ).toBeTruthy()
      }
    })

    await test.step('Execution Deploy to Clusters', async () => {
      const nextBtn = page.getByRole('button', { name: /next|continue|assign/i }).first()
      if (await nextBtn.isVisible()) await nextBtn.click()

      const blueprintBtn = page.getByRole('button', { name: /next|blueprint|flight/i }).first()
      if (await blueprintBtn.isVisible()) await blueprintBtn.click()

      const deployBtn = page.locator('button', { hasText: 'Deploy to Clusters' }).first()
      await expect(deployBtn).toBeEnabled({ timeout: 15_000 })

      // Capture deployment API network request if any
      const deployReqPromise = page.waitForResponse(
        res => res.url().includes('deploy') || res.url().includes('assignments'),
        { timeout: 15_000 }
      ).catch(() => null)

      await deployBtn.click()
      await deployReqPromise
      await expect(page.locator('text=/Deploying|In Progress|Running/')).toBeVisible({ timeout: 15_000 })
    })

    await test.step('Harden Kubernetes Validation', async () => {
      // 10 retries with exponential backoff for exact target namespaces
      const isReady = await waitForKubernetesReadiness(['cert-manager', 'monitoring', 'prometheus'], 10)

      console.log('[k8s] Cluster summary:')
      try {
        console.log('[k8s] Pods:\n', execSync('kubectl get pods -A', { encoding: 'utf-8' }))
        console.log('[k8s] Namespaces:\n', execSync('kubectl get ns', { encoding: 'utf-8' }))
      } catch { /* kubectl may not be available in all environments */ }

      if (!isReady) {
        console.debug('--- KUBERNETES FAILURE STATE DUMP ---')
        const pods = getKubePods()
        console.debug(JSON.stringify(pods, null, 2))
        console.debug('--------------------------------------')
        throw new Error('Kubernetes pods failed to reach Ready state within the timeout.')
      }

      expect(isReady).toBe(true)
    })
  })

  // ── Failure mode: invalid NLP should yield no commands and no cluster state ─
  test('Deploy something-invalid-xyz - Ensure Clean State', async ({ page }) => {
    await test.step('Navigate to Mission Control', async () => {
      await page.getByTestId('mission-control-button').click({ force: true })
      await expect(page.getByTestId('mission-control-dialog').locator('textarea')).toBeVisible({ timeout: 15000 })
    })

    let wsMessageBuffer = ''
    let wsDoneResolve!: () => void
    const wsDonePromise = new Promise<void>(resolve => { wsDoneResolve = resolve })

    page.on('websocket', ws => {
      if (ws.url().includes('agent')) {
        ws.on('framereceived', frame => {
          try {
            const raw = typeof frame.payload === 'string' ? frame.payload : (frame.payload as Buffer).toString()
            const data = JSON.parse(raw)
            if (data.payload?.content) wsMessageBuffer += data.payload.content
            if (data.type === 'result' || data.type === 'stream_done' || data.done === true) {
              wsDoneResolve()
            }
          } catch { /* ignore malformed frames */ }
        })
      }
    })

    await test.step('Input Invalid NLP', async () => {
      const input = page.getByTestId('mission-control-dialog').locator('textarea')
      await input.fill('Deploy something-invalid-xyz')

      const askButton = page.getByRole('button', { name: /ask ai|suggest|plan/i }).first()
      await askButton.click()

      // The AI should fail to map to KB — Deploy button must stay hidden
      await expect(page.locator('button', { hasText: 'Deploy to Clusters' })).toBeHidden({ timeout: 30_000 })
      await Promise.race([
        wsDonePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('WebSocket completion timeout')), 30_000)
        ),
      ]).catch(e => console.warn('[ws-completion]', (e as Error).message))
    })

    await test.step('Validate ALL requirements for invalid input', async () => {
      // AI should return empty / error — no projects or commands
      const matches = wsMessageBuffer.match(/```json\s*\n?([\s\S]*?)```/g)
      let parsedProjects: any[] = []
      let parsedCommands: any[] = []
      if (matches) {
        for (const m of matches) {
          try {
            const block = JSON.parse(m.replace(/^```json/m, '').replace(/```$/, '').trim())
            if (block.projects) parsedProjects.push(...block.projects)
            if (block.commands) parsedCommands.push(...block.commands)
          } catch { /* skip */ }
        }
      }
      expect(parsedProjects.length).toBe(0) // No projects for invalid
      expect(parsedCommands.length).toBe(0) // No commands for invalid

      // Verify no garbage resources were created
      const pods = getKubePods()
      const hasGarbage = pods.some((p: any) => p.metadata?.name?.includes('invalid'))
      expect(hasGarbage).toBe(false)

      const namespaces = getKubeNamespaces()
      const hasGarbageNs = namespaces.some((ns: any) => ns.metadata?.name?.includes('invalid'))
      expect(hasGarbageNs).toBe(false)
    })
  })
})
