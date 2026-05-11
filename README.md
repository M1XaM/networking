# Networking

This repository contains laboratory works for the **Network Programming (PR)** course.

## Overview

* **[Lab 1: HTTP File Server](Lab1/)**  
  Implementation of a basic HTTP file server from scratch using raw TCP sockets in Python. It supports serving static HTML files, images, PDFs, and dynamically handling directory contents. It also includes basic error handling, MIME type resolution, a simple Python client, and is packaged with a `docker-compose.yml` configuration for straightforward deployment.

* **[Lab 2: Concurrent HTTP Server](Lab2/)**  
  An extension of Lab 1 focused on concurrency and connection management. This lab implements concurrent request handling in the HTTP server, allowing it to efficiently serve multiple clients simultaneously using multi-threading. It introduces robust stress-testing scripts within the `tests/` directory to benchmark performance against multiple concurrent connections and high loads.

* **[Lab 3: Memory Scramble (Multiplayer Game)](Lab3/)**  
  A multiplayer card matching game based on the MIT 6.102 (2025) Memory Scramble lab. Written in TypeScript and running on Node.js, this project implements a thread-safe, concurrent game board (`Board ADT`) exposed via an HTTP REST API. It handles parallel game state mutations, simulating concurrent matching attempts, and features strict linting and internal unit tests to guarantee safety against race conditions.

* **[Lab 4: Distributed Key-Value Store](Lab4/)**  
  A distributed key-value store emphasizing consensus, replication, and fault tolerance. Built defensively using Flask, it sets up a cluster topology involving a leader and multiple follower nodes. Key features include write quorums, asynchronous state synchronization, artificial network delays for testing robustness, and a centralized monitoring dashboard giving insight into the health and data state of the distributed cluster. All orchestrated seamlessly using Docker Compose.
