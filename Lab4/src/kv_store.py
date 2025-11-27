import threading

class KeyValueStore:
    def __init__(self):
        self.store = {}
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            return self.store.get(key)

    def put(self, key, value):
        with self.lock:
            self.store[key] = value

    def delete(self, key):
        with self.lock:
            self.store.pop(key, None)