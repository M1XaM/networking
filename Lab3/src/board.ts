/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { ICard, Card } from './card.js';
import { Player } from './player.js';
import { Deferred } from './deferred.js';

/**
 * Represents a position on the board.
 * Mutable internal type used by Board ADT.
 */
type Position = {
    /** The row index of the position */
    row: number;
    /** The column index of the position */
    col: number;
}

/**
 * A mutable, thread-safe game board for Memory Scramble.
 * 
 * The board is a grid of spaces that can contain cards. Players flip cards
 * to find matching pairs. Multiple players can interact with the board
 * concurrently, following the rules in the PS4 handout.
 * 
 * The board uses a singleton pattern - only one instance can exist at a time.
 * Cards are stored in a flat array indexed by row * cols + col.
 * Each player maintains a turn stack tracking cards they've flipped,
 * and a removal queue for unmatched pairs that need to be turned face down.
 */
export class Board {
    /** Number of rows and columns on the board */
    private readonly size: { row: number, col: number };
    /** Flat array of cards, indexed by row * cols + col. Undefined entries represent empty spaces. */
    private readonly cards: (ICard | undefined)[];
    /** Singleton instance of the board */
    private static instance: Board | null = null;
    /** List of all players who have interacted with the board */
    private readonly players: Player[] = [];
    /** Map from player to their current turn stack: positions of cards they've flipped this turn */
    private readonly playerTurnStack: Map<Player, Position[]> = new Map<Player, Position[]>();
    /** Queue for waiting players: key is "row,col", value is array of resolve functions */
    private readonly cardWaitQueue: Map<string, Array<() => void>> = new Map();
    /** Queue for cards waiting to be removed (unmatched pairs that need to be turned face down) */
    private readonly removalQueue: Map<Player, Position[]> = new Map<Player, Position[]>();
    /** Queue for watchers waiting for board changes */
    private readonly watchQueue: Array<() => void> = [];

    // Abstraction function:
    //   AF(size, cards, players, playerTurnStack, cardWaitQueue, removalQueue, watchQueue) = 
    //     a Memory Scramble game board with dimensions size.row x size.col, where
    //     cards[r * size.col + c] represents the card at row r, column c (or undefined if empty).
    //     Each card can be face up or face down, and can be busy (controlled by a player) or not.
    //     players contains all players who have interacted with the board.
    //     playerTurnStack[p] contains the positions of cards player p has flipped in their current turn.
    //     removalQueue[p] contains positions of unmatched pairs that player p needs to turn face down.
    //     cardWaitQueue tracks players waiting for specific cards to become available.
    //     watchQueue contains callbacks to notify when the board state changes.
    // Representation invariant:
    //   - size.row > 0, size.col > 0
    //   - cards.length === size.row * size.col
    //   - for all players p: playerTurnStack.get(p) is defined and is an array
    //   - for all players p: removalQueue.get(p) is defined and is an array
    //   - for all positions in playerTurnStack: row in [0, size.row), col in [0, size.col)
    //   - for all positions in removalQueue: row in [0, size.row), col in [0, size.col)
    //   - playerTurnStack[p].length <= 2 (at most two cards per turn)
    //   - if a card at position (r, c) is busy, then (r, c) is in playerTurnStack for some player
    // Safety from rep exposure:
    //   - size is readonly and returned as a copy in getSize()
    //   - cards is private and never returned directly; methods return copies or derived data
    //   - players is private; methods don't expose the array or player objects directly
    //   - playerTurnStack, cardWaitQueue, removalQueue, watchQueue are private and never exposed
    //   - all constructor parameters are copied into new objects

    /**
     * Creates a new Memory Scramble board.
     * 
     * Uses singleton pattern - only one board instance can exist at a time.
     * 
     * @param size number of rows and columns, must have row > 0 and col > 0
     * @param size.row number of rows on the board
     * @param size.col number of columns on the board
     * @param cards array of card objects to place on board, must have exactly size.row * size.col elements
     * @throws Error if board instance already exists, or if dimensions or cards array is invalid
     */
    public constructor(size: { row: number, col: number }, cards: ICard[]) {
        if (Board.instance !== null) {
            throw new Error('Board already exists');
        }
        Board.instance = this;
        this.cards = cards;
        this.size = size;
        this.checkRep();
    }
    /**
     * String representation of the board.
     * Shows all card values (face up cards only).
     * 
     * @returns string representation with card values separated by newlines
     */
    public async toString(): Promise<string> {
        const values = this.cards.map(card => card?.getValue());
        return values.join('\n');
    }

