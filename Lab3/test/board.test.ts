/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { Board } from '../src/board.js';
import { Player } from '../src/player.js';

/**
 * Tests for the Board ADT.
 * 
 * Testing strategy:
 * 
 * parseFromFile():
 *   - valid files: small (1x1), medium (3x3), large (5x5)
 *   - invalid files: wrong card count, invalid dimensions, malformed
 * 
 * look():
 *   - empty board, board with cards
 *   - all cards face down
 *   - some cards face up (controlled by self, controlled by others, not controlled)
 *   - some spaces empty (after matches removed)
 * 
 * flip():
 *   - First card:
 *     - valid position, face down → turns face up, player controls it
 *     - valid position, face up, not controlled → player controls it  
 *     - valid position, face up, controlled by another player → waits
 *     - empty space → throws error
 *   - Second card:
 *     - match with first card → both stay face up, player keeps control
 *     - no match with first card → both stay face up, player relinquishes control
 *     - empty space → throws error, relinquishes first card
 *     - controlled by another player → throws error, relinquishes first card
 *   - Finishing previous play:
 *     - matched cards → removed from board
 *     - non-matching cards (not controlled) → turned face down
 *     - non-matching cards (now controlled by another) → stay face up
 * 
 * Concurrency:
 *   - multiple players flipping different cards simultaneously
 *   - multiple players waiting for same card
 *   - player makes move while another is waiting
 */

