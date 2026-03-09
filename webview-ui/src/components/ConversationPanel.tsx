import { useEffect, useRef, useState, useCallback } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import type { ConversationEntry } from '../office/types.js'
import { CONVERSATION_PANEL_MIN_HEIGHT, CONVERSATION_PANEL_DEFAULT_HEIGHT } from '../constants.js'

interface ConversationPanelProps {
  officeState: OfficeState
  selectedAgent: number | null
  agentConversation: Record<number, ConversationEntry[]>
}

export function ConversationPanel({
  officeState,
  selectedAgent,
  agentConversation,
}: ConversationPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(CONVERSATION_PANEL_DEFAULT_HEIGHT)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const resizingRef = useRef(false)
  const resizeStartRef = useRef({ y: 0, height: 0 })

  const entries = selectedAgent !== null ? agentConversation[selectedAgent] || [] : []
  const character = selectedAgent !== null ? officeState.characters.get(selectedAgent) : undefined

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  // Track scroll position for auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    autoScrollRef.current = atBottom
  }, [])

  // Resize drag handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    resizeStartRef.current = { y: e.clientY, height }
    const handleMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = resizeStartRef.current.y - ev.clientY
      const newHeight = Math.max(CONVERSATION_PANEL_MIN_HEIGHT, resizeStartRef.current.height + delta)
      setHeight(newHeight)
    }
    const handleUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [height])

  if (selectedAgent === null || !character) return null

  const agentName = character.name || `Agent #${selectedAgent}`
  const projectName = character.projectName || character.folderName || ''

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 40,
        left: 0,
        right: 0,
        height: collapsed ? 'auto' : height,
        zIndex: 'var(--pixel-controls-z)' as unknown as number,
        background: 'var(--pixel-bg)',
        borderTop: '2px solid var(--pixel-border)',
        boxShadow: '0 -2px 0px #0a0a14',
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
      }}
    >
      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: 'absolute',
            top: -4,
            left: 0,
            right: 0,
            height: 8,
            cursor: 'ns-resize',
            zIndex: 1,
          }}
        />
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '3px 8px',
          borderBottom: collapsed ? 'none' : '1px solid var(--pixel-border)',
          flexShrink: 0,
          gap: 6,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: character.isActive ? 'var(--pixel-status-active)' : 'rgba(255,255,255,0.2)',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: '22px', color: 'var(--pixel-text)', userSelect: 'none' }}>
          {agentName}
        </span>
        {projectName && (
          <span style={{ fontSize: '18px', color: 'var(--pixel-text-dim)', userSelect: 'none' }}>
            {projectName}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setCollapsed((p) => !p)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pixel-text-dim)',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '0 4px',
            userSelect: 'none',
          }}
        >
          {collapsed ? '\u25B2' : '\u25BC'}
        </button>
      </div>

      {/* Scrollable message list */}
      {!collapsed && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '4px 8px',
          }}
        >
          {entries.length === 0 ? (
            <div style={{ fontSize: '18px', color: 'var(--pixel-text-dim)', padding: '8px 0', userSelect: 'none' }}>
              No conversation yet...
            </div>
          ) : (
            entries.map((entry, i) => <EntryRow key={i} entry={entry} />)
          )}
        </div>
      )}
    </div>
  )
}

function EntryRow({ entry }: { entry: ConversationEntry }) {
  switch (entry.kind) {
    case 'assistant_text':
      return (
        <div style={{ fontSize: '18px', color: 'var(--pixel-text)', padding: '2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {entry.content}
        </div>
      )
    case 'tool_use':
      return (
        <div style={{ fontSize: '18px', color: 'var(--pixel-accent)', padding: '2px 0' }}>
          <span style={{ opacity: 0.6 }}>{'\u2502'} </span>
          {entry.content}
        </div>
      )
    case 'tool_result':
      return (
        <div
          style={{
            fontSize: '16px',
            color: 'var(--pixel-text-dim)',
            padding: '1px 0 1px 12px',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            opacity: 0.7,
          }}
        >
          {entry.content || '(empty)'}
        </div>
      )
    case 'user_text':
      return (
        <div style={{ fontSize: '18px', color: 'var(--pixel-green)', padding: '2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <span style={{ opacity: 0.6 }}>&gt; </span>
          {entry.content}
        </div>
      )
    case 'turn_end':
      return (
        <div
          style={{
            borderBottom: '1px solid var(--pixel-border)',
            margin: '4px 0',
          }}
        />
      )
    default:
      return null
  }
}
