import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StarmapGraph } from '@/types/hermes'

const { fetches } = vi.hoisted(() => ({
  fetches: [] as Array<{ reject: (error: unknown) => void; resolve: (graph: StarmapGraph) => void }>
}))

vi.mock('@/hermes', () => ({
  getStarmapGraph: () =>
    new Promise<StarmapGraph>((resolve, reject) => {
      fetches.push({ reject, resolve })
    })
}))

const { $starmapError, $starmapGraph, $starmapLoading, loadStarmapGraph, resetStarmapGraph, watchStarmapGraph } =
  await import('./starmap')

const graph = (id: string): StarmapGraph => ({ edges: [], nodes: [{ id }] }) as unknown as StarmapGraph

beforeEach(async () => {
  // Settle leftovers from a previous test so its flight cannot write here.
  while (fetches.length) {
    fetches.shift()?.resolve(graph('leftover'))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  resetStarmapGraph()
  $starmapLoading.set(false)
})

describe('loadStarmapGraph', () => {
  it('drops the previous profile graph when a reset lands mid-load', async () => {
    const previous = loadStarmapGraph()
    resetStarmapGraph()
    const current = loadStarmapGraph()

    expect(fetches).toHaveLength(2)
    fetches[1].resolve(graph('current-node'))
    await current
    fetches[0].resolve(graph('previous-node'))
    await previous

    expect($starmapGraph.get()?.nodes.map(node => node.id)).toEqual(['current-node'])
    expect($starmapLoading.get()).toBe(false)
  })

  it('keeps the newer in-flight slot when the stranded load settles first', async () => {
    const previous = loadStarmapGraph()
    resetStarmapGraph()
    const current = loadStarmapGraph()

    fetches[0].reject(new Error('previous profile went away'))
    await previous

    expect($starmapError.get()).toBeNull()
    expect($starmapLoading.get()).toBe(true)
    // A caller arriving now joins the current profile's load, not a new fetch.
    void loadStarmapGraph()
    expect(fetches).toHaveLength(2)

    fetches[1].resolve(graph('current-node'))
    await current

    expect($starmapGraph.get()?.nodes.map(node => node.id)).toEqual(['current-node'])
    expect($starmapLoading.get()).toBe(false)
  })

  it('serves the cached graph without refetching', async () => {
    const pending = loadStarmapGraph()
    fetches[0].resolve(graph('cached-node'))
    await pending

    await loadStarmapGraph()

    expect(fetches).toHaveLength(1)
    expect($starmapGraph.get()?.nodes.map(node => node.id)).toEqual(['cached-node'])
  })

  // Nothing else reloads after a profile or gateway switch: the view loads on mount only.
  it('reloads an open star map after a reset strands its first load', async () => {
    const unwatch = watchStarmapGraph()

    try {
      expect(fetches).toHaveLength(1)
      resetStarmapGraph()
      expect(fetches).toHaveLength(2)

      fetches[1].resolve(graph('current-node'))
      fetches[0].resolve(graph('previous-node'))
      await vi.waitFor(() => expect($starmapGraph.get()?.nodes.map(node => node.id)).toEqual(['current-node']))
      expect($starmapLoading.get()).toBe(false)
    } finally {
      unwatch()
    }
  })

  it('reloads an open star map that already showed the previous scope', async () => {
    const unwatch = watchStarmapGraph()

    try {
      fetches[0].resolve(graph('previous-node'))
      await vi.waitFor(() => expect($starmapGraph.get()).not.toBeNull())
      resetStarmapGraph()

      expect($starmapGraph.get()).toBeNull()
      expect(fetches).toHaveLength(2)
      fetches[1].resolve(graph('current-node'))
      await vi.waitFor(() => expect($starmapGraph.get()?.nodes.map(node => node.id)).toEqual(['current-node']))
    } finally {
      unwatch()
    }
  })

  it('does not fetch on a reset while the star map is closed', () => {
    const unwatch = watchStarmapGraph()
    unwatch()
    fetches.shift()?.resolve(graph('closed'))

    resetStarmapGraph()

    expect(fetches).toHaveLength(0)
  })
})