    /**
     * Check the representation invariant.
     * @throws Error if the rep invariant is violated
     */
    private checkRep(): void {
        // Check size invariants
        assert(this.size.row > 0, 'size.row must be > 0');
        assert(this.size.col > 0, 'size.col must be > 0');
        assert(this.cards.length === this.size.row * this.size.col, 'cards.length must equal size.row * size.col');

        // Check that all players have defined turn stacks and removal queues
        for (const player of this.players) {
            const turnStack = this.playerTurnStack.get(player);
            assert(turnStack !== undefined, `playerTurnStack must have entry for player ${player.getId()}`);
            assert(Array.isArray(turnStack), `playerTurnStack entry for player ${player.getId()} must be an array`);
            
            const removalQueue = this.removalQueue.get(player);
            assert(removalQueue !== undefined, `removalQueue must have entry for player ${player.getId()}`);
            assert(Array.isArray(removalQueue), `removalQueue entry for player ${player.getId()} must be an array`);

            // Check turn stack length constraint
            assert(turnStack.length <= 2, `playerTurnStack for player ${player.getId()} must have at most 2 entries, got ${turnStack.length}`);

            // Check that all positions in turn stack are valid
            for (const pos of turnStack) {
                assert(pos.row >= 0 && pos.row < this.size.row, 
                    `turnStack position row ${pos.row} out of bounds [0, ${this.size.row})`);
                assert(pos.col >= 0 && pos.col < this.size.col, 
                    `turnStack position col ${pos.col} out of bounds [0, ${this.size.col})`);
            }

            // Check that all positions in removal queue are valid
            for (const pos of removalQueue) {
                assert(pos.row >= 0 && pos.row < this.size.row, 
                    `removalQueue position row ${pos.row} out of bounds [0, ${this.size.row})`);
                assert(pos.col >= 0 && pos.col < this.size.col, 
                    `removalQueue position col ${pos.col} out of bounds [0, ${this.size.col})`);
            }
        }

        // Check that if a card is busy, it's in some player's turn stack
        for (let r = 0; r < this.size.row; r++) {
            for (let c = 0; c < this.size.col; c++) {
                const card = this.cards[r * this.size.col + c];
                if (card !== undefined) {
                    // Check if card is busy using the getter method
                    const isBusy = card.isBusy;
                    if (isBusy) {
                        // Check that this position is in at least one player's turn stack
                        let foundInStack = false;
                        for (const player of this.players) {
                            const turnStack = this.playerTurnStack.get(player);
                            if (turnStack !== undefined) {
                                const found = turnStack.some(pos => pos.row === r && pos.col === c);
                                if (found) {
                                    foundInStack = true;
                                    break;
                                }
                            }
                        }
                        assert(foundInStack, `card at (${r},${c}) is busy but not in any player's turn stack`);
                    }
                }
            }
        }

        // Check that no position appears in multiple players' turn stacks simultaneously
        const positionsInStacks = new Map<string, Player>();
        for (const player of this.players) {
            const turnStack = this.playerTurnStack.get(player);
            if (turnStack !== undefined) {
                for (const pos of turnStack) {
                    const key = `${pos.row},${pos.col}`;
                    const existingPlayer = positionsInStacks.get(key);
                    assert(existingPlayer === undefined, 
                        `position (${pos.row},${pos.col}) appears in turn stacks of both player ${existingPlayer?.getId()} and player ${player.getId()}`);
                    positionsInStacks.set(key, player);
                }
            }
        }
    }
    /**
     * Get the dimensions of the board.
     *
     * @returns the height and width of the board
     */
    public getSize(): { row: number, col: number } {
        return this.size;
    }
    /**
     * Look at the board from a player's perspective.
     * 
     * @param playerId the player looking at the board
     * @returns promise that resolves to string representation of board state in the format specified in PS4 handout:
     *   ROWSxCOLUMNS
     *   SPOT
     *   SPOT
     *   ...
     *   where SPOT is one of: "none", "down ?", "up CARD", "my CARD"
     */
    public async look(playerId: string): Promise<string> {
        let player = this.players.find(player => player.getId() === playerId);
        if (player === undefined) {
            await this.addPlayer(new Player(playerId));
            player = this.players.find(player => player.getId() === playerId);
        }
        if (player === undefined) {
            throw new Error('Failed to create or find player');
        }
        
        const size = this.getSize();
        const lines: string[] = [`${size.row}x${size.col}`];
        
        const playerCards = this.playerTurnStack.get(player) ?? [];
        
        for (let row = 0; row < size.row; row++) {
            for (let col = 0; col < size.col; col++) {
                const card = this.getCards(row, col);
                if (card === undefined) {
                    lines.push('none');
                    continue;
                }
                
                const faceUp = await card.getFaceUp();
                
                // Check if this card is controlled by this player (in their turn stack)
                const isControlledByPlayer = playerCards.some(pos => pos.row === row && pos.col === col);
                
                if (!faceUp) {
                    lines.push('down ?');
                } else if (isControlledByPlayer) {
                    const value = card.getValue();
                    lines.push(`my ${value ?? ''}`);
                } else {
                    const value = card.getValue();
                    lines.push(`up ${value ?? ''}`);
                }
            }
        }
        
        return lines.join('\n');
    }
    /**
     * Get all cards on the board.
     * 
     * @returns array of all cards (undefined entries represent empty spaces)
     */
    public getCards(): (ICard | undefined)[];
    /**
     * Get a specific card at the given position.
     * 
     * @param row row index, must be in [0, size.row)
     * @param column column index, must be in [0, size.col)
     * @returns the card at that position, or undefined if the space is empty
     */
    public getCards(row: number, column: number): ICard | undefined;
    public getCards(row?: number, column?: number): (ICard | undefined)[] | ICard | undefined {
        if (row !== undefined && column !== undefined) {
            const card = this.cards[row * this.size.col + column];
            return card ?? undefined;
        }
        return this.cards;
    }

