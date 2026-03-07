import { useState } from 'react'
import type { ToolActivity } from '../office/types.js'
import type { OfficeState } from '../office/engine/officeState.js'
import type { OfflineAgent } from '../hooks/useExtensionMessages.js'
import { vscode } from '../vscodeApi.js'

interface AgentSidebarProps {
  officeState: OfficeState
  agents: number[]
  selectedAgent: number | null
  onSelectAgent: (id: number | null) => void
  agentTools: Record<number, ToolActivity[]>
  agentStatuses: Record<number, string>
  offlineAgents: OfflineAgent[]
  onSaveAgentMeta: () => void
  onForgetAgent: (sessionId: string) => void
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

/** Group offline agents by project name */
function groupOfflineByProject(offlineAgents: OfflineAgent[]): Map<string, OfflineAgent[]> {
  const groups = new Map<string, OfflineAgent[]>()
  for (const agent of offlineAgents) {
    const project = agent.projectName || 'Unknown'
    let list = groups.get(project)
    if (!list) {
      list = []
      groups.set(project, list)
    }
    list.push(agent)
  }
  return groups
}

interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          boxShadow: 'var(--pixel-shadow)',
          padding: '12px',
          minWidth: 240,
          maxWidth: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span style={{ fontSize: '18px', color: 'var(--pixel-text)' }}>
          {message}
        </span>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '4px 12px',
              fontSize: '16px',
              color: 'var(--pixel-text)',
              background: 'var(--pixel-bg)',
              border: '2px solid var(--pixel-border)',
              borderRadius: 0,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '4px 12px',
              fontSize: '16px',
              color: '#fff',
              background: '#c53030',
              border: '2px solid #9b2c2c',
              borderRadius: 0,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

const deleteButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--pixel-text-dim)',
  fontSize: '14px',
  cursor: 'pointer',
  padding: '0 2px',
  flexShrink: 0,
  lineHeight: 1,
}

interface EmployeeFileProps {
  officeState: OfficeState
  agentId: number
  onClose: () => void
  onSave: () => void
}

