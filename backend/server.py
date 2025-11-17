from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
import re
from pathlib import Path

app = Flask(__name__)
CORS(app)

# In-memory DB
FUNCTIONS = []  # list of { name, file, covered, total, coveragePct }
CFG_MAP = {}    # function_name -> { cfg:..., module: ... }

PERSIST_FILE = Path('.coverage_index.json')

def save_index():
    try:
        with open(PERSIST_FILE, 'w') as f:
            json.dump({'functions': FUNCTIONS, 'cfg_map': CFG_MAP}, f)
    except Exception as e:
        print('save failed', e)

def load_index():
    global FUNCTIONS, CFG_MAP
    if PERSIST_FILE.exists():
        try:
            with open(PERSIST_FILE) as f:
                obj = json.load(f)
                FUNCTIONS = obj.get('functions', [])
                CFG_MAP = obj.get('cfg_map', {})
        except Exception as e:
            print('load failed', e)

@app.route('/load-coverage-path', methods=['POST'])
def load_coverage_path():
    global FUNCTIONS
    payload = request.get_json() or {}
    path = payload.get('path')

    if not path:
        return jsonify({'error': 'path required'}), 400
    if not os.path.isfile(path):
        return jsonify({'error': 'file not found'}), 400

    try:
        with open(path) as f:
            data = json.load(f)
    except Exception as e:
        return jsonify({'error': f'invalid JSON: {e}'}), 400

    FUNCTIONS = []

    def process_function_entry(entry, source_file=None):
        name = entry.get('name') or '<unknown>'
        related_files = entry.get('filenames')
        file = source_file or '<unknown>'
        if isinstance(related_files, list) and related_files:
            file = entry.get('filenames')[0]
        regions = entry.get('regions') or entry.get('ranges') or []
        norm_regions = []
        if isinstance(regions, list):
            for r in regions:
                if isinstance(r, list) and len(r) >= 5:
                    line = r[0]
                    count = r[4]
                    norm_regions.append({'line': line, 'count': count})
                elif isinstance(r, dict):
                    line = r.get('line') or r.get('startLine') or (r.get('start') or {}).get('line')
                    count = r.get('count') or r.get('executionCount') or 0
                    norm_regions.append({'line': line, 'count': count})

        total = len(norm_regions)
        covered = sum(1 for rr in norm_regions if rr.get('count', 0) > 0)
        pct = (covered / total * 100) if total else None
        FUNCTIONS.append({'name': name, 'file': file, 'covered': covered, 'total': total, 'coveragePct': pct})

    for d in data.get('data', []):
        for fobj in d.get('files', []):
            for func in fobj.get('functions', []):
                process_function_entry(func, fobj.get('filename'))
        for func in d.get('functions', []):
            process_function_entry(func)

    for func in data.get('functions', []):
        process_function_entry(func)

    save_index()
    return jsonify({'status': 'ok', 'functions_loaded': len(FUNCTIONS)})

#@app.route('/upload-coverage', methods=['POST'])
#def upload_coverage():
#    global FUNCTIONS
#    if 'file' not in request.files:
#        return jsonify({'error': 'no file provided'}), 400
#    f = request.files['file']
#    try:
#        data = json.load(f)
#    except Exception as e:
#        return jsonify({'error': f'invalid JSON: {e}'}), 400
#
#    FUNCTIONS = []
#
#    def process_function_entry(entry, source_file=None):
#        name = entry.get('name') or entry.get('funcName') or entry.get('function') or '<unknown>'
#        file = source_file or entry.get('filename') or entry.get('file') or '<unknown>'
#        regions = entry.get('regions') or entry.get('ranges') or []
#        norm_regions = []
#        if isinstance(regions, list):
#            for r in regions:
#                if isinstance(r, list) and len(r) >= 5:
#                    line = r[0]
#                    count = r[4]
#                    norm_regions.append({'line': line, 'count': count})
#                elif isinstance(r, dict):
#                    line = r.get('line') or r.get('startLine') or (r.get('start') or {}).get('line')
#                    count = r.get('count') or r.get('executionCount') or 0
#                    norm_regions.append({'line': line, 'count': count})
#
#        total = len(norm_regions)
#        covered = sum(1 for rr in norm_regions if rr.get('count', 0) > 0)
#        pct = (covered / total * 100) if total else None
#        FUNCTIONS.append({'name': name, 'file': file, 'covered': covered, 'total': total, 'coveragePct': pct})
#
#    for d in data.get('data', []):
#        for fobj in d.get('files', []):
#            for func in fobj.get('functions', []):
#                process_function_entry(func, fobj.get('filename'))
#        for func in d.get('functions', []):
#            process_function_entry(func)
#
#    for func in data.get('functions', []):
#        process_function_entry(func)
#
#    save_index()
#    return jsonify({'status': 'ok', 'functions_loaded': len(FUNCTIONS)})