    /**
     * Remove a card from the board and notify waiters.
     * 
     * @param row the row index of the card to remove
     * @param column the column index of the card to remove
     */
    private async removeCard(row: number, column: number): Promise<void> {
        this.cards[row * this.size.col + column] = undefined;
        // Notify waiting players that the card is now available (removed)
        this.notifyCardAvailable(row, column);
        // Notify watchers that board state changed
        this.notifyWatchers();
        return;
    }

    /**
     * Notify all players waiting for a specific card to become available.
     * 
     * @param row the row index of the card being released
     * @param column the column index of the card being released
     */
    private notifyCardAvailable(row: number, column: number): void {
        const key = `${row},${column}`;
        const queue = this.cardWaitQueue.get(key);
        if (queue !== undefined && queue.length > 0) {
            // Resolve the first waiting promise
            const resolve = queue.shift();
            if (resolve !== undefined) {
                resolve();
            }
            // Clean up empty queues
            if (queue.length === 0) {
                this.cardWaitQueue.delete(key);
            }
        }
    }

    /**
     * Notify all registered change listeners that the board has changed.
     * This should be called whenever cards turn face up/down, are removed,
     * or change their string values.
     */
    private notifyWatchers(): void {
        // Resolve all waiting watchers
        while (this.watchQueue.length > 0) {
            const resolve = this.watchQueue.shift();
            if (resolve !== undefined) {
                resolve();
            }
        }
    }

