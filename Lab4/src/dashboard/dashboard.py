import os
import flask
import requests

app = flask.Flask(__name__, static_folder='static', static_url_path='')

# List of all node URLs (leader + followers)
LEADER = os.getenv('LEADER', 'http://leader:8000')
FOLLOWERS_STR = os.getenv('FOLLOWERS', 'http://follower1:8001,http://follower2:8002,http://follower3:8003,http://follower4:8004,http://follower5:8005')
FOLLOWERS = [f.strip() for f in FOLLOWERS_STR.split(',') if f.strip()] if FOLLOWERS_STR else []
NODES = [LEADER] + FOLLOWERS

@app.route('/')
def index():
    return flask.send_file('index.html')

@app.route('/api/all_data', methods=['GET'])
def all_data():
    result = {}
    for node_url in NODES:
        try:
            resp = requests.get(f'{node_url}/read_all', timeout=2)
            if resp.status_code == 200:
                result[node_url] = resp.json()
            else:
                result[node_url] = {'error': f'Status {resp.status_code}'}
        except Exception as e:
            result[node_url] = {'error': str(e)}
    print(flask.jsonify(result))
    return flask.jsonify(result)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)