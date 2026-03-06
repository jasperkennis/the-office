import { useState } from 'react'
import type { ToolActivity } from '../office/types.js'
import type { OfficeState } from '../office/engine/officeState.js'
import { vscode } from '../vscodeApi.js'

interface AgentSidebarProps {
  officeState: OfficeState
  agents: number[]
  selectedAgent: number | null
  agentTools: Record<number, ToolActivity[]>
  agentStatuses: Record<number, string>
}

/** Derive a short activity label from current tools */
function getActivity(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId]
  if (tools && tools.length > 0) {
    const activeTool = [...tools].reverse().find((t) => !t.done)
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval'
      return activeTool.status
    }
    if (isActive) {
      const lastTool = tools[tools.length - 1]
      if (lastTool) return lastTool.status
    }
  }
  return ''
}

/** Status dot color for an agent */
function getDotInfo(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  agentStatuses: Record<number, string>,
  isActive: boolean,
): { color: string; pulse: boolean } | null {
  const tools = agentTools[agentId]
  const hasPermission = tools?.some((t) => t.permissionWait && !t.done)
  const hasActiveTools = tools?.some((t) => !t.done)
  const status = agentStatuses[agentId]

  if (hasPermission) {
    return { color: 'var(--pixel-status-permission)', pulse: false }
  }
  if (status === 'waiting') {
    return { color: 'var(--pixel-status-permission)', pulse: false }
  }
  if (isActive && hasActiveTools) {
    return { color: 'var(--pixel-status-active)', pulse: true }
  }
  if (isActive) {
    return { color: 'var(--pixel-status-active)', pulse: true }
  }
  return null
}

/** Group agent IDs by their room/project name */
function groupByRoom(agents: number[], officeState: OfficeState): Map<string, number[]> {
  const groups = new Map<string, number[]>()
  // Use room order from officeState.rooms so groups match spatial layout
  for (const room of officeState.rooms) {
    groups.set(room.projectName, [])
  }
  for (const id of agents) {
    const ch = officeState.characters.get(id)
    if (!ch || ch.isSubagent) continue
    const project = ch.projectName || ch.folderName || ''
    let list = groups.get(project)
    if (!list) {
      list = []
      groups.set(project, list)
    }
    list.push(id)
  }
  return groups
}

export function AgentSidebar({
  officeState,
  agents,
  selectedAgent,
  agentTools,
  agentStatuses,
}: AgentSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  if (agents.length === 0) return null

  const handleClick = (id: number) => {
    officeState.selectedAgentId = id
    officeState.cameraFollowId = id
    vscode.postMessage({ type: 'focusAgent', id })
  }

  const roomGroups = groupByRoom(agents, officeState)

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        boxShadow: 'var(--pixel-shadow)',
        minWidth: collapsed ? undefined : 140,
        maxWidth: 220,
        maxHeight: 'calc(100% - 20px)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 6px',
          borderBottom: collapsed ? 'none' : '2px solid var(--pixel-border)',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed((p) => !p)}
      >
        <span style={{ fontSize: '20px', color: 'var(--pixel-text)', userSelect: 'none' }}>
          Agents ({agents.length})
        </span>
        <span style={{ fontSize: '16px', color: 'var(--pixel-text-dim)', userSelect: 'none', marginLeft: 6 }}>
          {collapsed ? '\u25B6' : '\u25BC'}
        </span>
      </div>

      {/* Agent list grouped by room */}
      {!collapsed && (
        <div style={{ overflowY: 'auto', overflowX: 'hidden' }}>
          {[...roomGroups.entries()].map(([projectName, ids]) => {
            if (ids.length === 0) return null
            return (
              <div key={projectName}>
                {/* Room header */}
                <div
                  style={{
                    padding: '3px 6px',
                    fontSize: '16px',
                    color: 'var(--pixel-green)',
                    background: 'rgba(90, 200, 140, 0.08)',
                    borderBottom: '1px solid var(--pixel-border)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                  }}
                >
                  {projectName || 'Unassigned'}
                </div>

                {/* Agents in this room */}
                {ids.map((id) => {
                  const ch = officeState.characters.get(id)
                  if (!ch) return null

                  const isSelected = selectedAgent === id
                  const isHovered = hoveredId === id
                  const activity = getActivity(id, agentTools, ch.isActive)
                  const dot = getDotInfo(id, agentTools, agentStatuses, ch.isActive)
                  const status = agentStatuses[id]
                  const isWaiting = status === 'waiting'
                  const isIdle = !ch.isActive && !activity && !isWaiting

                  return (
                    <div
                      key={id}
                      onClick={() => handleClick(id)}
                      onMouseEnter={() => { setHoveredId(id); officeState.hoveredAgentId = id }}
                      onMouseLeave={() => { setHoveredId(null); officeState.hoveredAgentId = null }}
                      style={{
                        padding: '4px 6px',
                        cursor: 'pointer',
                        background: isSelected
                          ? 'var(--pixel-active-bg)'
                          : isHovered
                            ? 'var(--pixel-btn-hover-bg)'
                            : 'transparent',
                        borderBottom: '1px solid var(--pixel-border)',
                      }}
                    >
                      {/* Name row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span
                          className={dot?.pulse ? 'pixel-agents-pulse' : undefined}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: dot ? dot.color : 'rgba(255,255,255,0.2)',
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: '20px',
                            color: isSelected ? '#fff' : 'var(--pixel-text)',
                            fontWeight: isSelected ? 'bold' : undefined,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {ch.name || `Agent #${id}`}
                        </span>
                      </div>

                      {/* Activity row */}
                      {(activity || isWaiting || isIdle) && (
                        <div
                          style={{
                            fontSize: '16px',
                            color: 'var(--pixel-text-dim)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            paddingLeft: 10,
                            marginTop: 1,
                          }}
                        >
                          {isWaiting ? 'Waiting for input' : activity || (ch.isActive ? 'Thinking...' : 'Idle')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