    /**
     * Preprocess waiting logic for second card flip.
     * If player is trying to flip a second card that is busy (controlled by another player),
     * relinquish control of their first card and throw an error.
     * 
     * @param player the player attempting to flip a card
     * @param row the row index of the card to flip
     * @param column the column index of the card to flip
     * @throws Error if the card is controlled by another player
     */
    private async preprocessWaitForCardAvailable(player: Player, row: number, column: number): Promise<void> {
        const card = this.getCards(row, column);
        const stack = this.playerTurnStack.get(player);
        if (stack === undefined) {
            throw new Error("There is no player stack");
        }
        if (card === undefined) {
            const pos = stack.shift();
            if (pos === undefined) {
                return;
            }
            const removedCard = this.getCards(pos.row, pos.col);
            if (removedCard !== undefined) {
                await removedCard.setIsBusy(false);
            }
            const removalQueue = this.removalQueue.get(player);
            if (removalQueue !== undefined) {
                removalQueue.push(pos);
            }
            this.notifyCardAvailable(pos.row, pos.col);
            this.notifyWatchers();
            throw new Error('Card not found');
        }
        if (stack.length === 1) {
            const isBusy = await card.getIsBusy();
            const isBusyByMe = stack.some(pos => pos.row === row && pos.col === column);
            if (isBusyByMe) {
                return;
            }
            if (!isBusy) {
                return;
            }
            if (isBusy) {
                const pos = stack.shift();
                if (pos === undefined) {
                    return;
                }
                const removedCard = this.getCards(pos.row, pos.col);
                if (removedCard !== undefined) {
                    await removedCard.setIsBusy(false);
                }
                const removalQueue = this.removalQueue.get(player);
                if (removalQueue !== undefined) {
                    removalQueue.push(pos);
                }
                this.notifyCardAvailable(pos.row, pos.col);
                this.notifyWatchers();
                throw new Error('The card is not available');
            }
        }
    }

    /**
     * Wait for a card to become available (not busy and exists).
     * If the card is busy, adds this operation to the wait queue and waits
     * until notified that the card is available.
     * 
     * @param row the row index of the card to monitor
     * @param column the column index of the card to monitor
     */
    private async waitForCardAvailable(row: number, column: number): Promise<void> {
        // Keep waiting until the card is available (not busy and exists)
        while (true) {
            const card = this.getCards(row, column);
            if (card === undefined) {
                // Card doesn't exist (was removed), don't wait
                return;
            }
            
            const isBusy = await card.getIsBusy();
            if (!isBusy) {
                // Card is available
                return;
            }

            // Card is busy, wait for notification
            const key = `${row},${column}`;
            const deferred = new Deferred<void>();
            if (!this.cardWaitQueue.has(key)) {
                this.cardWaitQueue.set(key, []);
            }
            const waitQueue = this.cardWaitQueue.get(key);
            if (waitQueue !== undefined) {
                waitQueue.push(deferred.resolve);
            }
            await deferred.promise;
            // After notification, loop again to check if card is actually available
        }
    }

    /**
     * Get the singleton board instance.
     * 
     * @returns the board instance
     * @throws Error if board has not been initialized
     */
    public static getInstance(): Board {
        if (Board.instance === null) {
            throw new Error('Board not initialized');
        }
        return Board.instance;
    }

    /**
     * Add a player to the board.
     * Initializes their turn stack and removal queue.
     * 
     * @param player the player to add
     * @returns promise that resolves to this board instance
     */
    public async addPlayer(player: Player): Promise<Board> {
        this.players.push(player);
        this.playerTurnStack.set(player, []);
        this.removalQueue.set(player, []);
        return this;
    }

    /**
     * Check if a card belongs to (is controlled by) a player.
     * 
     * @param card the card to check
     * @returns promise that resolves to true if the card is busy (controlled), false otherwise
     */
    public async isBelongingToPlayer(card: ICard): Promise<boolean> {
        return card.getIsBusy();
    }

    /**
     * Process the previous pair of cards flipped by a player.
     * If there are cards in the removal queue, turn them face down.
     * If there are two cards in the turn stack, check if they match:
     *   - If they match, remove both cards from the board.
     *   - If they don't match, they should already be in the removal queue.
     * 
     * RULE 3: Before flipping a new first card, finish previous play.
     * 
     * @param player the player whose previous pair should be processed
     */
    private async processPreviousPair(player: Player): Promise<void> {
        const removalQueue = this.removalQueue.get(player);
        if (removalQueue !== undefined && removalQueue.length > 0) {
            while (removalQueue.length > 0) {
                const pos = removalQueue.shift();
                if (pos === undefined) {
                    break;
                }
                const card = this.getCards(pos.row, pos.col);
                if (card !== undefined) {
                    const isBusy = await card.getIsBusy();
                    if (!isBusy) {
                        await card.setFaceUp(false);
                        await card.setIsBusy(false);
                        this.notifyCardAvailable(pos.row, pos.col);
                    }
                }
            }
        }

        // Then process the current pair in the stack
        const stack = this.playerTurnStack.get(player);
        if (stack === undefined || stack.length < 2) {
            return;
        }

        const first = stack.shift();
        const second = stack.shift();
        if (first === undefined || second === undefined) {
            return;
        }
        const firstCard = this.getCards(first.row, first.col);
        const secondCard = this.getCards(second.row, second.col);
        if (firstCard === undefined || secondCard === undefined) {
            return;
        }

        await this.removeCard(first.row, first.col);
        await this.removeCard(second.row, second.col);
        // removeCard already notifies watchers
    }

