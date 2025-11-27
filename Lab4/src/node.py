import os
import time
import threading
import concurrent.futures
import uuid
import random
import requests
import flask
import kv_store

app = flask.Flask(__name__)
store = kv_store.KeyValueStore()

ROLE = os.getenv('ROLE', 'follower')
FOLLOWERS = [f.strip() for f in os.getenv('FOLLOWERS', 'http://follower1:8001,http://follower2:8002,http://follower3:8003,http://follower4:8004,http://follower5:8005').split(',') if f.strip()]
WRITE_QUORUM = int(os.getenv('WRITE_QUORUM', '3'))
WORKER_THREADS = int(os.getenv('WORKER_THREADS', '10'))
MIN_DELAY = float(os.getenv('MIN_DELAY', 1)) / 1000.0
MAX_DELAY = float(os.getenv('MAX_DELAY', 1000)) / 1000.0

executor = concurrent.futures.ThreadPoolExecutor(max_workers=WORKER_THREADS)
jobs = {}
job_lock = threading.Lock()

# For all
def submit_job(fn):
    job_id = str(uuid.uuid4())
    with job_lock:
        jobs[job_id] = {'status': 'pending', 'result': None, 'error': None}
    
    def _run_job():
        with job_lock:
            jobs[job_id]['status'] = 'running'
        try:
            result = fn()
            with job_lock:
                jobs[job_id].update({'status': 'done', 'result': result})
        except Exception as e:
            with job_lock:
                jobs[job_id].update({'status': 'failed', 'error': str(e)})
    
    executor.submit(_run_job)
    return job_id

def random_delay():
    actual_delay = random.uniform(MIN_DELAY, MAX_DELAY)
    time.sleep(actual_delay)
    return actual_delay

def _get_request_data():
    data = flask.request.get_json(silent=True) or {}
    args = flask.request.args
    form = flask.request.form
    
    key = data.get('key') or form.get('key') or args.get('key')
    value = data.get('value') or form.get('value') or args.get('value')
    
    req_quorum = args.get('quorum') or data.get('quorum')
    if req_quorum:
        try:
            req_quorum = max(1, int(req_quorum))
        except (ValueError, TypeError):
            return None, None, None, flask.jsonify({'error': 'invalid quorum value'})
    
    return key, value, req_quorum, None

@app.route('/health', methods=['GET'])
def health():
    return flask.jsonify({'status': 'ok', 'role': ROLE})

@app.route('/read_all', methods=['GET'])
def read_all():
    def _sanitize(v):
        if v is None or isinstance(v, (str, int, float, bool)):
            return v
        if isinstance(v, (dict, list, tuple, set)):
            import json
            try: json.dumps(v); return v
            except Exception: return str(v)
        return str(v)
    
    with store.lock:
        snapshot = {str(k): _sanitize(v) for k, v in store.store.items()}
    return flask.jsonify(snapshot)

@app.route('/read', methods=['GET'])
def read():
    key = flask.request.args.get('key')
    return flask.jsonify({'value': store.get(key)}) if key else (
        flask.jsonify({'error': 'missing key'}), 400)

@app.route('/job/<job_id>', methods=['GET'])
def job_status(job_id):
    with job_lock:
        job = jobs.get(job_id)
    return flask.jsonify({'job_id': job_id, **job}) if job else (
        flask.jsonify({'error': 'job not found'}), 404)

# For leader only
def replicate_to_followers(key, value, action='put', follower_async=True, write_quorum=None):
    if ROLE != 'leader':
        return False, 0
    
    if not FOLLOWERS:
        return True, 1
    
    payload = {'key': key, 'action': action}
    if action == 'put':
        payload['value'] = value
    
    acked = 0
    ack_lock = threading.Lock()
    required_quorum = write_quorum if write_quorum is not None else WRITE_QUORUM
    
    quorum_event = threading.Event()
    results = {}
    
    def send_to_follower(follower):
        nonlocal acked
        try:
            actual_delay = random_delay()
            
            url = f'{follower}/replicate'
            params = {'async': 'true'} if follower_async else None
            resp = requests.post(url, json=payload, params=params, timeout=5)
            
            with ack_lock:
                if resp.ok:
                    acked += 1
                    results[follower] = {'success': True, 'delay': actual_delay}
                    
                    if (acked + 1) >= required_quorum and not quorum_event.is_set():
                        quorum_event.set()
                else:
                    results[follower] = {'success': False, 'delay': actual_delay}
        except Exception as e:
            with ack_lock:
                results[follower] = {'success': False, 'delay': actual_delay, 'error': str(e)}
    
    threads = [threading.Thread(target=send_to_follower, args=(follower,), daemon=True) 
               for follower in FOLLOWERS]
    
    for t in threads:
        t.start()
    
    quorum_event.wait(timeout=15)
    
    quorum_met = (acked + 1) >= required_quorum
    
    return quorum_met, acked + 1

@app.route('/write', methods=['POST'])
def write():
    if ROLE != 'leader':
        return flask.jsonify({'error': 'forbidden: not a leader'}), 403
    
    key, value, quorum, error = _get_request_data()
    if error or not key or value is None:
        return error or flask.jsonify({'error': 'missing key or value'}), 400
    
    store.put(key, value)
    
    quorum_met, acked = replicate_to_followers(key, value, 'put', False, quorum)
    
    if quorum_met:
        return flask.jsonify({'status': 'committed', 'acked': acked}), 200
    else:
        return flask.jsonify({'error': 'quorum not met', 'acked': acked}), 500

# For followers only
@app.route('/replicate', methods=['POST'])
def replicate():
    if ROLE == 'leader':
        return flask.jsonify({'error': 'forbidden: leaders do not accept replication requests'}), 403
    
    data = flask.request.get_json(silent=True) or {}
    key, action = data.get('key'), data.get('action', 'put')
    
    if not key or (action == 'put' and 'value' not in data):
        return flask.jsonify({'error': f'missing {"key" if not key else "value"}'}), 400
        
    def apply_operation():
        if action == 'put':
            store.put(key, data['value'])
        else:
            store.delete(key)
    
    job_id = submit_job(apply_operation)
    return flask.jsonify({'status': 'accepted', 'job_id': job_id}), 202

if __name__ == '__main__':
    port = int(os.getenv('PORT', '8000'))
    app.run(host='0.0.0.0', port=port, threaded=True)