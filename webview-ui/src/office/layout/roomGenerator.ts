import { TileType, FurnitureType } from '../types.js'
import type { TileType as TileTypeVal, OfficeLayout, PlacedFurniture, FloorColor } from '../types.js'
import {
  ROOM_HEIGHT,
  ROOM_LABEL_ROWS,
  ROOM_GAP_COLS,
  ROOM_MIN_SEATS,
  ROOM_EXTRA_SEATS,
  ROOM_MIN_INTERIOR_WIDTH,
  ROOM_FLOOR_COLOR,
  DEFAULT_WALL_COLOR,
} from '../../constants.js'

export interface RoomInfo {
  projectName: string
  col: number
  row: number
  width: number
  height: number
  seatUids: string[]
}

export interface GeneratedLayout {
  layout: OfficeLayout
  rooms: RoomInfo[]
}

export function generateRoomLayout(
  projects: Array<{ name: string; agentCount: number }>,
): GeneratedLayout {
  if (projects.length === 0) {
    // Empty layout — no rooms
    return {
      layout: {
        version: 1,
        cols: 1,
        rows: ROOM_LABEL_ROWS + ROOM_HEIGHT,
        tiles: new Array(ROOM_LABEL_ROWS + ROOM_HEIGHT).fill(TileType.VOID),
        furniture: [],
        tileColors: new Array(ROOM_LABEL_ROWS + ROOM_HEIGHT).fill(null),
      },
      rooms: [],
    }
  }

  // Calculate room dimensions
  const roomSpecs = projects.map((p) => {
    const seatCount = Math.max(p.agentCount + ROOM_EXTRA_SEATS, ROOM_MIN_SEATS)
    const deskPairs = Math.ceil(seatCount / 2)
    const interiorWidth = Math.max(ROOM_MIN_INTERIOR_WIDTH, 2 + deskPairs * 3)
    const roomWidth = interiorWidth + 2 // add walls
    return { name: p.name, seatCount, deskPairs, interiorWidth, roomWidth }
  })

  // Total layout dimensions
  const totalRows = ROOM_LABEL_ROWS + ROOM_HEIGHT
  const totalCols = roomSpecs.reduce((sum, r) => sum + r.roomWidth, 0) + ROOM_GAP_COLS * (roomSpecs.length - 1)

  // Initialize tiles with VOID
  const tiles: TileTypeVal[] = new Array(totalRows * totalCols).fill(TileType.VOID)
  const tileColors: Array<FloorColor | null> = new Array(totalRows * totalCols).fill(null)
  const furniture: PlacedFurniture[] = []
  const rooms: RoomInfo[] = []

  let colOffset = 0
  for (const spec of roomSpecs) {
    const roomCol = colOffset
    const roomRow = ROOM_LABEL_ROWS
    const seatUids: string[] = []

    // Fill room tiles
    for (let r = 0; r < ROOM_HEIGHT; r++) {
      for (let c = 0; c < spec.roomWidth; c++) {
        const tileRow = roomRow + r
        const tileCol = roomCol + c
        const idx = tileRow * totalCols + tileCol

        const isTopWall = r === 0
        const isBottomWall = r === ROOM_HEIGHT - 1
        const isLeftWall = c === 0
        const isRightWall = c === spec.roomWidth - 1

        // Bottom wall with doorway in the center
        if (isBottomWall) {
          const doorCol = Math.floor(spec.roomWidth / 2)
          if (c === doorCol) {
            tiles[idx] = TileType.FLOOR_1
            tileColors[idx] = ROOM_FLOOR_COLOR
          } else {
            tiles[idx] = TileType.WALL
            tileColors[idx] = DEFAULT_WALL_COLOR
          }
          continue
        }

        if (isTopWall || isLeftWall || isRightWall) {
          tiles[idx] = TileType.WALL
          tileColors[idx] = DEFAULT_WALL_COLOR
          continue
        }

        // Interior floor
        tiles[idx] = TileType.FLOOR_1
        tileColors[idx] = ROOM_FLOOR_COLOR
      }
    }

    // Place desks and chairs
    // Desks go in rows 2-3 (interior rows 1-2), chairs in row 4 (interior row 3)
    // Layout: wall | pad | desk desk gap desk desk gap ... | pad | wall
    const startCol = roomCol + 2 // skip wall + 1 padding
    for (let dp = 0; dp < spec.deskPairs; dp++) {
      const deskCol = startCol + dp * 3
      const deskRow = roomRow + 2 // rows 2-3 relative to room

      // Place 2x2 desk
      furniture.push({
        uid: `${spec.name}:desk-${dp}`,
        type: FurnitureType.DESK,
        col: deskCol,
        row: deskRow,
      })

      // Place 2 chairs below the desk (row 4 relative to room)
      const chairRow = roomRow + 4
      for (let ci = 0; ci < 2; ci++) {
        const chairCol = deskCol + ci
        const chairIdx = dp * 2 + ci
        if (chairIdx >= spec.seatCount) break
        const chairUid = `${spec.name}:chair-${chairIdx}`
        furniture.push({
          uid: chairUid,
          type: FurnitureType.CHAIR,
          col: chairCol,
          row: chairRow,
        })
        seatUids.push(chairUid)
      }
    }

    // Place plants at interior corners for decoration
    // Top-left corner (row 1, col 1 relative to room)
    furniture.push({
      uid: `${spec.name}:plant-0`,
      type: FurnitureType.PLANT,
      col: roomCol + 1,
      row: roomRow + 1,
    })
    // Top-right corner
    furniture.push({
      uid: `${spec.name}:plant-1`,
      type: FurnitureType.PLANT,
      col: roomCol + spec.roomWidth - 2,
      row: roomRow + 1,
    })

    rooms.push({
      projectName: spec.name,
      col: roomCol,
      row: roomRow,
      width: spec.roomWidth,
      height: ROOM_HEIGHT,
      seatUids,
    })

    colOffset += spec.roomWidth + ROOM_GAP_COLS
  }

  return {
    layout: {
      version: 1,
      cols: totalCols,
      rows: totalRows,
      tiles,
      furniture,
      tileColors,
    },
    rooms,
  }
}