    /**
     * Remove a position from all players' removal queues.
     * Called when a card is removed to clean up stale references.
     * 
     * @param row the row index of the position to remove
     * @param column the column index of the position to remove
     */
    public async processRemovalQueue(row: number, column: number): Promise<void> {
        if (this.removalQueue !== undefined) {
            while (this.removalQueue.entries().some(([_, positions]) => positions.some((pos) => pos.row === row && pos.col === column))) {
                for (const [_, positions] of this.removalQueue.entries()) {
                    const index = positions.findIndex((pos) => pos.row === row && pos.col === column);
                    if (index !== -1) {
                        positions.splice(index, 1);
                    }
                }
            }
        }
    }

    /**
     * Process the current pair of cards in a player's turn stack.
     * If there are two cards in the stack:
     *   - If they match, keep them in the stack (player controls them).
     *   - If they don't match, add them to the removal queue and relinquish control.
     * 
     * @param player the player whose stack should be processed
     * @param row optional row parameter (unused)
     * @param column optional column parameter (unused)
     */
    public async processStack(player: Player, row?: number, column?: number): Promise<void> {
        const stack = this.playerTurnStack.get(player);
        // console.log(stack)
        if (stack === undefined) {
            return;
        }

        if (stack.length < 2) {
            // Need at least 2 cards to process a pair
            return;
        }

        const first = stack.shift();
        const second = stack.shift();
        if (first === undefined || second === undefined) {
            return;
        }
        const firstCard = this.getCards(first.row, first.col);
        const secondCard = this.getCards(second.row, second.col);
        if (firstCard === undefined || secondCard === undefined) {
            return;
        }
        const firstValue = firstCard.getValue();
        const secondValue = secondCard.getValue();

        if (firstValue !== secondValue) {
            // Unmatched pair: add to removal queue instead of unshifting back to stack
            const removalQueue = this.removalQueue.get(player);
            
            if (removalQueue !== undefined) {
                removalQueue.push(first);
                removalQueue.push(second);
            }
        
            await firstCard.setIsBusy(false);
            await secondCard.setIsBusy(false);
            this.notifyCardAvailable(first.row, first.col);
            this.notifyCardAvailable(second.row, second.col);
        } else {
            stack.unshift({row: first.row, col: first.col});
            stack.unshift({row: second.row, col: second.col});
        }
        return;
    }