describe('Board', function() {
    
    beforeEach(function() {
        // Reset singleton instance before each test
        (Board as any).instance = null;
    });

    // ========== parseFromFile() tests ==========
    
    describe('parseFromFile', function() {
        
        it('should parse a simple 1x1 board', async function() {
            const filename = 'test-boards/simple.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '1x1\nA\n');
            
            const board = await Board.parseFromFile(filename);
            const size = board.getSize();
            
            assert.strictEqual(size.row, 1);
            assert.strictEqual(size.col, 1);
            
            // Clean up
            await fs.promises.unlink(filename);
        });
        
        it('should parse a 3x3 board', async function() {
            const board = await Board.parseFromFile('boards/perfect.txt');
            const size = board.getSize();
            
            assert.strictEqual(size.row, 3);
            assert.strictEqual(size.col, 3);
        });
        
        it('should parse a 5x5 board', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            const size = board.getSize();
            
            assert.strictEqual(size.row, 5);
            assert.strictEqual(size.col, 5);
        });
        
        it('should throw error for invalid file', async function() {
            await assert.rejects(
                async () => await Board.parseFromFile('boards/nonexistent.txt'),
                Error
            );
        });
        
        it('should throw error for invalid size format', async function() {
            const filename = 'test-boards/bad-dims.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, 'not-a-board\n');
            
            await assert.rejects(
                async () => await Board.parseFromFile(filename),
                Error
            );
            
            await fs.promises.unlink(filename);
        });
    });

    // ========== look() tests ==========
    
    describe('look', function() {
        
        it('should show all cards face down initially', async function() {
            const filename = 'test-boards/look1.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            const view = await board.look('alice');
            
            const lines = view.split('\n');
            assert.strictEqual(lines[0], '2x2');
            // Cards are in row-major order: (0,0), (0,1), (1,0), (1,1)
            assert.strictEqual(lines[1], 'down ?');
            assert.strictEqual(lines[2], 'down ?');
            assert.strictEqual(lines[3], 'down ?');
            assert.strictEqual(lines[4], 'down ?');
            
            await fs.promises.unlink(filename);
        });
        
        it('should show controlled cards as "my"', async function() {
            const filename = 'test-boards/look2.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            
            // Alice flips first card
            await board.flip('alice', 0, 0);
            
            const view = await board.look('alice');
            const lines = view.split('\n');
            assert.strictEqual(lines[1], 'my A');  // Alice's card at (0,0)
            
            await fs.promises.unlink(filename);
        });
        
        it('should show others\' controlled cards as "up"', async function() {
            const filename = 'test-boards/look3.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            
            // Alice flips first card
            await board.flip('alice', 0, 0);
            
            // Bob's view
            const view = await board.look('bob');
            const lines = view.split('\n');
            assert.strictEqual(lines[1], 'up A');  // Alice's card, from Bob's perspective
            
            await fs.promises.unlink(filename);
        });
        
        it('should show empty spaces as "none"', async function() {
            const filename = 'test-boards/look4.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            
            // Alice makes a match
            await board.flip('alice', 0, 0);  // First A at (0,0)
            await board.flip('alice', 1, 0);  // Second A at (1,0) - match!
            
            // Start new move - matched cards removed
            await board.flip('alice', 0, 1);  // Some other card
            
            const view = await board.look('alice');
            const lines = view.split('\n');
            assert.strictEqual(lines[1], 'none');  // First A removed at (0,0)
            assert.strictEqual(lines[3], 'none');  // Second A removed at (1,0)
            
            await fs.promises.unlink(filename);
        });
    });

    // ========== flip() tests - First Card ==========
    
    describe('flip - first card', function() {
        
        it('should flip face-down card and give control (Rule 1-B)', async function() {
            const filename = 'test-boards/flip1.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            
            await board.flip('alice', 0, 0);
            
            const view = await board.look('alice');
            const lines = view.split('\n');
            assert.strictEqual(lines[1], 'my A');
            
            await fs.promises.unlink(filename);
        });
        
        it('should give control of face-up uncontrolled card (Rule 1-C)', async function() {
            const filename = 'test-boards/flip2.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            await board.addPlayer(new Player('bob'));
            
            // Alice flips and doesn't match
            await board.flip('alice', 0, 0);
            await board.flip('alice', 0, 1);  // No match - cards stay up but not controlled
            
            // Bob can now take control of the face-up card
            await board.flip('bob', 0, 0);
            
            const view = await board.look('bob');
            const lines = view.split('\n');
            assert.strictEqual(lines[1], 'my A');
            
            await fs.promises.unlink(filename);
        });
        
        it('should throw error for empty space (Rule 1-A)', async function() {
            const filename = 'test-boards/flip3.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            await board.addPlayer(new Player('bob'));
            
            // Alice makes a match and removes cards
            await board.flip('alice', 0, 0);
            await board.flip('alice', 1, 0);
            await board.flip('alice', 0, 1);  // Removes matched As
            
            // Bob tries to flip empty space
            await assert.rejects(
                async () => await board.flip('bob', 0, 0),
                /Card not found|no card at/
            );
            
            await fs.promises.unlink(filename);
        });
        
        it('should wait for controlled card (Rule 1-D)', async function() {
            const filename = 'test-boards/flip4.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            await board.addPlayer(new Player('bob'));
            
            // Alice flips first card
            await board.flip('alice', 0, 0);
            
            // Bob tries to flip same card - should wait
            let bobDone = false;
            const bobPromise = board.flip('bob', 0, 0).then(() => {
                bobDone = true;
            });
            
            // Give Bob a moment to start waiting
            await timeout(10);
            assert.strictEqual(bobDone, false, 'Bob should still be waiting');
            
            // Alice flips second card (no match) - relinquishes first card
            await board.flip('alice', 0, 1);
            
            // Now Bob's flip should complete
            await bobPromise;
            assert.strictEqual(bobDone, true);
            
            await fs.promises.unlink(filename);
        });
    });

    // ========== flip() tests - Second Card ==========
    
    describe('flip - second card', function() {
        
        it('should match and keep control of both cards (Rule 2-D)', async function() {
            const filename = 'test-boards/flip-2nd-1.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            
            await board.flip('alice', 0, 0);  // First A at (0,0)
            await board.flip('alice', 1, 0);  // Second A at (1,0) - match!
            
            const view = await board.look('alice');
            const lines = view.split('\n');
            assert.strictEqual(lines[1], 'my A');  // First card at (0,0)
            assert.strictEqual(lines[3], 'my A');  // Second card at (1,0)
            
            await fs.promises.unlink(filename);
        });
        
        it('should not match and relinquish control (Rule 2-E)', async function() {
            const filename = 'test-boards/flip-2nd-2.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            
            await board.flip('alice', 0, 0);  // A at (0,0)
            await board.flip('alice', 0, 1);  // B at (0,1) - no match
            
            const view = await board.look('alice');
            const lines = view.split('\n');
            // Both cards face up but not controlled
            assert.strictEqual(lines[1], 'up A');
            assert.strictEqual(lines[2], 'up B');
            
            await fs.promises.unlink(filename);
        });
        
        it('should throw and relinquish first card on empty space (Rule 2-A)', async function() {
            const filename = 'test-boards/flip-2nd-3.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '3x3\nA\nB\nA\nB\nC\nC\nD\nD\nE\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('bob'));
            await board.addPlayer(new Player('alice'));
            
            // Bob makes a match and removes cards
            await board.flip('bob', 0, 0);  // First A at (0,0)
            await board.flip('bob', 0, 2);  // Second A at (0,2) - match!
            await board.flip('bob', 0, 1);  // Removes the As
            
            // Alice tries second card at empty space
            await board.flip('alice', 1, 0);  // First card - B at (1,0)
            
            await assert.rejects(
                async () => await board.flip('alice', 0, 0),  // Empty! (A was removed)
                /Card not found|no card at/
            );
            
            // Alice's first card should be relinquished
            const view = await board.look('alice');
            const lines = view.split('\n');
            // Position (1,0) is index 4 in row-major order (row 1, col 0 = 1*3 + 0 = 3, but 0-indexed from size line)
            // Actually: lines[0] = "3x3", lines[1] = (0,0), lines[2] = (0,1), lines[3] = (0,2)
            // lines[4] = (1,0), lines[5] = (1,1), etc.
            assert.strictEqual(lines[4], 'up B');  // Position (1,0) - not "my" anymore
            
            await fs.promises.unlink(filename);
        });
        
        it('should throw and relinquish on controlled card (Rule 2-B)', async function() {
            const filename = 'test-boards/flip-2nd-4.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('bob'));
            await board.addPlayer(new Player('alice'));
            
            // Bob flips first card
            await board.flip('bob', 0, 1);
            
            // Alice tries to flip two cards, but second is controlled by Bob
            await board.flip('alice', 0, 0);
            
            await assert.rejects(
                async () => await board.flip('alice', 0, 1),  // Controlled by Bob
                /controlled|Card not found|not available/
            );
            
            // Alice's first card should be relinquished
            const view = await board.look('alice');
            const lines = view.split('\n');
            assert.strictEqual(lines[1], 'up A');  // Not "my" anymore
            
            await fs.promises.unlink(filename);
        });
    });

    // ========== flip() tests - Finishing Previous Play ==========
    
    describe('flip - finishing previous play', function() {
        
        it('should remove matched cards on next move (Rule 3-A)', async function() {
            const filename = 'test-boards/finish1.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '3x3\nA\nB\nA\nB\nC\nC\nD\nD\nE\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            
            // Alice matches A cards at (0,0) and (0,2)
            await board.flip('alice', 0, 0);  // First A at (0,0)
            await board.flip('alice', 0, 2);  // Second A at (0,2) - match!
            
            // Cards should still be there and controlled
            let view = await board.look('alice');
            let lines = view.split('\n');
            assert.strictEqual(lines[1], 'my A');  // Still controlled
            assert.strictEqual(lines[3], 'my A');  // Still controlled
            
            // Alice starts new move - should remove As
            await board.flip('alice', 0, 1);
            
            view = await board.look('alice');
            lines = view.split('\n');
            assert.strictEqual(lines[1], 'none');  // Position (0,0) - First A removed
            assert.strictEqual(lines[3], 'none');  // Position (0,2) - Second A removed
            
            await fs.promises.unlink(filename);
        });
        
        it('should turn down non-matching uncontrolled cards (Rule 3-B)', async function() {
            const filename = 'test-boards/finish2.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            
            // Alice flips non-matching cards
            // Board is: A B / A B (row-major)
            //           (0,0) (0,1) / (1,0) (1,1)
            await board.flip('alice', 0, 0);  // A at (0,0)
            await board.flip('alice', 0, 1);  // B at (0,1) - no match
            
            // Cards should be face up but not controlled
            let view = await board.look('alice');
            let lines = view.split('\n');
            assert.strictEqual(lines[1], 'up A');
            assert.strictEqual(lines[2], 'up B');
            
            // Alice starts new move - should turn them down
            await board.flip('alice', 1, 0);  // A at (1,0)
            
            view = await board.look('alice');
            lines = view.split('\n');
            assert.strictEqual(lines[1], 'down ?');  // Position (0,0) - turned down
            assert.strictEqual(lines[2], 'down ?');  // Position (0,1) - turned down
            
            await fs.promises.unlink(filename);
        });
        
        it('should NOT turn down card now controlled by another (Rule 3-B)', async function() {
            const filename = 'test-boards/finish3.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            await board.addPlayer(new Player('bob'));
            
            // Alice flips non-matching cards
            await board.flip('alice', 0, 0);  // A
            await board.flip('alice', 0, 1);  // B - no match, relinquishes
            
            // Bob takes control of one of Alice's cards
            await board.flip('bob', 0, 0);
            
            // Alice starts new move
            await board.flip('alice', 1, 0);
            
            const view = await board.look('bob');
            const lines = view.split('\n');
            assert.strictEqual(lines[1], 'my A');  // Bob's card stays up
            assert.strictEqual(lines[2], 'down ?');  // Alice's other card turned down
            
            await fs.promises.unlink(filename);
        });
        
    });

    // ========== Concurrency tests ==========
    
    describe('concurrency', function() {
        
        it('should handle multiple players flipping different cards', async function() {
            const filename = 'test-boards/concurrent1.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '3x3\nA\nB\nC\nA\nB\nC\nD\nD\nE\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            await board.addPlayer(new Player('bob'));
            
            // Alice and Bob flip simultaneously
            await Promise.all([
                board.flip('alice', 0, 0),
                board.flip('bob', 0, 1)
            ]);
            
            const aliceView = await board.look('alice');
            const bobView = await board.look('bob');
            
            const aliceLines = aliceView.split('\n');
            const bobLines = bobView.split('\n');
            
            assert.strictEqual(aliceLines[1], 'my A');
            assert.strictEqual(bobLines[2], 'my B');
            
            await fs.promises.unlink(filename);
        });
        
        it('should handle multiple waiters for same card', async function() {
            const filename = 'test-boards/concurrent2.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            await board.addPlayer(new Player('bob'));
            await board.addPlayer(new Player('charlie'));
            
            // Alice controls a card
            await board.flip('alice', 0, 0);
            
            // Bob and Charlie both wait for it
            const bobPromise = board.flip('bob', 0, 0);
            const charliePromise = board.flip('charlie', 0, 0);
            
            await timeout(10);  // Let them start waiting
            
            // Alice releases the card
            await board.flip('alice', 0, 1);  // No match, relinquishes
            
            // One of them should get it (but not both)
            await Promise.race([bobPromise, charliePromise]);
            
            await fs.promises.unlink(filename);
        });
        
        it('should handle player making move while another waits', async function() {
            const filename = 'test-boards/concurrent3.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '3x3\nA\nB\nC\nA\nB\nC\nD\nD\nE\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('alice'));
            await board.addPlayer(new Player('bob'));
            await board.addPlayer(new Player('charlie'));
            
            // Alice controls a card
            await board.flip('alice', 0, 0);
            
            // Bob waits for it
            const bobPromise = board.flip('bob', 0, 0);
            
            await timeout(10);
            
            // Charlie makes a completely different move
            await board.flip('charlie', 1, 1);
            await board.flip('charlie', 1, 2);  // Should work fine
            
            // Alice releases, Bob gets it
            await board.flip('alice', 0, 1);
            await bobPromise;
            
            const bobView = await board.look('bob');
            assert(bobView.includes('my A'));
            
            await fs.promises.unlink(filename);
        });
    });

    describe('map', function() {
        
        it('should transform all cards on the board', async function() {
            const filename = 'test-boards/map-simple.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('player1'));
            
            // Transform A->X, B->Y
            await board.map('player1', async (card) => {
                if (card === 'A') return 'X';
                if (card === 'B') return 'Y';
                return card;
            });
            
            // Flip cards to verify transformation
            await board.flip('player1', 0, 0);
            const view = await board.look('player1');
            assert(view.includes('my X')); // Was A, now X
            
            await fs.promises.unlink(filename);
        });
        
        it('should maintain pairwise consistency during transformation', async function() {
            const filename = 'test-boards/map-consistency.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('player1'));
            
            // Flip cards face up
            await board.flip('player1', 0, 0); // A at (0,0)
            await board.flip('player1', 0, 1); // B at (0,1) - no match
            
            // Both As should transform together
            await board.map('player1', async (card) => {
                await timeout(5);
                return `${card}-new`;
            });
            
            const view = await board.look('player1');
            assert(view.includes('A-new'));
            assert(view.includes('B-new'));
            
            await fs.promises.unlink(filename);
        });
    });

    describe('watch', function() {
        
        it('should wait for board changes', async function() {
            const filename = 'test-boards/watch-flip.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('player1'));
            
            // Start watching for changes
            let watchResolved = false;
            const watchPromise = board.watch('player1').then(() => {
                watchResolved = true;
            });
            
            // Verify watch hasn't resolved yet
            await timeout(10);
            assert(!watchResolved, 'Watch should not resolve before change');
            
            // Make a change: flip a card
            await board.flip('player1', 0, 0);
            
            // Watch should now resolve
            await watchPromise;
            assert(watchResolved, 'Watch should resolve after flip');
            
            await fs.promises.unlink(filename);
        });
        
        it('should notify on card removal', async function() {
            const filename = 'test-boards/watch-remove.txt';
            await fs.promises.mkdir('test-boards', { recursive: true });
            await fs.promises.writeFile(filename, '2x2\nA\nB\nA\nB\n');
            
            const board = await Board.parseFromFile(filename);
            await board.addPlayer(new Player('player1'));
            
            // Set up a match
            await board.flip('player1', 0, 0); // A
            await board.flip('player1', 1, 0); // A - match!
            
            // Start watching
            let watchResolved = false;
            const watchPromise = board.watch('player1').then(() => {
                watchResolved = true;
            });
            
            await timeout(10);
            assert(!watchResolved);
            
            // Remove the matched cards by making another move
            await board.flip('player1', 0, 1);
            
            // Watch should resolve
            await watchPromise;
            assert(watchResolved);
            
            await fs.promises.unlink(filename);
        });
    });
    
    // Cleanup test-boards directory after all tests
    after(async function() {
        try {
            const files = await fs.promises.readdir('test-boards');
            for (const file of files) {
                await fs.promises.unlink(`test-boards/${file}`);
            }
            await fs.promises.rmdir('test-boards');
        } catch (err) {
            // Directory might not exist, that's okay
        }
    });
});

/**
 * Helper function to create a delay
 * @param ms milliseconds to wait
 */
async function timeout(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
