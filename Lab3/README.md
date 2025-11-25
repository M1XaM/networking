# Memory Scramble Lab
### Isacescu Maxim FAF-231

## Overview

This project implements the MIT 6.102 (2025) Memory Scramble laboratory work - a multiplayer card matching game where players compete to find matching pairs of cards on a game board. The implementation follows the specifications from the MIT 6.102 course, providing a thread-safe, concurrent game board with HTTP API support.

## Requirements Implementation

### Board ADT

The Board ADT includes:
- Representation invariants with checkRep() function
- Thread-safe concurrent operations
- Complete game rules implementation
- Safety from rep exposure arguments
- Complete specifications for all methods

### Commands Module
Implements the following functions:
- look(board, playerId): Promise<string>
- flip(board, playerId, row, column): Promise<string>
- map(board, playerId, f): Promise<string>
- watch(board, playerId): Promise<string>

### HTTP API Server
The server:
- Only calls functions from the commands module
- Does not call Board methods directly
- Handles all required endpoints with proper error handling


## Running the Project

### Prerequisites
- Docker

### Running the Server
```bash
docker compose up --build
```

## Design Documentation

### Board ADT Representation

**Representation Invariants:**
- `size.row > 0, size.col > 0`
- `cards.length === size.row * size.col`
- For all players p: `playerTurnStack.get(p)` is defined and is an array
- For all players p: `removalQueue.get(p)` is defined and is an array
- For all positions in playerTurnStack: `row in [0, size.row), col in [0, size.col)`
- For all positions in removalQueue: `row in [0, size.row), col in [0, size.col)`
- `playerTurnStack[p].length <= 2` (at most two cards per turn)
- If a card at position (r, c) is busy, then (r, c) is in playerTurnStack for some player

**Safety from Rep Exposure:**
- `size` is readonly and returned as a copy in `getSize()`
- `cards` is private and never returned directly; methods return copies or derived data
- `players` is private; methods don't expose the array or player objects directly
- `playerTurnStack`, `cardWaitQueue`, `removalQueue`, `watchQueue` are private and never exposed
- All constructor parameters are copied into new objects

### API Specifications

All methods include complete specifications with:
- **Function signatures** with parameter and return types
- **Preconditions** that must be true before execution
- **Postconditions** that will be true after execution
- **Throws** declarations for exceptional cases

**Key Methods:**

1. **`flip(playerId: string, row: number, column: number): Promise<void>`**
   - *Preconditions:* Player exists, position is within board bounds
   - *Postconditions:* Card is flipped and player gains/loses control based on game rules
   - *Throws:* Error if card doesn't exist or is controlled by another player

2. **`map(playerId: string, f: (card: string) => Promise<string>): Promise<void>`**
   - *Preconditions:* Player exists, f is a mathematical function
   - *Postconditions:* All cards are transformed while maintaining pairwise consistency
   - *Throws:* Error if player not found

3. **`watch(playerId: string): Promise<string>`**
   - *Preconditions:* Player exists
   - *Postconditions:* Returns when board state changes (cards flip, remove, or change value)
   - *Throws:* Error if player cannot be created

## Testing

### Unit Tests
The test suite comprehensively covers:
- All game rules and edge cases (`flip`, `look`, `map`, `watch`)
- Board state transitions and representation invariants
- Error conditions and exception handling
- Multi-player scenarios and concurrent access
- File parsing and board initialization

**Test Categories:**
- **parseFromFile()**: Valid/invalid file formats, various board sizes
- **look()**: Different card states (face up/down, controlled, empty)
- **flip()**: First/second card rules, error conditions, concurrent access
- **Concurrency**: Multiple players, wait queues, race conditions
- **map()**: Card transformations with pairwise consistency
- **watch()**: Change detection and notification

### Simulation Test
The simulation script verifies system stability under concurrent load:
- **2 concurrent players** making moves simultaneously
- **100 moves per player** with random positions
- **Random timeouts** between 1s and 2s between moves
- **No game crashes** or deadlocks under heavy concurrent access
- **Proper error handling** for invalid moves and race conditions

## API Endpoints

| Method | Endpoint | Description | Response Format |
|--------|----------|-------------|-----------------|
| GET | `/look/:playerId` | Get board state from player's perspective | Text format per PS4 spec |
| GET | `/flip/:playerId/:row,:column` | Flip a card at specified position | Updated board state or 409 error |
| GET | `/replace/:playerId/:fromCard/:toCard` | Replace all occurrences of a card | Updated board state |
| GET | `/watch/:playerId` | Wait for board changes | Updated board state when changed |

## Development Notes

- Follows the exact structure from MIT 6.102 TypeScript skeleton
- Maintains architectural patterns while implementing all required functionality
- Emphasizes thread safety and proper concurrent access patterns
- Includes comprehensive error handling and input validation
- Uses singleton pattern for Board instance management
- Implements proper wait/notify mechanisms for card availability