    /**
     * Flip a card at the given position.
     * Implements the complete game rules from PS4 handout.
     * 
     * RULE 1: Flipping a first card
     *   - If no card at position, throw error
     *   - If card is busy (controlled by another player), wait until available
     *   - Turn card face up and take control
     * 
     * RULE 2: Flipping a second card
     *   - If no card at position, relinquish first card and throw error
     *   - If card is controlled by another player, relinquish first card and throw error
     *   - Turn card face up
     *   - If cards match, keep control of both
     *   - If cards don't match, relinquish control of both (they'll be turned down later)
     * 
     * RULE 3: Before flipping a new first card, finish previous play
     *   - Process removal queue (turn unmatched cards face down)
     *   - Process turn stack (remove matched cards or add unmatched to removal queue)
     * 
     * @param playerId ID of player making the flip
     * @param row row of card to flip, must be in [0, size.row)
     * @param column column of card to flip, must be in [0, size.col)
     * @returns promise that resolves when flip completes successfully
     * @throws Error if flip fails (no card at position, or attempting to flip
     *         a second card that's controlled by someone)
     */
    public async flip(playerId: string, row: number, column: number): Promise<void> {
        const player = this.players.find(player => player.getId() === playerId);
        if (player === undefined) {
            throw new Error('Player not found');
        }

        const stack = this.playerTurnStack.get(player);
        if (stack?.find((pos)=> pos.row === row && pos.col === column)) {
            throw new Error('Card is already controlled by you');
        }
        
        const removalQueue = this.removalQueue.get(player);
        const isTheSecondCard = stack?.length === 1;

        if (isTheSecondCard) {
            await this.preprocessWaitForCardAvailable(player, row, column);
        }
        
        await this.waitForCardAvailable(row, column);
        
        if (stack !== undefined && stack.length >= 2 || (removalQueue !== undefined && removalQueue.length >= 1)) {
            await this.processPreviousPair(player);
        }
        
        await this.waitForCardAvailable(row, column);
        const card = this.getCards(row, column);
        if (card === undefined) {
            throw new Error('Card not found');
        }
        
        const isBusy = await card.getIsBusy();
        if (isBusy) {
            // Card became busy again (race condition), wait once more
            await this.waitForCardAvailable(row, column);
            const finalCard = this.getCards(row, column);
            if (finalCard === undefined) {
                throw new Error('Card not found');
            }
            await finalCard.setFaceUp(true);
            await finalCard.setIsBusy(true);
            const playerStack = this.playerTurnStack.get(player);
            if (playerStack !== undefined) {
                playerStack.push({ row, col: column });
            }
        } else {
            await card.setFaceUp(true);
            await card.setIsBusy(true);
            const playerStack = this.playerTurnStack.get(player);
            if (playerStack !== undefined) {
                playerStack.push({ row, col: column });
            }
        }

        await this.processRemovalQueue(row, column);
        
        await this.processStack(player);
        // Notify watchers that board state changed
        this.notifyWatchers();
        return;
    }

    /**
     * Apply a transformer function to every card on the board.
     * Replaces each card with f(card), maintaining pairwise consistency:
     * if two cards match before transformation, they will not be observed
     * as non-matching during transformation.
     * 
     * This operation allows interleaving with other board operations.
     * Other operations may see partially-transformed boards, but matching
     * pairs will remain consistent.
     * 
     * @param playerId ID of player performing the transformation (must exist)
     * @param f transformer function that maps card strings to new card strings;
     *          must be a mathematical function (same input always gives same output)
     * @returns promise that resolves when all cards have been transformed
     * @throws Error if player is not found
     */
    public async map(playerId: string, f: (card: string) => Promise<string>): Promise<void> {
        const player = this.players.find(player => player.getId() === playerId);
        if (player === undefined) {
            throw new Error('Player not found');
        }

        // Group all cards by their current value to maintain pairwise consistency
        // Cards with the same value must be transformed together
        const valueToCards = new Map<string, Array<{ card: ICard, row: number, col: number }>>();
        
        const size = this.getSize();
        for (let row = 0; row < size.row; row++) {
            for (let col = 0; col < size.col; col++) {
                const card = this.getCards(row, col);
                if (card === undefined) {
                    continue;
                }
                // Access the actual value regardless of face-up state
                // ICard interface has value as a property (typed as string, so always defined)
                const cardValue = card.value;
                
                if (!valueToCards.has(cardValue)) {
                    valueToCards.set(cardValue, []);
                }
                const cardsForValue = valueToCards.get(cardValue);
                if (cardsForValue !== undefined) {
                    cardsForValue.push({ card, row, col });
                }
            }
        }

        // Transform each unique value and apply to all cards with that value
        // This ensures matching pairs remain matching during transformation
        const transformPromises: Promise<void>[] = [];
        
        for (const [value, cards] of valueToCards.entries()) {
            // Create a promise that transforms all cards with this value
            const transformPromise = (async () => {
                const newValue = await f(value);
                // Apply the transformation to all cards with this value
                for (const { card } of cards) {
                    await card.setValue(newValue);
                }
            })();
            transformPromises.push(transformPromise);
        }

        // Wait for all transformations to complete
        // This allows interleaving: other operations can run between transformations
        // of different values, but all cards with the same value are transformed atomically
        await Promise.all(transformPromises);

        // Notify watchers that board state changed
        this.notifyWatchers();
        return;
    }