@app.route('/load-cfg-dir', methods=['POST'])
def load_cfg_dir():
    global CFG_MAP
    payload = request.get_json() or {}
    path = payload.get('path')
    if not path:
        return jsonify({'error': 'path required'}), 400
    if not os.path.isdir(path):
        return jsonify({'error': 'path not found or not a directory'}), 400

    CFG_MAP = {}
    functions_with_cfg = 0
    for root, dirs, files in os.walk(path):
        for fn in files:
            if fn.startswith('cfg.') and fn.endswith('.json'):
                full = os.path.join(root, fn)
                try:
                    with open(full) as fh:
                        obj = json.load(fh)
                        for f in obj.get('functions', []):
                            name = f.get('name')
                            if not name:
                                continue
                            CFG_MAP[name] = {'cfg': f, 'module': obj.get('modules')}
                            functions_with_cfg += 1
                except Exception as e:
                    print('Failed to parse cfg', full, e)

    save_index()
    return jsonify({'status': 'ok', 'functions_with_cfg': functions_with_cfg})

@app.route('/functions')
def list_functions():
    q = request.args
    regex = q.get('regex')
    page = int(q.get('page', 1))
    limit = int(q.get('limit', 100))
    sortBy = q.get('sortBy', 'coverage')
    sortDir = q.get('sortDir', 'desc')

    candidates = FUNCTIONS
    if regex:
        try:
            r = re.compile(regex)
        except re.error as e:
            return jsonify({'error': f'invalid regex: {e}'}), 400

        filtered = []
        for f in candidates:
            cfg_entry = CFG_MAP.get(f['name'])
            module_path = cfg_entry.get('module') if cfg_entry else f.get('file')
            try:
                if module_path and os.path.isfile(module_path):
                    with open(module_path, errors='ignore') as fh:
                        txt = fh.read()
                        if r.search(txt):
                            filtered.append(f)
                            continue
                if r.search(f.get('file', '')) or r.search(f.get('name', '')):
                    filtered.append(f)
            except Exception:
                continue
        candidates = filtered

    for f in candidates:
        f['missed'] = (f.get('total') or 0) - (f.get('covered') or 0)

    if sortBy == 'alpha':
        candidates.sort(key=lambda x: x.get('name') or '')
    elif sortBy == 'coverage':
        candidates.sort(key=lambda x: (x.get('coveragePct') is None, -(x.get('coveragePct') or 0)))
    elif sortBy == 'missed':
        candidates.sort(key=lambda x: x.get('missed', 0), reverse=True)

    total = len(candidates)
    start = (page - 1) * limit
    end = start + limit
    page_items = candidates[start:end]
    return jsonify({'total': total, 'page': page, 'limit': limit, 'functions': page_items})

@app.route('/function/<path:name>')
def get_function(name):
    nm = name
    cfg_entry = CFG_MAP.get(nm)
    coverage = next((f for f in FUNCTIONS if f.get('name') == nm), None)
    return jsonify({'cfg': cfg_entry.get('cfg') if cfg_entry else None, 'module': cfg_entry.get('module') if cfg_entry else None, 'coverage': coverage})

if __name__ == '__main__':
    load_index()
    app.run(host='0.0.0.0', port=5000, debug=True)
