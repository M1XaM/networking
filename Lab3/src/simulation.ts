/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import process from 'node:process';

/**
 * Example code for simulating a game.
 * 
 * PS4 instructions: you may use, modify, or remove this file,
 *   completing it is recommended but not required.
 * 
 * Command-line usage:
 *     npm run simulation [SERVER_URL]
 * where SERVER_URL is the base URL of the running server (defaults to 'http://localhost:8789')
 * 
 * Example:
 *     npm run simulation http://localhost:8789
 * 
 * @throws Error if an error occurs connecting to the server
 */
async function simulationMain(): Promise<void> {
    const serverUrl = process.argv[2];
    if (serverUrl === undefined || serverUrl === '') {
        throw new Error('SERVER_URL is required');
    }
    const players = 2;
    const tries = 100;
    const minDelayMilliseconds = 1000;
    const maxDelayMilliseconds = 2000;

    // Get board size from the server
    const boardSize = await getBoardSize(serverUrl);
    const size = { row: boardSize.row, col: boardSize.col };

    // start up one or more players as concurrent asynchronous function calls
    const playerPromises: Array<Promise<void>> = [];
    for (let ii = 0; ii < players; ++ii) {
        playerPromises.push(player(ii, serverUrl, size));
    }
    // wait for all the players to finish (unless one throws an exception)
    await Promise.all(playerPromises);

    /**
     * @param playerNumber player to simulate
     * @param baseUrl base URL of the server
     * @param size board dimensions
     * @param size.row number of rows on the board
     * @param size.col number of columns on the board
     */
    async function player(playerNumber: number, baseUrl: string, size: { row: number, col: number }): Promise<void> {
        const playerId = `player${playerNumber}`;
        
        // Set up this player on the board by calling look endpoint
        try {
            await httpGet(`${baseUrl}/look/${playerId}`);
        } catch (err) {
            console.error(`Failed to initialize player ${playerNumber}:`, err);
            return;
        }

        for (let jj = 0; jj < tries; ++jj) {
            // First flip with its own error handling
            try {
                const delay1 = minDelayMilliseconds + Math.random() * (maxDelayMilliseconds - minDelayMilliseconds);
                await timeout(delay1);
                
                const row1 = randomInt(size.row);
                const col1 = randomInt(size.col);
                await httpGet(`${baseUrl}/flip/${playerId}/${row1},${col1}`);
            } catch (err) {
                console.error(`Player ${playerNumber}, move ${jj}, first flip failed:`, err);
                // Don't return or continue - let it try the second flip
            }

            // Second flip with its own error handling
            try {
                const delay2 = minDelayMilliseconds + Math.random() * (maxDelayMilliseconds - minDelayMilliseconds);
                await timeout(delay2);
                
                const row2 = randomInt(size.row);
                const col2 = randomInt(size.col);
                await httpGet(`${baseUrl}/flip/${playerId}/${row2},${col2}`);
            } catch (err) {
                console.error(`Player ${playerNumber}, move ${jj}, second flip failed:`, err);
                // Don't return or continue - let the loop proceed to next attempt
            }
        }
    }

    /**
     * Get board size from the server by calling look endpoint
     * @param baseUrl base URL of the server
     * @returns promise that resolves to board dimensions
     */
    async function getBoardSize(baseUrl: string): Promise<{ row: number, col: number }> {
        const response = await httpGet(`${baseUrl}/look/temp`);
        const lines = response.split('\n');
        const sizeLine = lines[0];
        if (sizeLine === undefined || sizeLine === '') {
            throw new Error('Invalid board response: missing size line');
        }
        const parts = sizeLine.split('x');
        const row = parseInt(parts[0] ?? '0', 10);
        const col = parseInt(parts[1] ?? '0', 10);
        if (isNaN(row) || isNaN(col) || row <= 0 || col <= 0) {
            throw new Error(`Invalid board size: ${sizeLine}`);
        }
        return { row, col };
    }

    /**
     * Make an HTTP GET request
     * @param url URL to fetch
     * @returns promise that resolves to the response text
     */
    async function httpGet(url: string): Promise<string> {
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        return await response.text();
    }
}

/**
 * Random positive integer generator
 * 
 * @param max a positive integer which is the upper bound of the generated number
 * @returns a random integer >= 0 and < max
 */
function randomInt(max: number): number {
    return Math.floor(Math.random() * max);
}


/**
 * @param milliseconds duration to wait
 * @returns a promise that fulfills no less than `milliseconds` after timeout() was called
 */
async function timeout(milliseconds: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, milliseconds);
    return promise;
}

void simulationMain();