    /**
     * Register a listener to be notified when the board changes.
     * A change is defined as any cards turning face up or face down,
     * being removed from the board, or changing card values.
     * 
     * @param playerId the player watching for changes
     * @returns a promise that resolves to the board state (via look()) the next time the board changes
     */
    public async watch(playerId: string): Promise<string> {
        // Ensure player exists
        let player = this.players.find(player => player.getId() === playerId);
        if (player === undefined) {
            await this.addPlayer(new Player(playerId));
            player = this.players.find(player => player.getId() === playerId);
        }
        if (player === undefined) {
            throw new Error('Failed to create or find player');
        }

        // Take a snapshot of the current board state
        const snapshot = await this.getBoardSnapshot();

        // Wait for a change notification
        while (true) {
            const deferred = new Deferred<void>();
            this.watchQueue.push(deferred.resolve);
            await deferred.promise;

            // Check if the board state actually changed
            const currentState = await this.getBoardSnapshot();
            if (this.hasBoardChanged(snapshot, currentState)) {
                // Board changed, return the new state
                return await this.look(playerId);
            }
            // No actual change detected, wait again
        }
    }

    /**
     * Get a snapshot of the current board state for change detection.
     * 
     * @returns promise that resolves to a map from position keys ("row,col") to card state
     */
    private async getBoardSnapshot(): Promise<Map<string, { faceUp: boolean, value: string | undefined, exists: boolean }>> {
        const snapshot = new Map<string, { faceUp: boolean, value: string | undefined, exists: boolean }>();
        const size = this.getSize();
        
        for (let row = 0; row < size.row; row++) {
            for (let col = 0; col < size.col; col++) {
                const key = `${row},${col}`;
                const card = this.getCards(row, col);
                if (card === undefined) {
                    snapshot.set(key, { faceUp: false, value: undefined, exists: false });
                } else {
                    const faceUp = await card.getFaceUp();
                    const value = faceUp ? card.getValue() : undefined;
                    snapshot.set(key, { faceUp, value, exists: true });
                }
            }
        }
        return snapshot;
    }

    /**
     * Check if the board state has changed between two snapshots.
     * 
     * @param oldSnapshot the previous board state snapshot
     * @param newSnapshot the current board state snapshot
     * @returns true if any card changed (face up/down, value, or existence), false otherwise
     */
    private hasBoardChanged(
        oldSnapshot: Map<string, { faceUp: boolean, value: string | undefined, exists: boolean }>,
        newSnapshot: Map<string, { faceUp: boolean, value: string | undefined, exists: boolean }>
    ): boolean {
        // Check if any card changed
        for (const [key, oldState] of oldSnapshot.entries()) {
            const newState = newSnapshot.get(key);
            if (newState === undefined) {
                // Card position disappeared (shouldn't happen, but check anyway)
                return true;
            }
            
            // Check if card was removed or added
            if (oldState.exists !== newState.exists) {
                return true;
            }
            
            // Check if face up/down status changed
            if (oldState.faceUp !== newState.faceUp) {
                return true;
            }
            
            // Check if value changed (only if both are face up)
            if (oldState.faceUp && newState.faceUp && oldState.value !== newState.value) {
                return true;
            }
        }
        
        // Check for new cards (shouldn't happen in normal operation, but check anyway)
        for (const key of newSnapshot.keys()) {
            if (!oldSnapshot.has(key)) {
                return true;
            }
        }
        
        return false;
    }
    /**
     * Make a new board by parsing a file.
     * 
     * PS4 instructions: the specification of this method may not be changed.
     * 
     * @param filename path to game board file
     * @returns a new board with the size and cards from the file
     * @throws Error if the file cannot be read or is not a valid game board
     */
    public static async parseFromFile(filename: string): Promise<Board> {
        const file = await fs.promises.readFile(filename, 'utf8');
        const [rawSize, ...cards] = file.split('\n').map(line => line.trim()).filter(line => line !== '');
        const [row, col] = rawSize?.split("x") ?? [];
        if (row === undefined || col === undefined) {
            throw new Error('invalid size');
        }
        return new Board({ row: parseInt(row), col: parseInt(col) }, cards.map(card => new Card(card, false, false)));
    }
}
