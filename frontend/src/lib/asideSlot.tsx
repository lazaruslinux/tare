import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// What the page underneath wants in the right-hand column. The column belongs
// to the shell rather than to any one screen, so a page with something better
// to say there hands it over and the aside draws it in place of its own top
// block.
//
// Two contexts rather than one: the setter never changes, so the page filling
// the slot is not redrawn every time the slot it filled is read.

const SetSlot = createContext<(node: ReactNode | null) => void>(() => undefined)
const SlotNode = createContext<ReactNode | null>(null)

export function AsideSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode | null>(null)
  return (
    <SetSlot.Provider value={setNode}>
      <SlotNode.Provider value={node}>{children}</SlotNode.Provider>
    </SetSlot.Provider>
  )
}

// Fills the column while the caller is on screen and empties it on the way
// out. What a page puts there is built from its own state, so the node is a
// new one on every render and the column follows it.
export function useAsideSlot(node: ReactNode | null): void {
  const setNode = useContext(SetSlot)
  useEffect(() => {
    setNode(node)
    return () => setNode(null)
  }, [node, setNode])
}

export function useAsideSlotNode(): ReactNode | null {
  return useContext(SlotNode)
}
