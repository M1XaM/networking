import random
import requests
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import statistics
import matplotlib.pyplot as plt

LEADER = os.getenv('LEADER', 'http://leader:8000')
FOLLOWERS = [f.strip() for f in os.getenv('FOLLOWERS', 'http://follower1:8001,http://follower2:8002,http://follower3:8003,http://follower4:8004,http://follower5:8005').split(',') if f.strip()]
WRITES = 100
CONCURRENCY = 10
KEYS = 10
SAME_KEY = False
QUORUM = None
USE_URL_QUORUM = True
WAIT = True

def do_write(leader_url, key, value, timeout=10.0, quorum=None):
    params = {}
    if quorum and USE_URL_QUORUM:
        params['quorum'] = str(quorum)
    
    start = time.perf_counter()
    try:
        r = requests.post(f'{leader_url}/write', json={'key': key, 'value': value}, 
                         params=params, timeout=timeout)
        latency = time.perf_counter() - start
        return latency, r.status_code, r.text
    except Exception as e:
        latency = time.perf_counter() - start
        return latency, 0, str(e)

def run_writes(leader_url, keys, total_writes=WRITES, concurrency=10, quorum=None, same_key=False):
    latencies, errors, statuses = [], 0, {}
    error_samples = []
    
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = [ex.submit(do_write, leader_url, 
                           keys[0] if same_key else random.choice(keys), 
                           f'{int(time.time()*1000)}-{i}', 
                           quorum=quorum) 
                  for i in range(total_writes)]
        
        for f in as_completed(futures):
            lat, status, text = f.result()
            latencies.append(lat)
            statuses[status] = statuses.get(status, 0) + 1
            if status == 0 or status >= 400:
                errors += 1
                if len(error_samples) < 3:
                    error_samples.append(f"status={status}, text={text[:100]}")
    
    stats = {
        'avg_latency': statistics.mean(latencies) if latencies else 0.0,
        'median_latency': statistics.median(latencies) if latencies else 0.0,
        'p95_latency': statistics.quantiles(latencies, n=100)[94] if len(latencies) >= 100 else (max(latencies) if latencies else 0.0),
        'p99_latency': statistics.quantiles(latencies, n=100)[98] if len(latencies) >= 100 else (max(latencies) if latencies else 0.0),
        'stddev': statistics.pstdev(latencies) if latencies else 0.0,
        'statuses': statuses, 'errors': errors, 'count': len(latencies), 
        'latencies': latencies, 'error_samples': error_samples
    }
    return stats

def check_leader_health(leader_url):
    try:
        r = requests.get(f'{leader_url}/health', timeout=5)
        if r.status_code == 200:
            return True
        else:
            return False
    except Exception as e:
        return False

def check_follower_health(follower_url):
    try:
        r = requests.get(f'{follower_url}/health', timeout=5)
        if r.status_code == 200:
            return True
        return False
    except Exception:
        return False

def main():
    keys = [f'k{i}' for i in range(KEYS)]
    quorum_values = list(range(1, 6))
    avg_latencies, p95s, p99s, medians = [], [], [], []
    
    if not check_leader_health(LEADER):
        return
    
    healthy_followers = 0
    for follower in FOLLOWERS:
        if check_follower_health(follower):
            healthy_followers += 1
    
    for q in quorum_values:
        print(f'Testing WRITE_QUORUM={q}')
        
        if WAIT and not wait_up(LEADER, timeout=30):
            continue
            
        q_override = QUORUM or q
        result = run_writes(LEADER, keys, WRITES, CONCURRENCY, q_override, SAME_KEY)
        
        avg_latencies.append(result['avg_latency'])
        p95s.append(result.get('p95_latency', 0.0))
        p99s.append(result.get('p99_latency', 0.0))
        medians.append(result.get('median_latency', 0.0))
        
        time.sleep(1)

    plot_results(quorum_values, avg_latencies, p95s, p99s, medians, './results/out.png')

def read_key(node_url, key, timeout=5.0):
    try:
        r = requests.get(f'{node_url}/read', params={'key': key}, timeout=timeout)
        return r.json().get('value') if r.status_code == 200 else None
    except Exception:
        return None

def compare_stores(leader_url, follower_urls, keys):
    leader_values = {k: read_key(leader_url, k) for k in keys}
    return {
        f: {k: {'leader_value': leader_values[k], 
                'follower_value': read_key(f, k),
                'match': leader_values[k] == read_key(f, k)} 
             for k in keys}
        for f in follower_urls
    }

def plot_results(quorum_values, avg_latencies, p95s, p99s, medians, out_file='./results/out.png'):
    plt.clf()
    plt.plot(quorum_values, avg_latencies, marker='o', label='avg')
    plt.plot(quorum_values, p95s, marker='x', linestyle='--', label='p95')
    plt.plot(quorum_values, p99s, marker='^', linestyle='--', label='p99')
    plt.plot(quorum_values, medians, marker='s', linestyle='-.', label='median')
    plt.legend()
    plt.xlabel('Write Quorum'); plt.ylabel('Avg Write Latency (s)')
    plt.title('Write Quorum vs Write Latency'); plt.grid(True)
    plt.savefig(out_file)

def wait_up(url, timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        try:
            if requests.get(f'{url}/health', timeout=1).status_code == 200:
                return True
        except Exception:
            time.sleep(0.5)
    return False

if __name__ == '__main__':
    main()