function EmployeeFile({ officeState, agentId, onClose, onSave }: EmployeeFileProps) {
  const ch = officeState.characters.get(agentId)
  if (!ch) return null

  const [name, setName] = useState(ch.name || '')
  const [roleShort, setRoleShort] = useState(ch.roleShort || '')
  const [roleFull, setRoleFull] = useState(ch.roleFull || '')
  const [workspacePath, setWorkspacePath] = useState(ch.workspacePath || '')

  const handleSave = () => {
    const character = officeState.characters.get(agentId)
    if (!character) return
    character.name = name
    character.roleShort = roleShort
    character.roleFull = roleFull
    character.workspacePath = workspacePath || undefined
    onSave()
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 6px',
    fontSize: '18px',
    color: 'var(--pixel-text)',
    background: 'var(--pixel-bg)',
    border: '2px solid var(--pixel-border)',
    borderRadius: 0,
    outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '16px',
    color: 'var(--pixel-text-dim)',
    marginBottom: 2,
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          boxShadow: 'var(--pixel-shadow)',
          padding: '12px',
          minWidth: 280,
          maxWidth: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '22px', color: 'var(--pixel-text)', fontWeight: 'bold' }}>
            Employee File
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--pixel-text-dim)',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            {'\u2715'}
          </button>
        </div>

        {/* Name */}
        <div>
          <div style={labelStyle}>Name</div>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name"
          />
        </div>

        {/* Short role */}
        <div>
          <div style={labelStyle}>Role (short)</div>
          <input
            style={inputStyle}
            value={roleShort}
            onChange={(e) => setRoleShort(e.target.value)}
            placeholder="e.g. Frontend Dev"
          />
        </div>

        {/* Full role description */}
        <div>
          <div style={labelStyle}>Role (full)</div>
          <textarea
            style={{
              ...inputStyle,
              minHeight: 60,
              resize: 'vertical',
            }}
            value={roleFull}
            onChange={(e) => setRoleFull(e.target.value)}
            placeholder="Full role description..."
          />
        </div>

        {/* Workspace path */}
        <div>
          <div style={labelStyle}>Working Directory</div>
          <input
            style={inputStyle}
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            placeholder="/path/to/project"
          />
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          style={{
            padding: '6px 12px',
            fontSize: '18px',
            color: 'var(--pixel-agent-text)',
            background: 'var(--pixel-agent-bg)',
            border: '2px solid var(--pixel-agent-border)',
            borderRadius: 0,
            cursor: 'pointer',
            alignSelf: 'flex-end',
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}

export function AgentSidebar({
  officeState,
  agents,
  selectedAgent,
  onSelectAgent,
  agentTools,
  agentStatuses,
  offlineAgents,
  onSaveAgentMeta,
  onForgetAgent,
}: AgentSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [hoveredOffline, setHoveredOffline] = useState<string | null>(null)
  const [offlineCollapsed, setOfflineCollapsed] = useState(true)
  const [editingAgentId, setEditingAgentId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ sessionId: string; name: string } | null>(null)

  if (agents.length === 0 && offlineAgents.length === 0) return null

  const handleClick = (id: number) => {
    officeState.selectedAgentId = id
    officeState.cameraFollowId = id
    onSelectAgent(id)
    vscode.postMessage({ type: 'focusAgent', id })
  }

  const roomGroups = groupByRoom(agents, officeState)

  return (
    <>
      {confirmDelete && (
        <ConfirmDialog
          message={`Remove "${confirmDelete.name}" from memory? This cannot be undone.`}
          onConfirm={() => {
            onForgetAgent(confirmDelete.sessionId)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {editingAgentId !== null && (
        <EmployeeFile
          officeState={officeState}
          agentId={editingAgentId}
          onClose={() => setEditingAgentId(null)}
          onSave={onSaveAgentMeta}
        />
      )}
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
          minWidth: collapsed ? undefined : 180,
          maxWidth: 300,
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
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              flex: 1,
                            }}
                          >
                            <span
                              style={{
                                fontSize: '20px',
                                color: isSelected ? '#fff' : 'var(--pixel-text)',
                                fontWeight: isSelected ? 'bold' : undefined,
                              }}
                            >
                              {ch.name || `Agent #${id}`}
                            </span>
                            {ch.roleShort && (
                              <span
                                style={{
                                  fontSize: '16px',
                                  color: 'var(--pixel-accent)',
                                  marginLeft: 6,
                                }}
                              >
                                {ch.roleShort}
                              </span>
                            )}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingAgentId(id)
                            }}
                            title="Employee file"
                            style={{
                              ...deleteButtonStyle,
                              color: isHovered || isSelected ? 'var(--pixel-text-dim)' : 'transparent',
                            }}
                          >
                            {'\u270E'}
                          </button>
                          {ch.sessionId && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmDelete({ sessionId: ch.sessionId!, name: ch.name || `Agent #${id}` })
                              }}
                              title="Remove from memory"
                              style={{
                                ...deleteButtonStyle,
                                color: isHovered || isSelected ? 'var(--pixel-text-dim)' : 'transparent',
                              }}
                            >
                              {'\u{1F5D1}'}
                            </button>
                          )}
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

        {/* Offline agents section */}
        {offlineAgents.length > 0 && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 6px',
                borderTop: '2px solid var(--pixel-border)',
                cursor: 'pointer',
              }}
              onClick={() => setOfflineCollapsed((p) => !p)}
            >
              <span style={{ fontSize: '20px', color: 'var(--pixel-text-dim)', userSelect: 'none' }}>
                Offline ({offlineAgents.length})
              </span>
              <span style={{ fontSize: '16px', color: 'var(--pixel-text-dim)', userSelect: 'none', marginLeft: 6 }}>
                {offlineCollapsed ? '\u25B6' : '\u25BC'}
              </span>
            </div>

            {!offlineCollapsed && (
              <div style={{ overflowY: 'auto', overflowX: 'hidden' }}>
                {[...groupOfflineByProject(offlineAgents).entries()].map(([projectName, offAgents]) => (
                  <div key={`offline-${projectName}`}>
                    <div
                      style={{
                        padding: '3px 6px',
                        fontSize: '16px',
                        color: 'var(--pixel-text-dim)',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderBottom: '1px solid var(--pixel-border)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        userSelect: 'none',
                      }}
                    >
                      {projectName}
                    </div>
                    {offAgents.map((agent) => (
                      <div
                        key={agent.sessionId}
                        onMouseEnter={() => setHoveredOffline(agent.sessionId)}
                        onMouseLeave={() => setHoveredOffline(null)}
                        style={{
                          padding: '4px 6px',
                          background: hoveredOffline === agent.sessionId ? 'var(--pixel-btn-hover-bg)' : 'transparent',
                          borderBottom: '1px solid var(--pixel-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 4,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: 'rgba(255,255,255,0.1)',
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: '20px',
                              color: 'var(--pixel-text-dim)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {agent.name || agent.sessionId.slice(0, 8)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmDelete({ sessionId: agent.sessionId, name: agent.name || agent.sessionId.slice(0, 8) })
                            }}
                            title="Remove from memory"
                            style={{
                              ...deleteButtonStyle,
                              color: hoveredOffline === agent.sessionId ? 'var(--pixel-text-dim)' : 'transparent',
                            }}
                          >
                            {'\u{1F5D1}'}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              vscode.postMessage({
                                type: 'restartAgent',
                                sessionId: agent.sessionId,
                                workspacePath: agent.workspacePath,
                              })
                            }}
                            style={{
                              padding: '2px 8px',
                              fontSize: '16px',
                              color: 'var(--pixel-agent-text)',
                              background: 'var(--pixel-agent-bg)',
                              border: '2px solid var(--pixel-agent-border)',
                              borderRadius: 0,
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                            title="Resume this session in iTerm"
                          >
                            Resume
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
